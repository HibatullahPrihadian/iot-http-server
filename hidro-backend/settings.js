// Pengaturan aplikasi (menu Settings).
//
// Disimpan di tabel AppSetting yang sudah ada: satu baris per seksi, key
// `settings.<seksi>`, value JSON. Key internal lain (activeTankRecipeId,
// transplantDateBackfilled, tankReadingMigrated, tankReadingDedupe) tidak
// bertabrakan karena semua seksi di sini memakai prefix `settings.`.
//
// Sumber kebenaran nilai default ada di file ini. Salinannya untuk frontend
// ada di web/src/settings/defaults.js — jaga keduanya tetap sinkron.

const crypto = require('crypto');

const KEY_PREFIX = 'settings.';
const PIN_KEY = 'settings.security';
const DEFAULT_PIN = '1234';

const SECTIONS = ['general', 'plan', 'monitoring', 'listrik', 'device', 'limits'];

const SENSOR_THRESHOLD_KEYS = [
  'suhu_air',
  'suhu_udara',
  'kadar_tds',
  'kelembapan_udara',
  'kadar_ph',
  'intensitas_uv',
];

const DEFAULTS = {
  general: {
    farmName: 'Hidroponik',
  },
  plan: {
    harvestReadyDays: 3,
    harvestBannerDays: 1,
    ppmTolerancePct: 10,
    phFallbackMin: 5.5,
    phFallbackMax: 6.5,
  },
  monitoring: {
    pollHidroSeconds: 5,
    pollListrikSeconds: 2,
    onlineWindowMinutes: 5,
    thresholds: {
      suhu_air: { warn: 28, danger: 30 },
      suhu_udara: { warn: 32, danger: 35 },
      kadar_tds: { dangerLow: 500, warnLow: 700, warnHigh: 1300, dangerHigh: 1500 },
      kelembapan_udara: { dangerLow: 40, dangerHigh: 80 },
      kadar_ph: { dangerLow: 5.5, dangerHigh: 6.5 },
      intensitas_uv: { dangerLow: 0, dangerHigh: 2000 },
    },
  },
  listrik: {
    tariffPerKwh: 1444.7,
    voltageWarnLow: 207,
    voltageDangerLow: 198,
    voltageWarnHigh: 235,
    voltageDangerHigh: 242,
    powerFactorWarn: 0.85,
  },
  device: {
    uplinkIntervalSeconds: 60,
    uplinkIntervalOptions: [60, 180, 300, 600],
    dosingTargetPpm: 800,
    dosingVolumeLiters: 180,
    dosingConstant: 160,
    maxPumpSeconds: 600,
    relayLabels: ['Relay 1', 'Relay 2', 'Relay 3', 'Relay 4'],
  },
  limits: {
    maxNotesChars: 2000,
    maxImagesPerBatch: 5,
    maxImageMb: 5,
  },
};

// Cache in-memory: toBatchDto dipanggil per baris batch, jadi jangan query DB
// berulang. Di-invalidate setiap kali ada penulisan.
let cache = null;

function getDb() {
  // Lazy require supaya fungsi validasi murni bisa dipakai tanpa membuka DB.
  return require('./db');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Merge objek bertingkat: patch menang, array diganti utuh (bukan digabung).
function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return clone(patch);
  const out = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : clone(value);
  }
  return out;
}

function readSection(name) {
  const row = getDb()
    .prepare('SELECT value FROM AppSetting WHERE key = ?')
    .get(`${KEY_PREFIX}${name}`);
  if (!row || !row.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    console.error(`Setting ${name} rusak (bukan JSON), memakai default.`);
    return null;
  }
}

function writeSection(name, value) {
  getDb()
    .prepare(
      `INSERT INTO AppSetting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(`${KEY_PREFIX}${name}`, JSON.stringify(value));
}

function invalidate() {
  cache = null;
}

// Helper generik key/value AppSetting untuk key internal (bukan seksi settings).
// Baca nilai (null bila belum ada).
function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM AppSetting WHERE key = ?').get(key);
  return row ? row.value : null;
}

// Simpan/hapus setting generik (upsert; value null -> hapus baris).
function setSetting(key, value) {
  if (value === null || value === undefined) {
    getDb().prepare('DELETE FROM AppSetting WHERE key = ?').run(key);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO AppSetting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

// Nilai setting lengkap (default + tersimpan), sudah di-clone.
function getSettings() {
  if (cache) return clone(cache);
  const merged = {};
  for (const name of SECTIONS) {
    const stored = readSection(name);
    merged[name] = stored ? deepMerge(DEFAULTS[name], stored) : clone(DEFAULTS[name]);
  }
  cache = merged;
  return clone(merged);
}

// ---------------------------------------------------------------------------
// Validasi
// ---------------------------------------------------------------------------

function num(value, label, { min, max, integer = false } = {}) {
  if (value === null || value === undefined || value === '') {
    return { error: `${label} wajib diisi` };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `${label} harus angka` };
  if (integer && !Number.isInteger(n)) return { error: `${label} harus bilangan bulat` };
  if (min !== undefined && n < min) return { error: `${label} minimal ${min}` };
  if (max !== undefined && n > max) return { error: `${label} maksimal ${max}` };
  return { value: n };
}

function checkUnknownKeys(obj, allowed, label) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) return `${label}: field tidak dikenal (${key})`;
  }
  return null;
}

function validateGeneral(section) {
  const unknown = checkUnknownKeys(section, ['farmName'], 'general');
  if (unknown) return unknown;
  if (typeof section.farmName !== 'string') return 'farmName harus teks';
  const name = section.farmName.trim();
  if (name.length < 1 || name.length > 60) return 'farmName harus 1-60 karakter';
  return null;
}

function validatePlan(section) {
  const unknown = checkUnknownKeys(
    section,
    ['harvestReadyDays', 'harvestBannerDays', 'ppmTolerancePct', 'phFallbackMin', 'phFallbackMax'],
    'plan'
  );
  if (unknown) return unknown;

  const ready = num(section.harvestReadyDays, 'harvestReadyDays', { min: 0, max: 30, integer: true });
  if (ready.error) return ready.error;
  const banner = num(section.harvestBannerDays, 'harvestBannerDays', { min: 0, max: 30, integer: true });
  if (banner.error) return banner.error;
  const tol = num(section.ppmTolerancePct, 'ppmTolerancePct', { min: 1, max: 50, integer: true });
  if (tol.error) return tol.error;
  const phMin = num(section.phFallbackMin, 'phFallbackMin', { min: 0, max: 14 });
  if (phMin.error) return phMin.error;
  const phMax = num(section.phFallbackMax, 'phFallbackMax', { min: 0, max: 14 });
  if (phMax.error) return phMax.error;
  if (phMin.value >= phMax.value) return 'phFallbackMin harus lebih kecil dari phFallbackMax';
  return null;
}

function validateThresholds(thresholds) {
  if (!isPlainObject(thresholds)) return 'thresholds harus objek';
  const unknown = checkUnknownKeys(thresholds, SENSOR_THRESHOLD_KEYS, 'monitoring.thresholds');
  if (unknown) return unknown;

  for (const key of SENSOR_THRESHOLD_KEYS) {
    const cfg = thresholds[key];
    if (!isPlainObject(cfg)) return `thresholds.${key} harus objek`;

    if (key === 'suhu_air' || key === 'suhu_udara') {
      const unknownSensor = checkUnknownKeys(cfg, ['warn', 'danger'], `thresholds.${key}`);
      if (unknownSensor) return unknownSensor;
      const warn = num(cfg.warn, `${key}.warn`, { min: -20, max: 100 });
      if (warn.error) return warn.error;
      const danger = num(cfg.danger, `${key}.danger`, { min: -20, max: 100 });
      if (danger.error) return danger.error;
      if (warn.value >= danger.value) return `${key}: warn harus lebih kecil dari danger`;
      continue;
    }

    if (key === 'kadar_tds') {
      const unknownSensor = checkUnknownKeys(
        cfg,
        ['dangerLow', 'warnLow', 'warnHigh', 'dangerHigh'],
        `thresholds.${key}`
      );
      if (unknownSensor) return unknownSensor;
      const fields = {};
      for (const f of ['dangerLow', 'warnLow', 'warnHigh', 'dangerHigh']) {
        const r = num(cfg[f], `${key}.${f}`, { min: 0, max: 10000 });
        if (r.error) return r.error;
        fields[f] = r.value;
      }
      if (!(fields.dangerLow < fields.warnLow && fields.warnLow <= fields.warnHigh && fields.warnHigh < fields.dangerHigh)) {
        return `${key}: urutan harus dangerLow < warnLow <= warnHigh < dangerHigh`;
      }
      continue;
    }

    const unknownSensor = checkUnknownKeys(cfg, ['dangerLow', 'dangerHigh'], `thresholds.${key}`);
    if (unknownSensor) return unknownSensor;
    const max = key === 'kadar_ph' ? 14 : key === 'kelembapan_udara' ? 100 : 100000;
    const low = num(cfg.dangerLow, `${key}.dangerLow`, { min: 0, max });
    if (low.error) return low.error;
    const high = num(cfg.dangerHigh, `${key}.dangerHigh`, { min: 0, max });
    if (high.error) return high.error;
    if (low.value >= high.value) return `${key}: dangerLow harus lebih kecil dari dangerHigh`;
  }
  return null;
}

function validateMonitoring(section) {
  const unknown = checkUnknownKeys(
    section,
    ['pollHidroSeconds', 'pollListrikSeconds', 'onlineWindowMinutes', 'thresholds'],
    'monitoring'
  );
  if (unknown) return unknown;

  const pollH = num(section.pollHidroSeconds, 'pollHidroSeconds', { min: 1, max: 60, integer: true });
  if (pollH.error) return pollH.error;
  const pollL = num(section.pollListrikSeconds, 'pollListrikSeconds', { min: 1, max: 60, integer: true });
  if (pollL.error) return pollL.error;
  const online = num(section.onlineWindowMinutes, 'onlineWindowMinutes', { min: 1, max: 60, integer: true });
  if (online.error) return online.error;
  return validateThresholds(section.thresholds);
}

function validateListrik(section) {
  const unknown = checkUnknownKeys(
    section,
    [
      'tariffPerKwh',
      'voltageWarnLow',
      'voltageDangerLow',
      'voltageWarnHigh',
      'voltageDangerHigh',
      'powerFactorWarn',
    ],
    'listrik'
  );
  if (unknown) return unknown;

  const tariff = num(section.tariffPerKwh, 'tariffPerKwh', { min: 0, max: 10000 });
  if (tariff.error) return tariff.error;

  const fields = {};
  for (const f of ['voltageDangerLow', 'voltageWarnLow', 'voltageWarnHigh', 'voltageDangerHigh']) {
    const r = num(section[f], `listrik.${f}`, { min: 0, max: 500 });
    if (r.error) return r.error;
    fields[f] = r.value;
  }
  if (
    !(
      fields.voltageDangerLow < fields.voltageWarnLow &&
      fields.voltageWarnLow <= fields.voltageWarnHigh &&
      fields.voltageWarnHigh < fields.voltageDangerHigh
    )
  ) {
    return 'listrik: urutan harus voltageDangerLow < voltageWarnLow <= voltageWarnHigh < voltageDangerHigh';
  }

  const pf = num(section.powerFactorWarn, 'powerFactorWarn', { min: 0, max: 1 });
  if (pf.error) return pf.error;
  return null;
}

function validateDevice(section) {
  const unknown = checkUnknownKeys(
    section,
    [
      'uplinkIntervalSeconds',
      'uplinkIntervalOptions',
      'dosingTargetPpm',
      'dosingVolumeLiters',
      'dosingConstant',
      'maxPumpSeconds',
      'relayLabels',
    ],
    'device'
  );
  if (unknown) return unknown;

  const interval = num(section.uplinkIntervalSeconds, 'uplinkIntervalSeconds', {
    min: 10,
    max: 3600,
    integer: true,
  });
  if (interval.error) return interval.error;

  const options = section.uplinkIntervalOptions;
  if (!Array.isArray(options) || options.length < 1 || options.length > 8) {
    return 'uplinkIntervalOptions harus 1-8 angka';
  }
  const seen = new Set();
  for (const raw of options) {
    const r = num(raw, 'uplinkIntervalOptions', { min: 10, max: 3600, integer: true });
    if (r.error) return r.error;
    if (seen.has(r.value)) return 'uplinkIntervalOptions tidak boleh duplikat';
    seen.add(r.value);
  }
  if (!seen.has(interval.value)) {
    return 'uplinkIntervalOptions wajib memuat uplinkIntervalSeconds';
  }

  const target = num(section.dosingTargetPpm, 'dosingTargetPpm', { min: 1, max: 5000, integer: true });
  if (target.error) return target.error;
  const volume = num(section.dosingVolumeLiters, 'dosingVolumeLiters', { min: 1, max: 100000 });
  if (volume.error) return volume.error;
  const konstanta = num(section.dosingConstant, 'dosingConstant', { min: 1, max: 100000 });
  if (konstanta.error) return konstanta.error;
  const maxPump = num(section.maxPumpSeconds, 'maxPumpSeconds', { min: 1, max: 3600, integer: true });
  if (maxPump.error) return maxPump.error;

  const labels = section.relayLabels;
  if (!Array.isArray(labels) || labels.length !== 4) return 'relayLabels harus 4 label';
  for (const label of labels) {
    if (typeof label !== 'string') return 'relayLabels harus teks';
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > 30) return 'relayLabels harus 1-30 karakter';
  }
  return null;
}

function validateLimits(section) {
  const unknown = checkUnknownKeys(
    section,
    ['maxNotesChars', 'maxImagesPerBatch', 'maxImageMb'],
    'limits'
  );
  if (unknown) return unknown;

  const notes = num(section.maxNotesChars, 'maxNotesChars', { min: 100, max: 10000, integer: true });
  if (notes.error) return notes.error;
  const images = num(section.maxImagesPerBatch, 'maxImagesPerBatch', { min: 1, max: 20, integer: true });
  if (images.error) return images.error;
  const mb = num(section.maxImageMb, 'maxImageMb', { min: 1, max: 20, integer: true });
  if (mb.error) return mb.error;
  return null;
}

const VALIDATORS = {
  general: validateGeneral,
  plan: validatePlan,
  monitoring: validateMonitoring,
  listrik: validateListrik,
  device: validateDevice,
  limits: validateLimits,
};

// Ubah nilai hasil form (string dari input) menjadi tipe sesuai default:
// angka -> Number, array angka -> array Number, teks -> trim.
function coerceSection(template, section) {
  if (Array.isArray(template)) {
    const numeric = template.length > 0 && typeof template[0] === 'number';
    return (section || []).map((v) => (numeric ? Number(v) : typeof v === 'string' ? v.trim() : v));
  }
  const out = {};
  for (const [key, value] of Object.entries(section || {})) {
    const t = template?.[key];
    if (typeof t === 'number') out[key] = Number(value);
    else if (Array.isArray(t)) out[key] = coerceSection(t, value);
    else if (isPlainObject(t)) out[key] = coerceSection(t, value);
    else out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

// Validasi patch (hanya seksi yang dikirim). Nilai yang belum ada di patch
// digabung dengan nilai sekarang, jadi patch parsial tetap aman.
// Mengembalikan { value: <section ter-merge & ter-normalisasi> } atau { error }.
function validateSettings(patch) {
  if (!isPlainObject(patch)) return { error: 'Body harus objek per seksi' };
  const names = Object.keys(patch);
  if (names.length === 0) return { error: 'Tidak ada setting yang dikirim' };

  for (const name of names) {
    if (!SECTIONS.includes(name)) return { error: `Seksi tidak dikenal (${name})` };
  }

  const current = getSettings();
  const value = {};
  for (const name of names) {
    if (!isPlainObject(patch[name])) return { error: `${name} harus objek` };
    const merged = deepMerge(current[name], patch[name]);
    const error = VALIDATORS[name](merged);
    if (error) return { error };
    value[name] = coerceSection(DEFAULTS[name], merged);
  }
  return { value };
}

// Simpan seksi yang dikirim. Seksi lain tidak disentuh.
function updateSections(patch) {
  const parsed = validateSettings(patch);
  if (parsed.error) return parsed;
  for (const [name, value] of Object.entries(parsed.value)) {
    writeSection(name, value);
  }
  invalidate();
  return { value: getSettings() };
}

// ---------------------------------------------------------------------------
// PIN pengaturan
// ---------------------------------------------------------------------------

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
}

function readPinRecord() {
  const row = getDb().prepare('SELECT value FROM AppSetting WHERE key = ?').get(PIN_KEY);
  if (!row || !row.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    if (typeof parsed?.hash === 'string' && typeof parsed?.salt === 'string') return parsed;
  } catch {
    // jatuh ke null
  }
  return null;
}

function writePinRecord(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const record = { salt, hash: hashPin(pin, salt) };
  getDb()
    .prepare(
      `INSERT INTO AppSetting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(PIN_KEY, JSON.stringify(record));
}

// Seed PIN default saat pertama kali jalan; tidak menimpa PIN yang sudah ada.
function initSettings() {
  try {
    const record = readPinRecord();
    if (!record) {
      writePinRecord(DEFAULT_PIN);
      console.warn(
        `⚠️  PIN Settings masih default (${DEFAULT_PIN}). Ganti lewat menu Settings setelah deploy.`
      );
    } else if (verifyPin(DEFAULT_PIN)) {
      console.warn(`⚠️  PIN Settings masih default (${DEFAULT_PIN}). Segera ganti lewat menu Settings.`);
    }
  } catch (err) {
    console.error('Gagal menyiapkan PIN settings:', err.message);
  }
  invalidate();
}

function verifyPin(pin) {
  if (typeof pin !== 'string' || pin.length === 0) return false;
  const record = readPinRecord();
  if (!record) return false;
  const candidate = Buffer.from(hashPin(pin, record.salt), 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function isDefaultPin() {
  try {
    return verifyPin(DEFAULT_PIN);
  } catch {
    return false;
  }
}

function setPin(newPin) {
  if (typeof newPin !== 'string') return { error: 'PIN baru harus teks' };
  const pin = newPin.trim();
  if (pin.length < 4 || pin.length > 64) return { error: 'PIN harus 4-64 karakter' };
  writePinRecord(pin);
  return { ok: true };
}

module.exports = {
  DEFAULTS,
  SECTIONS,
  DEFAULT_PIN,
  getSetting,
  setSetting,
  getSettings,
  validateSettings,
  updateSections,
  invalidate,
  initSettings,
  verifyPin,
  isDefaultPin,
  setPin,
};
