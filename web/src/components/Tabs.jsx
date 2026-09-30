import { LayoutDashboard, History, BarChart3, Sprout } from 'lucide-react'

const TABS = [
  { key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'history', label: 'Riwayat', Icon: History },
  { key: 'stats', label: 'Statistik', Icon: BarChart3 },
  { key: 'catalog', label: 'Katalog', Icon: Sprout },
]

export function Tabs({ active, onChange }) {
  return (
    <nav className="hidden md:flex gap-1.5">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          aria-current={active === t.key ? 'page' : undefined}
          className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold
            transition active:scale-[0.97]
            ${
              active === t.key
                ? 'bg-ios-blue text-white shadow-glow-blue'
                : 'text-text-low hover:bg-white/5 hover:text-text-body'
            }`}
        >
          <t.Icon size={16} className="-mt-0.5 mr-1.5" aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </nav>
  )
}

export function BottomTabs({ active, onChange }) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 md:hidden glass-panel !rounded-none !border-x-0 !border-b-0
        pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-stretch">
        {TABS.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold
                transition active:scale-[0.97]
                ${isActive ? 'text-ios-blue' : 'text-text-low'}`}
            >
              <t.Icon size={20} aria-hidden="true" />
              {t.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default Tabs
