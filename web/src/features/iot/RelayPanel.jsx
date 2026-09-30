import { useState } from 'react'
import { kontrolRelay } from './api.js'
import { useToast } from './Toast.jsx'
import { useRelayStatus } from './useSensorData.js'

// Panel 4 relay: tombol toggle ON/OFF + sinkron status dari InfluxDB.
export default function RelayPanel() {
  const toast = useToast()
  const { relays, setRelay } = useRelayStatus()
  const [busyId, setBusyId] = useState(null)

  async function toggle(idRelay) {
    const current = relays[`relay_${idRelay}`]
    const next = current === 'ON' ? 'OFF' : 'ON'
    setBusyId(idRelay)
    try {
      const res = await kontrolRelay(idRelay, next)
      if (res.success) {
        setRelay(idRelay, next)
        toast.success(`Relay ${idRelay} set to ${next}`)
      } else {
        toast.error(res.message)
      }
    } catch {
      toast.error('Gagal menghubungi server.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="glass-panel p-6 max-w-[1240px] mx-auto">
      <div className="flex flex-col items-center w-full">
        <p className="mb-4 font-semibold text-text-low text-xs uppercase tracking-[0.5px]">
          Kontrol Relay Sistem
        </p>
        <div className="flex flex-wrap gap-4 justify-center w-full">
          {[1, 2, 3, 4].map((id) => {
            const status = relays[`relay_${id}`] || 'OFF'
            const on = status === 'ON'
            return (
              <div key={id} className="card-sub p-5 w-[200px] text-center">
                <h4 className="mb-4 text-[#e5e5ea] font-medium">Relay {id}</h4>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  disabled={busyId === id}
                  className={`btn-ios w-full py-3 text-white disabled:opacity-60 ${
                    on ? 'bg-ios-green hover:shadow-glow-green' : 'bg-ios-blue hover:shadow-glow-blue'
                  }`}
                >
                  {busyId === id ? 'Updating...' : status}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
