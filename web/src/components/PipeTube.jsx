import { statusStyle, statusGlow, countdownLabel } from '../utils/status.js'

// Satu tabung pipa PVC. Kosong -> abu-abu, terisi -> warna status.
export default function PipeTube({
  tableNumber,
  pipeNumber,
  batch,
  onClick,
  onHistoryClick,
}) {
  const style = statusStyle(batch)
  const glow = statusGlow(batch)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onClick(tableNumber, pipeNumber)}
        className={`rounded-full h-14 w-full flex items-center justify-between px-5 transition
          duration-300 active:scale-[.97] focus:outline-none focus:ring-2 focus:ring-ios-blue/50
          ${style} ${glow}`}
      >
        <span className="text-xs font-semibold opacity-70">Pipa {pipeNumber}</span>
        {batch ? (
          <span className="flex items-center gap-3">
            <span className="font-semibold">{batch.plantName}</span>
            <span className="text-sm">{countdownLabel(batch.daysRemaining)}</span>
          </span>
        ) : (
          <span className="text-sm">Kosong</span>
        )}
      </button>

      {batch?.hasHistory && (
        <button
          type="button"
          onClick={() => onHistoryClick(tableNumber, pipeNumber)}
          title="Lihat riwayat panen pipa ini"
          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-ios-blue text-white
            text-xs leading-none flex items-center justify-center shadow-glow-blue hover:brightness-110 transition"
          aria-label="Riwayat pipa"
        >
          &#8635;
        </button>
      )}
    </div>
  )
}
