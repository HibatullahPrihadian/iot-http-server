import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

const SWIPE_THRESHOLD = 40

function formatCaption(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

// Lightbox gambar dokumentasi. Dirender lewat portal ke document.body karena
// panel induk memakai backdrop-filter (mengurung position: fixed).
export default function ImageLightbox({ images, initialIndex = 0, onClose }) {
  const total = images.length
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(total - 1, 0))
  )
  const [failed, setFailed] = useState(false)
  const closeRef = useRef(null)
  const touchStart = useRef(null)
  const previousOverflow = useRef('')

  const go = useCallback(
    (delta) => {
      if (total <= 1) return
      setIndex((prev) => (prev + delta + total) % total)
      setFailed(false)
    },
    [total]
  )

  const close = useCallback(() => onClose?.(), [onClose])

  // Kunci scroll body + kelola fokus. Nilai overflow sebelumnya bisa 'hidden'
  // (dikunci PlantModal), jadi harus dikembalikan persis.
  useEffect(() => {
    previousOverflow.current = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previouslyFocused = document.activeElement
    closeRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow.current
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  // Listener capture agar Escape/panah tidak ikut ditangani PlantModal.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.stopPropagation()
        go(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.stopPropagation()
        go(1)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [close, go])

  // Jaga index tetap valid bila daftar gambar berubah.
  useEffect(() => {
    setIndex((prev) => Math.min(Math.max(prev, 0), Math.max(total - 1, 0)))
  }, [total])

  const current = images[index]

  function handleTouchStart(e) {
    const t = e.touches?.[0]
    if (!t) return
    touchStart.current = { x: t.clientX, y: t.clientY }
  }

  function handleTouchEnd(e) {
    const start = touchStart.current
    const t = e.changedTouches?.[0]
    touchStart.current = null
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // Hanya pindah bila horizontal dominan, agar scroll vertikal tidak memicu.
    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      go(dx > 0 ? -1 : 1)
    }
  }

  if (!current) return null

  const caption = formatCaption(current.createdAt)

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Preview gambar dokumentasi"
      onClick={close}
    >
      <div
        className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-4 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 text-xs">
          <p className="font-semibold text-text-body tabular-nums">
            Gambar {index + 1} / {total}
          </p>
          {caption && <p className="text-text-low mt-0.5">{caption}</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="Tutup preview"
          className="btn-ios inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full
            bg-white/10 text-text-body hover:bg-white/20 focus:outline-none
            focus:ring-2 focus:ring-ios-blue/60"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div
        className="absolute inset-0 flex items-center justify-center px-4 py-16"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {failed ? (
          <p className="text-sm text-text-low">Gambar tidak dapat dimuat.</p>
        ) : (
          <img
            src={current.url}
            alt={`Dokumentasi tanaman ${index + 1} dari ${total}`}
            className="max-h-[80vh] max-w-[92vw] select-none object-contain"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onError={() => setFailed(true)}
          />
        )}
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              go(-1)
            }}
            aria-label="Gambar sebelumnya"
            className="btn-ios absolute left-2 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2
              items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70
              focus:outline-none focus:ring-2 focus:ring-ios-blue/60"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              go(1)
            }}
            aria-label="Gambar berikutnya"
            className="btn-ios absolute right-2 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2
              items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70
              focus:outline-none focus:ring-2 focus:ring-ios-blue/60"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
