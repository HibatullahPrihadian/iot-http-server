import { useCallback, useEffect, useMemo, useState } from 'react'
import { Radar, RefreshCw } from 'lucide-react'
import Modal, { INPUT } from '../Modal.jsx'
import { LABEL } from './fields.jsx'
import SectionShell from './SectionShell.jsx'
import { useToast } from '../../features/iot/Toast.jsx'
import { usePwaStatus } from '../PwaStatus.jsx'
import { getWifiSettings, putWifiSettings, resendWifiSettings, scanWifi } from '../../settings/api.js'
import { findSection } from '../../settings/sections.js'

const meta = findSection('wifi')
const POLL_MS = 5000
const TTL_MS = 5 * 60 * 1000

function isFresh(device) {
  if (!device || device.stale) return false
  const at = new Date(device.at).getTime()
  return Number.isFinite(at) && Date.now() - at <= TTL_MS
}

function formatAgo(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

function DeviceCard({ title, role, device, desiredRevision }) {
  const fresh = isFresh(device)
  const waiting =
    fresh && desiredRevision > (device.appliedRevision || 0) ? true : false

  return (
    <div className="card-sub p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-text-body">{title}</p>
        <span
          className={`text-[11px] font-semibold ${
            !fresh ? 'text-text-low' : waiting ? 'text-ios-orange' : 'text-ios-green'
          }`}
        >
          {!fresh ? 'Tidak diketahui' : waiting ? 'Menunggu perangkat…' : 'Tersinkron'}
        </span>
      </div>

      <dl className="grid gap-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-text-low">SSID aktif</dt>
          <dd className="text-text-body text-right break-all">{fresh ? device.ssid || '-' : '-'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-low">IP</dt>
          <dd className="text-text-body text-right tabular-nums">{fresh ? device.ip || '-' : '-'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-low">Sinyal</dt>
          <dd className="text-text-body text-right tabular-nums">
            {fresh && device.rssi ? `${device.rssi} dBm` : '-'}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-low">Revisi</dt>
          <dd className="text-text-body text-right tabular-nums">
            {fresh ? `terpasang ${device.appliedRevision || 0}` : '-'}
            {fresh && device.pendingRevision ? ` · pending ${device.pendingRevision}` : ''}
          </dd>
        </div>
        {role === 'node' && (
          <div className="flex justify-between gap-2">
            <dt className="text-text-low">Link ESP-NOW</dt>
            <dd className={`text-right ${device?.linkOk === false ? 'text-ios-red' : 'text-text-body'}`}>
              {!fresh || device.linkOk === null ? '-' : device.linkOk ? 'OK' : 'Terputus'}
            </dd>
          </div>
        )}
        {fresh && device.lastError && (
          <div className="flex justify-between gap-2">
            <dt className="text-text-low">Error terakhir</dt>
            <dd className="text-ios-orange text-right break-all">{device.lastError}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-text-low">Terakhir lapor</dt>
          <dd className="text-text-body text-right">{formatAgo(device?.at)}</dd>
        </div>
      </dl>
    </div>
  )
}

export default function WifiSection({ gate }) {
  const toast = useToast()
  const { online } = usePwaStatus()
  const [data, setData] = useState({ loading: true, error: '', ready: true, desired: null, devices: {} })
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [force, setForce] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState('')
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await getWifiSettings()
      setData({
        loading: false,
        error: '',
        ready: res?.ready !== false,
        desired: res?.desired || null,
        devices: res?.devices || {},
        updatedAt: res?.updatedAt || null,
      })
      // Prefill SSID hanya bila field masih kosong (jangan timpa ketikan user).
      setSsid((prev) => prev || res?.desired?.ssid || '')
    } catch (err) {
      setData((prev) => ({ ...prev, loading: false, error: err.message }))
    }
  }, [])

  useEffect(() => {
    if (!online) return undefined
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load, online])

  const esp = data.devices['utama:esp32']
  const node = data.devices['utama:node']
  const desiredRevision = data.desired?.revision || 0

  const scanNetworks = useMemo(() => {
    if (!isFresh(esp) || !esp?.scan?.networks?.length) return []
    const seen = new Set()
    return esp.scan.networks
      .filter((n) => {
        if (!n.ssid || seen.has(n.ssid)) return false
        seen.add(n.ssid)
        return true
      })
      .sort((a, b) => b.rssi - a.rssi)
  }, [esp])

  async function handleScan() {
    setScanning(true)
    try {
      await gate.guarded(
        (pinOverride) => scanWifi(pinOverride),
        () => toast.success('Permintaan scan terkirim. Hasil muncul beberapa detik lagi.')
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setScanning(false)
    }
  }

  function openConfirm(e) {
    e.preventDefault()
    if (!ssid.trim()) {
      toast.error('SSID wajib diisi.')
      return
    }
    setConfirmed(false)
    setConfirmOpen(true)
  }

  async function applyNow() {
    // Tutup modal konfirmasi dulu; PIN (bila perlu) diminta lewat modal PIN
    // bersama di SettingsPage, jadi tidak ada dua modal bertumpuk.
    setConfirmOpen(false)
    setBusy('save')
    try {
      const ok = await gate.guarded(
        (pinOverride) =>
          putWifiSettings(pinOverride, {
            ssid: ssid.trim(),
            password: password === '' ? undefined : password,
            force,
          }),
        () => toast.success('Config WiFi tersimpan dan dikirim ke perangkat.')
      )
      if (ok) {
        setPassword('')
        setForce(false)
        load()
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy('')
    }
  }

  async function resend() {
    setBusy('resend')
    try {
      await gate.guarded(
        (pinOverride) => resendWifiSettings(pinOverride, force),
        () => toast.success('Config dikirim ulang ke antrean perangkat.')
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-5">
      <SectionShell title={meta.title} description={meta.description}>
        {!data.ready && (
          <p className="rounded-lg bg-ios-orange/10 border border-ios-orange/40 text-ios-orange text-xs px-3 py-2 mb-4">
            <code>SETTINGS_SECRET</code> belum diset di server. Ganti WiFi dari web dinonaktifkan
            sampai env tersebut diisi dan container di-restart.
          </p>
        )}

        {data.error && (
          <p className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2 mb-4">
            {data.error}
          </p>
        )}

        <form onSubmit={openConfirm} className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className={LABEL}>SSID</span>
            <div className="flex gap-2 mt-1.5">
              <input
                type="text"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                className={INPUT}
                placeholder="Nama WiFi tujuan"
                maxLength={32}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleScan}
                disabled={scanning || !data.ready}
                className="btn-ios shrink-0 inline-flex items-center gap-1.5 bg-white/10 text-text-body
                  text-xs font-semibold px-3 py-2 disabled:opacity-60"
              >
                <Radar size={14} className={scanning ? 'animate-pulse' : undefined} aria-hidden="true" />
                {scanning ? 'Scan…' : 'Scan'}
              </button>
            </div>
          </label>

          {scanNetworks.length > 0 && (
            <div className="sm:col-span-2">
              <p className={LABEL}>Hasil scan</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {scanNetworks.map((n) => (
                  <button
                    key={n.ssid}
                    type="button"
                    onClick={() => setSsid(n.ssid)}
                    className={`btn-ios inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5
                      ${
                        ssid === n.ssid
                          ? 'bg-ios-blue text-white'
                          : 'bg-white/10 text-text-body hover:bg-white/15'
                      }`}
                  >
                    {n.secure ? '🔒' : '📶'} {n.ssid}
                    <span className="text-[10px] opacity-70 tabular-nums">{n.rssi} dBm</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block sm:col-span-2">
            <span className={LABEL}>Password WiFi</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${INPUT} mt-1.5`}
              placeholder={
                data.desired?.hasPassword ? 'Biarkan kosong bila tidak diubah' : 'Kosongkan untuk jaringan terbuka'
              }
              autoComplete="new-password"
            />
            <p className="text-xs text-text-low mt-1">
              8-63 karakter. Kosongkan bila SSID tidak berubah dan password tetap, atau untuk jaringan
              terbuka.
            </p>
          </label>

          <label className="sm:col-span-2 flex items-start gap-2 text-xs text-text-body">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Paksa terapkan ke ESP32 walau NodeMCU tidak membalas (NodeMCU akan tetap di WiFi lama
              sampai di-flash ulang).
            </span>
          </label>

          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!data.ready || busy === 'save'}
              className="btn-ios bg-ios-blue hover:shadow-glow-blue text-white text-sm font-semibold
                px-4 py-2.5 disabled:opacity-60"
            >
              Simpan &amp; Terapkan
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={!data.ready || busy === 'resend' || !data.desired?.ssid}
              className="btn-ios inline-flex items-center gap-1.5 bg-white/10 text-text-body text-sm
                font-semibold px-4 py-2.5 disabled:opacity-60"
            >
              <RefreshCw
                size={14}
                className={busy === 'resend' ? 'animate-spin' : undefined}
                aria-hidden="true"
              />
              Kirim ulang
            </button>
          </div>
        </form>

        {data.desired?.ssid && (
          <p className="text-xs text-text-low mt-4">
            Config tersimpan: <strong className="text-text-body">{data.desired.ssid}</strong> · revisi{' '}
            {desiredRevision} · {data.desired.hasPassword ? 'dengan password' : 'tanpa password'}
          </p>
        )}
      </SectionShell>

      <section className="glass-panel p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-text-hi">Status Perangkat</h2>
            <p className="text-sm text-text-low mt-0.5">
              Revisi config dan koneksi WiFi yang dilaporkan perangkat.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={data.loading}
            aria-label="Muat ulang status perangkat"
            className="btn-ios shrink-0 inline-flex items-center justify-center rounded-xl bg-white/10
              text-text-body p-2 disabled:opacity-60"
          >
            <RefreshCw size={14} className={data.loading ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeviceCard title="ESP32" role="esp32" device={esp} desiredRevision={desiredRevision} />
          <DeviceCard title="NodeMCU" role="node" device={node} desiredRevision={desiredRevision} />
        </div>

        <p className="text-xs text-text-low mt-4">
          Selama proses pindah WiFi, perangkat restart dan pompa/aktuator berhenti sesaat. Bila
          perangkat gagal tersambung, firmware otomatis kembali ke kredensial lama; jika itu juga
          gagal, ESP32 membuka AP <code>Hidro-Setup-XXXX</code> untuk config darurat.
        </p>
      </section>

      <Modal
        open={confirmOpen}
        title="Terapkan WiFi Baru?"
        subtitle="Perangkat akan restart dan aktuator berhenti sesaat."
        onClose={() => setConfirmOpen(false)}
        busy={busy === 'save'}
      >
        <div className="space-y-3 text-sm text-text-body">
          <p>
            SSID tujuan: <strong className="text-text-hi">{ssid.trim() || '-'}</strong>
          </p>
          <p className="text-xs text-text-low">
            ESP32 akan mengirim config ke NodeMCU lewat ESP-NOW, lalu keduanya restart bertahap.
            Bila gagal tersambung dalam 30 detik, keduanya otomatis kembali ke WiFi lama.
          </p>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>Saya paham risikonya dan ingin melanjutkan.</span>
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            disabled={busy === 'save'}
            className="btn-ios flex-1 bg-white/10 text-text-body text-sm font-semibold py-2.5 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={applyNow}
            disabled={!confirmed || busy === 'save'}
            className="btn-ios flex-1 bg-ios-blue hover:shadow-glow-blue text-white text-sm font-semibold
              py-2.5 disabled:opacity-60"
          >
            {busy === 'save' ? 'Mengirim...' : 'Terapkan'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
