// Dialog konfirmasi reusable (glass-panel). Tutup via overlay / tombol Batal.
export default function ConfirmDialog({
  open,
  title = 'Konfirmasi',
  message,
  confirmLabel = 'Hapus',
  busyLabel = 'Menghapus...',
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        className="glass-panel w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-text-hi mb-2">{title}</h3>
        <p className="text-sm text-mid mb-5">{message}</p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-ios flex-1 border border-white/10 text-text-dim py-2.5
              hover:bg-white/5 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-ios flex-1 bg-ios-red hover:shadow-glow-red disabled:opacity-60
              text-white py-2.5"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
