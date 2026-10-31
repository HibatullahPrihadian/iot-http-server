import { useEffect, useRef } from 'react'
import { SETTINGS_SECTIONS } from '../../settings/sections.js'

// Strip sub-menu Settings: sticky tepat di bawah header aplikasi, bisa digeser
// horizontal di layar kecil, dan menandai tab yang belum disimpan (dirtyKeys).
export default function SettingsTabs({ active, dirtyKeys = [], onChange }) {
  const listRef = useRef(null)

  // Pastikan tab aktif terlihat saat dibuka lewat deep link / back-forward.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.querySelector(`[data-tab="${active}"]`)
    el?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [active])

  return (
    <div
      className="sticky z-20 -mx-4 px-4 py-2 bg-surface-bg/90 backdrop-blur
        border-b border-white/10"
      style={{ top: 'var(--app-header-h)' }}
    >
      <nav
        ref={listRef}
        role="tablist"
        aria-label="Sub-menu pengaturan"
        className="flex gap-1.5 overflow-x-auto max-w-7xl mx-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SETTINGS_SECTIONS.map(({ key, label, Icon }) => {
          const isActive = active === key
          const isDirty = dirtyKeys.includes(key)
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`settings-tab-${key}`}
              data-tab={key}
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onChange(key)}
              className={`relative inline-flex shrink-0 items-center whitespace-nowrap rounded-xl
                px-3.5 py-2 text-sm font-semibold transition active:scale-[0.97]
                ${
                  isActive
                    ? 'bg-ios-blue text-white shadow-glow-blue'
                    : 'text-text-low hover:bg-white/5 hover:text-text-body'
                }`}
            >
              <Icon size={16} className="-mt-0.5 mr-1.5" aria-hidden="true" />
              {label}
              {isDirty && (
                <span
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-ios-orange"
                  aria-label="Ada perubahan belum disimpan"
                />
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
