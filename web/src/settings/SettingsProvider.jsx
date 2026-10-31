import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS } from './defaults.js'
import { getSettings, putSettings, putSettingsPin } from './api.js'

const CACHE_KEY = 'hydro_settings_cache'
const PIN_KEY = 'hydro_settings_pin'

const SettingsContext = createContext(null)

function mergeWithDefaults(raw) {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS
  const merged = {}
  for (const [name, defaults] of Object.entries(DEFAULT_SETTINGS)) {
    const stored = raw[name]
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      merged[name] =
        name === 'monitoring'
          ? {
              ...defaults,
              ...stored,
              thresholds: { ...defaults.thresholds, ...(stored.thresholds || {}) },
            }
          : { ...defaults, ...stored }
    } else {
      merged[name] = defaults
    }
  }
  return merged
}

function readCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? mergeWithDefaults(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function readSessionPin() {
  if (typeof sessionStorage === 'undefined') return ''
  return sessionStorage.getItem(PIN_KEY) || ''
}

// Provider setting aplikasi: nilai dari server, fallback cache localStorage saat
// offline, dan PIN sesi untuk penulisan.
export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => readCache() || DEFAULT_SETTINGS)
  const [pinIsDefault, setPinIsDefault] = useState(true)
  const [pin, setPinValue] = useState(readSessionPin)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getSettings()
      const next = mergeWithDefaults(res?.settings)
      setSettings(next)
      setPinIsDefault(Boolean(res?.pinIsDefault))
      setError('')
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setPin = useCallback((value) => {
    const next = value || ''
    setPinValue(next)
    if (typeof sessionStorage === 'undefined') return
    if (next) sessionStorage.setItem(PIN_KEY, next)
    else sessionStorage.removeItem(PIN_KEY)
  }, [])

  // Simpan satu seksi setting. Melempar error dengan .code 'PIN_REQUIRED'
  // (belum ada PIN di sesi) atau 'PIN_INVALID' (401 dari server).
  // pinOverride dipakai saat PIN baru saja dimasukkan lewat modal.
  const saveSection = useCallback(
    async (name, values, pinOverride) => {
      const activePin = pinOverride ?? pin
      if (!activePin) {
        const err = new Error('PIN diperlukan')
        err.code = 'PIN_REQUIRED'
        throw err
      }
      try {
        const res = await putSettings(activePin, { [name]: values })
        const next = mergeWithDefaults(res?.settings)
        setSettings(next)
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(CACHE_KEY, JSON.stringify(next))
        }
        return next
      } catch (err) {
        if (err.status === 401) {
          setPin('')
          const e = new Error('PIN salah')
          e.code = 'PIN_INVALID'
          throw e
        }
        throw err
      }
    },
    [pin, setPin]
  )

  const changePin = useCallback(
    async (newPin, pinOverride) => {
      const activePin = pinOverride ?? pin
      if (!activePin) {
        const err = new Error('PIN diperlukan')
        err.code = 'PIN_REQUIRED'
        throw err
      }
      try {
        const res = await putSettingsPin(activePin, newPin)
        setPin(newPin)
        setPinIsDefault(Boolean(res?.pinIsDefault))
        return res
      } catch (err) {
        if (err.status === 401) {
          setPin('')
          const e = new Error('PIN salah')
          e.code = 'PIN_INVALID'
          throw e
        }
        throw err
      }
    },
    [pin, setPin]
  )

  const value = useMemo(
    () => ({
      settings,
      loading,
      error,
      pin,
      pinIsDefault,
      setPin,
      saveSection,
      changePin,
      refresh,
    }),
    [settings, loading, error, pin, pinIsDefault, setPin, saveSection, changePin, refresh]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings harus dipakai di dalam SettingsProvider')
  return ctx
}

export default SettingsProvider
