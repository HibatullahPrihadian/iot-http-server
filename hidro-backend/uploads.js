const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// Folder upload gambar, override lewat env (default relatif proyek; Docker pakai /app/data/uploads).
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Batas keras: setting maxImageMb dibatasi 20 MB (lihat settings.js), jangan lewat.
const HARD_MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const batchId = req.params.id || 'x';
    const rand = crypto.randomBytes(6).toString('hex');
    const ext = ALLOWED[file.mimetype] || '.bin';
    cb(null, `${batchId}-${Date.now()}-${rand}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED[file.mimetype]) return cb(null, true);
  const err = new Error('Hanya JPG, PNG, atau WEBP yang diizinkan');
  err.status = 400;
  cb(err);
}

// Instance multer dengan batas ukuran dari setting (Settings > Batas & Unggahan).
function makeUpload(maxBytes) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : HARD_MAX_BYTES;
  return multer({
    storage,
    fileFilter,
    limits: { fileSize: Math.min(limit, HARD_MAX_BYTES) },
  });
}

// Helper hapus file fisik (abaikan bila sudah hilang).
function removeFile(filename) {
  if (!filename) return;
  const full = path.join(UPLOAD_DIR, path.basename(filename));
  fs.rm(full, { force: true }, () => {});
}

module.exports = { makeUpload, UPLOAD_DIR, removeFile };
