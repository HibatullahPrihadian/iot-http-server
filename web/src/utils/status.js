// Warna & label untuk tiap status pipa.
const STATUS_STYLES = {
  Semai: 'bg-ios-green/85 text-white',
  Pembesaran: 'bg-ios-blue/85 text-white',
  'Siap Panen': 'bg-ios-orange text-black',
  Kosong: 'bg-white/5 text-text-low',
}

const EMPTY_STYLE = 'bg-white/5 text-text-low'

// Glow hover per status (shadow Tailwind).
export const STATUS_GLOW = {
  Semai: 'hover:shadow-glow-green',
  Pembesaran: 'hover:shadow-glow-blue',
  'Siap Panen': 'hover:shadow-glow-orange',
  Kosong: 'hover:shadow-glow-blue',
}

export function statusGlow(batch) {
  if (!batch) return STATUS_GLOW.Kosong
  return STATUS_GLOW[batch.computedStatus] || STATUS_GLOW.Kosong
}

export function statusStyle(batch) {
  if (!batch) return EMPTY_STYLE
  return STATUS_STYLES[batch.computedStatus] || EMPTY_STYLE
}

// Label sisa hari: "H-n", "Lewat" bila negatif, "Hari ini" bila 0.
export function countdownLabel(daysRemaining) {
  if (daysRemaining === null || daysRemaining === undefined) return ''
  if (daysRemaining < 0) return 'Lewat'
  if (daysRemaining === 0) return 'Hari ini'
  return `H-${daysRemaining}`
}

// Format tanggal ISO 'YYYY-MM-DD' atau datetime -> 'D Mmm YYYY' (id-ID).
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
]

export function formatDate(value) {
  if (!value) return '-'
  const iso = String(value).slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return value
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// Selisih hari antara dua tanggal 'YYYY-MM-DD' (UTC-safe).
export function daysBetween(fromStr, toStr) {
  if (!fromStr || !toStr) return null
  const a = new Date(`${String(fromStr).slice(0, 10)}T00:00:00Z`)
  const b = new Date(`${String(toStr).slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

// Hari ini format 'YYYY-MM-DD' lokal (untuk default input date).
export function todayInput() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export const LEGEND = [
  { label: 'Kosong', style: EMPTY_STYLE, color: 'bg-white/20' },
  { label: 'Semai', color: 'bg-ios-green' },
  { label: 'Pembesaran', color: 'bg-ios-blue' },
  { label: 'Siap Panen', color: 'bg-ios-orange' },
]

// ---------------------------------------------------------------------------
// RCP (resep nutrisi)
// ---------------------------------------------------------------------------

const PPM_TOLERANCE = 0.1

// Bandingkan pembacaan terakhir vs resep fase aktif.
// Mengembalikan { level: 'ok'|'warn'|'danger', reasons: string[] }.
export function nutritionAlert(reading, recipe) {
  if (!reading || !recipe) return { level: 'ok', reasons: [] }

  const reasons = []
  let level = 'ok'

  if (
    recipe.ppmTarget !== null &&
    recipe.ppmTarget !== undefined &&
    reading.ppm !== null &&
    reading.ppm !== undefined
  ) {
    const diff = Math.abs(reading.ppm - recipe.ppmTarget)
    if (diff > recipe.ppmTarget * PPM_TOLERANCE) {
      const pct = recipe.ppmTarget
        ? Math.round((diff / recipe.ppmTarget) * 100)
        : 0
      level = 'danger'
      reasons.push(`ppm ${reading.ppm} menyimpang ${pct}% dari target ${recipe.ppmTarget}`)
    }
  }

  if (
    reading.ph !== null &&
    reading.ph !== undefined &&
    recipe.phMin !== null &&
    recipe.phMin !== undefined &&
    recipe.phMax !== null &&
    recipe.phMax !== undefined
  ) {
    if (reading.ph < recipe.phMin || reading.ph > recipe.phMax) {
      level = 'danger'
      reasons.push(`pH ${reading.ph} di luar rentang ${recipe.phMin}-${recipe.phMax}`)
    }
  }

  return { level, reasons }
}

// Format angka ppm '560 ppm' atau '-' bila kosong.
export function formatPpm(value) {
  if (value === null || value === undefined || value === '') return '-'
  return `${value} ppm`
}

// Format nilai pH '6.2' atau '-' bila kosong.
export function formatPh(value) {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

// Format datetime ISO -> 'D Mmm YYYY HH:MM' (id-ID, lokal).
export function formatDateTime(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${hh}:${mm}`
}

// Waktu relatif bahasa Indonesia: "baru saja", "x menit lalu", "x jam lalu", "x hari lalu".
export function formatRelativeTime(value) {
  if (!value) return '-'
  const t = new Date(value).getTime()
  if (!Number.isFinite(t)) return String(value)
  const diffMs = Date.now() - t
  if (diffMs < 0) return 'baru saja'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'baru saja'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} menit lalu`
  const jam = Math.floor(min / 60)
  if (jam < 24) return `${jam} jam lalu`
  const hari = Math.floor(jam / 24)
  return `${hari} hari lalu`
}
