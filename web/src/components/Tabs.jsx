import { useEffect, useRef } from 'react'
import { LayoutDashboard, History, BarChart3, Sprout, Droplets } from 'lucide-react'

const TABS = [
  { key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'history', label: 'Riwayat', Icon: History },
  { key: 'stats', label: 'Statistik', Icon: BarChart3 },
  { key: 'catalog', label: 'Katalog', Icon: Sprout },
  { key: 'tank', label: 'Tangki', Icon: Droplets },
]

// Tab desktop di dalam kartu judul halaman (pola Plan).
// tabs/idPrefix/renderBadge opsional agar komponen ini dipakai juga oleh
// sub-menu Settings tanpa mengubah tampilan Plan.
export function Tabs({ active, onChange, tabs = TABS, idPrefix, renderBadge }) {
  return (
    <nav className="hidden md:flex gap-1.5" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={idPrefix ? `${idPrefix}-${t.key}` : undefined}
          onClick={() => onChange(t.key)}
          aria-selected={active === t.key}
          aria-current={active === t.key ? 'page' : undefined}
          className={`relative inline-flex shrink-0 items-center whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold
            transition active:scale-[0.97]
            ${
              active === t.key
                ? 'bg-ios-blue text-white shadow-glow-blue'
                : 'text-text-low hover:bg-white/5 hover:text-text-body'
            }`}
        >
          <t.Icon size={16} className="-mt-0.5 mr-1.5" aria-hidden="true" />
          {t.label}
          {renderBadge?.(t.key)}
        </button>
      ))}
    </nav>
  )
}

// Tab mobile. scrollable=false = gaya Plan (bagi rata lebar layar);
// scrollable=true = item shrink-0 yang bisa digeser bila tabnya banyak.
export function BottomTabs({
  active,
  onChange,
  tabs = TABS,
  idPrefix,
  renderBadge,
  scrollable = false,
}) {
  const listRef = useRef(null)

  // Bila scrollable, pastikan tab aktif terlihat saat deep link / back-forward.
  useEffect(() => {
    if (!scrollable) return
    const el = listRef.current?.querySelector(`[data-tab="${active}"]`)
    el?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [active, scrollable])

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 md:hidden glass-panel !rounded-none !border-x-0 !border-b-0
        pb-[env(safe-area-inset-bottom)]"
    >
      <div
        ref={listRef}
        className={
          scrollable
            ? 'flex items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            : 'flex items-stretch'
        }
      >
        {tabs.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              data-tab={t.key}
              id={idPrefix ? `${idPrefix}-${t.key}` : undefined}
              onClick={() => onChange(t.key)}
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 font-semibold
                transition active:scale-[0.97] text-[10px]
                ${scrollable ? 'shrink-0 px-4 py-2.5' : 'flex-1 py-2.5'}
                ${isActive ? 'text-ios-blue' : 'text-text-low'}`}
            >
              <t.Icon size={20} aria-hidden="true" />
              {t.label}
              {renderBadge?.(t.key)}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default Tabs
