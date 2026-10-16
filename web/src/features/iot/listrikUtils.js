// Konstanta + helper murni untuk dashboard Listrik (PZEM-004T).
// Paralel dengan utils.js (hidroponik), tetapi terpisah agar tidak mengganggu
// chart/threshold hidroponik yang sudah teruji.

// Metrik listrik PZEM-004T -> metadata tampilan.
export const PZEM_METRICS = {
  tegangan: {
    key: 'tegangan',
    label: 'Tegangan',
    icon: '🔌',
    unit: 'V',
    color: '#ff9f0a',
    glow: 'glow-ph',
    chartGlow: 'chart-glow-ph',
    decimals: 1,
    yMin: 0,
    // Nominal PLN 220 V; sumbu 0-300 cukup menampung variasi.
    yMax: 300,
  },
  arus: {
    key: 'arus',
    label: 'Arus',
    icon: '⚡',
    unit: 'A',
    color: '#64d2ff',
    glow: 'glow-lembab',
    chartGlow: 'chart-glow-lembab',
    decimals: 2,
    yMin: 0,
    yMax: 10,
    autoScale: true,
    yMaxFloor: 1,
  },
  daya: {
    key: 'daya',
    label: 'Daya Aktif',
    icon: '💡',
    unit: 'W',
    color: '#bf5af2',
    glow: 'glow-uv',
    chartGlow: 'chart-glow-uv',
    decimals: 1,
    yMin: 0,
    yMax: 1000,
    autoScale: true,
    yMaxFloor: 100,
  },
  energi: {
    key: 'energi',
    label: 'Energi',
    icon: '🔋',
    unit: 'kWh',
    color: '#30d158',
    glow: 'glow-tds',
    chartGlow: 'chart-glow-tds',
    decimals: 3,
    yMin: 0,
    yMax: 100,
    autoScale: true,
    yMaxFloor: 1,
  },
  frekuensi: {
    key: 'frekuensi',
    label: 'Frekuensi',
    icon: '📶',
    unit: 'Hz',
    color: '#0a84ff',
    glow: 'glow-suhu',
    chartGlow: 'chart-glow-suhu',
    decimals: 1,
    yMin: 0,
    yMax: 60,
  },
  power_factor: {
    key: 'power_factor',
    label: 'Faktor Daya',
    icon: '📐',
    unit: '',
    color: '#ff375f',
    glow: 'glow-air',
    chartGlow: 'chart-glow-air',
    decimals: 2,
    yMin: 0,
    yMax: 1,
  },
}

// Urutan kartu & chart.
export const PZEM_ORDER = [
  'tegangan',
  'arus',
  'daya',
  'energi',
  'frekuensi',
  'power_factor',
]

// Daftar opsi trend (tanpa energi: kumulatif, tren nilai mentah kurang bermakna).
export const PZEM_TREND_OPTIONS = [
  'tegangan',
  'arus',
  'daya',
  'frekuensi',
  'power_factor',
]

// Ambil nilai metrik dari row; null bila tidak ada (agar gap tetap gap).
export function pzemValueOrNull(row, key) {
  if (!row) return null
  const val = row[key]
  if (val === null || val === undefined) return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

// Konsumsi energi periode = jumlah kenaikan antar sampel energi kumulatif.
// Sample berurutan; reset alat (nilai turun) dihitung sebagai awal segmen baru
// (bukan dibuang), jadi pemakaian setelah reset tetap terhitung.
// Butuh >= 2 titik; tanpa kenaikan valid -> null.
export function energyDelta(data) {
  if (!Array.isArray(data)) return null
  const nums = data
    .map((row) => pzemValueOrNull(row, 'energi'))
    .filter((v) => v !== null)
  if (nums.length < 2) return null

  let total = 0
  for (let i = 1; i < nums.length; i++) {
    const step = nums[i] - nums[i - 1]
    if (step >= 0) total += step // reset (step < 0) -> mulai segmen baru, step diabaikan
  }
  return Number.isFinite(total) ? total : null
}

// Estimasi biaya: kWh * tarif (Rp/kWh).
export function estimateCost(kwh, tariff) {
  if (kwh === null || kwh === undefined) return null
  const t = Number(tariff)
  if (!Number.isFinite(t) || t < 0) return null
  const cost = Number(kwh) * t
  return Number.isFinite(cost) ? cost : null
}

// Format rupiah tanpa desimal.
export function formatRupiah(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value))
}

// Tentukan batas atas sumbu Y untuk metrik listrik.
function niceCeilPzem(value) {
  const steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
  for (const step of steps) {
    if (value <= step) return step
  }
  return Math.ceil(value / 1000) * 1000
}

export function computePzemYMax(values, meta) {
  if (!meta.autoScale) return meta.yMax
  const nums = (values ?? []).filter(
    (v) => v !== null && v !== undefined && Number.isFinite(Number(v))
  )
  const peak = nums.length
    ? nums.reduce((m, v) => Math.max(m, Number(v)), 0)
    : null
  const floor = meta.yMaxFloor !== undefined ? meta.yMaxFloor : meta.yMax
  if (peak === null) return floor
  return Math.max(floor, niceCeilPzem(peak))
}

// Status alert metrik listrik (hanya anomali jelas).
export function pzemAlertStatus(key, row) {
  if (!row) return 'normal'
  const tegangan = pzemValueOrNull(row, 'tegangan')
  const pf = pzemValueOrNull(row, 'power_factor')

  switch (key) {
    case 'tegangan':
      if (tegangan === null) return 'normal'
      if (tegangan < 198 || tegangan > 242) return 'danger'
      if (tegangan < 207 || tegangan > 235) return 'warning'
      return 'normal'
    case 'power_factor':
      if (pf === null) return 'normal'
      if (pf > 0 && pf < 0.85) return 'warning'
      return 'normal'
    default:
      return 'normal'
  }
}

export function pzemCardClass(status) {
  if (status === 'danger') return 'alert-danger'
  if (status === 'warning') return 'alert-warning'
  return ''
}

export function pzemValueClass(status) {
  if (status === 'danger') return 'alert-text-danger'
  if (status === 'warning') return 'alert-text-warning'
  return ''
}

// Ubah tarif tersimpan (string) jadi angka >= 0. Kosong/invalid -> 0.
export function parseTariff(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// Unduh CSV data listrik (paralel downloadSensorCSV).
// Nilai yang tak ada ditulis sebagai sel kosong (bukan 0) agar tidak salah baca.
export function downloadPzemCSV(data, filterValue) {
  if (!Array.isArray(data) || data.length === 0) return false
  const cols = ['tegangan', 'arus', 'daya', 'energi', 'frekuensi', 'power_factor']
  let csv = 'Timestamp,Tegangan (V),Arus (A),Daya (W),Energi (kWh),Frekuensi (Hz),Faktor Daya\n'
  const cell = (v) => (v === null || v === undefined ? '' : v)
  data.forEach((row) => {
    const waktu = new Date(row.waktu).toLocaleString('id-ID').replace(',', '')
    csv += `"${waktu}",${cols.map((k) => cell(pzemValueOrNull(row, k))).join(',')}\n`
  })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `Log_Listrik_${filterValue}.csv`
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return true
}
