import { INPUT } from '../Modal.jsx'

export const LABEL = 'text-xs font-semibold uppercase tracking-[0.4px] text-text-low'
export const HINT = 'text-xs text-text-low mt-1'

// Satu baris input angka/teks dengan label.
export function Field({
  label,
  value,
  onChange,
  type = 'number',
  hint,
  step,
  min,
  max,
  placeholder,
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} mt-1.5`}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        inputMode={type === 'number' ? 'decimal' : undefined}
      />
      {hint && <p className={HINT}>{hint}</p>}
    </label>
  )
}

// Grid 2 kolom untuk kumpulan Field (pola kartu Settings).
export function FieldsGrid({ children }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
}

// Kotak kecil pembungkus beberapa Field (dipakai grup threshold).
export function ThresholdGroup({ title, children }) {
  return (
    <div className="card-sub p-3">
      <p className="text-xs font-semibold text-text-body mb-2">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  )
}

export function formatDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' })
}
