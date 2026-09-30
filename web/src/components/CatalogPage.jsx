import { useState } from 'react'
import { get, post, put, del } from '../api.js'
import TankRecipePicker from './TankRecipePicker.jsx'

const EMPTY_FORM = { name: '', seedlingDays: '', growDays: '' }

const PHASES = ['Semai', 'Pembesaran']

const EMPTY_RECIPE = {
  ppmTarget: '',
  phMin: '',
  phMax: '',
  gramPerLiterA: '',
  gramPerLiterB: '',
  konstanta: '',
  ppmAirDefault: '',
  volumeTangki: '',
  catatan: '',
}

const INPUT =
  'mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-text-body focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30'

// CRUD katalog tanaman + editor resep nutrisi (RCP) 2 fase.
export default function CatalogPage({ catalog, onChanged }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Resep: di-key per fase.
  const [recipes, setRecipes] = useState({ Semai: null, Pembesaran: null })
  const [recipeError, setRecipeError] = useState('')
  const [recipeBusy, setRecipeBusy] = useState(null)
  const [recipeSaved, setRecipeSaved] = useState(null)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function reset() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError('')
    setRecipes({ Semai: null, Pembesaran: null })
    setRecipeError('')
    setRecipeSaved(null)
  }

  async function loadRecipes(id) {
    try {
      const rows = await get(`/catalog/${id}/recipes`)
      const next = { Semai: null, Pembesaran: null }
      for (const r of rows) {
        next[r.phase] = {
          ppmTarget: r.ppmTarget ?? '',
          phMin: r.phMin ?? '',
          phMax: r.phMax ?? '',
          gramPerLiterA: r.gramPerLiterA ?? '',
          gramPerLiterB: r.gramPerLiterB ?? '',
          konstanta: r.konstanta ?? '',
          ppmAirDefault: r.ppmAirDefault ?? '',
          volumeTangki: r.volumeTangki ?? '',
          catatan: r.catatan ?? '',
        }
      }
      setRecipes(next)
    } catch (err) {
      setRecipeError(err.message)
    }
  }

  function startEdit(item) {
    setEditingId(item.id)
    setForm({
      name: item.name,
      seedlingDays: String(item.seedlingDays),
      growDays: String(item.growDays),
    })
    setError('')
    setRecipeError('')
    setRecipeSaved(null)
    setRecipes({ Semai: null, Pembesaran: null })
    loadRecipes(item.id)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const body = {
        name: form.name.trim(),
        seedlingDays: Number(form.seedlingDays),
        growDays: Number(form.growDays),
      }
      if (editingId) {
        await put(`/catalog/${editingId}`, body)
      } else {
        await post('/catalog', body)
      }
      reset()
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(item) {
    setError('')
    setBusy(true)
    try {
      await del(`/catalog/${item.id}`)
      if (editingId === item.id) reset()
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function setRecipeField(phase, key, value) {
    setRecipes((prev) => ({ ...prev, [phase]: { ...prev[phase], [key]: value } }))
    setRecipeSaved(null)
  }

  async function saveRecipe(phase) {
    setRecipeError('')
    setRecipeBusy(phase)
    setRecipeSaved(null)
    try {
      const r = recipes[phase] || EMPTY_RECIPE
      const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
      const body = {
        ppmTarget: numOrNull(r.ppmTarget),
        phMin: numOrNull(r.phMin),
        phMax: numOrNull(r.phMax),
        gramPerLiterA: numOrNull(r.gramPerLiterA),
        gramPerLiterB: numOrNull(r.gramPerLiterB),
        konstanta: numOrNull(r.konstanta),
        ppmAirDefault: numOrNull(r.ppmAirDefault),
        volumeTangki: numOrNull(r.volumeTangki),
        catatan: r.catatan || null,
      }
      await put(`/catalog/${editingId}/recipes/${phase}`, body)
      setRecipeSaved(phase)
    } catch (err) {
      setRecipeError(err.message)
    } finally {
      setRecipeBusy(null)
    }
  }

  const totalPreview =
    Number(form.seedlingDays) > 0 && Number(form.growDays) > 0
      ? Number(form.seedlingDays) + Number(form.growDays)
      : null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="glass-panel p-5">
        <h2 className="text-base font-bold text-text-hi mb-4">
          {editingId ? 'Edit Tanaman' : 'Tambah Tanaman'}
        </h2>

        {error && (
          <div className="mb-3 rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-mid">Nama</span>
            <input
              value={form.name}
              onChange={set('name')}
              required
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-mid">Hari semai</span>
            <input
              type="number"
              min="1"
              value={form.seedlingDays}
              onChange={set('seedlingDays')}
              required
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-mid">Hari pembesaran</span>
            <input
              type="number"
              min="1"
              value={form.growDays}
              onChange={set('growDays')}
              required
              className={INPUT}
            />
          </label>

          {totalPreview && (
            <p className="text-xs text-text-low">Total: {totalPreview} hari</p>
          )}

          <div className="flex gap-2">
            {editingId && (
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="btn-ios flex-1 border border-white/10 text-text-dim text-sm
                  py-2 hover:bg-white/5"
              >
                Batal
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="btn-ios flex-1 bg-ios-green hover:shadow-glow-green disabled:opacity-60
                text-white text-sm py-2"
            >
              {busy ? 'Menyimpan...' : editingId ? 'Simpan' : 'Tambah'}
            </button>
          </div>
        </form>

        {editingId && (
          <div className="mt-5 border-t border-white/10 pt-4">
            <h3 className="text-sm font-bold text-text-hi mb-1">Resep Nutrisi (RCP)</h3>
            <p className="text-[11px] text-text-low mb-3">
              Nilai awal adalah tebakan; sesuaikan dengan pupuk &amp; kondisi Anda.
            </p>

            {recipeError && (
              <div className="mb-3 rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
                {recipeError}
              </div>
            )}

            {recipes.Semai === null ? (
              <p className="text-xs text-text-low">Memuat resep...</p>
            ) : (
              <div className="space-y-4">
                {PHASES.map((phase) => {
                  const r = recipes[phase] || EMPTY_RECIPE
                  return (
                    <div key={phase} className="rounded-lg bg-black/20 border border-white/10 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-text-body">{phase}</span>
                        {recipeSaved === phase && (
                          <span className="text-[11px] text-ios-green">Tersimpan</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <RecipeInput label="ppm target" value={r.ppmTarget} onChange={(v) => setRecipeField(phase, 'ppmTarget', v)} />
                        <RecipeInput label="ppm air baku" value={r.ppmAirDefault} onChange={(v) => setRecipeField(phase, 'ppmAirDefault', v)} />
                        <RecipeInput label="pH min" step="0.1" value={r.phMin} onChange={(v) => setRecipeField(phase, 'phMin', v)} />
                        <RecipeInput label="pH max" step="0.1" value={r.phMax} onChange={(v) => setRecipeField(phase, 'phMax', v)} />
                        <RecipeInput label="g/L A" step="0.1" value={r.gramPerLiterA} onChange={(v) => setRecipeField(phase, 'gramPerLiterA', v)} />
                        <RecipeInput label="g/L B" step="0.1" value={r.gramPerLiterB} onChange={(v) => setRecipeField(phase, 'gramPerLiterB', v)} />
                        <RecipeInput label="konstanta" step="1" value={r.konstanta} onChange={(v) => setRecipeField(phase, 'konstanta', v)} />
                        <RecipeInput label="volume tangki (L)" step="1" value={r.volumeTangki} onChange={(v) => setRecipeField(phase, 'volumeTangki', v)} />
                      </div>
                      <label className="block mt-2">
                        <span className="text-[11px] text-text-low">Catatan</span>
                        <input
                          value={r.catatan}
                          onChange={(e) => setRecipeField(phase, 'catatan', e.target.value)}
                          className={INPUT}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => saveRecipe(phase)}
                        disabled={recipeBusy === phase}
                        className="btn-ios mt-2 w-full bg-ios-blue hover:shadow-glow-blue disabled:opacity-60
                          text-white text-xs py-2"
                      >
                        {recipeBusy === phase ? 'Menyimpan...' : `Simpan Resep ${phase}`}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="lg:col-span-2 space-y-6">
        <section className="glass-panel p-5">
          <h2 className="text-base font-bold text-text-hi mb-1">Resep Tangki Aktif</h2>
          <p className="text-[11px] text-text-low mb-3">
            Resep RCP yang dipakai di tangki (satu tangki untuk 2 meja).
          </p>
          <TankRecipePicker onChanged={onChanged} />
        </section>

        <section className="glass-panel overflow-x-auto">
          <table className="w-full text-sm">
          <thead className="bg-white/5 text-text-low text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Nama</th>
              <th className="px-4 py-3 font-semibold">Semai</th>
              <th className="px-4 py-3 font-semibold">Besar</th>
              <th className="px-4 py-3 font-semibold">Total</th>
              <th className="px-4 py-3 font-semibold">Resep</th>
              <th className="px-4 py-3 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {catalog.map((c) => (
              <tr key={c.id} className="hover:bg-white/5 transition">
                <td className="px-4 py-3 font-medium text-text-hi">{c.name}</td>
                <td className="px-4 py-3 text-text-dim">{c.seedlingDays} hari</td>
                <td className="px-4 py-3 text-text-dim">{c.growDays} hari</td>
                <td className="px-4 py-3 text-text-dim">{c.totalDays} hari</td>
                <td className="px-4 py-3">
                  {c.hasRecipe ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-ios-green/15 text-ios-green">
                      Ada
                    </span>
                  ) : (
                    <span className="text-text-low">&mdash;</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="text-ios-blue hover:underline text-xs font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c)}
                      disabled={busy}
                      className="text-ios-red hover:underline text-xs font-semibold disabled:opacity-50"
                    >
                      Hapus
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      </div>
    </div>
  )
}

function RecipeInput({ label, value, onChange, step }) {
  return (
    <label className="block">
      <span className="text-[11px] text-text-low">{label}</span>
      <input
        type="number"
        min="0"
        step={step || '1'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </label>
  )
}
