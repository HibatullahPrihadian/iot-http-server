import { useEffect, useState } from 'react'
import { post } from '../api.js'
import Modal, { INPUT } from './Modal.jsx'

// Modal: catat pengukuran manual tangki (ppm, pH, catatan).
// Setelah sukses, modal ditutup dan pembacaan terbaru di-refresh oleh onSaved.
export default function TankReadingModal({ open, onClose, onSaved }) {
  const [ppm, setPpm] = useState('')
  const [ph, setPh] = useState('')
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Bersihkan pesan error tiap kali modal dibuka.
  useEffect(() => {
    if (open) setError('')
  }, [open])

  async function handleSubmit(e) {
    e.preventDefault()
    if (ppm === '' && ph === '') {
      setError('Isi minimal ppm atau pH.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const body = {}
      if (ppm !== '') body.ppm = Number(ppm)
      if (ph !== '') body.ph = Number(ph)
      if (catatan.trim() !== '') body.catatan = catatan.trim()
      await post('/tank/readings', body)
      setPpm('')
      setPh('')
      setCatatan('')
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Tambah Pengukuran Tangki"
      subtitle="Berlaku untuk tangki, bukan per pipa"
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        {error && (
          <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-text-low">ppm</span>
            <input
              type="number"
              min="0"
              value={ppm}
              onChange={(e) => setPpm(e.target.value)}
              placeholder="mis. 840"
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-text-low">pH</span>
            <input
              type="number"
              min="0"
              max="14"
              step="0.01"
              value={ph}
              onChange={(e) => setPh(e.target.value)}
              placeholder="mis. 6.0"
              className={INPUT}
            />
          </label>
        </div>

        <input
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
          placeholder="Catatan (opsional)"
          className={INPUT}
        />

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => onClose?.()}
            disabled={busy}
            className="btn-ios flex-1 border border-white/10 text-text-dim py-2
              hover:bg-white/5 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-ios flex-1 bg-ios-green hover:shadow-glow-green disabled:opacity-60
              text-white text-xs font-semibold py-2"
          >
            {busy ? 'Menyimpan...' : 'Simpan Pengukuran'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
