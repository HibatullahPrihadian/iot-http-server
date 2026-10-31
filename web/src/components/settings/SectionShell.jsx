// Kartu seksi Settings: judul + deskripsi + isi + footer tombol Simpan/Reset.
export default function SectionShell({ title, description, children, footer }) {
  return (
    <section className="glass-panel p-5">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-text-hi">{title}</h2>
        {description && <p className="text-sm text-text-low mt-0.5">{description}</p>}
      </div>
      {children}
      {footer}
    </section>
  )
}

// Baris tombol Simpan/Reset + slot footer tambahan (mis. Terapkan ke perangkat).
export function SectionActions({ dirty, busy, onSave, onReset, footer }) {
  return (
    <div className="mt-5 flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onSave}
        disabled={busy || !dirty}
        className="btn-ios bg-ios-blue hover:shadow-glow-blue text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60"
      >
        {busy ? 'Menyimpan...' : 'Simpan'}
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={busy || !dirty}
        className="btn-ios bg-white/10 text-text-body text-sm font-semibold px-4 py-2.5 disabled:opacity-60"
      >
        Reset
      </button>
      {footer}
    </div>
  )
}
