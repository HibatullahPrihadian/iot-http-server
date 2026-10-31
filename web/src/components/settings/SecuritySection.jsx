import { Field } from './fields.jsx'
import SectionShell from './SectionShell.jsx'
import { findSection } from '../../settings/sections.js'

const meta = findSection('keamanan')

// Tab Keamanan: tidak memakai draft setting, hanya form ganti PIN.
export default function SecuritySection({
  newPin,
  confirmPin,
  onNewPin,
  onConfirmPin,
  localError,
  busy,
  pinIsDefault,
  pinActive,
  onSubmit,
}) {
  return (
    <SectionShell
      title={meta.title}
      description={`${meta.description} ${
        pinActive ? 'PIN sesi ini aktif.' : 'PIN belum dimasukkan di sesi ini.'
      }`}
    >
      {pinIsDefault && (
        <p className="rounded-lg bg-ios-orange/10 border border-ios-orange/40 text-ios-orange text-xs px-3 py-2 mb-4">
          PIN masih default (1234). Segera ganti.
        </p>
      )}

      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field
          label="PIN baru"
          type="password"
          value={newPin}
          onChange={onNewPin}
          hint="4-64 karakter."
        />
        <Field label="Ulangi PIN baru" type="password" value={confirmPin} onChange={onConfirmPin} />
        {localError && <p className="text-xs text-ios-red sm:col-span-2">{localError}</p>}
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="btn-ios bg-ios-orange hover:shadow-glow-orange text-black text-sm font-semibold px-4 py-2.5 disabled:opacity-60"
          >
            {busy ? 'Menyimpan...' : 'Ganti PIN'}
          </button>
        </div>
      </form>
    </SectionShell>
  )
}
