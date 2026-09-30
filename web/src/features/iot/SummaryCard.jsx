import { SENSORS, alertStatus, alertCardClass, alertValueClass, formatSensor } from './utils.js'

// Kartu ringkasan 1 sensor + status alert. Klik -> buka trend.
export default function SummaryCard({ sensorKey, row, onOpenTrend }) {
  const meta = SENSORS[sensorKey]
  const status = alertStatus(sensorKey, row)

  return (
    <button
      type="button"
      onClick={() => onOpenTrend && onOpenTrend(sensorKey)}
      className={`glass-panel p-5 text-center cursor-pointer ${meta.glow} ${alertCardClass(status)}`}
    >
      <div className="text-3xl mb-3 drop-shadow-[0_4px_6px_rgba(0,0,0,0.3)]">{meta.icon}</div>
      <div className="text-sm text-text-low font-semibold tracking-[-0.2px]">{meta.label}</div>
      {row ? (
        <div className={`text-2xl font-bold mt-1.5 tracking-[-0.5px] text-glow-white ${alertValueClass(status)}`}>
          {formatSensor(row, sensorKey)}
        </div>
      ) : (
        <div className="skeleton mt-1.5" aria-hidden="true" />
      )}
    </button>
  )
}
