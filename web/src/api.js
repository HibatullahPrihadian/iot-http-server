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
    const message = (data && data.error) || `Request gagal (${res.status})`
    throw new Error(message)
  }
  return data
}

export const get = (path) => request(path)
export const post = (path, body) =>
  request(path, { method: 'POST', body: JSON.stringify(body || {}) })
export const put = (path, body) =>
  request(path, { method: 'PUT', body: JSON.stringify(body || {}) })
export const del = (path) => request(path, { method: 'DELETE' })

// Upload gambar (multipart/form-data). Jangan set Content-Type manual.
export async function uploadImage(batchId, file) {
  const form = new FormData()
  form.append('image', file)

  const res = await fetch(`${BASE}/batches/${batchId}/images`, {
    method: 'POST',
    body: form,
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
    const message = (data && data.error) || `Upload gagal (${res.status})`
    throw new Error(message)
  }
  return data
}
