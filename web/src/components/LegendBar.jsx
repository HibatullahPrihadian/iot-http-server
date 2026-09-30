import { LEGEND } from '../utils/status.js'

export default function LegendBar() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-mid">
      {LEGEND.map((item) => (
        <span key={item.label} className="flex items-center gap-2">
          <span className={`inline-block w-4 h-4 rounded-full ${item.color}`} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
