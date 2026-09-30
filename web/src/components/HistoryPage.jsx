import { useEffect, useState } from 'react'
import { get, del } from '../api.js'
import { formatDate } from '../utils/status.js'
import ConfirmDialog from './ConfirmDialog.jsx'

// Halaman riwayat global: filter + tabel batch arsip + export CSV.
export default function HistoryPage({ catalog }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmRow, setConfirmRow] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [filters, setFilters] = useState({
    tableNumber: '',
    pipeNumber: '',
    plantId: '',
    from: '',
    to: '',
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '') params.set(k, v)
    })
    params.set('limit', '500')

    get(`/batches/history?${params.toString()}`)
      .then((d) => {
        if (!cancelled) setRows(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filters])

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))

  async function handleDelete(row) {
    setActionError('')
    setBusyId(row.id)
    try {
      await del(`/batches/${row.id}`)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      setConfirmRow(null)
    } catch (err) {
      setActionError(err.message)
      setConfirmRow(null)
    } finally {
      setBusyId(null)
    }
  }

  function exportCsv() {
    const header = [
      'meja',
      'pipa',
      'tanaman',
      'tanggal_semai',
      'estimasi_panen',
      'tanggal_panen',
      'durasi_hari',
      'estimasi_hari',
      'berat_gram',
      'catatan',
    ]
    const lines = rows.map((r) =>
      [
        r.tableNumber,
        r.pipeNumber,
        r.plantName,
        r.sowDate,
        r.harvestDate,
        r.harvestedAt ? r.harvestedAt.slice(0, 10) : '',
        r.durationDays ?? '',
        r.totalDays,
        r.harvestWeightGram ?? '',
        (r.notes || '').replace(/"/g, '""'),
      ]
        .map((v) => `"${String(v)}"`)
        .join(',')
    )
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `riwayat-hidroponik-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const empty = !loading && rows.length === 0

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Meja">
          <select value={filters.tableNumber} onChange={set('tableNumber')} className={inputCls}>
            <option value="">Semua</option>
            <option value="1">Meja 1</option>
            <option value="2">Meja 2</option>
          </select>
        </Field>
        <Field label="Pipa">
          <select value={filters.pipeNumber} onChange={set('pipeNumber')} className={inputCls}>
            <option value="">Semua</option>
            {Array.from({ length: 6 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                Pipa {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tanaman">
          <select value={filters.plantId} onChange={set('plantId')} className={inputCls}>
            <option value="">Semua</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dari">
          <input type="date" value={filters.from} onChange={set('from')} className={inputCls} />
        </Field>
        <Field label="Sampai">
          <input type="date" value={filters.to} onChange={set('to')} className={inputCls} />
        </Field>

        <div className="col-span-2 lg:col-span-5 flex justify-between items-center">
          <span className="text-sm text-text-low">{rows.length} riwayat</span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="btn-ios bg-ios-blue hover:shadow-glow-blue disabled:opacity-50 text-white
              text-sm px-4 py-2"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-4 py-3">
          {error}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-4 py-3">
          {actionError}
        </div>
      )}

      <div className="glass-panel overflow-x-auto">
        {loading ? (
          <p className="p-5 text-text-low text-sm">Memuat riwayat...</p>
        ) : empty ? (
          <p className="p-5 text-text-low text-sm">Belum ada riwayat panen.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-text-low text-left">
              <tr>
                <Th>Meja</Th>
                <Th>Pipa</Th>
                <Th>Tanaman</Th>
                <Th>Semai</Th>
                <Th>Panen</Th>
                <Th>Durasi</Th>
                <Th>Berat</Th>
                <Th>Aksi</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/5 transition">
                  <Td>{r.tableNumber}</Td>
                  <Td>{r.pipeNumber}</Td>
                  <Td>{r.plantName}</Td>
                  <Td>{formatDate(r.sowDate)}</Td>
                  <Td>{formatDate(r.harvestedAt)}</Td>
                  <Td>{r.durationDays != null ? `${r.durationDays} hari` : '-'}</Td>
                  <Td>{r.harvestWeightGram ? `${r.harvestWeightGram} g` : '-'}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => setConfirmRow(r)}
                      disabled={busyId === r.id}
                      className="text-ios-red hover:text-ios-pink underline transition
                        disabled:opacity-50"
                    >
                      Hapus
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        title="Hapus riwayat"
        message={
          confirmRow
            ? `Hapus riwayat ${confirmRow.plantName} (Meja ${confirmRow.tableNumber}, Pipa ${confirmRow.pipeNumber}) tanggal ${formatDate(confirmRow.harvestedAt)}? Tindakan ini permanen.`
            : ''
        }
        busy={busyId !== null}
        onConfirm={() => confirmRow && handleDelete(confirmRow)}
        onCancel={() => setConfirmRow(null)}
      />
    </div>
  )
}

const inputCls =
  'mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-text-body focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text-low">{label}</span>
      {children}
    </label>
  )
}

function Th({ children }) {
  return <th className="px-4 py-3 font-semibold whitespace-nowrap">{children}</th>
}

function Td({ children }) {
  return <td className="px-4 py-3 text-text-dim whitespace-nowrap">{children}</td>
}
