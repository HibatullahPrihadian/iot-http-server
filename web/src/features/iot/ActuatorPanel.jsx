import { useEffect, useState } from 'react'
import { kontrolPompa, kontrolInterval, kontrolAutodosing } from './api.js'
import { useToast } from './Toast.jsx'
import { useSettings } from '../../settings/SettingsProvider.jsx'

// Label opsi interval: menit bila kelipatan 60, selain itu detik.
function intervalLabel(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s)) return `${seconds} Detik`
  if (s >= 60 && s % 60 === 0) return `${s / 60} Menit`
  return `${s} Detik`
}

// Panel aktuator: 1 pompa (AB Mix) + interval uplink + auto dosing.
// Pompa utama kini dikendalikan lewat Relay 1, bukan dari panel ini.
// Nilai awal diambil dari Settings > Perangkat.
export default function ActuatorPanel() {
  const toast = useToast()
  const { settings } = useSettings()
  const device = settings.device

  const [durasiB, setDurasiB] = useState('10')
  const [busyPompa, setBusyPompa] = useState(false)

  const [intervalDetik, setIntervalDetik] = useState(String(device.uplinkIntervalSeconds))
  const [busyInterval, setBusyInterval] = useState(false)

  const [targetTds, setTargetTds] = useState(String(device.dosingTargetPpm))
  const [volumeAir, setVolumeAir] = useState(String(device.dosingVolumeLiters))
  const [konstanta, setKonstanta] = useState(String(device.dosingConstant))
  const [busyDosing, setBusyDosing] = useState(false)

  // Settings dimuat asinkron: sinkronkan nilai awal saat data server tiba.
  useEffect(() => {
    setIntervalDetik(String(device.uplinkIntervalSeconds))
  }, [device.uplinkIntervalSeconds])
  useEffect(() => {
    setTargetTds(String(device.dosingTargetPpm))
  }, [device.dosingTargetPpm])
  useEffect(() => {
    setVolumeAir(String(device.dosingVolumeLiters))
  }, [device.dosingVolumeLiters])
  useEffect(() => {
    setKonstanta(String(device.dosingConstant))
  }, [device.dosingConstant])

  // Pastikan interval tersimpan selalu ada di daftar opsi.
  const intervalOptions = Array.from(
    new Set([...device.uplinkIntervalOptions, device.uplinkIntervalSeconds].map(Number))
  ).sort((a, b) => a - b)

  async function kirimPompa(durasi) {
    const d = parseInt(durasi, 10)
    if (Number.isNaN(d) || d <= 0) {
      toast.error('Durasi tidak valid!')
      return
    }
    setBusyPompa(true)
    try {
      const res = await kontrolPompa(d)
      if (res.success) toast.success(`Pompa AB Mix aktif selama ${d} detik.`)
      else toast.error(res.message)
    } catch {
      toast.error('Gagal menghubungi server.')
    } finally {
      setBusyPompa(false)
    }
  }

  async function kirimInterval() {
    setBusyInterval(true)
    try {
      const res = await kontrolInterval(parseInt(intervalDetik, 10))
      if (res.success) toast.success(res.message)
      else toast.error(res.message)
    } catch {
      toast.error('Gagal menghubungi server.')
    } finally {
      setBusyInterval(false)
    }
  }

  async function kirimAutoDosing() {
    const t = parseInt(targetTds, 10)
    const v = parseInt(volumeAir, 10)
    const k = parseInt(konstanta, 10)
    if (Number.isNaN(t) || Number.isNaN(v) || Number.isNaN(k)) {
      toast.error('Input tidak valid!')
      return
    }
    setBusyDosing(true)
    try {
      const res = await kontrolAutodosing(t, v, k)
      if (res.success) toast.success(res.message)
      else toast.error(res.message)
    } catch {
      toast.error('Gagal menghubungi server.')
    } finally {
      setBusyDosing(false)
    }
  }

  return (
    <div className="glass-panel p-6">
      <div className="flex flex-wrap justify-center gap-8 items-start">
        {/* KONTROL MANUAL POMPA */}
        <div className="flex flex-col items-center w-full max-w-[480px]">
          <p className="mb-4 font-semibold text-text-low text-xs uppercase tracking-[0.5px]">
            Kontrol Aktuator
          </p>
          <div className="flex flex-wrap gap-4 justify-center w-full">
            <div className="card-sub p-5 w-[220px] text-center">
              <h4 className="mb-4 text-[#e5e5ea] font-medium">Pompa AB Mix</h4>
              <input
                type="number"
                min="1"
                max={device.maxPumpSeconds}
                value={durasiB}
                onChange={(e) => setDurasiB(e.target.value)}
                placeholder="Detik"
                className="input-ios w-[80px] text-center mb-4"
              />
              <button
                type="button"
                onClick={() => kirimPompa(durasiB)}
                disabled={busyPompa}
                className="btn-ios w-full bg-ios-orange hover:shadow-glow-orange disabled:opacity-60 text-white py-3"
              >
                {busyPompa ? 'Mengirim...' : 'Nyalakan Dosing'}
              </button>
            </div>
          </div>
        </div>

        <div
          className="hidden md:block w-px bg-white/10 min-h-[180px]"
          style={{ boxShadow: '0 0 10px rgba(255,255,255,0.2)' }}
        />

        {/* KONFIGURASI SISTEM */}
        <div className="flex flex-col items-center w-full max-w-[500px]">
          <p className="mb-4 font-semibold text-text-low text-xs uppercase tracking-[0.5px]">
            Pengaturan Sistem
          </p>
          <div className="flex flex-wrap gap-4 justify-center items-start w-full">
            <div className="card-sub p-5 w-[220px] text-center">
              <h4 className="mb-4 text-[#e5e5ea] font-medium">Interval Uplink</h4>
              <select
                value={intervalDetik}
                onChange={(e) => setIntervalDetik(e.target.value)}
                className="input-ios w-full mb-4"
              >
                {intervalOptions.map((o) => (
                  <option key={o} value={o} className="bg-neutral-900">
                    {intervalLabel(o)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={kirimInterval}
                disabled={busyInterval}
                className="btn-ios w-full bg-ios-purple hover:shadow-glow-purple disabled:opacity-60 text-white py-3"
              >
                {busyInterval ? 'Menyimpan...' : 'Simpan Interval'}
              </button>
            </div>

            <div className="card-sub p-5 w-[250px] text-center">
              <h4 className="mb-4 text-[#e5e5ea] font-medium">Sistem Auto Dosing</h4>
              <DosingRow label="Target (ppm)" value={targetTds} onChange={setTargetTds} />
              <DosingRow label="Vol Air (L)" value={volumeAir} onChange={setVolumeAir} />
              <DosingRow label="Konstanta (K)" value={konstanta} onChange={setKonstanta} last />
              <button
                type="button"
                onClick={kirimAutoDosing}
                disabled={busyDosing}
                className="btn-ios w-full bg-ios-green hover:shadow-glow-green disabled:opacity-60 text-white py-3"
              >
                {busyDosing ? 'Menerapkan...' : 'Terapkan Parameter'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DosingRow({ label, value, onChange, last }) {
  return (
    <div className={`flex justify-between items-center ${last ? 'mb-4' : 'mb-2.5'}`}>
      <label className="text-[13px] text-text-mid">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-ios w-[70px] !p-1.5"
      />
    </div>
  )
}
