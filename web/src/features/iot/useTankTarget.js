import { useEffect, useState } from 'react'
import { getTankRecipe } from './api.js'

const TTL_MS = 60000

// Cache bersama antar chart: 6 chart me-mount bersamaan = 1 request.
let cached = { value: null, fetchedAt: 0 }
let inflight = null

function validTarget(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Target ppm resep tangki aktif (floor sumbu Y chart TDS).
// enabled=false -> tidak fetch, langsung null. Gagal fetch -> diam, pakai nilai terakhir.
export function useTankTarget({ enabled = true } = {}) {
  const [target, setTarget] = useState(cached.value)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false

    async function load() {
      if (Date.now() - cached.fetchedAt < TTL_MS) {
        if (!cancelled) setTarget(cached.value)
        return
      }
      try {
        if (!inflight) {
          inflight = getTankRecipe().finally(() => {
            inflight = null
          })
        }
        const res = await inflight
        const value = validTarget(res?.recipe?.ppmTarget)
        cached = { value, fetchedAt: Date.now() }
        if (!cancelled) setTarget(value)
      } catch {
        // Diamkan; chart tetap jalan mode data-only.
      }
    }

    load()
    const timer = setInterval(load, TTL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled])

  return target
}
