import { useEffect, useState } from 'react'
import { post, put, del } from '../api.js'
import { countdownLabel, formatDate, todayInput, daysBetween } from '../utils/status.js'
import NotesImages from './NotesImages.jsx'
import NutritionPanel from './NutritionPanel.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

// Modal: form tanam baru (pipa kosong) atau detail + edit + panen (pipa terisi).
export default function PlantModal({
  modal,
  catalog,
  batch,
  onClose,
  onSaved,
  onOpenHistory,
  hasHistory,
}) {
  const [plantId, setPlantId] = useState('')
  const [sowDate, setSowDate] = useState(todayInput())
  const [editMode, setEditMode] = useState(false)
  const [weight, setWeight] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!modal.open) return
    setError('')
    setBusy(false)
    setEditMode(false)
    setWeight('')
    setConfirmOpen(false)
    if (batch) {
      setPlantId(String(batch.plantId))
      setSowDate(batch.sowDate)
    } else {
      setPlantId(catalog.length ? String(catalog[0].id) : '')
      setSowDate(todayInput())
    }
  }, [modal, batch, catalog])

  if (!modal.open) return null

  async function handlePlant(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await post('/batches', {
        tableNumber: modal.tableNumber,
        pipeNumber: modal.pipeNumber,
        plantId: Number(plantId),
        sowDate,
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleEdit() {
    setError('')
    setBusy(true)
    try {
      await put(`/batches/${batch.id}`, { plantId: Number(plantId), sowDate })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleHarvest() {
    setError('')
    setBusy(true)
    try {
      const body = {}
      if (weight !== '' && weight !== null) body.harvestWeightGram = Number(weight)
      await post(`/batches/${batch.id}/harvest`, body)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setError('')
    setBusy(true)
    try {
      await del(`/batches/${batch.id}`)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  // Preview tanggal saat memilih tanaman/tanggal (form tanam & mode edit).
  const previewPlant = catalog.find((c) => String(c.id) === plantId)
  const previewTransfer = previewPlant && sowDate
    ? addDays(previewPlant.seedlingDays, sowDate)
    : null
  const previewHarvest = previewPlant && sowDate
    ? addDays(previewPlant.totalDays, sowDate)
    : null

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-40"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-text-hi">
              {batch ? batch.plantName : 'Tanam Baru'}
            </h3>
            <p className="text-sm text-text-low">
              Meja {modal.tableNumber} &middot; Pipa {modal.pipeNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-low hover:text-text-body text-xl leading-none"
            aria-label="Tutup"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-sm px-3 py-2">
            {error}
          </div>
        )}

        {batch ? (
          editMode ? (
            <div className="space-y-4">
              <PlantFields
                catalog={catalog}
                plantId={plantId}
                setPlantId={setPlantId}
                sowDate={sowDate}
                setSowDate={setSowDate}
                previewTransfer={previewTransfer}
                previewHarvest={previewHarvest}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  disabled={busy}
                  className="btn-ios flex-1 border border-white/10 text-text-dim
                    py-2.5 hover:bg-white/5"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={busy}
                  className="btn-ios flex-1 bg-ios-blue hover:shadow-glow-blue disabled:opacity-60
                    text-white py-2.5"
                >
                  {busy ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <dl className="text-sm text-text-dim space-y-2">
                <Row label="Tanggal semai" value={formatDate(batch.sowDate)} />
                <Row label="Pindah (pembesaran)" value={formatDate(batch.transferDate)} />
                <Row label="Estimasi panen" value={formatDate(batch.harvestDate)} />
                <Row label="Hitung mundur" value={countdownLabel(batch.daysRemaining)} />
                <Row label="Status" value={batch.computedStatus} />
                <Row
                  label="Umur"
                  value={`${daysBetween(batch.sowDate, todayInput())} hari`}
                />
              </dl>

              <div className="border-t border-white/10 pt-3">
                <label className="block text-sm font-medium text-mid mb-1">
                  Berat panen (gram, opsional)
                </label>
                <input
                  type="number"
                  min="0"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="mis. 500"
                  className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm
                    text-text-body placeholder:text-text-low
                    focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30"
                />
              </div>

              <button
                type="button"
                onClick={handleHarvest}
                disabled={busy}
                className="btn-ios w-full bg-ios-orange hover:shadow-glow-orange disabled:opacity-60
                  text-black py-2.5"
              >
                {busy ? 'Memproses...' : 'Tandai Panen'}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  disabled={busy}
                  className="btn-ios flex-1 border border-white/10 text-text-dim
                    py-2 hover:bg-white/5"
                >
                  Edit
                </button>
                {hasHistory && (
                  <button
                    type="button"
                    onClick={() => onOpenHistory(modal.tableNumber, modal.pipeNumber)}
                    disabled={busy}
                    className="btn-ios flex-1 border border-white/10 text-text-dim
                      py-2 hover:bg-white/5"
                  >
                    Riwayat
                  </button>
                )}
              </div>

              <NotesImages batch={batch} onChanged={onSaved} />

              <NutritionPanel batch={batch} archived={Boolean(batch.archivedAt)} />

              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={busy}
                className="w-full text-xs text-ios-red hover:text-ios-pink underline transition"
              >
                Hapus permanen (batal tanam salah input)
              </button>
            </div>
          )
        ) : (
          <form onSubmit={handlePlant} className="space-y-4">
            <PlantFields
              catalog={catalog}
              plantId={plantId}
              setPlantId={setPlantId}
              sowDate={sowDate}
              setSowDate={setSowDate}
              previewTransfer={previewTransfer}
              previewHarvest={previewHarvest}
            />
            <button
              type="submit"
              disabled={busy || !plantId}
              className="btn-ios w-full bg-ios-green hover:shadow-glow-green disabled:opacity-60
                text-white py-2.5"
            >
              {busy ? 'Menanam...' : 'Tanam'}
            </button>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Batalkan penanaman"
        message={
          batch
            ? `Batalkan penanaman ${batch.plantName} di Meja ${modal.tableNumber} Pipa ${modal.pipeNumber}? Data akan terhapus permanen.`
            : ''
        }
        confirmLabel="Hapus"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

function PlantFields({
  catalog,
  plantId,
  setPlantId,
  sowDate,
  setSowDate,
  previewTransfer,
  previewHarvest,
}) {
  return (
    <>
      <label className="block">
        <span className="text-sm font-medium text-mid">Tanaman</span>
        <select
          value={plantId}
          onChange={(e) => setPlantId(e.target.value)}
          className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2
            text-text-body focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30"
        >
          {catalog.map((c) => (
            <option key={c.id} value={c.id} className="bg-neutral-900 text-text-body">
              {c.name} ({c.totalDays} hari)
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-mid">Tanggal semai</span>
        <input
          type="date"
          value={sowDate}
          max={todayInput()}
          onChange={(e) => setSowDate(e.target.value)}
          className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2
            text-text-body focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30"
        />
      </label>

      {previewHarvest && (
        <p className="text-xs text-text-low">
          Pindah: {formatDate(previewTransfer)} &middot; Estimasi panen:{' '}
          {formatDate(previewHarvest)}
        </p>
      )}
    </>
  )
}

// Tambah n hari ke string tanggal ISO 'YYYY-MM-DD'.
function addDays(n, dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-low">{label}</dt>
      <dd className="font-medium text-text-body">{value}</dd>
    </div>
  )
}
