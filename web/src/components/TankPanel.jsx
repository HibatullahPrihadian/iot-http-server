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
import { get, del } from '../api.js'
import {
  nutritionAlert,
  formatPpm,
  formatPh,
  formatDateTime,
  formatRelativeTime,
} from '../utils/status.js'
import TankReadingModal from './TankReadingModal.jsx'
import TankDoseModal from './TankDoseModal.jsx'

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

// Tinggi grafik: 240px di mobile, 320px di layar >= 768px (selaras breakpoint md).
const CHART_HEIGHT_MOBILE = 240
const CHART_HEIGHT_DESKTOP = 320

// Recharts butuh tinggi numerik; ikut perubahan lebar layar.
function useChartHeight() {
  const [height, setHeight] = useState(CHART_HEIGHT_MOBILE)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(min-width: 768px)')
    const apply = () =>
      setHeight(mq.matches ? CHART_HEIGHT_DESKTOP : CHART_HEIGHT_MOBILE)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return height
}

// Panel resep tangki (satu tangki global untuk 3 meja) yang tampil di tab Tangki:
// resep aktif, pembacaan sensor IoT, ringkasan pengukuran manual, grafik tren,
// dan riwayat pengukuran. Form tambah pengukuran & kalkulator dosis berada di modal.
export default function TankPanel({ onGoCatalog }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [recipe, setRecipe] = useState(null)
  const [sensor, setSensor] = useState(null)
  const [sensorError, setSensorError] = useState(null)
  const [sensorAt, setSensorAt] = useState(null)

  // Pengukuran manual (level tangki).
  const [readings, setReadings] = useState([])

  // Modal aktif: 'reading' (tambah pengukuran) atau 'dose' (kalkulator dosis).
  const [modal, setModal] = useState(null)

  const chartHeight = useChartHeight()

  // Muat data tangki. Error sensor dipisah dari error panel.
  async function load() {
    setError('')
    try {
      const data = await get('/tank')
      setRecipe(data.recipe || null)
      setSensor(data.sensor || null)
      setSensorError(data.sensorError || null)
      setSensorAt(new Date().toISOString())
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
  // Label sumbu X diringkas (dd/MM HH:MM); label penuh dipakai di tooltip.
  const chartData = [...readings]
    .reverse()
    .map((r) => {
      const d = r.measuredAt ? new Date(r.measuredAt) : null
      const valid = d && !Number.isNaN(d.getTime())
      const label = valid
        ? `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(
            d.getMinutes(),
          ).padStart(2, '0')}`
        : formatDateTime(r.measuredAt)
      return {
        label,
        full: formatDateTime(r.measuredAt),
        ppm: r.ppm,
        ph: r.ph,
      }
    })

  return (
    <>
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

            {/* Aksi: kalkulator dosis & tambah pengukuran (formnya di modal) */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setModal('dose')}
                className="btn-ios bg-ios-blue hover:shadow-glow-blue
                  text-white text-xs font-semibold px-4 py-2"
              >
                Hitung Dosis
              </button>
              <button
                type="button"
                onClick={() => setModal('reading')}
                className="btn-ios bg-ios-green hover:shadow-glow-green
                  text-white text-xs font-semibold px-4 py-2"
              >
                Tambah Pengukuran
              </button>
            </div>

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
                <div className="h-60 md:h-80">
                  <ResponsiveContainer width="100%" height={chartHeight}>

                      <LineChart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis
                          dataKey="label"
                          tick={AXIS_TICK}
                          minTickGap={28}
                          interval="preserveStartEnd"
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          tickLine={false}
                        />
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
                        <Tooltip
                          {...TOOLTIP_STYLE}
                          labelFormatter={(label, payload) =>
                            (payload && payload[0] && payload[0].payload.full) || label
                          }
                        />
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
                </div>
              )}

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

      <TankReadingModal
        open={modal === 'reading'}
        onClose={() => setModal(null)}
        onSaved={loadReadings}
      />
      <TankDoseModal
        open={modal === 'dose'}
        onClose={() => setModal(null)}
        recipe={recipe}
        onGoCatalog={onGoCatalog}
      />
    </>
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
