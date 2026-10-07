// Klien fetch untuk 6 endpoint IoT (pola sama seperti api.js Plan, base /api).
const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request gagal (${res.status})`
    throw new Error(message)
  }
  return data
}

const post = (path, body) =>
  request(path, { method: 'POST', body: JSON.stringify(body || {}) })

export const getSensorData = (filter = 'realtime') =>
  request(`/sensor-data?filter=${encodeURIComponent(filter)}`)

export const getRelayStatus = () => request('/relay/status')

// Resep tangki aktif + sensor terakhir: { recipe, sensor, sensorError }.
export const getTankRecipe = () => request('/tank')

export const kontrolPompa = (durasi) =>
  post('/pompa/kontrol', { durasi })

export const kontrolInterval = (intervalDetik) =>
  post('/interval/kontrol', { intervalDetik })

export const kontrolAutodosing = (targetTds, volumeAir, konstantaPupuk) =>
  post('/autodosing/kontrol', { targetTds, volumeAir, konstantaPupuk })

export const kontrolRelay = (idRelay, status) =>
  post('/relay/kontrol', { idRelay, status })
