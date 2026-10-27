import { LEGEND } from '../utils/status.js'

export default function LegendBar({ compact = false }) {
  // Varian compact untuk panel sempit (kartu/ringkasan)
  const sizeClass = compact ? 'text-xs gap-x-4 gap-y-1' : 'text-sm gap-x-5 gap-y-2'

  return (
    <div className={`flex flex-wrap items-center ${sizeClass} text-mid`}>
      {LEGEND.map((item) => (
        <span key={item.label} className="flex items-center gap-2">
          <span className={`inline-block w-4 h-4 rounded-full ${item.color}`} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
