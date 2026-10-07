import { useEffect, useState } from 'react'
import { get, put } from '../api.js'
import { notifyTankRecipeChanged } from '../features/iot/useTankTarget.js'

const SELECT =
  'w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-text-body ' +
  'focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30'

// Pemilih resep tangki aktif: <select> semua resep (tanaman x fase) -> PUT /tank/recipe.
// Dipakai di CatalogPage; memuat sendiri daftar resep dari /catalog + /catalog/:id/recipes.
export default function TankRecipePicker({ onChanged }) {
  const [options, setOptions] = useState([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [catalog, tank] = await Promise.all([get('/catalog'), get('/tank')])
      const perPlant = await Promise.all(
        catalog.map((p) => get(`/catalog/${p.id}/recipes`).catch(() => []))
      )
      const opts = []
      perPlant.forEach((rows, i) => {
        for (const r of rows) {
          if (r.id === null || r.id === undefined) continue
          opts.push({ id: r.id, label: `${catalog[i].name} \u2014 ${r.phase}` })
        }
      })
      setOptions(opts)
      setActiveId(tank?.recipe?.id ? String(tank.recipe.id) : '')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function apply(value) {
    setActiveId(value)
    setError('')
    setBusy(true)
    try {
      const updated = await put('/tank/recipe', { recipeId: value === '' ? null : Number(value) })
      notifyTankRecipeChanged(updated?.recipe?.ppmTarget)
      if (onChanged) onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-low">Memuat resep...</p>
      ) : (
        <>
          <label className="block">
            <span className="text-[11px] text-text-low">Resep aktif</span>
            <select
              value={activeId}
              disabled={busy}
              onChange={(e) => apply(e.target.value)}
              className={SELECT}
            >
              <option value="">(Belum dipilih)</option>
              {options.map((o) => (
                <option key={o.id} value={String(o.id)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {activeId !== '' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => apply('')}
              className="btn-ios w-full border border-white/10 text-text-dim text-xs py-2
                hover:bg-white/5 disabled:opacity-60"
            >
              Kosongkan resep tangki
            </button>
          )}
          {options.length === 0 && (
            <p className="text-[11px] text-text-low">
              Belum ada resep. Simpan resep per fase di atas lebih dulu.
            </p>
          )}
        </>
      )}
    </div>
  )
}
