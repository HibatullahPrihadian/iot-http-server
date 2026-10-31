import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useSensorData } from './useSensorData.js'
import PzemChart from './PzemChart.jsx'
import { calculateTrend, dateTimeLabel, TREND_FILTERS, trendFilterToApi } from './utils.js'
import { PZEM_METRICS, PZEM_TREND_OPTIONS, pzemValueOrNull } from './listrikUtils.js'
import { useSettings } from '../../settings/SettingsProvider.jsx'

// Halaman analisis tren 1 metrik listrik (paralel TrendPage hidroponik).
export default function ListrikTrendPage() {
  const { metric } = useParams()
  const navigate = useNavigate()
  const metricKey = PZEM_METRICS[metric] ? metric : 'tegangan'
  const [filter, setFilter] = useState('realtime')
  const { settings } = useSettings()

  const { data } = useSensorData({
    filter: trendFilterToApi(filter),
    domain: 'listrik',
    pollMs: settings.monitoring.pollListrikSeconds * 1000,
  })

  const meta = PZEM_METRICS[metricKey]
  const labels = useMemo(() => data.map((row) => dateTimeLabel(row.waktu)), [data])
  const values = useMemo(
    () => data.map((row) => pzemValueOrNull(row, metricKey)),
    [data, metricKey]
  )
  const trend = useMemo(() => calculateTrend(values), [values])

  return (
    <div className="space-y-6 max-w-[1000px] mx-auto">
      <div className="text-center mb-6 px-5 pt-2">
        <h1 className="font-bold tracking-[-0.5px] m-0 text-[28px] text-white text-glow-white">
          Analisis Tren Listrik
        </h1>
        <Link
          to="/listrik"
          className="inline-block mt-4 px-6 py-3 rounded-[14px] bg-white/10 text-ios-blue
            font-semibold text-sm border border-white/5 hover:bg-ios-blue/15 hover:shadow-glow-blue
            hover:-translate-y-0.5 transition active:scale-[0.96]"
        >
          Kembali ke Dashboard Listrik
        </Link>
      </div>

      {/* Panel kontrol */}
      <div className="glass-panel p-6 flex justify-center gap-5 flex-wrap items-center">
        <div className="flex flex-col items-start">
          <label className="font-semibold mb-2 text-text-low text-xs uppercase tracking-[0.5px]">
            Tampilkan Metrik Listrik
          </label>
          <select
            value={metricKey}
            onChange={(e) => navigate(`/listrik/trend/${e.target.value}`)}
            className="input-ios min-w-[240px]"
          >
            {PZEM_TREND_OPTIONS.map((k) => (
              <option key={k} value={k} className="bg-neutral-900">
                {PZEM_METRICS[k].label}
                {PZEM_METRICS[k].unit ? ` (${PZEM_METRICS[k].unit})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col items-start">
          <label className="font-semibold mb-2 text-text-low text-xs uppercase tracking-[0.5px]">
            Rentang Waktu (Time-Series)
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="input-ios min-w-[240px]"
          >
            {TREND_FILTERS.map((f) => (
              <option key={f.value} value={f.value} className="bg-neutral-900">
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Indikator tren */}
      <div
        className="glass-panel p-6 text-center"
        style={{ borderColor: meta.color + '40', boxShadow: `0 12px 30px ${meta.color}25` }}
      >
        <div className="text-sm text-text-low font-semibold tracking-[-0.2px] uppercase">
          Status Tren (Awal vs Akhir Periode)
        </div>
        <div className="text-[32px] font-bold mt-2.5 flex justify-center items-center gap-2.5 text-white tracking-[-0.5px] [text-shadow:0_0_15px_rgba(255,255,255,0.2)] flex-wrap">
          {trend.status === 'naik' && (
            <>
              📈 Sedang Naik{' '}
              <span className="text-ios-green [text-shadow:0_0_15px_rgba(48,209,88,0.4)]">
                (+{Math.abs(trend.diff).toFixed(2)})
              </span>
            </>
          )}
          {trend.status === 'turun' && (
            <>
              📉 Sedang Turun{' '}
              <span className="text-ios-red [text-shadow:0_0_15px_rgba(255,69,58,0.4)]">
                (-{Math.abs(trend.diff).toFixed(2)})
              </span>
            </>
          )}
          {trend.status === 'stabil' &&
            (trend.first !== undefined ? '➖ Cenderung Stabil' : 'Memuat Data...')}
        </div>
        <div className="text-sm text-text-mid mt-2.5">
          {trend.first !== undefined
            ? `Rata-rata awal: ${trend.first.toFixed(1)} | Rata-rata akhir: ${trend.last.toFixed(1)}`
            : trend.text || '--'}
        </div>
      </div>

      {/* Chart */}
      <div
        className="glass-panel p-6 pb-4"
        style={{ borderColor: meta.color + '30', boxShadow: `0 15px 40px ${meta.color}15` }}
      >
        <PzemChart metricKey={metricKey} labels={labels} values={values} height={420} />
      </div>
    </div>
  )
}
