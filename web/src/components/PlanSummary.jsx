import { LEGEND, countdownLabel } from '../utils/status.js'

// 3 meja x 6 pipa = 18 pipa total.
const PIPES_PER_TABLE = 6
const TOTAL_PIPES = 18

// Urutan meja mengikuti grid halaman Plan: pembibitan dulu, lalu pembesaran.
const TABLES = [
  { tableNumber: 3, title: 'Meja 3 · Pembibitan' },
  { tableNumber: 1, title: 'Meja 1 · Pembesaran' },
  { tableNumber: 2, title: 'Meja 2 · Pembesaran' },
]

const STATUS_LABELS = ['Semai', 'Pembesaran', 'Siap Panen', 'Kosong']

// Warna titik diambil dari LEGEND (utils/status.js), tidak ditulis ulang.
const COLOR_BY_LABEL = LEGEND.reduce((acc, item) => {
  acc[item.label] = item.color
  return acc
}, {})

const BADGE_BY_LABEL = {
  Semai: 'bg-ios-green/10 border-ios-green/40 text-ios-green',
  Pembesaran: 'bg-ios-blue/10 border-ios-blue/40 text-ios-blue',
  'Siap Panen': 'bg-ios-orange/10 border-ios-orange/40 text-ios-orange',
  Kosong: 'bg-white/5 border-white/10 text-text-low',
}

// Isi satu meja: batch di meja itu, jumlah pipa terisi, dan hitungan per status.
function summarizeTable(tableNumber, list) {
  const rows = list.filter((b) => b && b.tableNumber === tableNumber)
  const filled = new Set(rows.map((b) => b.pipeNumber)).size
  const counts = { Semai: 0, Pembesaran: 0, 'Siap Panen': 0 }

  for (const b of rows) {
    if (counts[b.computedStatus] === undefined) continue
    counts[b.computedStatus] += 1
  }
  counts.Kosong = Math.max(PIPES_PER_TABLE - filled, 0)

  return { rows, filled, counts }
}

// Countdown panen terdekat (Meja 1-2): daysRemaining terkecil yang tersedia.
function nearestHarvest(rows) {
  const values = rows
    .map((b) => b.daysRemaining)
    .filter((d) => d !== null && d !== undefined)
  if (!values.length) return null
  return Math.min(...values)
}

// Jumlah/Meja 3 yang sudah mencapai target hari pindah (HSS >= hssTarget).
function readyToTransfer(rows) {
  return rows.filter(
    (b) =>
      b.hss !== null &&
      b.hss !== undefined &&
      b.hssTarget !== null &&
      b.hssTarget !== undefined &&
      b.hss >= b.hssTarget,
  ).length
}

export default function PlanSummary({ batches = [], onJumpToTable }) {
  const list = Array.isArray(batches) ? batches.filter(Boolean) : []

  // Pipa terisi unik (satu batch menempati satu pipa).
  const occupiedPipes = new Set(
    list.map((b) => `${b.tableNumber}-${b.pipeNumber}`),
  ).size

  const totalCounts = { Semai: 0, Pembesaran: 0, 'Siap Panen': 0 }
  for (const b of list) {
    if (totalCounts[b.computedStatus] === undefined) continue
    totalCounts[b.computedStatus] += 1
  }
  totalCounts.Kosong = Math.max(TOTAL_PIPES - occupiedPipes, 0)

  const jump = (tableNumber) => {
    if (typeof onJumpToTable === 'function') onJumpToTable(tableNumber)
  }

  return (
    <section className="glass-panel p-4 sm:p-5">
      {/* Baris total + jumlah per status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-low">
          Total{' '}
          <strong className="text-text-hi text-base tabular-nums">
            {occupiedPipes}/{TOTAL_PIPES}
          </strong>{' '}
          pipa terisi
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_LABELS.map((label) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${BADGE_BY_LABEL[label]}`}
            >
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${COLOR_BY_LABEL[label]}`}
              />
              {totalCounts[label]} {label}
            </span>
          ))}
        </div>
      </div>

      {/* Kartu per meja */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TABLES.map(({ tableNumber, title }) => {
          const { rows, filled, counts } = summarizeTable(tableNumber, list)
          const isNursery = tableNumber === 3
          const harvest = nearestHarvest(rows)
          const transferReady = readyToTransfer(rows)

          let infoText
          if (isNursery) {
            infoText = transferReady > 0 ? `${transferReady} siap pindah` : 'Belum siap pindah'
          } else if (!rows.length) {
            infoText = 'Belum ada tanaman'
          } else {
            infoText = `Panen terdekat ${countdownLabel(harvest) || '-'}`
          }

          return (
            <button
              key={tableNumber}
              type="button"
              onClick={() => jump(tableNumber)}
              aria-label={`Lihat pipa ${title}`}
              className="card-sub w-full text-left px-4 py-4 cursor-pointer hover:bg-white/10 hover:border-white/20 transition focus:outline-none focus:ring-2 focus:ring-ios-blue/50 active:scale-[.99]"
            >
              <span className="block text-sm font-bold text-text-hi">{title}</span>

              <span className="mt-1 block text-2xl font-bold tabular-nums text-text-hi">
                {filled}/{PIPES_PER_TABLE}
                <span className="ml-1.5 text-xs font-semibold text-text-low">terisi</span>
              </span>

              {/* Breakdown status: hanya status dengan jumlah > 0 */}
              <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                {STATUS_LABELS.filter((label) => counts[label] > 0).map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 text-xs text-text-mid"
                  >
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${COLOR_BY_LABEL[label]}`}
                    />
                    {counts[label]} {label}
                  </span>
                ))}
              </span>

              <span className="mt-3 block text-xs font-semibold text-text-dim">
                {infoText}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}