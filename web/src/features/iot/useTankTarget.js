import { useEffect, useState } from 'react'
import { getTankRecipe } from './api.js'

const TTL_MS = 10000

export const TANK_RECIPE_CHANGED_EVENT = 'tank-recipe-changed'

// Cache bersama antar chart: TDS + pH me-mount bersamaan = 1 request.
let cached = { recipe: { ppmTarget: null, phMin: null, phMax: null }, fetchedAt: 0 }
let inflight = null

function validPpm(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function validPh(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 14 ? n : null
}

function pickRecipe(source) {
  const ppmTarget = validPpm(source?.ppmTarget)
  const phMin = validPh(source?.phMin)
  const phMax = validPh(source?.phMax)
  return {
    ppmTarget,
    phMin: phMin !== null && phMax !== null && phMin <= phMax ? phMin : null,
    phMax: phMin !== null && phMax !== null && phMin <= phMax ? phMax : null,
  }
}

// Beri tahu chart bahwa resep tangki aktif berubah (dipanggil setelah PUT sukses).
// Terima objek resep { ppmTarget, phMin, phMax } atau angka ppmTarget (kompatibel lama).
export function notifyTankRecipeChanged(recipeOrTarget) {
  const recipe =
    recipeOrTarget !== null &&
    typeof recipeOrTarget === 'object' &&
    !Array.isArray(recipeOrTarget)
      ? pickRecipe(recipeOrTarget)
      : { ...cached.recipe, ppmTarget: validPpm(recipeOrTarget) }
  cached = { recipe, fetchedAt: Date.now() }
  window.dispatchEvent(
    new CustomEvent(TANK_RECIPE_CHANGED_EVENT, { detail: { recipe } })
  )
}

// Resep tangki aktif { ppmTarget, phMin, phMax } (field null bila tak ada).
// Dipakai chart TDS (floor + garis target) dan pH (garis batas).
// enabled=false -> tidak fetch, langsung nilai cache. Gagal fetch -> diam, pakai terakhir.
export function useTankTarget({ enabled = true } = {}) {
  const [recipe, setRecipe] = useState(cached.recipe)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false

    async function load(force = false) {
      if (!force && Date.now() - cached.fetchedAt < TTL_MS) {
        if (!cancelled) setRecipe(cached.recipe)
        return
      }
      try {
        if (!inflight) {
          inflight = getTankRecipe().finally(() => {
            inflight = null
          })
        }
        const res = await inflight
        const next = pickRecipe(res?.recipe)
        cached = { recipe: next, fetchedAt: Date.now() }
        if (!cancelled) setRecipe(next)
      } catch {
        // Diamkan; chart tetap jalan mode data-only/statis.
      }
    }

    load()
    const timer = setInterval(() => load(false), TTL_MS)

    function handleRecipeChanged(event) {
      const detail = event?.detail
      const next =
        detail?.recipe !== null && typeof detail?.recipe === 'object'
          ? pickRecipe(detail.recipe)
          : { ...cached.recipe, ppmTarget: validPpm(detail?.ppmTarget) }
      cached = { recipe: next, fetchedAt: Date.now() }
      if (!cancelled) setRecipe(next)
    }
    window.addEventListener(TANK_RECIPE_CHANGED_EVENT, handleRecipeChanged)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(TANK_RECIPE_CHANGED_EVENT, handleRecipeChanged)
    }
  }, [enabled])

  return recipe
}
