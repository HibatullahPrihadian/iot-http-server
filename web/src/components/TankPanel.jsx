import { useEffect, useState } from 'react'
import { get, post } from '../api.js'
import {
  nutritionAlert,
  formatPpm,
  formatPh,
  formatDateTime,
  formatRelativeTime,
} from '../utils/status.js'

const ALERT_STYLE = {
  ok: 'bg-ios-green/10 border-ios-green/40 text-ios-green',
  warn: 'bg-ios-orange/10 border-ios-orange/40 text-ios-orange',
  danger: 'bg-ios-red/10 border-ios-red/40 text-ios-red',
}

const INPUT =
  'w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-text-body ' +
  'placeholder:text-text-low focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30'

// Panel resep tangki (satu tangki global untuk 2 meja) yang tampil di atas Meja 1:
// resep aktif, kalkulator dosis, dan pembacaan sensor IoT terakhir.
export default function TankPanel({ onGoCatalog }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [recipe, setRecipe] = useState(null)
  const [sensor, setSensor] = useState(null)
  const [sensorError, setSensorError] = useState(null)
  const [sensorAt, setSensorAt] = useState(null)

  // Kalkulator.
  const [volumeAir, setVolumeAir] = useState('10')
  const [ppmAirAwal, setPpmAirAwal] = useState('')
  const [targetPpm, setTargetPpm] = useState('')
  const [dose, setDose] = useState(null)
  const [calcBusy, setCalcBusy] = useState(false)

  // Muat data tangki. Error sensor dipisah dari error panel.
  async function load() {
    setError('')
    try {
      const data = await get('/tank')
      setRecipe(data.recipe || null)
      setSensor(data.sensor || null)
      setSensorError(data.sensorError || null)
      setSensorAt(new Date().toISOString())
      if (data.recipe) {
        setPpmAirAwal(
          data.recipe.ppmAirDefault === null || data.recipe.ppmAirDefault === undefined
            ? ''
            : String(data.recipe.ppmAirDefault)
        )
        setTargetPpm(
          data.recipe.ppmTarget === null || data.recipe.ppmTarget === undefined
            ? ''
            : String(data.recipe.ppmTarget)
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Poll ringan 30 detik; dibersihkan saat unmount.
    const timer = setInterval(() => {
      load()
    }, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCalc(e) {
    e.preventDefault()
    setError('')
    setCalcBusy(true)
    setDose(null)
    try {
      const body = { volumeAir: Number(volumeAir) }
      if (ppmAirAwal !== '') body.ppmAirAwal = Number(ppmAirAwal)
      if (targetPpm !== '') body.targetPpm = Number(targetPpm)
      const result = await post('/tank/dose', body)
      setDose(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setCalcBusy(false)
    }
  }

  const alert = nutritionAlert(sensor, recipe)

  return (
    <section className="glass-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-text-hi">Resep Tangki</h2>
        {recipe && (
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-text-mid">
              {recipe.plantName}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-ios-blue/15 text-ios-blue">
              {recipe.phase}
            </span>
          </div>
        )}
      </div>
      <p className="text-[11px] text-text-low mt-1">
        Satu tangki untuk 2 meja. Nilai sensor adalah kondisi tangki total, bukan per pipa.
      </p>

      {error && (
        <div className="mt-3 rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-3 text-xs text-text-low">Memuat data tangki...</p>
      ) : !recipe ? (
        <div className="mt-3 rounded-lg bg-white/5 border border-white/10 px-3 py-3 text-xs text-text-low">
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
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2 text-xs">
            <Info label="Target ppm" value={formatPpm(recipe.ppmTarget)} />
            <Info
              label="Rentang pH"
              value={
                recipe.phMin !== null && recipe.phMax !== null
                  ? `${recipe.phMin} - ${recipe.phMax}`
                  : '-'
              }
            />
            <Info
              label="AB Mix A"
              value={recipe.gramPerLiterA !== null ? `${recipe.gramPerLiterA} g/L` : '-'}
            />
            <Info
              label="AB Mix B"
              value={recipe.gramPerLiterB !== null ? `${recipe.gramPerLiterB} g/L` : '-'}
            />
            <Info label="Konstanta" value={recipe.konstanta !== null ? String(recipe.konstanta) : '-'} />
            <Info label="ppm air baku" value={formatPpm(recipe.ppmAirDefault)} />
            <Info
              label="Volume tangki"
              value={recipe.volumeTangki !== null && recipe.volumeTangki !== undefined ? `${recipe.volumeTangki} L` : '-'}
            />
          </dl>

          {(!recipe.volumeTangki || recipe.volumeTangki <= 0) && (
            <p className="text-[11px] text-ios-orange">
              Volume tangki belum diisi &mdash; automasi pompa AB Mix akan melewati dosing.
              Atur di tab Katalog.
            </p>
          )}

          {recipe.catatan && (
            <p className="text-[11px] text-text-low border-l-2 border-white/10 pl-2">
              {recipe.catatan}
            </p>
          )}

          {/* Pembacaan sensor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-text-mid">Pembacaan Sensor</p>
              {sensor && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full ${
                    sensor.stale
                      ? 'bg-ios-red/15 text-ios-red'
                      : 'bg-ios-green/15 text-ios-green'
                  }`}
                >
                  {sensor.stale ? 'Offline' : 'Online'}
                </span>
              )}
            </div>

            {sensorError ? (
              <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
                Tidak dapat membaca sensor &mdash; {sensorError}
                {sensorAt && (
                  <span className="block text-text-low mt-0.5">
                    Percobaan: {formatDateTime(sensorAt)}
                  </span>
                )}
              </div>
            ) : sensor ? (
              <div className={`rounded-lg border px-3 py-2 text-xs ${ALERT_STYLE[alert.level]}`}>
                <span className="font-semibold">Terakhir:</span> ppm {formatPpm(sensor.ppm)} &middot;
                pH {formatPh(sensor.ph)}
                {sensor.waktu && (
                  <>
                    {' '}&middot; {formatDateTime(sensor.waktu)} ({formatRelativeTime(sensor.waktu)})
                  </>
                )}
                {alert.reasons.length > 0 && (
                  <ul className="mt-1 list-disc list-inside">
                    {alert.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-white/5 border border-white/10 text-xs text-text-low px-3 py-2">
                Belum ada data sensor.
              </div>
            )}
          </div>

          {/* Kalkulator dosis */}
          <form onSubmit={handleCalc} className="space-y-2">
            <p className="text-xs font-semibold text-text-mid">
              Kalkulator dosis <span className="text-text-low">(perkiraan)</span>
            </p>
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
              disabled={calcBusy}
              className="btn-ios w-full bg-ios-blue hover:shadow-glow-blue disabled:opacity-60
                text-white text-xs py-2"
            >
              {calcBusy ? 'Menghitung...' : 'Hitung Dosis'}
            </button>
            {dose && (
              <div className="rounded-lg bg-ios-cyan/10 border border-ios-cyan/40 text-ios-cyan text-xs px-3 py-2">
                AB Mix A: <strong>{dose.gramA} g</strong> &middot; B:{' '}
                <strong>{dose.gramB} g</strong> untuk {dose.volumeAir} L (target{' '}
                {formatPpm(dose.targetPpm)}, konstanta {dose.konstanta})
              </div>
            )}
          </form>
        </div>
      )}
    </section>
  )
}

function Info({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-text-low">{label}</dt>
      <dd className="font-medium text-text-body text-right">{value}</dd>
    </div>
  )
}
