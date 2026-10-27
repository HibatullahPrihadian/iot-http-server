import { useEffect } from 'react'

// Class input form yang dipakai bersama modal (gaya dark iOS).
export const INPUT =
  'w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-text-body ' +
  'placeholder:text-text-low focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30'

// Shell modal reusable: overlay gelap + panel glass, tutup via backdrop / Escape / tombol X.
// Lock scroll body saat terbuka supaya halaman di belakang tidak ikut ter-scroll.
export default function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  busy = false,
}) {
  useEffect(() => {
    if (!open) return undefined

    function onKeyDown(e) {
      if (e.key === 'Escape' && !busy) onClose?.()
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={() => {
        if (!busy) onClose?.()
      }}
    >
      <div
        className="glass-panel w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-text-hi">{title}</h3>
            {subtitle && <p className="text-sm text-text-low mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            disabled={busy}
            className="text-text-low hover:text-text-body text-xl leading-none disabled:opacity-50"
            aria-label="Tutup"
          >
            &times;
          </button>
        </div>

        {children}

        {footer && <div className="mt-5 flex gap-2">{footer}</div>}
      </div>
    </div>
  )
}
