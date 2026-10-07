import { useEffect, useState } from 'react'
import { getTankRecipe } from './api.js'

const TTL_MS = 10000

export const TANK_RECIPE_CHANGED_EVENT = 'tank-recipe-changed'

// Cache bersama antar chart: 6 chart me-mount bersamaan = 1 request.
let cached = { value: null, fetchedAt: 0 }
let inflight = null

function validTarget(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Beri tahu chart bahwa resep tangki aktif berubah (dipanggil setelah PUT sukses).
// Nilai valid langsung dipakai; null/invalid menandai cache basi agar refetch.
export function notifyTankRecipeChanged(ppmTarget) {
  const value = validTarget(ppmTarget)
  if (value !== null) cached = { value, fetchedAt: Date.now() }
  else cached = { value: cached.value, fetchedAt: 0 }
  window.dispatchEvent(
    new CustomEvent(TANK_RECIPE_CHANGED_EVENT, { detail: { ppmTarget: value } })
  )
}

// Target ppm resep tangki aktif (floor sumbu Y chart TDS).
// enabled=false -> tidak fetch, langsung null. Gagal fetch -> diam, pakai nilai terakhir.
export function useTankTarget({ enabled = true } = {}) {
  const [target, setTarget] = useState(cached.value)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false

    async function load(force = false) {
      if (!force && Date.now() - cached.fetchedAt < TTL_MS) {
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
    const timer = setInterval(() => load(false), TTL_MS)

    function handleRecipeChanged(event) {
      const value = validTarget(event?.detail?.ppmTarget)
      if (value !== null) {
        cached = { value, fetchedAt: Date.now() }
        if (!cancelled) setTarget(value)
      } else {
        load(true)
      }
    }
    window.addEventListener(TANK_RECIPE_CHANGED_EVENT, handleRecipeChanged)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(TANK_RECIPE_CHANGED_EVENT, handleRecipeChanged)
    }
  }, [enabled])

  return target
}
