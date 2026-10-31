import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '../../settings/SettingsProvider.jsx'
import { usePwaStatus } from '../PwaStatus.jsx'
import { getRelayStatus, getSensorData } from '../../features/iot/api.js'
import { LABEL, formatDateTime } from './fields.jsx'

// Kartu info perangkat (read-only): tidak ada form tulis untuk WiFi/host/token.
export default function DeviceInfo() {
  const { settings } = useSettings()
  const { online: networkOnline } = usePwaStatus()
  const [state, setState] = useState({
    loading: true,
    error: '',
    sensorAt: null,
    relaySource: '',
    tokenConfigured: null,
  })

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: '' }))
    const [sensorRes, relayRes] = await Promise.allSettled([
      getSensorData('realtime'),
      getRelayStatus(),
    ])

    let sensorAt = null
    let relaySource = ''
    let tokenConfigured = null
    let error = ''

    if (sensorRes.status === 'fulfilled') {
      const rows = sensorRes.value?.data ?? sensorRes.value
      if (Array.isArray(rows) && rows.length) {
        sensorAt = rows[rows.length - 1]?.waktu ?? null
      }
    } else {
      error = 'Data sensor tidak tersedia.'
    }

    if (relayRes.status === 'fulfilled') {
      relaySource = relayRes.value?.source || ''
      tokenConfigured = relayRes.value?.deviceTokenConfigured ?? null
    } else if (!error) {
      error = 'Status relay tidak tersedia.'
    }

    setState({ loading: false, error, sensorAt, relaySource, tokenConfigured })
  }, [])

  useEffect(() => {
    if (networkOnline) {
      load()
      return
    }
    setState((prev) => ({
      ...prev,
      loading: false,
      error: 'Offline — info perangkat tidak dapat dimuat.',
    }))
  }, [load, networkOnline])

  const windowMs = (settings.monitoring.onlineWindowMinutes || 5) * 60000
  const sensorOnline =
    state.sensorAt && Date.now() - new Date(state.sensorAt).getTime() <= windowMs

  return (
    <section className="glass-panel p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-text-hi">Info Perangkat</h2>
          <p className="text-sm text-text-low mt-0.5">
            Kondisi perangkat yang bisa diketahui server (read-only).
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={state.loading}
          className="btn-ios shrink-0 bg-white/10 text-text-body text-xs font-semibold px-3 py-2 disabled:opacity-60"
        >
          {state.loading ? 'Memuat...' : 'Muat ulang'}
        </button>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="card-sub px-3 py-2.5">
          <dt className={LABEL}>Data sensor terakhir</dt>
          <dd className="mt-1 text-text-body">{formatDateTime(state.sensorAt)}</dd>
          <dd className={`text-xs mt-0.5 ${sensorOnline ? 'text-ios-green' : 'text-ios-red'}`}>
            {state.sensorAt ? (sensorOnline ? 'Online' : 'Basi / offline') : 'Belum ada data'}
          </dd>
        </div>
        <div className="card-sub px-3 py-2.5">
          <dt className={LABEL}>Sumber status relay</dt>
          <dd className="mt-1 text-text-body">
            {state.relaySource === 'device'
              ? 'Laporan perangkat'
              : state.relaySource === 'influx'
                ? 'InfluxDB (fallback)'
                : '-'}
          </dd>
        </div>
        <div className="card-sub px-3 py-2.5">
          <dt className={LABEL}>DEVICE_TOKEN server</dt>
          <dd className="mt-1">
            {state.tokenConfigured === null ? (
              <span className="text-text-low">Tidak diketahui</span>
            ) : state.tokenConfigured ? (
              <span className="text-ios-green">Terkonfigurasi</span>
            ) : (
              <span className="text-ios-red">Belum dikonfigurasi</span>
            )}
          </dd>
        </div>
      </dl>

      {state.error && <p className="text-xs text-ios-orange mt-3">{state.error}</p>}

      <p className="text-xs text-text-low mt-4">
        SSID/password WiFi, host server, token perangkat, dan pemetaan pin tersimpan di
        firmware. Nilai itu hanya bisa diubah lewat reflash — bukan dari halaman ini.
      </p>
    </section>
  )
}
