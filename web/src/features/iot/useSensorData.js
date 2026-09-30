import { useCallback, useEffect, useRef, useState } from 'react'
import { getSensorData, getRelayStatus } from './api.js'

const POLL_MS = 5000

// Polling data sensor + status relay tiap 5 detik (port dari index.html baris 578-585).
// paused=window.location.href-true agar tidak fetch saat tab trend memakai hook sendiri.
export function useSensorData({ filter = 'realtime', enabled = true } = {}) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const timer = useRef(null)

  const fetchData = useCallback(async (currentFilter) => {
    try {
      const res = await getSensorData(currentFilter)
      const rows = res?.data ?? res
      if (Array.isArray(rows)) {
        setData(rows)
        setError('')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    setLoading(true)
    fetchData(filter)
    timer.current = setInterval(() => fetchData(filter), POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [filter, enabled, fetchData])

  return { data, loading, error }
}

// Polling status relay 4 kanal tiap 5 detik.
// Status berasal dari InfluxDB (uplink terakhir ESP32), jadi bisa tertinggal
// beberapa detik dari aksi user. Karena itu perubahan lokal (optimistic) tidak
// boleh langsung ditimpa nilai lama: simpan "intent" per relay sampai server
// mengonfirmasi nilai itu, atau sampai timeout.
const RELAY_INTENT_MS = 15000

export function useRelayStatus({ enabled = true } = {}) {
  const [relays, setRelays] = useState({
    relay_1: 'OFF',
    relay_2: 'OFF',
    relay_3: 'OFF',
    relay_4: 'OFF',
  })
  const [loading, setLoading] = useState(true)
  const timer = useRef(null)
  const intent = useRef({}) // { relay_n: { value, until } }

  const fetchRelay = useCallback(async () => {
    try {
      const res = await getRelayStatus()
      if (!res?.success || !res.data) return

      const now = Date.now()
      const next = {}
      for (const key of ['relay_1', 'relay_2', 'relay_3', 'relay_4']) {
        const serverValue = res.data[key]
        const pending = intent.current[key]
        if (pending && pending.until > now && serverValue !== pending.value) {
          // Server belum menyusul aksi user -> pertahankan nilai lokal.
          next[key] = pending.value
        } else {
          // Server sudah cocok atau intent kedaluwarsa -> pakai nilai server.
          if (pending) delete intent.current[key]
          next[key] = serverValue
        }
      }
      setRelays(next)
    } catch {
      // Diamkan; badge relay tetap nilai terakhir.
    } finally {
      setLoading(false)
    }
  }, [])

  // Set status relay secara optimistic + catat intent agar tidak ditimpa poll lama.
  const setRelay = useCallback((idRelay, status) => {
    const key = `relay_${idRelay}`
    intent.current[key] = { value: status, until: Date.now() + RELAY_INTENT_MS }
    setRelays((prev) => ({ ...prev, [key]: status }))
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    fetchRelay()
    timer.current = setInterval(fetchRelay, POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [enabled, fetchRelay])

  return { relays, setRelay, loading, refresh: fetchRelay }
}
