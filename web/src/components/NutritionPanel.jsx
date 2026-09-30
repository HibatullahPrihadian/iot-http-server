import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from 'recharts'
import { get, post, del } from '../api.js'
import {
  nutritionAlert,
  formatPpm,
  formatPh,
  formatDateTime,
} from '../utils/status.js'

const AXIS_TICK = { fill: '#aeaeb2', fontSize: 11 }
const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'rgba(28,28,30,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    color: '#f2f2f7',
  },
  labelStyle: { color: '#f2f2f7' },
  itemStyle: { color: '#f2f2f7' },
}
const LEGEND_STYLE = { wrapperStyle: { color: '#aeaeb2', fontSize: 11 } }

const ALERT_STYLE = {
  ok: 'bg-ios-green/10 border-ios-green/40 text-ios-green',
  warn: 'bg-ios-orange/10 border-ios-orange/40 text-ios-orange',
  danger: 'bg-ios-red/10 border-ios-red/40 text-ios-red',
}

const INPUT =
  'w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-text-body ' +
  'placeholder:text-text-low focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30'

// Panel nutrisi (RCP) untuk batch aktif: resep fase, kalkulator dosis,
// pengukuran ppm/pH, alert, dan grafik tren kecil.
export default function NutritionPanel({ batch, archived }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState(null)
  const [recipe, setRecipe] = useState(null)
  const [readings, setReadings] = useState([])

  // Kalkulator.
  const [volumeAir, setVolumeAir] = useState('10')
  const [ppmAirAwal, setPpmAirAwal] = useState('')
  const [targetPpm, setTargetPpm] = useState('')
  const [dose, setDose] = useState(null)
  const [calcBusy, setCalcBusy] = useState(false)

  // Form pengukuran.
  const [ppmInput, setPpmInput] = useState('')
  const [phInput, setPhInput] = useState('')
  const [catatanInput, setCatatanInput] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await get(`/batches/${batch.id}/readings`)
      setPhase(data.phase)
      setRecipe(data.recipe)
      setReadings(data.readings || [])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id])

  async function handleCalc(e) {
    e.preventDefault()
    setError('')
    setCalcBusy(true)
    setDose(null)
    try {
      const body = { volumeAir: Number(volumeAir) }
      if (ppmAirAwal !== '') body.ppmAirAwal = Number(ppmAirAwal)
      if (targetPpm !== '') body.targetPpm = Number(targetPpm)
      const result = await post(`/batches/${batch.id}/dose`, body)
      setDose(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setCalcBusy(false)
    }
  }

  async function handleAddReading(e) {
    e.preventDefault()
    setError('')
    setSaveBusy(true)
    try {
      const body = {}
      if (ppmInput !== '') body.ppm = Number(ppmInput)
      if (phInput !== '') body.ph = Number(phInput)
      if (catatanInput.trim() !== '') body.catatan = catatanInput.trim()
      await post(`/batches/${batch.id}/readings`, body)
      setPpmInput('')
      setPhInput('')
      setCatatanInput('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaveBusy(false)
    }
  }

  async function removeReading(readingId) {
    setError('')
    try {
      await del(`/batches/${batch.id}/readings/${readingId}`)
      setReadings((prev) => prev.filter((r) => r.id !== readingId))
    } catch (err) {
      setError(err.message)
    }
  }

  const latest = readings.length ? readings[0] : null
  const alert = nutritionAlert(latest, recipe)

  // Grafik butuh data urut naik sesuai waktu.
  const chartData = [...readings]
    .reverse()
    .map((r) => ({
      label: formatDateTime(r.measuredAt),
      ppm: r.ppm,
      ph: r.ph,
    }))

  return (
    <div className="space-y-4 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-text-hi">Nutrisi (RCP)</h4>
        {phase && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-mid">
            Fase {phase}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-low">Memuat nutrisi...</p>
      ) : !recipe ? (
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-3 text-xs text-text-low">
          Belum ada resep untuk tanaman ini. Atur di tab <strong>Katalog</strong> &rarr; Edit
          tanaman &rarr; Resep.
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <Info label="Target ppm" value={formatPpm(recipe.ppmTarget)} />
            <Info
              label="Rentang pH"
              value={
                recipe.phMin !== null && recipe.phMax !== null
                  ? `${recipe.phMin} - ${recipe.phMax}`
                  : '-'
              }
            />
            <Info label="AB Mix A" value={recipe.gramPerLiterA !== null ? `${recipe.gramPerLiterA} g/L` : '-'} />
            <Info label="AB Mix B" value={recipe.gramPerLiterB !== null ? `${recipe.gramPerLiterB} g/L` : '-'} />
            <Info label="Konstanta" value={recipe.konstanta !== null ? String(recipe.konstanta) : '-'} />
            <Info label="Ppm air baku" value={formatPpm(recipe.ppmAirDefault)} />
          </dl>

          {/* Pembacaan terakhir + alert */}
          <div className={`rounded-lg border px-3 py-2 text-xs ${ALERT_STYLE[alert.level]}`}>
            {latest ? (
              <>
                <span className="font-semibold">Terakhir:</span> ppm {formatPpm(latest.ppm)} &middot; pH{' '}
                {formatPh(latest.ph)} &middot; {formatDateTime(latest.measuredAt)}
                {alert.reasons.length > 0 && (
                  <ul className="mt-1 list-disc list-inside">
                    {alert.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <span>Belum ada pengukuran.</span>
            )}
          </div>

          {/* Grafik tren */}
          {chartData.length > 0 && (
            <div className="rounded-lg bg-black/20 border border-white/10 p-2">
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={AXIS_TICK} hide />
                  <YAxis yAxisId="ppm" tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                  <YAxis
                    yAxisId="ph"
                    orientation="right"
                    domain={[4, 8]}
                    tick={AXIS_TICK}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                    tickLine={false}
                  />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend {...LEGEND_STYLE} />
                  {recipe.ppmTarget !== null && (
                    <ReferenceLine
                      yAxisId="ppm"
                      y={recipe.ppmTarget}
                      stroke="#ff9f0a"
                      strokeDasharray="4 4"
                    />
                  )}
                  <Line
                    yAxisId="ppm"
                    type="monotone"
                    dataKey="ppm"
                    name="ppm"
                    stroke="#0a84ff"
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 2 }}
                  />
                  <Line
                    yAxisId="ph"
                    type="monotone"
                    dataKey="ph"
                    name="pH"
                    stroke="#30d158"
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!archived && (
            <>
              {/* Kalkulator dosis */}
              <form onSubmit={handleCalc} className="space-y-2">
                <p className="text-xs font-semibold text-mid">
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
                    <strong>{dose.gramB} g</strong> untuk {dose.volumeAir} L
                    (target {formatPpm(dose.targetPpm)}, konstanta {dose.konstanta})
                  </div>
                )}
              </form>

              {/* Form tambah pengukuran */}
              <form onSubmit={handleAddReading} className="space-y-2">
                <p className="text-xs font-semibold text-mid">Tambah Pengukuran</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-text-low">ppm</span>
                    <input
                      type="number"
                      min="0"
                      value={ppmInput}
                      onChange={(e) => setPpmInput(e.target.value)}
                      placeholder="mis. 840"
                      className={INPUT}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-text-low">pH</span>
                    <input
                      type="number"
                      min="0"
                      max="14"
                      step="0.1"
                      value={phInput}
                      onChange={(e) => setPhInput(e.target.value)}
                      placeholder="mis. 6.0"
                      className={INPUT}
                    />
                  </label>
                </div>
                <input
                  value={catatanInput}
                  onChange={(e) => setCatatanInput(e.target.value)}
                  placeholder="Catatan (opsional)"
                  className={INPUT}
                />
                <button
                  type="submit"
                  disabled={saveBusy || (ppmInput === '' && phInput === '')}
                  className="btn-ios w-full bg-ios-green hover:shadow-glow-green disabled:opacity-60
                    text-white text-xs py-2"
                >
                  {saveBusy ? 'Menyimpan...' : 'Simpan Pengukuran'}
                </button>
              </form>
            </>
          )}

          {/* Riwayat pengukuran */}
          {readings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-mid">Riwayat ({readings.length})</p>
              <ul className="divide-y divide-white/10 rounded-lg bg-black/20 border border-white/10">
                {readings.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="text-text-dim">
                      <span className="text-text-body">{formatDateTime(r.measuredAt)}</span>
                      {' \u00b7 '}
                      ppm {formatPpm(r.ppm)} &middot; pH {formatPh(r.ph)}
                      {r.catatan && <span className="text-text-low"> &middot; {r.catatan}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeReading(r.id)}
                      className="text-ios-red hover:underline ml-2 shrink-0"
                    >
                      Hapus
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
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
