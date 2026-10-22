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
  formatRelativeTime,
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

// Panel resep tangki (satu tangki global untuk 3 meja) yang tampil di atas Meja 3:
// resep aktif, kalkulator dosis, pembacaan sensor IoT, dan pengukuran manual
// ppm/pH level tangki (bukan per pipa).
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

  // Pengukuran manual (level tangki).
  const [readings, setReadings] = useState([])
  const [ppmInput, setPpmInput] = useState('')
  const [phInput, setPhInput] = useState('')
  const [catatanInput, setCatatanInput] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)

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

  // Pengukuran manual dipisah dari polling sensor agar tidak ikut tiap 30 detik.
  async function loadReadings() {
    try {
      const data = await get('/tank/readings')
      setReadings(data.readings || [])
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
    loadReadings()
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

  async function handleAddReading(e) {
    e.preventDefault()
    setError('')
    setSaveBusy(true)
    try {
      const body = {}
      if (ppmInput !== '') body.ppm = Number(ppmInput)
      if (phInput !== '') body.ph = Number(phInput)
      if (catatanInput.trim() !== '') body.catatan = catatanInput.trim()
      await post('/tank/readings', body)
      setPpmInput('')
      setPhInput('')
      setCatatanInput('')
      await loadReadings()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaveBusy(false)
    }
  }

  async function removeReading(readingId) {
    setError('')
    try {
      await del(`/tank/readings/${readingId}`)
      setReadings((prev) => prev.filter((r) => r.id !== readingId))
    } catch (err) {
      setError(err.message)
    }
  }

  const alert = nutritionAlert(sensor, recipe)

  const latestReading = readings.length ? readings[0] : null
  const readingAlert = nutritionAlert(latestReading, recipe)

  // Grafik butuh data urut naik sesuai waktu.
  const chartData = [...readings]
    .reverse()
    .map((r) => ({
      label: formatDateTime(r.measuredAt),
      ppm: r.ppm,
      ph: r.ph,
    }))

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
        Satu tangki untuk 3 meja. Nilai sensor dan pengukuran manual adalah kondisi tangki
        total, bukan per pipa.
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
          <p className="mt-2">
            Pengukuran tetap bisa dicatat, tetapi target ppm/pH untuk peringatan belum
            tersedia.
          </p>
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
        </div>
      )}

      {!loading && (
        <div className="mt-4 space-y-4">
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
                <span className="font-semibold">Terakhir:</span> {formatPpm(sensor.ppm)} &middot;
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
              disabled={calcBusy || !recipe}
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

          <div className="border-t border-white/10 pt-3 space-y-3">
            <p className="text-xs font-semibold text-text-mid">Pengukuran Manual Tangki</p>

            {/* Pembacaan manual terakhir + alert */}
            <div className={`rounded-lg border px-3 py-2 text-xs ${ALERT_STYLE[readingAlert.level]}`}>
              {latestReading ? (
                <>
                  <span className="font-semibold">Terakhir:</span>{' '}
                  {formatPpm(latestReading.ppm)} &middot; pH {formatPh(latestReading.ph)} &middot;{' '}
                  {formatDateTime(latestReading.measuredAt)}
                  {readingAlert.reasons.length > 0 && (
                    <ul className="mt-1 list-disc list-inside">
                      {readingAlert.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <span>Belum ada pengukuran.</span>
              )}
            </div>

            {/* Grafik tren pengukuran */}
            {chartData.length > 0 && (
              <div className="rounded-lg bg-black/20 border border-white/10 p-2">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" tick={AXIS_TICK} hide />
                    <YAxis
                      yAxisId="ppm"
                      tick={AXIS_TICK}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                    />
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
                    {recipe && recipe.ppmTarget !== null && (
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

            {/* Form tambah pengukuran */}
            <form onSubmit={handleAddReading} className="space-y-2">
              <p className="text-xs font-semibold text-text-mid">
                Tambah Pengukuran{' '}
                <span className="text-text-low font-normal">(berlaku untuk tangki)</span>
              </p>
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

            {/* Riwayat pengukuran */}
            {readings.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-text-mid">Riwayat ({readings.length})</p>
                <ul className="divide-y divide-white/10 rounded-lg bg-black/20 border border-white/10">
                  {readings.map((r) => (
                    <li key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div className="text-text-dim">
                        {formatDateTime(r.measuredAt)}
                        {' \u00b7 '}
                        {formatPpm(r.ppm)} &middot; pH {formatPh(r.ph)}
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
          </div>
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
