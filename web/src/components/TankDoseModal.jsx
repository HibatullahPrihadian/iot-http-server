import { useEffect, useState } from 'react'
import { post } from '../api.js'
import { formatPpm } from '../utils/status.js'
import Modal, { INPUT } from './Modal.jsx'

// Modal: kalkulator dosis AB Mix. Memakai resep tangki aktif sebagai default
// ppm air awal & target ppm. Hasil perhitungan tampil di dalam modal.
export default function TankDoseModal({ open, onClose, recipe, onGoCatalog }) {
  const [volumeAir, setVolumeAir] = useState('10')
  const [ppmAirAwal, setPpmAirAwal] = useState('')
  const [targetPpm, setTargetPpm] = useState('')
  const [dose, setDose] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Default form mengikuti resep aktif setiap modal dibuka.
  useEffect(() => {
    if (!open) return
    setDose(null)
    setError('')
    setVolumeAir('10')
    setPpmAirAwal(recipe?.ppmAirDefault == null ? '' : String(recipe.ppmAirDefault))
    setTargetPpm(recipe?.ppmTarget == null ? '' : String(recipe.ppmTarget))
  }, [open, recipe])

  async function handleCalc(e) {
    e.preventDefault()
    setError('')
    setDose(null)
    setBusy(true)
    try {
      const body = { volumeAir: Number(volumeAir) }
      if (ppmAirAwal !== '') body.ppmAirAwal = Number(ppmAirAwal)
      if (targetPpm !== '') body.targetPpm = Number(targetPpm)
      const result = await post('/tank/dose', body)
      setDose(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Kalkulator Dosis"
      subtitle="Perkiraan gram AB Mix A & B untuk volume air tertentu"
      onClose={onClose}
      busy={busy}
    >
      {!recipe ? (
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-3 text-xs text-text-low">
          <p>Belum ada resep tangki aktif.</p>
          {onGoCatalog && (
            <button
              type="button"
              onClick={onGoCatalog}
              className="mt-2 text-ios-blue hover:underline font-semibold"
            >
              Pilih di tab Katalog &rarr;
            </button>
          )}
          <p className="mt-2">
            Dosis memakai target ppm/pH dari resep, jadi resep perlu dipilih lebih dulu.
          </p>
        </div>
      ) : (
        <form onSubmit={handleCalc} className="space-y-3" noValidate>
          {error && (
            <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[11px] text-text-low">Volume (L)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={volumeAir}
                onChange={(e) => setVolumeAir(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-text-low">ppm air</span>
              <input
                type="number"
                min="0"
                value={ppmAirAwal}
                onChange={(e) => setPpmAirAwal(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-text-low">target ppm</span>
              <input
                type="number"
                min="0"
                value={targetPpm}
                onChange={(e) => setTargetPpm(e.target.value)}
                className={INPUT}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="btn-ios w-full bg-ios-blue hover:shadow-glow-blue disabled:opacity-60
              text-white text-xs py-2"
          >
            {busy ? 'Menghitung...' : 'Hitung Dosis'}
          </button>

          {dose && (
            <div className="rounded-lg bg-ios-cyan/10 border border-ios-cyan/40 text-ios-cyan text-xs px-3 py-2">
              AB Mix A: <strong>{dose.gramA} g</strong> &middot; B:{' '}
              <strong>{dose.gramB} g</strong> untuk {dose.volumeAir} L (target{' '}
              {formatPpm(dose.targetPpm)}, konstanta {dose.konstanta})
            </div>
          )}
        </form>
      )}
    </Modal>
  )
}
