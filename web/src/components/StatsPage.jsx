import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from 'recharts'
import { get } from '../api.js'
import { nutritionAlert, formatPpm, formatPh, formatDateTime } from '../utils/status.js'

// Halaman statistik: panen per bulan, per tanaman, estimasi vs realisasi, keterisian.
const AXIS_TICK = { fill: '#aeaeb2', fontSize: 12 }
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
const LEGEND_STYLE = { wrapperStyle: { color: '#aeaeb2' } }

export default function StatsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tankReadings, setTankReadings] = useState([])
  const [tankRecipe, setTankRecipe] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    get('/stats/summary')
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    get('/tank/readings')
      .then((d) => {
        if (cancelled) return
        setTankRecipe(d.recipe || null)
        setTankReadings(d.readings || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <p className="text-text-low">Memuat statistik...</p>
  if (error) {
    return (
      <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-4 py-3">
        {error}
      </div>
    )
  }

  const occupancy = data.occupancy
  const pct = Math.round(occupancy.ratio * 100)

  const latestReading = tankReadings.length ? tankReadings[0] : null
  const tankAlert = nutritionAlert(latestReading, tankRecipe)
  // Ringkasan HSS/HST per tanaman (backend kirim `hssHstRealisasi`).
  const hssHst = Array.isArray(data.hssHstRealisasi) ? data.hssHstRealisasi : []
  // Grafik butuh data urut naik sesuai waktu.
  const chartData = [...tankReadings]
    .reverse()
    .map((r) => ({
      label: formatDateTime(r.measuredAt),
      ppm: r.ppm,
      ph: r.ph,
    }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pipa terisi" value={`${occupancy.occupied} / ${occupancy.total}`} />
        <StatCard label="Keterisian" value={`${pct}%`} />
        <StatCard label="Total panen" value={totalHarvest(data)} />
      </div>

      <Card title="Nutrisi (RCP)">
        {tankReadings.length === 0 ? (
          <p className="text-sm text-text-low">Belum ada pengukuran nutrisi.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-text-low">
              Satu tangki untuk 3 meja &mdash; pembacaan berikut adalah kondisi tangki total,
              bukan per pipa.
              {tankRecipe && (
                <>
                  {' '}Target: ppm {formatPpm(tankRecipe.ppmTarget)}, pH{' '}
                  {tankRecipe.phMin !== null && tankRecipe.phMax !== null
                    ? `${tankRecipe.phMin}-${tankRecipe.phMax}`
                    : '-'}
                  .
                </>
              )}
            </p>

            {chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 6, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} hide />
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
                  {tankRecipe && tankRecipe.ppmTarget !== null && (
                    <ReferenceLine
                      yAxisId="ppm"
                      y={tankRecipe.ppmTarget}
                      stroke="#ff9f0a"
                      strokeDasharray="4 4"
                    />
                  )}
                  <Line yAxisId="ppm" type="monotone" dataKey="ppm" name="ppm" stroke="#0a84ff" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                  <Line yAxisId="ph" type="monotone" dataKey="ph" name="pH" stroke="#30d158" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}

            <div>
              <p className="text-sm font-semibold text-mid mb-2">Tangki di luar target</p>
              {tankAlert.reasons.length === 0 ? (
                <p className="text-sm text-text-low">
                  {tankRecipe
                    ? 'Pembacaan terakhir dalam target.'
                    : 'Resep tangki belum diset — target ppm/pH belum bisa diperiksa.'}
                </p>
              ) : (
                <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
                  <span className="font-semibold">
                    Terakhir {formatDateTime(latestReading.measuredAt)} (ppm{' '}
                    {formatPpm(latestReading.ppm)}, pH {formatPh(latestReading.ph)}):
                  </span>{' '}
                  {tankAlert.reasons.join('; ')}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title="Panen per Bulan">
        {data.harvestByMonth.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.harvestByMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="count" name="Panen" fill="#30d158" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Panen per Tanaman">
        {data.harvestByPlant.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.harvestByPlant}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="plant" tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="count" name="Panen" fill="#0a84ff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Estimasi vs Realisasi (hari)">
        {data.estimasiVsRealisasi.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.estimasiVsRealisasi}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="plant" tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Legend {...LEGEND_STYLE} />
              <Bar dataKey="estimasi" name="Estimasi" fill="#8e8e93" radius={[4, 4, 0, 0]} />
              <Bar dataKey="realisasi" name="Realisasi" fill="#ff9f0a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="HSS vs HST (target & realisasi)">
        {hssHst.length === 0 ? (
          <Empty />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hssHst}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="plant" tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Legend {...LEGEND_STYLE} />
                <Bar dataKey="estimasiHss" name="Target HSS" fill="#8e8e93" radius={[4, 4, 0, 0]} />
                <Bar dataKey="realisasiHss" name="HSS aktual" fill="#30d158" radius={[4, 4, 0, 0]} />
                <Bar dataKey="estimasiHst" name="Target HST" fill="#5e5ce6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="realisasiHst" name="HST aktual" fill="#ff9f0a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-text-low mt-2">
              HSS = hari sejak semai, HST = hari sejak pindah ke Meja pembesaran. Target
              diambil dari katalog (semai + pembesaran), realisasi = rata-rata saat panen.
            </p>
          </>
        )}
      </Card>
    </div>
  )
}

function totalHarvest(data) {
  return data.harvestByMonth.reduce((sum, m) => sum + m.count, 0)
}

function Card({ title, children }) {
  return (
    <section className="glass-panel p-5">
      <h2 className="text-base font-bold text-text-hi mb-4">{title}</h2>
      {children}
    </section>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="glass-panel p-5">
      <p className="text-sm text-mid">{label}</p>
      <p className="text-2xl font-bold text-text-hi mt-1">{value}</p>
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-text-low">Belum ada data panen.</p>
}
