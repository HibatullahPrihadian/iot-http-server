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
