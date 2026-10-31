import { useState } from 'react'
import { useSettings } from '../../settings/SettingsProvider.jsx'
import { useToast } from '../../features/iot/Toast.jsx'
import { kontrolAutodosing, kontrolInterval } from '../../features/iot/api.js'

// Tombol "Terapkan ke perangkat" untuk interval & parameter auto dosing.
// Memakai nilai tersimpan (bukan draft), jadi simpan dulu sebelum menerapkan.
export default function ApplyButtons() {
  const { settings } = useSettings()
  const toast = useToast()
  const [busy, setBusy] = useState('')

  async function applyInterval() {
    setBusy('interval')
    try {
      const res = await kontrolInterval(Number(settings.device.uplinkIntervalSeconds))
      if (res?.success) toast.success(res.message || 'Perintah interval masuk antrean.')
      else toast.error(res?.message || 'Perintah interval gagal.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy('')
    }
  }

  async function applyDosing() {
    setBusy('dosing')
    try {
      const res = await kontrolAutodosing(
        Number(settings.device.dosingTargetPpm),
        Number(settings.device.dosingVolumeLiters),
        Number(settings.device.dosingConstant)
      )
      if (res?.success) toast.success(res.message || 'Parameter dosing masuk antrean.')
      else toast.error(res?.message || 'Perintah dosing gagal.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={applyInterval}
        disabled={busy === 'interval'}
        className="btn-ios bg-ios-purple hover:shadow-glow-purple text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60"
      >
        {busy === 'interval' ? 'Mengirim...' : 'Terapkan Interval'}
      </button>
      <button
        type="button"
        onClick={applyDosing}
        disabled={busy === 'dosing'}
        className="btn-ios bg-ios-green hover:shadow-glow-green text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60"
      >
        {busy === 'dosing' ? 'Mengirim...' : 'Terapkan Dosing'}
      </button>
      <p className="text-xs text-text-low w-full mt-1">
        Memakai nilai yang sudah disimpan. Sukses berarti perintah masuk antrean iot-api;
        perintah hilang bila container iot-api restart atau perangkat sedang offline.
      </p>
    </>
  )
}
