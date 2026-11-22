const JPEG_TYPE = 'image/jpeg'
const MAX_DIMENSION = 4096
const MIN_DIMENSION = 320

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Foto tidak dapat dibaca untuk dikompres'))
    }
    image.src = url
  })
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Browser gagal membuat foto JPEG'))
    }, JPEG_TYPE, quality)
  })
}

function dimensionsFor(image, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  return {
    width: Math.max(1, Math.round(image.naturalWidth * scale)),
    height: Math.max(1, Math.round(image.naturalHeight * scale)),
  }
}

// Convert only oversized files to JPEG while preserving as much detail as the target allows.
export async function compressImage(file, targetBytes) {
  if (file.size <= targetBytes) return file

  const image = await loadImage(file)
  let maxDimension = Math.min(MAX_DIMENSION, Math.max(image.naturalWidth, image.naturalHeight))

  while (maxDimension >= MIN_DIMENSION) {
    const { width, height } = dimensionsFor(image, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser tidak mendukung kompresi foto')

    // JPEG does not support transparency, so use a white background for PNG/WEBP files.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    let low = 0.1
    let high = 0.92
    let best = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const quality = (low + high) / 2
      const blob = await canvasBlob(canvas, quality)
      if (blob.size <= targetBytes) {
        best = blob
        low = quality
      } else {
        high = quality
      }
    }

    if (best) {
      return new File([best], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
        type: JPEG_TYPE,
        lastModified: file.lastModified,
      })
    }

    maxDimension = Math.floor(maxDimension * 0.75)
  }

  throw new Error('Foto terlalu besar untuk dikompres hingga batas ukuran')
}
