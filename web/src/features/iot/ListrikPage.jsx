import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSensorData } from './useSensorData.js'
import { useToast } from './Toast.jsx'
import PzemChart from './PzemChart.jsx'
import PzemTable from './PzemTable.jsx'
import { isOnline, FILTERS, timeLabel } from './utils.js'
import {
  PZEM_METRICS,
  PZEM_ORDER,
  downloadPzemCSV,
  energyDelta,
  estimateCost,
  formatRupiah,
  parseTariff,
  pzemAlertStatus,
  pzemCardClass,
  pzemValueClass,
  pzemValueOrNull,
} from './listrikUtils.js'

const TARIFF_STORAGE_KEY = 'listrik_tariff'
const DEFAULT_TARIFF = 1444.7

// Jam realtime (paralel MonitoringPage).
function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

// Kartu ringkasan 1 metrik listrik.
function PzemCard({ metricKey, row, onOpenTrend }) {
  const meta = PZEM_METRICS[metricKey]
  const status = pzemAlertStatus(metricKey, row)
  const value = pzemValueOrNull(row, metricKey)

  return (
    <button
      type="button"
      onClick={() => onOpenTrend && onOpenTrend(metricKey)}
      className={`glass-panel p-5 text-center cursor-pointer ${meta.glow} ${pzemCardClass(status)}`}
    >
      <div className="text-3xl mb-3 drop-shadow-[0_4px_6px_rgba(0,0,0,0.3)]">{meta.icon}</div>
      <div className="text-sm text-text-low font-semibold tracking-[-0.2px]">{meta.label}</div>
      {row && value !== null ? (
        <div
          className={`text-2xl font-bold mt-1.5 tracking-[-0.5px] text-glow-white ${pzemValueClass(
            status
          )}`}
        >
          {value}
          {meta.unit ? ` ${meta.unit}` : ''}
        </div>
      ) : (
        <div className="skeleton mt-1.5" aria-hidden="true" />
      )}
    </button>
  )
}

// Halaman Listrik: header + jam + status, filter, tarif, kartu energi/biaya,
// 6 kartu metrik, 6 chart, tabel riwayat.
export default function ListrikPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const now = useClock()
  const [filter, setFilter] = useState('realtime')
  const [tariffInput, setTariffInput] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TARIFF_STORAGE_KEY) : null
    return saved !== null ? saved : String(DEFAULT_TARIFF)
  })
  const { data, loading, error } = useSensorData({ filter, domain: 'listrik', pollMs: 1000 })

  const latest = data.length ? data[data.length - 1] : null
  const online = isOnline(latest?.waktu)
  const labels = data.map((row) => timeLabel(row.waktu))

  const tariff = parseTariff(tariffInput)
  const delta = useMemo(() => energyDelta(data), [data])
  const cost = useMemo(() => estimateCost(delta, tariff), [delta, tariff])

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(TARIFF_STORAGE_KEY, tariffInput)
  }, [tariffInput])

  function handleExport() {
    const ok = downloadPzemCSV(data, filter)
    if (!ok) toast.error('Data kosong.')
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center mb-6 px-5 pt-2">
        <h1 className="font-bold tracking-[-0.5px] m-0 text-[28px] text-white text-glow-white">
          Dashboard Listrik
        </h1>
        <p className="text-text-low mt-1 text-[15px]">Pemantauan Daya &amp; Energi (PZEM-004T)</p>
        <div className="my-4">
          <div className="text-[56px] font-bold tracking-[-2px] text-white leading-none [text-shadow:0_0_25px_rgba(255,255,255,0.4)]">
            {now.toLocaleTimeString('id-ID', { hour12: false })}
          </div>
          <div className="text-base text-text-mid font-medium mt-0.5">
            {now.toLocaleDateString('id-ID', {
              weekday: 'long',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </div>
        </div>
        <div className="text-[13px] text-text-low mt-4">
          {latest
            ? `Diperbarui: ${new Date(latest.waktu).toLocaleString('id-ID')}`
            : 'Memperbarui data...'}
        </div>
        <div className="mt-4">
          <span
            className={`inline-block px-3.5 py-1.5 rounded-full font-semibold text-[13px] transition-all
              ${
                online
                  ? 'bg-[rgba(48,209,88,0.2)] text-ios-green border border-ios-green [box-shadow:0_0_10px_rgba(48,209,88,0.3)]'
                  : 'bg-[rgba(255,69,58,0.2)] text-ios-red border border-ios-red [box-shadow:0_0_10px_rgba(255,69,58,0.3)]'
              }`}
          >
            {latest ? (online ? 'Online' : 'Offline') : 'Menghubungkan...'}
          </span>
        </div>

        <div className="mt-6 flex justify-center gap-3 items-center flex-wrap">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-4 py-2.5 text-[15px] rounded-xl border border-white/10 outline-none cursor-pointer
              bg-white/10 text-white font-medium input-ios"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value} className="bg-neutral-900">
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExport}
            className="px-4.5 py-2.5 text-sm rounded-xl bg-white/10 text-ios-blue font-semibold
              hover:bg-ios-blue/15 hover:shadow-glow-blue transition btn-ios"
          >
            Unduh CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-4 py-3">
          Gagal memuat data: {error}
        </div>
      )}

      {/* Kartu energi periode + estimasi biaya + input tarif */}
      <div className="glass-panel p-6 mx-auto max-w-[1300px]">
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] items-end">
          <div>
            <div className="text-sm text-text-low font-semibold uppercase tracking-[0.5px]">
              Pemakaian Periode
            </div>
            <div className="text-3xl font-bold mt-2 text-white tracking-[-0.5px]">
              {delta === null ? '—' : `${delta.toFixed(3)} kWh`}
            </div>
          </div>
          <div>
            <div className="text-sm text-text-low font-semibold uppercase tracking-[0.5px]">
              Estimasi Biaya
            </div>
            <div className="text-3xl font-bold mt-2 text-ios-green tracking-[-0.5px]">
              {formatRupiah(cost)}
            </div>
          </div>
          <div className="flex flex-col items-start">
            <label className="font-semibold mb-2 text-text-low text-xs uppercase tracking-[0.5px]">
              Tarif (Rp/kWh)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={tariffInput}
              onChange={(e) => setTariffInput(e.target.value)}
              className="input-ios min-w-[180px]"
            />
          </div>
        </div>
        {delta === null && (
          <p className="text-xs text-text-low mt-3">
            Pemakaian periode dihitung dari selisih energi kumulatif; butuh minimal 2 titik data
            pada rentang terpilih.
          </p>
        )}
      </div>

      {/* Kartu metrik */}
      <div className="grid gap-4 mx-auto max-w-[1300px] [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {PZEM_ORDER.map((key) => (
          <PzemCard
            key={key}
            metricKey={key}
            row={latest}
            onOpenTrend={(k) => navigate(`/listrik/trend/${k}`)}
          />
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-5 mx-auto max-w-[1300px] [grid-template-columns:repeat(auto-fit,minmax(350px,1fr))]">
        {PZEM_ORDER.map((key) => (
          <div key={key} className={`glass-panel px-5 pt-5 pb-3 ${PZEM_METRICS[key].chartGlow}`}>
            <h3 className="text-[#e5e5ea] text-[15px] font-semibold tracking-[-0.3px] mb-2">
              {PZEM_METRICS[key].label}
              {PZEM_METRICS[key].unit ? ` (${PZEM_METRICS[key].unit})` : ''}
            </h3>
            <PzemChart
              metricKey={key}
              labels={labels}
              values={data.map((row) => pzemValueOrNull(row, key))}
            />
          </div>
        ))}
      </div>

      {/* Tabel riwayat */}
      {!loading && <PzemTable data={data} />}
    </div>
  )
}
