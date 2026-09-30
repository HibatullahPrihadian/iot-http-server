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
} from 'recharts'
import { get } from '../api.js'
import { formatPpm, formatPh } from '../utils/status.js'

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
  const [nutrition, setNutrition] = useState(null)
  const [selectedBatch, setSelectedBatch] = useState('')

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
    get('/stats/nutrition')
      .then((d) => {
        if (cancelled) return
        setNutrition(d)
        if (d.trend && d.trend.length) setSelectedBatch(String(d.trend[0].batchId))
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

  const trend = nutrition?.trend || []
  const outOfRange = nutrition?.outOfRange || []
  const activeTrend = trend.find((t) => String(t.batchId) === selectedBatch) || null
  const chartData = activeTrend
    ? activeTrend.readings.map((r) => ({
        label: String(r.measuredAt).slice(5, 16).replace('T', ' '),
        ppm: r.ppm,
        ph: r.ph,
      }))
    : []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pipa terisi" value={`${occupancy.occupied} / ${occupancy.total}`} />
        <StatCard label="Keterisian" value={`${pct}%`} />
        <StatCard label="Total panen" value={totalHarvest(data)} />
      </div>

      <Card title="Nutrisi (RCP)">
        {trend.length === 0 ? (
          <p className="text-sm text-text-low">Belum ada pengukuran nutrisi.</p>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs text-text-low">Pilih batch</span>
              <select
                value={selectedBatch}
                onChange={(e) => setSelectedBatch(e.target.value)}
                className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm
                  text-text-body focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30"
              >
                {trend.map((t) => (
                  <option key={t.batchId} value={t.batchId} className="bg-neutral-900 text-text-body">
                    {t.plantName} — Meja {t.tableNumber} Pipa {t.pipeNumber} ({t.phase})
                  </option>
                ))}
              </select>
            </label>

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
                  <Line yAxisId="ppm" type="monotone" dataKey="ppm" name="ppm" stroke="#0a84ff" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                  <Line yAxisId="ph" type="monotone" dataKey="ph" name="pH" stroke="#30d158" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}

            <div>
              <p className="text-sm font-semibold text-mid mb-2">
                Batch di luar target ({outOfRange.length})
              </p>
              {outOfRange.length === 0 ? (
                <p className="text-sm text-text-low">Semua pembacaan dalam target.</p>
              ) : (
                <ul className="space-y-1">
                  {outOfRange.map((o) => (
                    <li
                      key={o.batchId}
                      className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2"
                    >
                      <span className="font-semibold">
                        {o.plantName} — Meja {o.tableNumber} Pipa {o.pipeNumber}
                      </span>{' '}
                      (ppm {formatPpm(o.lastReading.ppm)}, pH {formatPh(o.lastReading.ph)}):{' '}
                      {o.reasons.join('; ')}
                    </li>
                  ))}
                </ul>
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
