import { countdownLabel } from '../utils/status.js'

// Panel reminder: batch siap panen / lewat (daysRemaining <= 1), kecuali Meja 3 (pembibitan, tak bisa panen).
export default function HarvestBanner({ batches, onHarvest }) {
  const due = batches.filter((b) => b.tableNumber !== 3 && b.daysRemaining <= 1)
  if (!due.length) return null

  return (
    <div className="glass-panel border-ios-orange/40 shadow-glow-orange p-4">
      <h2 className="text-sm font-bold text-ios-orange mb-3">
        Perlu Panen ({due.length})
      </h2>
      <ul className="space-y-2">
        {due.map((b) => (
          <li
            key={b.id}
            className="card-sub flex items-center justify-between gap-3 px-3 py-2"
          >
            <span className="text-sm text-text-dim">
              <strong className="text-text-hi">Meja {b.tableNumber} · Pipa {b.pipeNumber}</strong> — {b.plantName}{' '}
              <span className="text-ios-orange font-semibold">
                {countdownLabel(b.daysRemaining)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onHarvest(b)}
              className="btn-ios shrink-0 bg-ios-orange hover:shadow-glow-orange text-black
                text-xs font-semibold px-3 py-1.5"
            >
              Tandai Panen
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
