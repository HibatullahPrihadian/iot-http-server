import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSensorData } from './useSensorData.js'
import { useToast } from './Toast.jsx'
import SummaryCard from './SummaryCard.jsx'
import SensorChart from './SensorChart.jsx'
import ActuatorPanel from './ActuatorPanel.jsx'
import RelayPanel from './RelayPanel.jsx'
import SensorTable from './SensorTable.jsx'
import {
  FILTERS,
  SENSORS,
  SENSOR_ORDER,
  alertCardClass,
  downloadSensorCSV,
  isOnline,
  sensorValue,
  timeLabel,
} from './utils.js'

// Jam realtime (port dari updateDateTime).
function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

// Halaman Monitoring: header + kartu sensor + panel kontrol + 6 chart + tabel.
export default function MonitoringPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const now = useClock()
  const [filter, setFilter] = useState('realtime')
  const { data, loading, error } = useSensorData({ filter })

  const latest = data.length ? data[data.length - 1] : null
  const online = isOnline(latest?.waktu)
  const labels = data.map((row) => timeLabel(row.waktu))

  function handleExport() {
    const ok = downloadSensorCSV(data, filter)
    if (!ok) toast.error('Data kosong.')
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center mb-6 px-5 pt-2">
        <h1 className="font-bold tracking-[-0.5px] m-0 text-[28px] text-white text-glow-white">
          Dashboard Hidroponik
        </h1>
        <p className="text-text-low mt-1 text-[15px]">Sistem Pemantauan &amp; Kendali Pintar</p>
        <div className="my-4">
          <div className="text-[56px] font-bold tracking-[-2px] text-white leading-none [text-shadow:0_0_25px_rgba(255,255,255,0.4)]">
            {now.toLocaleTimeString('id-ID', { hour12: false })}
          </div>
          <div className="text-base text-text-mid font-medium mt-0.5">
            {now.toLocaleDateString('id-ID', {
              weekday: 'long',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </div>
        </div>
        <div className="text-[13px] text-text-low mt-4">
          {latest
            ? `Diperbarui: ${new Date(latest.waktu).toLocaleString('id-ID')}`
            : 'Memperbarui data...'}
        </div>
        <div className="mt-4">
          <span
            className={`inline-block px-3.5 py-1.5 rounded-full font-semibold text-[13px] transition-all
              ${
                online
                  ? 'bg-[rgba(48,209,88,0.2)] text-ios-green border border-ios-green [box-shadow:0_0_10px_rgba(48,209,88,0.3)]'
                  : 'bg-[rgba(255,69,58,0.2)] text-ios-red border border-ios-red [box-shadow:0_0_10px_rgba(255,69,58,0.3)]'
              }`}
          >
            {latest ? (online ? 'Online' : 'Offline') : 'Menghubungkan...'}
          </span>
        </div>

        <div className="mt-6 flex justify-center gap-3 items-center flex-wrap">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-4 py-2.5 text-[15px] rounded-xl border border-white/10 outline-none cursor-pointer
              bg-white/10 text-white font-medium input-ios"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value} className="bg-neutral-900">
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExport}
            className="px-4.5 py-2.5 text-sm rounded-xl bg-white/10 text-ios-blue font-semibold
              hover:bg-ios-blue/15 hover:shadow-glow-blue transition btn-ios"
          >
            Unduh CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-4 py-3">
          Gagal memuat data: {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 mx-auto max-w-[1300px] [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {SENSOR_ORDER.map((key) => (
          <SummaryCard
            key={key}
            sensorKey={key}
            row={latest}
            onOpenTrend={(k) => navigate(`/monitoring/trend/${k}`)}
          />
        ))}
      </div>

      {/* Panel kontrol aktuator */}
      <ActuatorPanel />

      {/* Panel relay */}
      <RelayPanel />

      {/* Charts */}
      <div className="grid gap-5 mx-auto max-w-[1300px] [grid-template-columns:repeat(auto-fit,minmax(350px,1fr))]">
        {SENSOR_ORDER.map((key) => (
          <div key={key} className={`glass-panel px-5 pt-5 pb-3 ${SENSORS[key].chartGlow}`}>
            <h3 className="text-[#e5e5ea] text-[15px] font-semibold tracking-[-0.3px] mb-2">
              {SENSORS[key].label}
            </h3>
            <SensorChart
              sensorKey={key}
              labels={labels}
              values={data.map((row) => sensorValue(row, key))}
            />
          </div>
        ))}
      </div>

      {/* Tabel riwayat */}
      {!loading && <SensorTable data={data} />}
    </div>
  )
}
