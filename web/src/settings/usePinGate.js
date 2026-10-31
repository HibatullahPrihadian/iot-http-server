import { useCallback, useRef, useState } from 'react'
import { useSettings } from './SettingsProvider.jsx'

// Hook PIN: menjalankan aksi yang butuh PIN, dan membuka modal bila PIN belum
// ada di sesi (PIN_REQUIRED) atau ditolak server (PIN_INVALID).
//
// action: (pinOverride) => Promise. Dipanggil tanpa argumen lebih dulu (memakai
// PIN sesi), lalu diulang dengan PIN dari modal bila perlu.
export function usePinGate() {
  const { pin, setPin } = useSettings()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pendingRef = useRef(null)

  // Mengembalikan true bila aksi selesai, false bila modal PIN dibuka.
  const guarded = useCallback(async (action, onSuccess) => {
    try {
      await action()
      onSuccess?.()
      return true
    } catch (err) {
      if (err.code === 'PIN_REQUIRED' || err.code === 'PIN_INVALID') {
        pendingRef.current = { action, onSuccess }
        setError(err.code === 'PIN_INVALID' ? 'PIN salah. Coba lagi.' : '')
        setOpen(true)
        return false
      }
      throw err
    }
  }, [])

  const submit = useCallback(
    async (value) => {
      const trimmed = (value || '').trim()
      if (!trimmed) {
        setError('PIN wajib diisi.')
        return
      }
      setBusy(true)
      setError('')
      const pending = pendingRef.current
      try {
        if (pending) {
          await pending.action(trimmed)
          // Simpan PIN di sesi agar simpan berikutnya tidak meminta ulang.
          setPin(trimmed)
          pending.onSuccess?.()
          pendingRef.current = null
        } else {
          setPin(trimmed)
        }
        setOpen(false)
      } catch (err) {
        setError(err.message || 'PIN salah')
        if (err.code === 'PIN_INVALID') setPin('')
      } finally {
        setBusy(false)
      }
    },
    [setPin]
  )

  const close = useCallback(() => {
    setOpen(false)
    pendingRef.current = null
  }, [])

  return { open, error, busy, submit, close, guarded, hasPin: Boolean(pin) }
}

export default usePinGate
