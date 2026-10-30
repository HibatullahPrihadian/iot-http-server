import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, RefreshCw, WifiOff } from 'lucide-react'
import { useToast } from '../features/iot/Toast.jsx'

// Event `beforeinstallprompt` bisa datang sebelum React selesai mount, jadi
// listener dipasang di level modul dan hasilnya dibagikan lewat subscriber.
let deferredPrompt = null
const promptListeners = new Set()

function publishPrompt(value) {
  deferredPrompt = value
  for (const listener of promptListeners) listener(value)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    publishPrompt(event)
  })
  window.addEventListener('appinstalled', () => publishPrompt(null))
}

function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  )
}

// Status PWA: ketersediaan update, tombol install, dan status jaringan.
export function usePwa() {
  const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true })
  const toast = useToast()

  const [installPrompt, setInstallPrompt] = useState(deferredPrompt)
  const [installed, setInstalled] = useState(isStandalone)
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const [dismissedUpdate, setDismissedUpdate] = useState(false)
  const offlineNotified = useRef(false)

  useEffect(() => {
    const onPrompt = (value) => setInstallPrompt(value)
    promptListeners.add(onPrompt)
    return () => promptListeners.delete(onPrompt)
  }, [])

  useEffect(() => {
    const onInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // App shell sudah tersimpan di cache -> beri tahu sekali.
  useEffect(() => {
    if (!offlineReady[0] || offlineNotified.current) return
    offlineNotified.current = true
    toast.success('Aplikasi siap dipakai offline.')
  }, [offlineReady, toast])

  // Setelah update dipasang (needRefresh kembali false), izinkan prompt lagi
  // untuk rilis berikutnya.
  useEffect(() => {
    if (!needRefresh[0]) setDismissedUpdate(false)
  }, [needRefresh])

  const promptInstall = useCallback(async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice?.outcome === 'accepted') setInstalled(true)
    publishPrompt(null)
  }, [installPrompt])

  const needRefreshValue = needRefresh[0] && !dismissedUpdate

  const applyUpdate = useCallback(() => {
    updateServiceWorker(true)
  }, [updateServiceWorker])

  return {
    online,
    needRefresh: needRefreshValue,
    applyUpdate,
    dismissUpdate: () => setDismissedUpdate(true),
    canInstall: Boolean(installPrompt) && !installed,
    promptInstall,
  }
}

// Banner status jaringan: app shell tetap tampil, data sensor tidak.
export function OfflineBanner({ online }) {
  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-ios-orange/40 bg-ios-orange/15 px-4 py-2 text-xs font-semibold text-ios-orange"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <WifiOff size={14} aria-hidden="true" className="shrink-0" />
        <span>
          Offline — tampilan aplikasi tetap terbuka, tapi data sensor dan perintah tidak tersedia.
        </span>
      </div>
    </div>
  )
}

// Tombol install (hanya muncul bila browser menawarkan prompt).
export function InstallButton({ canInstall, onInstall }) {
  if (!canInstall) return null
  return (
    <button
      type="button"
      onClick={onInstall}
      className="inline-flex items-center self-center whitespace-nowrap rounded-xl bg-ios-blue px-3 py-2 text-xs
        font-semibold text-white shadow-glow-blue transition active:scale-[0.97]"
      title="Pasang aplikasi ke layar utama"
    >
      <Download size={14} className="mr-1.5" aria-hidden="true" />
      Pasang
    </button>
  )
}

// Banner update: service worker baru menunggu, user yang memutuskan reload.
export function UpdateBanner({ needRefresh, onApply, onDismiss }) {
  if (!needRefresh) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass-panel fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50
        px-4 py-3 md:inset-x-auto md:right-4 md:bottom-4 md:w-[22rem]"
    >
      <div className="flex items-start gap-3">
        <RefreshCw size={18} className="mt-0.5 shrink-0 text-ios-blue" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-hi">Versi baru tersedia</p>
          <p className="mt-0.5 text-xs text-text-low">
            Muat ulang untuk memakai pembaruan aplikasi.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={onApply}
              className="rounded-xl bg-ios-blue px-3 py-1.5 text-xs font-semibold text-white
                transition active:scale-[0.97]"
            >
              Muat ulang
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-text-low
                transition hover:bg-white/5 hover:text-text-body active:scale-[0.97]"
            >
              Nanti
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
