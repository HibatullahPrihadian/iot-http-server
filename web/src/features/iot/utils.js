// Konstanta + helper murni untuk dashboard IoT.
// Semua threshold/bound diambil persis dari web-app/public/index.html (baris 90-108, 493-498, 530-535).

// Sensor key -> metadata tampilan.
export const SENSORS = {
  suhu_udara: {
    key: 'suhu_udara',
    label: 'Suhu Udara',
    icon: '🌡️',
    unit: '°C',
    color: '#ff453a',
    glow: 'glow-suhu',
    chartGlow: 'chart-glow-suhu',
    decimals: 1,
    yMin: 0,
    yMax: 50,
  },
  kelembapan_udara: {
    key: 'kelembapan_udara',
    label: 'Kelembapan',
    icon: '💧',
    unit: '%',
    color: '#64d2ff',
    glow: 'glow-lembab',
    chartGlow: 'chart-glow-lembab',
    decimals: 1,
    yMin: 0,
    yMax: 100,
  },
  kadar_tds: {
    key: 'kadar_tds',
    label: 'Kadar TDS',
    icon: '🌱',
    unit: 'ppm',
    color: '#30d158',
    glow: 'glow-tds',
    chartGlow: 'chart-glow-tds',
    decimals: 0,
    yMin: 0,
    // Fallback darurat: hanya dipakai bila tak ada resep & tak ada data.
    yMax: 1800,
    autoScale: true,
    floorFromRecipe: true,
  },
  kadar_ph: {
    key: 'kadar_ph',
    label: 'Kadar pH',
    icon: '🧪',
    unit: '',
    color: '#ff9f0a',
    glow: 'glow-ph',
    chartGlow: 'chart-glow-ph',
    decimals: 2,
    yMin: 0,
    yMax: 14,
  },
  intensitas_uv: {
    key: 'intensitas_uv',
    label: 'Intensitas UV',
    icon: '☀️',
    unit: '',
    color: '#bf5af2',
    glow: 'glow-uv',
    chartGlow: 'chart-glow-uv',
    decimals: 0,
    yMin: 0,
    yMax: 150,
    autoScale: true,
    yMaxFloor: 50,
  },
  suhu_air: {
    key: 'suhu_air',
    label: 'Suhu Air',
    icon: '🌊',
    unit: '°C',
    color: '#ff375f',
    glow: 'glow-air',
    chartGlow: 'chart-glow-air',
    decimals: 1,
    yMin: 0,
    yMax: 50,
  },
}

// Urutan kartu & chart (port dari index.html).
export const SENSOR_ORDER = [
  'suhu_udara',
  'kelembapan_udara',
  'kadar_tds',
  'kadar_ph',
  'intensitas_uv',
  'suhu_air',
]

// Opsi filter waktu — 8 opsi (code = source of truth, dokumentasi.md lama hanya 5).
export const FILTERS = [
  { value: 'realtime', label: 'Data Terkini (40 Titik)' },
  { value: '12hour', label: 'Riwayat 12 Jam' },
  { value: '1day', label: 'Riwayat 24 Jam' },
  { value: '1week', label: 'Riwayat 7 Hari' },
  { value: '2week', label: 'Riwayat 14 Hari' },
  { value: '1month', label: 'Riwayat 1 Bulan' },
  { value: '3month', label: 'Riwayat 3 Bulan' },
  { value: '6month', label: 'Riwayat 6 Bulan' },
]

// Opsi filter trend.html (subset, ada '2month' alih-alih '2week').
export const TREND_FILTERS = [
  { value: 'realtime', label: 'Real-Time (40 Terakhir)' },
  { value: '12hour', label: '12 Jam Terakhir' },
  { value: '1day', label: '1 Hari Terakhir' },
  { value: '1week', label: '1 Pekan Terakhir' },
  { value: '2month', label: '2 Pekan Terakhir' },
  { value: '1month', label: '1 Bulan Terakhir' },
]

// Mapping filter trend -> filter API (trend.html pakai '2month', server tak mengenalnya).
export function trendFilterToApi(value) {
  if (value === '2month') return '2week'
  return value
}

// Bulatkan nilai ke jumlah desimal (port dari server.js `bulatkan`).
export function bulatkan(nilai, jumlahDesimal) {
  if (nilai === null || nilai === undefined) return null
  return Number(Number(nilai).toFixed(jumlahDesimal))
}

// Bulatkan ke atas ke kelipatan "bulat" terdekat agar label tick rapi.
const NICE_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
export function niceCeil(value) {
  for (const step of NICE_STEPS) {
    if (value <= step) return step
  }
  return Math.ceil(value / 1000) * 1000
}

// Batas atas sumbu Y. Fixed (meta.yMax) kecuali autoScale aktif: ikuti peak data,
// dengan floor prioritas: recipeTarget > yMaxFloor > peak data. Tanpa resep & tanpa
// floor tetap: murni ikuti peak. Tanpa data sama sekali: jatuh ke floor/meta.yMax.
// Non-numerik/null diabaikan.
export function computeYMax(values, meta, recipeTarget) {
  if (!meta.autoScale) return meta.yMax
  const nums = (values ?? []).filter(
    (v) => v !== null && v !== undefined && Number.isFinite(Number(v))
  )
  const peak = nums.length
    ? nums.reduce((m, v) => Math.max(m, Number(v)), -Infinity)
    : null
  let floor
  if (meta.floorFromRecipe && recipeTarget !== null && recipeTarget !== undefined) {
    floor = Number(recipeTarget)
    if (!Number.isFinite(floor)) floor = undefined
  } else if (meta.yMaxFloor !== undefined) {
    floor = meta.yMaxFloor
  }
  if (floor === undefined) floor = peak === null ? meta.yMax : niceCeil(peak)
  if (peak === null) return floor
  return Math.max(floor, niceCeil(peak))
}

// Ambil nilai sensor dari row, dukung alias lama (tds/ph/uv/suhu).
export function sensorValue(row, key) {
  if (!row) return 0
  if (key === 'kadar_tds') return row.kadar_tds ?? row.tds ?? 0
  if (key === 'kadar_ph') return row.kadar_ph ?? row.ph ?? 0
  if (key === 'intensitas_uv') return row.intensitas_uv ?? row.uv ?? 0
  if (key === 'suhu_air') return row.suhu_air ?? row.suhu ?? 0
  return row[key] ?? 0
}

// Ambil nilai nullable (untuk trend, biar gap tetap gap).
export function sensorValueOrNull(row, key) {
  if (!row) return null
  if (key === 'kadar_tds') return row.kadar_tds ?? row.tds ?? null
  if (key === 'kadar_ph') return row.kadar_ph ?? row.ph ?? null
  if (key === 'intensitas_uv') return row.intensitas_uv ?? row.uv ?? null
  if (key === 'suhu_air') return row.suhu_air ?? row.suhu ?? null
  return row[key] ?? null
}

// Formatter nilai + satuan untuk kartu. pH/UV tanpa satuan.
export function formatSensor(row, key) {
  const meta = SENSORS[key]
  const val = sensorValue(row, key)
  return meta.unit ? `${val} ${meta.unit}` : String(val)
}

// Status alert per sensor (port persis dari index.html baris 530-535).
export function alertStatus(key, row) {
  if (!row) return 'normal'
  const suhuAir = sensorValue(row, 'suhu_air')
  const suhuUdara = sensorValue(row, 'suhu_udara')
  const tds = sensorValue(row, 'kadar_tds')
  const ph = sensorValue(row, 'kadar_ph')
  const lembap = sensorValue(row, 'kelembapan_udara')
  const uv = sensorValue(row, 'intensitas_uv')

  switch (key) {
    case 'suhu_air':
      if (suhuAir >= 30) return 'danger'
      if (suhuAir > 28) return 'warning'
      return 'normal'
    case 'suhu_udara':
      if (suhuUdara >= 35) return 'danger'
      if (suhuUdara > 32) return 'warning'
      return 'normal'
    case 'kadar_tds':
      if (tds <= 500 || tds >= 1500) return 'danger'
      if (tds < 700 || tds > 1300) return 'warning'
      return 'normal'
    case 'kelembapan_udara':
      if (lembap <= 40 || lembap >= 80) return 'danger'
      return 'normal'
    case 'kadar_ph':
      return ph < 5.5 || ph > 6.5 ? 'danger' : 'normal'
    case 'intensitas_uv':
      return uv < 0 || uv > 2000 ? 'danger' : 'normal'
    default:
      return 'normal'
  }
}

// Kelas alert untuk kartu & nilai (port dari applyAlertStatus).
export function alertCardClass(status) {
  if (status === 'danger') return 'alert-danger'
  if (status === 'warning') return 'alert-warning'
  return ''
}

export function alertValueClass(status) {
  if (status === 'danger') return 'alert-text-danger'
  if (status === 'warning') return 'alert-text-warning'
  return ''
}

// Badge online/offline: data terbaru dalam 5 menit (300000 ms).
export const ONLINE_WINDOW_MS = 300000

export function isOnline(latestWaktu) {
  if (!latestWaktu) return false
  const diff = new Date() - new Date(latestWaktu)
  return diff <= ONLINE_WINDOW_MS
}

// Garis batas annotation per sensor (port dari index.html baris 480-491).
const BORDER_STYLE = {
  borderColor: 'rgba(255, 69, 58, 0.6)',
  borderWidth: 1.5,
  borderDash: [4, 4],
}

function borderLine(y) {
  return {
    type: 'line',
    yMin: y,
    yMax: y,
    borderColor: BORDER_STYLE.borderColor,
    borderWidth: BORDER_STYLE.borderWidth,
    borderDash: BORDER_STYLE.borderDash,
  }
}

export function annotationsFor(key) {
  switch (key) {
    case 'kadar_tds':
      return { garisBawah: borderLine(700), garisAtas: borderLine(1300) }
    case 'kadar_ph':
      return { garisBawah: borderLine(5.5), garisAtas: borderLine(6.5) }
    case 'suhu_air':
      return { garisAtas: borderLine(30) }
    case 'suhu_udara':
      return { garisAtas: borderLine(34) }
    default:
      return {}
  }
}

// Gradient fill: lineColor+'50' -> lineColor+'00' (port dari createChart).
export function makeGradient(ctx, chartArea, lineColor) {
  if (!chartArea) return lineColor + '20'
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
  gradient.addColorStop(0, lineColor + '50')
  gradient.addColorStop(1, lineColor + '00')
  return gradient
}

// Label jam 'HH.MM' locale id-ID.
export function timeLabel(waktu) {
  return new Date(waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

// Label tanggal+jam untuk trend.
export function dateTimeLabel(waktu) {
  return new Date(waktu).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Hitung tren awal vs akhir (port dari calculateTrend di trend.html).
export function calculateTrend(values) {
  const valid = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v))
  if (valid.length < 2) return { status: 'stabil', diff: 0, text: 'Data tidak cukup' }

  const firstValues = valid.slice(0, Math.min(3, valid.length))
  const lastValues = valid.slice(-Math.min(3, valid.length))
  const avgFirst = firstValues.reduce((a, b) => a + b, 0) / firstValues.length
  const avgLast = lastValues.reduce((a, b) => a + b, 0) / lastValues.length
  const diff = avgLast - avgFirst

  if (diff > 0.5) return { status: 'naik', diff, first: avgFirst, last: avgLast }
  if (diff < -0.5) return { status: 'turun', diff, first: avgFirst, last: avgLast }
  return { status: 'stabil', diff, first: avgFirst, last: avgLast }
}

// Unduh CSV dari data sensor (port dari downloadCSV di index.html).
export function downloadSensorCSV(data, filterValue) {
  if (!Array.isArray(data) || data.length === 0) return false
  let csv =
    'Timestamp,Suhu Udara (°C),Kelembapan (%),Kadar TDS (ppm),Kadar pH,Intensitas UV,Suhu Air (°C)\n'
  data.forEach((row) => {
    const waktu = new Date(row.waktu).toLocaleString('id-ID').replace(',', '')
    csv += `"${waktu}",${row.suhu_udara ?? 0},${row.kelembapan_udara ?? 0},${
      row.kadar_tds ?? row.tds ?? 0
    },${row.kadar_ph ?? row.ph ?? 0},${row.intensitas_uv ?? row.uv ?? 0},${
      row.suhu_air ?? row.suhu ?? 0
    }\n`
  })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `Log_Hidroponik_${filterValue}.csv`
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return true
}
