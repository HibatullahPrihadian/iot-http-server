import { useEffect, useState } from 'react'
import Modal, { INPUT } from '../components/Modal.jsx'

const LABEL = 'text-xs font-semibold uppercase tracking-[0.4px] text-text-low'

// Modal input PIN yang dipakai bersama halaman Settings dan jalan pintas tarif
// di halaman Listrik. `gate` berasal dari usePinGate().
export default function PinPromptModal({ gate }) {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (gate.open) setValue('')
  }, [gate.open])

  function handleSubmit(e) {
    e.preventDefault()
    gate.submit(value)
  }

  return (
    <Modal
      open={gate.open}
      title="PIN Pengaturan"
      subtitle="PIN diperlukan untuk mengubah pengaturan."
      onClose={gate.close}
      busy={gate.busy}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className={LABEL}>PIN</span>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`${INPUT} mt-1.5`}
            autoFocus
            autoComplete="current-password"
          />
        </label>
        {gate.error && <p className="text-xs text-ios-red">{gate.error}</p>}
        <button
          type="submit"
          disabled={gate.busy}
          className="btn-ios w-full bg-ios-blue hover:shadow-glow-blue text-white text-sm font-semibold py-2.5 disabled:opacity-60"
        >
          {gate.busy ? 'Memeriksa...' : 'Lanjutkan'}
        </button>
      </form>
    </Modal>
  )
}
