import { useEffect, useState } from 'react'
import { get, del } from '../api.js'
import { formatDate, daysBetween } from '../utils/status.js'
import ConfirmDialog from './ConfirmDialog.jsx'

// Riwayat batch arsip untuk satu pipa (rotasi). Klik item -> buka detail.
export default function HistoryModal({
  tableNumber,
  pipeNumber,
  onClose,
  onOpenBatch,
  onDeleted,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmRow, setConfirmRow] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    get(`/batches/history?tableNumber=${tableNumber}&pipeNumber=${pipeNumber}&limit=200`)
      .then((data) => {
        if (!cancelled) setRows(data)
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
  }, [tableNumber, pipeNumber])

  async function handleDelete(row) {
    setActionError('')
    setBusyId(row.id)
    try {
      await del(`/batches/${row.id}`)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      setConfirmRow(null)
      onDeleted?.(row.id)
    } catch (err) {
      setActionError(err.message)
      setConfirmRow(null)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-text-hi">Riwayat Pipa</h3>
            <p className="text-sm text-text-low">
              Meja {tableNumber} &middot; Pipa {pipeNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-low hover:text-text-body text-xl leading-none"
            aria-label="Tutup"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-3 py-2">
            {error}
          </div>
        )}

        {actionError && (
          <div className="mb-3 rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-3 py-2">
            {actionError}
          </div>
        )}

        {loading ? (
          <p className="text-text-low text-sm">Memuat riwayat...</p>
        ) : rows.length === 0 ? (
          <p className="text-text-low text-sm">Belum ada riwayat panen di pipa ini.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onOpenBatch && onOpenBatch(r)}
                  className="flex-1 text-left py-3 hover:bg-white/5 rounded-lg px-2 transition"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-text-hi">{r.plantName}</span>
                    <span className="text-xs text-text-low">
                      {r.harvestWeightGram ? `${r.harvestWeightGram} g` : 'tanpa berat'}
                    </span>
                  </div>
                  <div className="text-xs text-text-low mt-1">
                    Semai {formatDate(r.sowDate)} &middot; Panen {formatDate(r.harvestedAt)}
                    {r.durationDays != null && ` · ${r.durationDays} hari`}
                    {' '}&middot; Estimasi {r.totalDays} hari
                  </div>
                  {r.notes && (
                    <p className="text-xs text-mid italic mt-1">{r.notes}</p>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmRow(r)
                  }}
                  disabled={busyId === r.id}
                  className="text-xs text-ios-red hover:text-ios-pink underline transition
                    py-3 px-2 disabled:opacity-50"
                >
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        title="Hapus riwayat"
        message={
          confirmRow
            ? `Hapus riwayat ${confirmRow.plantName} tanggal ${formatDate(confirmRow.harvestedAt)}? Tindakan ini permanen.`
            : ''
        }
        busy={busyId !== null}
        onConfirm={() => confirmRow && handleDelete(confirmRow)}
        onCancel={() => setConfirmRow(null)}
      />
    </div>
  )
}
