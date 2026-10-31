const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
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
    const message = (data && data.error) || `Request gagal (${res.status})`
    const err = new Error(message)
    err.status = res.status
    // Penanda agar usePinGate bisa membuka modal PIN pada 401.
    if (res.status === 401) err.code = 'PIN_INVALID'
    throw err
  }
  return data
}

// GET /api/settings -> { settings, pinIsDefault }.
export const getSettings = () => request('/settings')

// PUT /api/settings dengan header PIN.
export const putSettings = (pin, patch) =>
  request('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Settings-Pin': pin },
    body: JSON.stringify(patch || {}),
  })

// PUT /api/settings/pin -> { ok, pinIsDefault }.
export const putSettingsPin = (pin, newPin) =>
  request('/settings/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Settings-Pin': pin },
    body: JSON.stringify({ newPin }),
  })

// GET /api/settings/wifi -> { desired, devices, updatedAt, ready } (publik).
export const getWifiSettings = () => request('/settings/wifi')

// PUT /api/settings/wifi -> simpan + kirim ke perangkat.
export const putWifiSettings = (pin, { ssid, password, force }) =>
  request('/settings/wifi', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Settings-Pin': pin },
    body: JSON.stringify({ ssid, password, force }),
  })

// POST /api/settings/wifi/resend -> kirim ulang config tersimpan.
export const resendWifiSettings = (pin, force = false) =>
  request('/settings/wifi/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Settings-Pin': pin },
    body: JSON.stringify({ force }),
  })

// POST /api/settings/wifi/scan -> minta perangkat memindai SSID.
export const scanWifi = (pin) =>
  request('/settings/wifi/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Settings-Pin': pin },
    body: JSON.stringify({}),
  })
