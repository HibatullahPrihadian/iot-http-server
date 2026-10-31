import { useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { get, put, del, uploadImage } from '../api.js'
import { useSettings } from '../settings/SettingsProvider.jsx'
import ImageLightbox from './ImageLightbox.jsx'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

// Catatan teks + galeri gambar untuk satu batch.
export default function NotesImages({ batch, onChanged }) {
  const { settings } = useSettings()
  const maxImages = settings.limits.maxImagesPerBatch
  const maxBytes = settings.limits.maxImageMb * 1024 * 1024
  const maxNotes = settings.limits.maxNotesChars
  const [notes, setNotes] = useState(batch.notes || '')
  const [images, setImages] = useState([])
  const [savingNotes, setSavingNotes] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  // Index gambar yang dibuka di lightbox; null = tertutup.
  const [previewIndex, setPreviewIndex] = useState(null)
  const fileRef = useRef(null)

  // Reset field catatan & preview saat berganti batch (bukan tiap notes berubah).
  useEffect(() => {
    setNotes(batch.notes || '')
    setPreviewIndex(null)
  }, [batch.id])

  // Muat gambar sekali per batch; tidak ikut refetch saat catatan disimpan.
  useEffect(() => {
    setError('')
    let cancelled = false
    get(`/batches/${batch.id}/images`)
      .then((data) => {
        if (!cancelled) setImages(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [batch.id])

  async function saveNotes() {
    setError('')
    setSavingNotes(true)
    try {
      await put(`/batches/${batch.id}/notes`, { notes })
      onChanged && onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingNotes(false)
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return

    if (!ALLOWED.includes(file.type)) {
      setError('Hanya JPG, PNG, atau WEBP yang diizinkan')
      return
    }
    if (file.size > maxBytes) {
      setError(`Ukuran gambar maksimal ${settings.limits.maxImageMb}MB`)
      return
    }
    if (images.length >= maxImages) {
      setError(`Maksimal ${maxImages} gambar per batch`)
      return
    }

    setError('')
    setUploading(true)
    try {
      const created = await uploadImage(batch.id, file)
      setImages((prev) => [...prev, created])
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function removeImage(imageId) {
    setError('')
    try {
      await del(`/batches/${batch.id}/images/${imageId}`)
      setImages((prev) => prev.filter((i) => i.id !== imageId))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      {error && (
        <div className="rounded-lg bg-ios-red/10 border border-ios-red/40 text-ios-red text-xs px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-mid mb-1">Catatan</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={maxNotes}
            placeholder="Misal: daun menguning, tambah nutrisi..."
          className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm
            text-text-body placeholder:text-text-low
            focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/30"
        />
        <button
          type="button"
          onClick={saveNotes}
          disabled={savingNotes}
          className="btn-ios mt-1 bg-white/10 hover:bg-white/15 disabled:opacity-60
            text-text-body text-xs px-3 py-1.5"
        >
          {savingNotes ? 'Menyimpan...' : 'Simpan Catatan'}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-mid">
            Gambar ({images.length}/{maxImages})
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || images.length >= maxImages}
            className="btn-ios bg-ios-green hover:shadow-glow-green disabled:opacity-60
              text-white text-xs px-3 py-1.5"
          >
            {uploading ? 'Mengunggah...' : 'Upload'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {images.map((img, i) => (
              <div key={img.id} className="relative group">
                <button
                  type="button"
                  onClick={() => setPreviewIndex(i)}
                  aria-label={`Lihat gambar ${i + 1}`}
                  className="block w-full rounded-lg overflow-hidden border border-white/10
                    cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-ios-blue/50"
                >
                  <img
                    src={img.url}
                    alt={`Dokumentasi tanaman ${i + 1}`}
                    className="w-full h-20 object-cover"
                  />
                  <span
                    className="absolute inset-0 flex items-center justify-center bg-black/30
                      opacity-0 group-hover:opacity-100 transition pointer-events-none"
                    aria-hidden="true"
                  >
                    <Maximize2 size={18} className="text-white" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute top-1 right-1 bg-ios-red/90 text-white rounded-full
                    w-5 h-5 text-xs leading-none opacity-0 group-hover:opacity-100 transition
                    focus:opacity-100"
                  aria-label="Hapus gambar"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewIndex !== null && (
        <ImageLightbox
          images={images}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  )
}
