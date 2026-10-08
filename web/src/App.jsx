import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { get } from './api.js'
import TableSection from './components/TableSection.jsx'
import PlantModal from './components/PlantModal.jsx'
import LegendBar from './components/LegendBar.jsx'
import { Tabs, BottomTabs } from './components/Tabs.jsx'
import HarvestBanner from './components/HarvestBanner.jsx'
import HistoryModal from './components/HistoryModal.jsx'
import StatsPage from './components/StatsPage.jsx'
import HistoryPage from './components/HistoryPage.jsx'
import CatalogPage from './components/CatalogPage.jsx'
import TankPanel from './components/TankPanel.jsx'
import MonitoringPage from './features/iot/MonitoringPage.jsx'
import TrendPage from './features/iot/TrendPage.jsx'

const EMPTY_MODAL = { open: false, tableNumber: 1, pipeNumber: 1 }

// Halaman Plan: shell data katalog/batch + grid pipa + modal.
// Di-mount di /plan/* lewat route di bawah.
function PlanLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  const [catalog, setCatalog] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(EMPTY_MODAL)
  const [history, setHistory] = useState(null)

  // Sub-route Plan -> tab aktif.
  const tab = useMemo(() => {
    if (location.pathname.startsWith('/plan/history')) return 'history'
    if (location.pathname.startsWith('/plan/stats')) return 'stats'
    if (location.pathname.startsWith('/plan/catalog')) return 'catalog'
    return 'dashboard'
  }, [location.pathname])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cat, bat] = await Promise.all([get('/catalog'), get('/batches')])
      setCatalog(cat)
      setBatches(bat)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Susun grid: { tableNumber: { pipeNumber: batch } }
  const byTable = { 1: {}, 2: {}, 3: {} }
  for (const b of batches) {
    if (!byTable[b.tableNumber]) byTable[b.tableNumber] = {}
    byTable[b.tableNumber][b.pipeNumber] = b
  }

  function openPipe(tableNumber, pipeNumber) {
    setModal({ open: true, tableNumber, pipeNumber })
  }

  function closeModal() {
    setModal(EMPTY_MODAL)
  }

  async function handleSaved() {
    closeModal()
    await load()
  }

  function openHistory(tableNumber, pipeNumber) {
    setHistory({ tableNumber, pipeNumber })
  }

  const activeBatch = modal.open
    ? byTable[modal.tableNumber]?.[modal.pipeNumber] || null
    : null

  const activeModalHasHistory = activeBatch
    ? batches.some(
        (b) =>
          b.tableNumber === activeBatch.tableNumber &&
          b.pipeNumber === activeBatch.pipeNumber &&
          b.hasHistory
      )
    : false

  function changeTab(key) {
    if (key === 'dashboard') navigate('/plan')
    else navigate(`/plan/${key}`)
  }

  return (
    <>
      <div className="glass-panel p-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text-hi">Plan Hidroponik</h1>
          <p className="hidden md:block text-sm text-text-low">
            3 meja &middot; 6 pipa per meja &middot; Meja 3 pembibitan, Meja 1-2 pembesaran
            &middot; klik pipa untuk tanam / lihat detail
          </p>
        </div>
        <Tabs active={tab} onChange={changeTab} />
      </div>

      <div className="space-y-6 pb-20 md:pb-0">
        {error && (
          <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-4 py-3">
            {error}
          </div>
        )}

        {tab === 'dashboard' && (
          <>
            <HarvestBanner
              batches={batches}
              onHarvest={(b) => openPipe(b.tableNumber, b.pipeNumber)}
            />
            <LegendBar />

            {loading ? (
              <p className="text-text-low">Memuat data...</p>
            ) : (
              <div className="space-y-6">
                <TankPanel onGoCatalog={() => changeTab('catalog')} />
                <TableSection
                  tableNumber={3}
                  title="Meja 3 · Pembibitan"
                  hint="Tanam baru di sini, pindahkan ke Meja 1-2 saat siap"
                  batches={byTable[3]}
                  onPipeClick={openPipe}
                  onHistoryClick={openHistory}
                />
                <TableSection
                  tableNumber={1}
                  title="Meja 1 · Pembesaran"
                  hint="Hanya diisi via pindahan dari Meja 3"
                  batches={byTable[1]}
                  onPipeClick={openPipe}
                  onHistoryClick={openHistory}
                />
                <TableSection
                  tableNumber={2}
                  title="Meja 2 · Pembesaran"
                  hint="Hanya diisi via pindahan dari Meja 3"
                  batches={byTable[2]}
                  onPipeClick={openPipe}
                  onHistoryClick={openHistory}
                />
              </div>
            )}
          </>
        )}

        {tab === 'history' && <HistoryPage catalog={catalog} />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'catalog' && <CatalogPage catalog={catalog} onChanged={load} />}
      </div>

      <PlantModal
        modal={modal}
        catalog={catalog}
        batch={activeBatch}
        batches={batches}
        hasHistory={activeModalHasHistory}
        onClose={closeModal}
        onSaved={handleSaved}
        onOpenHistory={openHistory}
      />

      {history && (
        <HistoryModal
          tableNumber={history.tableNumber}
          pipeNumber={history.pipeNumber}
          onClose={() => setHistory(null)}
          onDeleted={() => load()}
        />
      )}

      <BottomTabs active={tab} onChange={changeTab} />
    </>
  )
}

// Shell app: header top-level + routing Monitoring/Plan.
export default function App() {
  const location = useLocation()
  const navigate = useNavigate()

  const inIot = location.pathname.startsWith('/monitoring')

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-surface-bg/90 backdrop-blur border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-lg font-bold text-text-hi">Hidroponik</h1>
          <nav className="flex gap-1.5">
            {[
              { key: 'monitoring', label: 'Monitoring', to: '/monitoring' },
              { key: 'plan', label: 'Plan', to: '/plan' },
            ].map((s) => {
              const active = s.key === 'monitoring' ? inIot : !inIot
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => navigate(s.to)}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center whitespace-nowrap rounded-xl px-3.5 py-2 text-sm
                    font-semibold transition active:scale-[0.97]
                    ${
                      active
                        ? 'bg-ios-blue text-white shadow-glow-blue'
                        : 'text-text-low hover:bg-white/5 hover:text-text-body'
                    }`}
                >
                  {s.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/monitoring" replace />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/monitoring/trend/:sensor" element={<TrendPage />} />
          <Route path="/plan/*" element={<PlanLayout />} />
          <Route path="*" element={<Navigate to="/monitoring" replace />} />
        </Routes>
      </main>
    </div>
  )
}
