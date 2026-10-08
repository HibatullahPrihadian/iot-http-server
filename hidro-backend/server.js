const express = require('express');
const cors = require('cors');
const db = require('./db');
const { upload, UPLOAD_DIR, removeFile } = require('./uploads');

const app = express();
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  corsOrigins.length
    ? cors({ origin: corsOrigins })
    : cors({ origin: false })
);
app.use(express.json());

// Sajikan gambar langsung (dev). Di Docker juga diproxy lewat nginx /uploads/.
app.use('/uploads', express.static(UPLOAD_DIR));

const MS_PER_DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTES = 2000;

// Tambah n hari ke string tanggal ISO 'YYYY-MM-DD' (UTC-safe, hindari geser timezone).
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Hari ini dalam UTC sebagai 'YYYY-MM-DD'.
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Timestamp ISO penuh untuk harvestedAt/archivedAt.
function nowISO() {
  return new Date().toISOString();
}

// Validasi format & realitas tanggal 'YYYY-MM-DD'.
function isValidDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

// Jumlah hari antara dua tanggal 'YYYY-MM-DD' (UTC-safe).
function daysBetween(fromStr, toStr) {
  return Math.round(
    (new Date(`${toStr}T00:00:00Z`) - new Date(`${fromStr}T00:00:00Z`)) / MS_PER_DAY
  );
}

// ---------------------------------------------------------------------------
// Helper RCP (resep nutrisi)
// ---------------------------------------------------------------------------

const PHASES = ['Semai', 'Pembesaran'];
// Batas jumlah pembacaan yang dikembalikan agar payload tak membengkak.
const MAX_READINGS = 500;
// Ambang alert ppm: menyimpang >10% dari target.
const PPM_TOLERANCE = 0.1;

// Fase aktif batch berdasarkan perbandingan hari ini vs tanggal pindah.
function activePhase(batch) {
  return todayISO() < batch.transferDate ? 'Semai' : 'Pembesaran';
}

// Resep (PlantRecipe) yang berlaku untuk batch sesuai fase aktifnya.
function getRecipeForBatch(batch) {
  return db
    .prepare('SELECT * FROM PlantRecipe WHERE plantId = ? AND phase = ?')
    .get(batch.plantId, activePhase(batch));
}

// Hitung dosis AB Mix dari target ppm, volume air, dan konstanta.
// gram = (targetPpm - ppmAirAwal) * volumeAir / 1000 * konstanta (min 0).
function computeDose(recipe, { volumeAir, ppmAirAwal, targetPpm }) {
  const target = targetPpm ?? recipe.ppmTarget ?? 0;
  const air = ppmAirAwal ?? recipe.ppmAirDefault ?? 0;
  const k = recipe.konstanta ?? 0;
  const gram = ((target - air) * volumeAir * k) / 1000;
  const safe = Number.isFinite(gram) && gram > 0 ? gram : 0;
  return { gramA: safe, gramB: safe };
}

// Validasi payload resep (PUT /api/catalog/:id/recipes/:phase).
function validateRecipePayload(body) {
  const b = body || {};
  const numOrNull = (v, label, { integer = false, min = 0 } = {}) => {
    if (v === null || v === undefined || v === '') return { value: null };
    const n = Number(v);
    if (Number.isNaN(n)) return { error: `${label} harus angka` };
    if (integer && !Number.isInteger(n)) return { error: `${label} harus bilangan bulat` };
    if (n < min) return { error: `${label} minimal ${min}` };
    return { value: n };
  };

  const ppm = numOrNull(b.ppmTarget, 'ppmTarget', { integer: true });
  if (ppm.error) return ppm;
  const gA = numOrNull(b.gramPerLiterA, 'gramPerLiterA');
  if (gA.error) return gA;
  const gB = numOrNull(b.gramPerLiterB, 'gramPerLiterB');
  if (gB.error) return gB;
  const k = numOrNull(b.konstanta, 'konstanta');
  if (k.error) return k;
  const air = numOrNull(b.ppmAirDefault, 'ppmAirDefault', { integer: true });
  if (air.error) return air;
  // Volume tangki (liter) untuk workflow pompa AB Mix; nullable, >= 0.
  const volTangki = numOrNull(b.volumeTangki, 'volumeTangki');
  if (volTangki.error) return volTangki;

  // pH: opsional, tapi bila salah satu diisi wajib keduanya dan phMin <= phMax.
  const hasMin = b.phMin !== null && b.phMin !== undefined && b.phMin !== '';
  const hasMax = b.phMax !== null && b.phMax !== undefined && b.phMax !== '';
  let phMin = null;
  let phMax = null;
  if (hasMin || hasMax) {
    if (!hasMin || !hasMax) {
      return { error: 'phMin dan phMax harus diisi bersamaan' };
    }
    phMin = Number(b.phMin);
    phMax = Number(b.phMax);
    if (Number.isNaN(phMin) || Number.isNaN(phMax)) {
      return { error: 'phMin/phMax harus angka' };
    }
    if (phMin < 0 || phMin > 14 || phMax < 0 || phMax > 14) {
      return { error: 'phMin/phMax harus dalam rentang 0-14' };
    }
    if (phMin > phMax) {
      return { error: 'phMin tidak boleh lebih besar dari phMax' };
    }
  }

  if (b.catatan !== null && b.catatan !== undefined && typeof b.catatan !== 'string') {
    return { error: 'catatan harus string' };
  }
  if (typeof b.catatan === 'string' && b.catatan.length > MAX_NOTES) {
    return { error: `catatan maksimal ${MAX_NOTES} karakter` };
  }

  return {
    value: {
      ppmTarget: ppm.value,
      phMin,
      phMax,
      gramPerLiterA: gA.value,
      gramPerLiterB: gB.value,
      konstanta: k.value,
      ppmAirDefault: air.value,
      volumeTangki: volTangki.value,
      catatan: typeof b.catatan === 'string' ? b.catatan.trim() || null : null,
    },
  };
}

// Tambah field hitungan runtime ke row batch.
function compute(row) {
  const today = todayISO();
  const harvest = new Date(`${row.harvestDate}T00:00:00Z`);
  const daysRemaining = Math.ceil(
    (harvest - new Date(`${today}T00:00:00Z`)) / MS_PER_DAY
  );

  let computedStatus;
  if (daysRemaining <= 3) {
    computedStatus = 'Siap Panen';
  } else if (today >= row.transferDate) {
    computedStatus = 'Pembesaran';
  } else {
    computedStatus = 'Semai';
  }

  return {
    ...row,
    daysRemaining,
    computedStatus,
    hasHistory: Boolean(row.hasHistory),
  };
}

// ---------------------------------------------------------------------------
// Helper pengaturan (AppSetting) + panel tangki (Fase 4)
// ---------------------------------------------------------------------------

const SETTING_ACTIVE_TANK_RECIPE = 'activeTankRecipeId';
// Sensor dianggap basi bila lebih tua dari 5 menit.
const SENSOR_STALE_MS = 5 * 60 * 1000;
// Cache respons sensor: sukses 20 s, gagal 5 s (cepat pulih).
const SENSOR_CACHE_OK_MS = 20000;
const SENSOR_CACHE_FAIL_MS = 5000;

// Baca nilai setting (null bila belum ada).
function getSetting(key) {
  const row = db.prepare('SELECT value FROM AppSetting WHERE key = ?').get(key);
  return row ? row.value : null;
}

// Simpan/hapus setting (upsert; value null -> hapus baris).
function setSetting(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM AppSetting WHERE key = ?').run(key);
    return;
  }
  db.prepare(
    `INSERT INTO AppSetting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

// Resep tangki aktif + nama tanaman; null bila belum diset atau resep sudah hilang.
function getActiveTankRecipe() {
  const raw = getSetting(SETTING_ACTIVE_TANK_RECIPE);
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    setSetting(SETTING_ACTIVE_TANK_RECIPE, null);
    return null;
  }
  const row = db
    .prepare(
      `SELECT r.*, c.name AS plantName
       FROM PlantRecipe r JOIN PlantCatalog c ON c.id = r.plantId
       WHERE r.id = ?`
    )
    .get(id);
  if (!row) {
    // Resep sudah dihapus -> bersihkan referensi menggantung.
    setSetting(SETTING_ACTIVE_TANK_RECIPE, null);
    return null;
  }
  return row;
}

// Cache module-level respons sensor.
let sensorCache = { at: 0, data: null, error: null };

// Ambil 1 pembacaan sensor dari API IoT (tidak pernah melempar).
// Respons nyata: { success, count, data: [ { waktu, kadar_tds, kadar_ph, ... } ] } (urut naik).
async function fetchIotSensor() {
  const url = process.env.IOT_API_URL || 'https://hidroponik.phd.my.id/api/sensor-data?filter=realtime';
  const timeoutMs = Number(process.env.IOT_TIMEOUT_MS) || 5000;
  const key = process.env.IOT_API_KEY;

  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { sensor: null, error: `Sensor HTTP ${res.status}` };

    const json = await res.json();
    const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    if (!rows.length) return { sensor: null, error: 'Data sensor kosong' };

    const last = rows[rows.length - 1] || {};
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const rawWaktu = last.waktu ?? last.timestamp ?? last.created_at ?? null;
    const waktu = rawWaktu ? new Date(rawWaktu).toISOString() : null;

    return {
      sensor: {
        ppm: num(last.kadar_tds ?? last.tds ?? last.ppm),
        ph: num(last.kadar_ph ?? last.ph),
        waktu,
      },
      error: null,
    };
  } catch (err) {
    return { sensor: null, error: `Gagal menghubungi sensor (${err.name || 'error'})` };
  }
}

// Sensor dengan cache + flag stale.
async function getTankSensor() {
  const now = Date.now();
  const ttl = sensorCache.error ? SENSOR_CACHE_FAIL_MS : SENSOR_CACHE_OK_MS;
  if (sensorCache.at && now - sensorCache.at < ttl) {
    return withStale(sensorCache.data, sensorCache.error);
  }

  const { sensor, error } = await fetchIotSensor();
  sensorCache = { at: now, data: sensor, error };
  return withStale(sensor, error);
}

function withStale(sensor, error) {
  if (!sensor) return { sensor: null, sensorError: error || 'Data sensor tidak tersedia' };
  const t = sensor.waktu ? new Date(sensor.waktu).getTime() : NaN;
  const stale = !Number.isFinite(t) || Date.now() - t > SENSOR_STALE_MS;
  return { sensor: { ...sensor, stale }, sensorError: null };
}

// Hitung dosis AB Mix dari resep tangki (reuse computeDose).
function computeDoseFromRecipe(recipe, { volumeAir, ppmAirAwal, targetPpm }) {
  return computeDose(recipe, { volumeAir, ppmAirAwal, targetPpm });
}

// ---------------------------------------------------------------------------
// Fase 1 endpoints
// ---------------------------------------------------------------------------

// GET /api/health -> healthcheck Docker.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GET /api/catalog -> semua tanaman + flag hasRecipe (ada resep RCP).
app.get('/api/catalog', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT c.*,
                EXISTS(SELECT 1 FROM PlantRecipe r WHERE r.plantId = c.id) AS hasRecipe
         FROM PlantCatalog c
         ORDER BY c.id`
      )
      .all();
    res.json(rows.map((r) => ({ ...r, hasRecipe: Boolean(r.hasRecipe) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/batches -> batch AKTIF + field hitungan + hasHistory.
app.get('/api/batches', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT b.*, c.name AS plantName, c.totalDays AS totalDays,
                EXISTS(
                  SELECT 1 FROM PlantBatch h
                  WHERE h.tableNumber = b.tableNumber
                    AND h.pipeNumber = b.pipeNumber
                    AND h.archivedAt IS NOT NULL
                ) AS hasHistory
         FROM PlantBatch b
         JOIN PlantCatalog c ON c.id = b.plantId
         WHERE b.archivedAt IS NULL
         ORDER BY b.tableNumber, b.pipeNumber`
      )
      .all();
    res.json(rows.map(compute));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/batches -> tanam baru di satu pipa.
app.post('/api/batches', (req, res) => {
  try {
    const { tableNumber, pipeNumber, plantId, sowDate } = req.body || {};

    if (![1, 2, 3].includes(tableNumber)) {
      return res.status(400).json({ error: 'tableNumber harus 1, 2, atau 3' });
    }
    // Meja 3 = pembibitan (tanam baru di sini); Meja 1-2 = pembesaran (hanya via pindahan).
    if (tableNumber === 1 || tableNumber === 2) {
      return res.status(403).json({ error: 'Meja 1-2 hanya diisi via pindahan dari Meja 3' });
    }
    if (!Number.isInteger(pipeNumber) || pipeNumber < 1 || pipeNumber > 6) {
      return res.status(400).json({ error: 'pipeNumber harus 1-6' });
    }
    if (!Number.isInteger(plantId)) {
      return res.status(400).json({ error: 'plantId tidak valid' });
    }
    if (!isValidDate(sowDate)) {
      return res.status(400).json({ error: 'sowDate harus format YYYY-MM-DD yang valid' });
    }
    if (sowDate > todayISO()) {
      return res.status(400).json({ error: 'sowDate tidak boleh di masa depan' });
    }

    const plant = db.prepare('SELECT * FROM PlantCatalog WHERE id = ?').get(plantId);
    if (!plant) {
      return res.status(400).json({ error: 'plantId tidak ada di katalog' });
    }

    const existing = db
      .prepare(
        'SELECT id FROM PlantBatch WHERE tableNumber = ? AND pipeNumber = ? AND archivedAt IS NULL'
      )
      .get(tableNumber, pipeNumber);
    if (existing) {
      return res.status(409).json({ error: 'Pipa sudah terisi, panen dulu sebelum tanam ulang' });
    }

    const transferDate = addDays(sowDate, plant.seedlingDays);
    const harvestDate = addDays(sowDate, plant.totalDays);

    const info = db
      .prepare(
        `INSERT INTO PlantBatch
          (tableNumber, pipeNumber, plantId, sowDate, transferDate, harvestDate, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Semai')`
      )
      .run(tableNumber, pipeNumber, plantId, sowDate, transferDate, harvestDate);

    const row = db
      .prepare(
        `SELECT b.*, c.name AS plantName, c.totalDays AS totalDays
         FROM PlantBatch b
         JOIN PlantCatalog c ON c.id = b.plantId
         WHERE b.id = ?`
      )
      .get(info.lastInsertRowid);

    res.status(201).json(compute(row));
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Pipa sudah terisi, panen dulu sebelum tanam ulang' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/batches/:id -> batal tanam (hapus permanen + gambar fisik).
app.delete('/api/batches/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id tidak valid' });
    }

    const batch = db.prepare('SELECT id FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) {
      return res.status(404).json({ error: 'Batch tidak ditemukan' });
    }

    const images = db.prepare('SELECT filename FROM BatchImage WHERE batchId = ?').all(id);
    db.prepare('DELETE FROM BatchImage WHERE batchId = ?').run(id);
    db.prepare('DELETE FROM PlantBatch WHERE id = ?').run(id);
    images.forEach((img) => removeFile(img.filename));

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Fase 2 endpoints
// ---------------------------------------------------------------------------

// Cari katalog + validasi payload katalog.
function validateCatalogPayload(body) {
  const { name, seedlingDays, growDays } = body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return { error: 'name wajib diisi' };
  }
  if (!Number.isInteger(seedlingDays) || seedlingDays <= 0) {
    return { error: 'seedlingDays harus bilangan bulat > 0' };
  }
  if (!Number.isInteger(growDays) || growDays <= 0) {
    return { error: 'growDays harus bilangan bulat > 0' };
  }
  return { value: { name: name.trim(), seedlingDays, growDays, totalDays: seedlingDays + growDays } };
}

// POST /api/catalog -> tambah tanaman.
app.post('/api/catalog', (req, res) => {
  try {
    const { error, value } = validateCatalogPayload(req.body);
    if (error) return res.status(400).json({ error });

    const dup = db.prepare('SELECT id FROM PlantCatalog WHERE name = ?').get(value.name);
    if (dup) return res.status(409).json({ error: 'Nama tanaman sudah ada' });

    const info = db
      .prepare(
        'INSERT INTO PlantCatalog (name, seedlingDays, growDays, totalDays) VALUES (?, ?, ?, ?)'
      )
      .run(value.name, value.seedlingDays, value.growDays, value.totalDays);

    const row = db.prepare('SELECT * FROM PlantCatalog WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Nama tanaman sudah ada' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/catalog/:id -> update + recompute harvestDate batch aktif pemakai.
app.put('/api/catalog/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const existing = db.prepare('SELECT * FROM PlantCatalog WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Katalog tidak ditemukan' });

    const { error, value } = validateCatalogPayload(req.body);
    if (error) return res.status(400).json({ error });

    const dup = db
      .prepare('SELECT id FROM PlantCatalog WHERE name = ? AND id <> ?')
      .get(value.name, id);
    if (dup) return res.status(409).json({ error: 'Nama tanaman sudah ada' });

    const tx = db.transaction(() => {
      db.prepare(
        'UPDATE PlantCatalog SET name = ?, seedlingDays = ?, growDays = ?, totalDays = ? WHERE id = ?'
      ).run(value.name, value.seedlingDays, value.growDays, value.totalDays, id);

      // Recompute tanggal untuk batch AKTIF yang memakai katalog ini.
      const active = db
        .prepare('SELECT id, sowDate FROM PlantBatch WHERE plantId = ? AND archivedAt IS NULL')
        .all(id);
      const update = db.prepare(
        'UPDATE PlantBatch SET transferDate = ?, harvestDate = ? WHERE id = ?'
      );
      for (const b of active) {
        update.run(
          addDays(b.sowDate, value.seedlingDays),
          addDays(b.sowDate, value.totalDays),
          b.id
        );
      }
    });
    tx();

    const row = db.prepare('SELECT * FROM PlantCatalog WHERE id = ?').get(id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/catalog/:id -> tolak bila masih dipakai batch (aktif/arsip).
app.delete('/api/catalog/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const existing = db.prepare('SELECT id FROM PlantCatalog WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Katalog tidak ditemukan' });

    const used = db.prepare('SELECT COUNT(*) AS n FROM PlantBatch WHERE plantId = ?').get(id).n;
    if (used > 0) {
      return res
        .status(409)
        .json({ error: 'Katalog masih dipakai riwayat batch, tidak bisa dihapus' });
    }

    // Hapus resep manual (katalog tak dihapus bila dipakai batch -> cascade jarang terpicu).
    db.transaction(() => {
      db.prepare('DELETE FROM PlantRecipe WHERE plantId = ?').run(id);
      db.prepare('DELETE FROM PlantCatalog WHERE id = ?').run(id);
    })();

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/catalog/:id/recipes -> selalu 2 baris (Semai, Pembesaran); default kosong bila belum ada.
app.get('/api/catalog/:id/recipes', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const plant = db.prepare('SELECT id FROM PlantCatalog WHERE id = ?').get(id);
    if (!plant) return res.status(404).json({ error: 'Katalog tidak ditemukan' });

    const rows = db
      .prepare('SELECT * FROM PlantRecipe WHERE plantId = ?')
      .all(id);
    const byPhase = Object.fromEntries(rows.map((r) => [r.phase, r]));

    res.json(
      PHASES.map(
        (phase) =>
          byPhase[phase] || {
            id: null,
            plantId: id,
            phase,
            ppmTarget: null,
            phMin: null,
            phMax: null,
            gramPerLiterA: null,
            gramPerLiterB: null,
            konstanta: null,
            ppmAirDefault: null,
            volumeTangki: null,
            catatan: null,
          }
      )
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/catalog/:id/recipes/:phase -> upsert resep 1 fase.
app.put('/api/catalog/:id/recipes/:phase', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const phase = req.params.phase;
    if (!PHASES.includes(phase)) {
      return res.status(400).json({ error: "phase harus 'Semai' atau 'Pembesaran'" });
    }

    const plant = db.prepare('SELECT id FROM PlantCatalog WHERE id = ?').get(id);
    if (!plant) return res.status(404).json({ error: 'Katalog tidak ditemukan' });

    const { error, value } = validateRecipePayload(req.body);
    if (error) return res.status(400).json({ error });

    db.prepare(
      `INSERT INTO PlantRecipe
         (plantId, phase, ppmTarget, phMin, phMax, gramPerLiterA, gramPerLiterB,
          konstanta, ppmAirDefault, volumeTangki, catatan)
       VALUES (@plantId, @phase, @ppmTarget, @phMin, @phMax, @gramPerLiterA,
               @gramPerLiterB, @konstanta, @ppmAirDefault, @volumeTangki, @catatan)
       ON CONFLICT(plantId, phase) DO UPDATE SET
         ppmTarget = excluded.ppmTarget,
         phMin = excluded.phMin,
         phMax = excluded.phMax,
         gramPerLiterA = excluded.gramPerLiterA,
         gramPerLiterB = excluded.gramPerLiterB,
         konstanta = excluded.konstanta,
         ppmAirDefault = excluded.ppmAirDefault,
         volumeTangki = excluded.volumeTangki,
         catatan = excluded.catatan`
    ).run({ plantId: id, phase, ...value });

    const row = db
      .prepare('SELECT * FROM PlantRecipe WHERE plantId = ? AND phase = ?')
      .get(id, phase);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/batches/history -> batch arsip + filter.
app.get('/api/batches/history', (req, res) => {
  try {
    const { tableNumber, pipeNumber, plantId, from, to } = req.query;
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 500));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = ['b.archivedAt IS NOT NULL'];
    const params = [];

    if (tableNumber) {
      if (!['1', '2', '3'].includes(String(tableNumber))) {
        return res.status(400).json({ error: 'tableNumber harus 1, 2, atau 3' });
      }
      where.push('b.tableNumber = ?');
      params.push(Number(tableNumber));
    }
    if (pipeNumber) {
      const p = Number(pipeNumber);
      if (!Number.isInteger(p) || p < 1 || p > 6) {
        return res.status(400).json({ error: 'pipeNumber harus 1-6' });
      }
      where.push('b.pipeNumber = ?');
      params.push(p);
    }
    if (plantId) {
      const pid = Number(plantId);
      if (!Number.isInteger(pid)) return res.status(400).json({ error: 'plantId tidak valid' });
      where.push('b.plantId = ?');
      params.push(pid);
    }
    if (from) {
      if (!isValidDate(from)) return res.status(400).json({ error: 'from harus YYYY-MM-DD' });
      where.push('b.harvestedAt >= ?');
      params.push(from);
    }
    if (to) {
      if (!isValidDate(to)) return res.status(400).json({ error: 'to harus YYYY-MM-DD' });
      where.push('b.harvestedAt <= ?');
      params.push(`${to}T23:59:59.999Z`);
    }

    const rows = db
      .prepare(
        `SELECT b.*, c.name AS plantName, c.totalDays AS totalDays
         FROM PlantBatch b
         JOIN PlantCatalog c ON c.id = b.plantId
         WHERE ${where.join(' AND ')}
         ORDER BY b.harvestedAt DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json(
      rows.map((r) => ({
        ...r,
        durationDays: r.harvestedAt ? daysBetween(r.sowDate, r.harvestedAt.slice(0, 10)) : null,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/batches/:id -> edit batch aktif (plantId + sowDate).
app.put('/api/batches/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT * FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });
    if (batch.archivedAt) {
      return res.status(409).json({ error: 'Batch sudah diarsipkan, tidak bisa diedit' });
    }

    const plantId = req.body?.plantId ?? batch.plantId;
    const sowDate = req.body?.sowDate ?? batch.sowDate;

    if (!Number.isInteger(plantId)) return res.status(400).json({ error: 'plantId tidak valid' });
    if (!isValidDate(sowDate)) {
      return res.status(400).json({ error: 'sowDate harus format YYYY-MM-DD yang valid' });
    }
    if (sowDate > todayISO()) {
      return res.status(400).json({ error: 'sowDate tidak boleh di masa depan' });
    }

    const plant = db.prepare('SELECT * FROM PlantCatalog WHERE id = ?').get(plantId);
    if (!plant) return res.status(400).json({ error: 'plantId tidak ada di katalog' });

    // Baca katalog + update batch dalam satu transaksi agar data katalog tidak
    // berubah di tengah perhitungan (better-sqlite3 sinkron -> serialisasi aman).
    db.transaction(() => {
      const current = db.prepare('SELECT * FROM PlantCatalog WHERE id = ?').get(plantId);
      const transferDate = addDays(sowDate, current.seedlingDays);
      const harvestDate = addDays(sowDate, current.totalDays);
      db.prepare(
        `UPDATE PlantBatch
         SET plantId = ?, sowDate = ?, transferDate = ?, harvestDate = ?
         WHERE id = ?`
      ).run(plantId, sowDate, transferDate, harvestDate, id);
    })();

    const row = db
      .prepare(
        `SELECT b.*, c.name AS plantName, c.totalDays AS totalDays
         FROM PlantBatch b JOIN PlantCatalog c ON c.id = b.plantId WHERE b.id = ?`
      )
      .get(id);
    res.json(compute(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/batches/:id/harvest -> arsipkan (panen).
app.post('/api/batches/:id/harvest', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT * FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });
    if (batch.archivedAt) return res.status(409).json({ error: 'Batch sudah dipanen' });
    // Meja 3 = pembibitan: tidak bisa dipanen langsung, pindahkan dulu ke Meja 1/2.
    if (batch.tableNumber === 3) {
      return res.status(409).json({ error: 'Bibit di Meja 3 tidak bisa dipanen, pindahkan dulu ke Meja 1/2' });
    }

    const weight = req.body?.harvestWeightGram;
    if (weight !== undefined && weight !== null) {
      if (!Number.isInteger(weight) || weight < 0) {
        return res.status(400).json({ error: 'harvestWeightGram harus bilangan bulat >= 0' });
      }
    }
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : batch.notes;
    if (typeof notes === 'string' && notes.length > MAX_NOTES) {
      return res.status(400).json({ error: `notes maksimal ${MAX_NOTES} karakter` });
    }
    const now = nowISO();

    db.prepare(
      `UPDATE PlantBatch
       SET harvestedAt = ?, archivedAt = ?, harvestWeightGram = ?, notes = ?
       WHERE id = ?`
    ).run(now, now, weight ?? null, notes, id);

    const row = db
      .prepare(
        `SELECT b.*, c.name AS plantName, c.totalDays AS totalDays
         FROM PlantBatch b JOIN PlantCatalog c ON c.id = b.plantId WHERE b.id = ?`
      )
      .get(id);
    res.json({
      ...row,
      durationDays: daysBetween(row.sowDate, now.slice(0, 10)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/batches/:id/transfer -> pindah bibit Meja 3 ke pipa kosong Meja 1/2.
// Tanggal (sowDate/transferDate/harvestDate) tidak berubah; hanya lokasi pindah.
app.post('/api/batches/:id/transfer', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT * FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });
    if (batch.archivedAt) {
      return res.status(409).json({ error: 'Batch sudah diarsipkan, tidak bisa dipindah' });
    }
    if (batch.tableNumber !== 3) {
      return res.status(403).json({ error: 'Hanya bibit dari Meja 3 yang bisa dipindah' });
    }

    const toTable = Number(req.body?.toTable);
    const toPipe = Number(req.body?.toPipe);
    if (![1, 2].includes(toTable)) {
      return res.status(400).json({ error: 'toTable harus 1 atau 2' });
    }
    if (!Number.isInteger(toPipe) || toPipe < 1 || toPipe > 6) {
      return res.status(400).json({ error: 'toPipe harus 1-6' });
    }

    const occupied = db
      .prepare(
        'SELECT id FROM PlantBatch WHERE tableNumber = ? AND pipeNumber = ? AND archivedAt IS NULL'
      )
      .get(toTable, toPipe);
    if (occupied) {
      return res.status(409).json({ error: 'Pipa tujuan sudah terisi' });
    }

    db.prepare('UPDATE PlantBatch SET tableNumber = ?, pipeNumber = ? WHERE id = ?').run(
      toTable,
      toPipe,
      id
    );

    const row = db
      .prepare(
        `SELECT b.*, c.name AS plantName, c.totalDays AS totalDays
         FROM PlantBatch b JOIN PlantCatalog c ON c.id = b.plantId WHERE b.id = ?`
      )
      .get(id);
    res.json(compute(row));
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Pipa tujuan sudah terisi' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/batches/:id/notes -> set/hapus catatan.
app.put('/api/batches/:id/notes', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT id FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });

    const notes = req.body?.notes;
    if (notes !== null && notes !== undefined && typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes harus string atau null' });
    }
    if (typeof notes === 'string' && notes.length > MAX_NOTES) {
      return res.status(400).json({ error: `notes maksimal ${MAX_NOTES} karakter` });
    }

    db.prepare('UPDATE PlantBatch SET notes = ? WHERE id = ?').run(
      notes ? notes.trim() || null : null,
      id
    );
    res.json({ success: true, notes: notes ? notes.trim() || null : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper: bentuk metadata gambar + url.
function imageRows(batchId) {
  return db
    .prepare('SELECT * FROM BatchImage WHERE batchId = ? ORDER BY id')
    .all(batchId)
    .map((r) => ({ ...r, url: `/uploads/${r.filename}` }));
}

// POST /api/batches/:id/images -> upload gambar (multipart field "image").
app.post('/api/batches/:id/images', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Ukuran gambar maksimal 5MB' });
      }
      return res.status(err.status || 400).json({ error: err.message || 'Upload gagal' });
    }

    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        if (req.file) removeFile(req.file.filename);
        return res.status(400).json({ error: 'id tidak valid' });
      }

      const batch = db.prepare('SELECT id FROM PlantBatch WHERE id = ?').get(id);
      if (!batch) {
        if (req.file) removeFile(req.file.filename);
        return res.status(404).json({ error: 'Batch tidak ditemukan' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'File gambar wajib diisi (field "image")' });
      }

      // Cek jumlah + insert dalam satu transaksi (better-sqlite3 sinkron) agar
      // dua upload bersamaan tidak sama-sama lolos batas 5 gambar/batch.
      let inserted = null;
      let limitReached = false;
      db.transaction(() => {
        const count = db
          .prepare('SELECT COUNT(*) AS n FROM BatchImage WHERE batchId = ?')
          .get(id).n;
        if (count >= 5) {
          limitReached = true;
          return;
        }
        const info = db
          .prepare('INSERT INTO BatchImage (batchId, filename, createdAt) VALUES (?, ?, ?)')
          .run(id, req.file.filename, nowISO());
        inserted = db.prepare('SELECT * FROM BatchImage WHERE id = ?').get(info.lastInsertRowid);
      })();

      if (limitReached) {
        removeFile(req.file.filename);
        return res.status(409).json({ error: 'Maksimal 5 gambar per batch' });
      }

      res.status(201).json({ ...inserted, url: `/uploads/${inserted.filename}` });
    } catch (e) {
      if (req.file) removeFile(req.file.filename);
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// GET /api/batches/:id/images -> daftar gambar batch.
app.get('/api/batches/:id/images', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT id FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });

    res.json(imageRows(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/batches/:id/images/:imageId -> hapus baris + file fisik.
app.delete('/api/batches/:id/images/:imageId', (req, res) => {
  try {
    const id = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    if (!Number.isInteger(id) || !Number.isInteger(imageId)) {
      return res.status(400).json({ error: 'id tidak valid' });
    }

    const img = db
      .prepare('SELECT * FROM BatchImage WHERE id = ? AND batchId = ?')
      .get(imageId, id);
    if (!img) return res.status(404).json({ error: 'Gambar tidak ditemukan' });

    db.prepare('DELETE FROM BatchImage WHERE id = ?').run(imageId);
    removeFile(img.filename);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/batches/:id/recipe -> resep fase aktif + phase + hasRecipe.
app.get('/api/batches/:id/recipe', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT * FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });

    const phase = activePhase(batch);
    const recipe = db
      .prepare('SELECT * FROM PlantRecipe WHERE plantId = ? AND phase = ?')
      .get(batch.plantId, phase);

    res.json({ phase, hasRecipe: Boolean(recipe), recipe: recipe || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/batches/:id/dose -> hitung dosis AB Mix (perkiraan ala auto-dosing).
app.post('/api/batches/:id/dose', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT * FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });
    if (batch.archivedAt) {
      return res.status(409).json({ error: 'Batch sudah dipanen, tidak bisa dihitung' });
    }

    const recipe = getRecipeForBatch(batch);
    if (!recipe) {
      return res.status(404).json({ error: 'Belum ada resep untuk fase tanaman ini' });
    }

    const volumeAir = Number(req.body?.volumeAir);
    if (!Number.isFinite(volumeAir) || volumeAir <= 0) {
      return res.status(400).json({ error: 'volumeAir harus angka > 0' });
    }

    const ppmAirAwal =
      req.body?.ppmAirAwal === undefined || req.body?.ppmAirAwal === null || req.body?.ppmAirAwal === ''
        ? recipe.ppmAirDefault ?? 0
        : Number(req.body.ppmAirAwal);
    const targetPpm =
      req.body?.targetPpm === undefined || req.body?.targetPpm === null || req.body?.targetPpm === ''
        ? recipe.ppmTarget ?? 0
        : Number(req.body.targetPpm);

    if (!Number.isFinite(ppmAirAwal) || ppmAirAwal < 0) {
      return res.status(400).json({ error: 'ppmAirAwal harus angka >= 0' });
    }
    if (!Number.isFinite(targetPpm) || targetPpm < 0) {
      return res.status(400).json({ error: 'targetPpm harus angka >= 0' });
    }

    const { gramA, gramB } = computeDose(recipe, { volumeAir, ppmAirAwal, targetPpm });
    res.json({
      gramA: Math.round(gramA * 100) / 100,
      gramB: Math.round(gramB * 100) / 100,
      targetPpm,
      ppmAirAwal,
      volumeAir,
      konstanta: recipe.konstanta,
      phase: activePhase(batch),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/batches/:id/readings -> daftar pengukuran (terbaru dulu) + resep fase aktif.
app.get('/api/batches/:id/readings', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT * FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });

    const recipe = getRecipeForBatch(batch);
    const readings = db
      .prepare(
        `SELECT * FROM BatchReading WHERE batchId = ?
         ORDER BY measuredAt DESC, id DESC LIMIT ?`
      )
      .all(id, MAX_READINGS);

    res.json({
      phase: activePhase(batch),
      recipe: recipe || null,
      readings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/batches/:id/readings -> tambah pengukuran { ppm?, ph?, catatan? }.
app.post('/api/batches/:id/readings', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id tidak valid' });

    const batch = db.prepare('SELECT * FROM PlantBatch WHERE id = ?').get(id);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });
    if (batch.archivedAt) {
      return res.status(409).json({ error: 'Batch sudah dipanen, tidak bisa menambah pengukuran' });
    }

    const rawPpm = req.body?.ppm;
    const rawPh = req.body?.ph;
    const hasPpm = rawPpm !== null && rawPpm !== undefined && rawPpm !== '';
    const hasPh = rawPh !== null && rawPh !== undefined && rawPh !== '';
    if (!hasPpm && !hasPh) {
      return res.status(400).json({ error: 'Minimal ppm atau pH harus diisi' });
    }

    let ppm = null;
    let ph = null;
    if (hasPpm) {
      ppm = Number(rawPpm);
      if (!Number.isInteger(ppm) || ppm < 0) {
        return res.status(400).json({ error: 'ppm harus bilangan bulat >= 0' });
      }
    }
    if (hasPh) {
      ph = Number(rawPh);
      if (!Number.isFinite(ph) || ph < 0 || ph > 14) {
        return res.status(400).json({ error: 'ph harus angka 0-14' });
      }
    }

    const catatan = req.body?.catatan;
    if (catatan !== null && catatan !== undefined && typeof catatan !== 'string') {
      return res.status(400).json({ error: 'catatan harus string' });
    }
    if (typeof catatan === 'string' && catatan.length > MAX_NOTES) {
      return res.status(400).json({ error: `catatan maksimal ${MAX_NOTES} karakter` });
    }

    const info = db
      .prepare(
        'INSERT INTO BatchReading (batchId, ppm, ph, catatan, measuredAt) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, ppm, ph, catatan ? catatan.trim() || null : null, nowISO());

    const row = db.prepare('SELECT * FROM BatchReading WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/batches/:id/readings/:readingId -> hapus 1 pengukuran.
app.delete('/api/batches/:id/readings/:readingId', (req, res) => {
  try {
    const id = Number(req.params.id);
    const readingId = Number(req.params.readingId);
    if (!Number.isInteger(id) || !Number.isInteger(readingId)) {
      return res.status(400).json({ error: 'id tidak valid' });
    }

    const reading = db
      .prepare('SELECT id FROM BatchReading WHERE id = ? AND batchId = ?')
      .get(readingId, id);
    if (!reading) return res.status(404).json({ error: 'Pengukuran tidak ditemukan' });

    db.prepare('DELETE FROM BatchReading WHERE id = ?').run(readingId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/stats/summary -> 4 blok statistik.
app.get('/api/stats/summary', (req, res) => {
  try {
    const archived = db
      .prepare(
        `SELECT b.*, c.name AS plantName, c.totalDays AS totalDays
         FROM PlantBatch b
         JOIN PlantCatalog c ON c.id = b.plantId
         WHERE b.archivedAt IS NOT NULL AND b.harvestedAt IS NOT NULL`
      )
      .all();

    // Panen per bulan (YYYY-MM).
    const harvestByMonthMap = {};
    for (const r of archived) {
      const month = r.harvestedAt.slice(0, 7);
      harvestByMonthMap[month] = (harvestByMonthMap[month] || 0) + 1;
    }
    const harvestByMonth = Object.keys(harvestByMonthMap)
      .sort()
      .map((month) => ({ month, count: harvestByMonthMap[month] }));

    // Panen per tanaman.
    const harvestByPlantMap = {};
    for (const r of archived) {
      harvestByPlantMap[r.plantName] = (harvestByPlantMap[r.plantName] || 0) + 1;
    }
    const harvestByPlant = Object.keys(harvestByPlantMap).map((plant) => ({
      plant,
      count: harvestByPlantMap[plant],
    }));

    // Estimasi vs realisasi: rata-rata durasi aktual vs totalDays katalog.
    const byPlant = {};
    for (const r of archived) {
      const dur = daysBetween(r.sowDate, r.harvestedAt.slice(0, 10));
      if (!byPlant[r.plantName]) {
        byPlant[r.plantName] = { plant: r.plantName, estimasi: r.totalDays, total: 0, n: 0 };
      }
      byPlant[r.plantName].total += dur;
      byPlant[r.plantName].n += 1;
    }
    const estimasiVsRealisasi = Object.values(byPlant).map((p) => ({
      plant: p.plant,
      estimasi: p.estimasi,
      realisasi: Math.round((p.total / p.n) * 10) / 10,
    }));

    // Keterisian: batch aktif / 18 pipa (3 meja x 6 pipa).
    const occupied = db
      .prepare('SELECT COUNT(*) AS n FROM PlantBatch WHERE archivedAt IS NULL')
      .get().n;

    res.json({
      harvestByMonth,
      harvestByPlant,
      estimasiVsRealisasi,
      occupancy: { occupied, total: 18, ratio: occupied / 18 },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/stats/nutrition -> tren ppm/pH + daftar batch pembacaan terakhir di luar target.
app.get('/api/stats/nutrition', (req, res) => {
  try {
    const batches = db
      .prepare(
        `SELECT b.*, c.name AS plantName
         FROM PlantBatch b JOIN PlantCatalog c ON c.id = b.plantId
         WHERE b.archivedAt IS NULL
         ORDER BY b.tableNumber, b.pipeNumber`
      )
      .all();

    const trend = [];
    const outOfRange = [];

    for (const batch of batches) {
      const readings = db
        .prepare(
          `SELECT * FROM BatchReading WHERE batchId = ?
           ORDER BY measuredAt ASC, id ASC LIMIT ?`
        )
        .all(batch.id, MAX_READINGS);

      if (readings.length === 0) continue;

      const phase = activePhase(batch);
      const recipe = db
        .prepare('SELECT * FROM PlantRecipe WHERE plantId = ? AND phase = ?')
        .get(batch.plantId, phase);

      trend.push({
        batchId: batch.id,
        plantName: batch.plantName,
        tableNumber: batch.tableNumber,
        pipeNumber: batch.pipeNumber,
        phase,
        readings: readings.map((r) => ({ measuredAt: r.measuredAt, ppm: r.ppm, ph: r.ph })),
      });

      const last = readings[readings.length - 1];
      const reasons = [];
      let level = 'ok';

      if (recipe) {
        if (
          recipe.ppmTarget !== null &&
          last.ppm !== null &&
          Math.abs(last.ppm - recipe.ppmTarget) > recipe.ppmTarget * PPM_TOLERANCE
        ) {
          level = 'danger';
          reasons.push(`ppm ${last.ppm} di luar ±10% dari target ${recipe.ppmTarget}`);
        }
        if (last.ph !== null && recipe.phMin !== null && recipe.phMax !== null) {
          if (last.ph < recipe.phMin || last.ph > recipe.phMax) {
            level = 'danger';
            reasons.push(`pH ${last.ph} di luar rentang ${recipe.phMin}-${recipe.phMax}`);
          }
        }
      }

      if (level !== 'ok') {
        outOfRange.push({
          batchId: batch.id,
          plantName: batch.plantName,
          tableNumber: batch.tableNumber,
          pipeNumber: batch.pipeNumber,
          phase,
          lastReading: last,
          reasons,
        });
      }
    }

    res.json({ trend, outOfRange });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Panel tangki (Fase 4)
// ---------------------------------------------------------------------------

// GET /api/tank -> resep tangki aktif + pembacaan sensor terakhir.
// Selalu 200; kegagalan sensor dikembalikan sebagai sensorError.
app.get('/api/tank', async (req, res) => {
  try {
    const recipe = getActiveTankRecipe();
    const { sensor, sensorError } = await getTankSensor();
    res.json({ recipe: recipe || null, sensor, sensorError });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/tank/recipe -> set/kosongkan resep tangki aktif: { recipeId }.
app.put('/api/tank/recipe', (req, res) => {
  try {
    const raw = req.body?.recipeId;
    if (raw === null || raw === undefined || raw === '') {
      setSetting(SETTING_ACTIVE_TANK_RECIPE, null);
      return res.json({ recipe: null });
    }

    const recipeId = Number(raw);
    if (!Number.isInteger(recipeId)) {
      return res.status(400).json({ error: 'recipeId harus bilangan bulat' });
    }

    const recipe = db
      .prepare(
        `SELECT r.*, c.name AS plantName
         FROM PlantRecipe r JOIN PlantCatalog c ON c.id = r.plantId
         WHERE r.id = ?`
      )
      .get(recipeId);
    if (!recipe) return res.status(404).json({ error: 'Resep tidak ditemukan' });

    setSetting(SETTING_ACTIVE_TANK_RECIPE, recipeId);
    res.json({ recipe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tank/dose -> hitung dosis dari resep tangki aktif.
app.post('/api/tank/dose', (req, res) => {
  try {
    const recipe = getActiveTankRecipe();
    if (!recipe) {
      return res.status(404).json({ error: 'Belum ada resep tangki aktif' });
    }

    const volumeAir = Number(req.body?.volumeAir);
    if (!Number.isFinite(volumeAir) || volumeAir <= 0) {
      return res.status(400).json({ error: 'volumeAir harus angka > 0' });
    }

    const ppmAirAwal =
      req.body?.ppmAirAwal === undefined || req.body?.ppmAirAwal === null || req.body?.ppmAirAwal === ''
        ? recipe.ppmAirDefault ?? 0
        : Number(req.body.ppmAirAwal);
    const targetPpm =
      req.body?.targetPpm === undefined || req.body?.targetPpm === null || req.body?.targetPpm === ''
        ? recipe.ppmTarget ?? 0
        : Number(req.body.targetPpm);

    if (!Number.isFinite(ppmAirAwal) || ppmAirAwal < 0) {
      return res.status(400).json({ error: 'ppmAirAwal harus angka >= 0' });
    }
    if (!Number.isFinite(targetPpm) || targetPpm < 0) {
      return res.status(400).json({ error: 'targetPpm harus angka >= 0' });
    }

    const { gramA, gramB } = computeDoseFromRecipe(recipe, { volumeAir, ppmAirAwal, targetPpm });
    res.json({
      gramA: Math.round(gramA * 100) / 100,
      gramB: Math.round(gramB * 100) / 100,
      targetPpm,
      ppmAirAwal,
      volumeAir,
      konstanta: recipe.konstanta,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tank/sensor -> data sensor saja (refresh ringan).
app.get('/api/tank/sensor', async (req, res) => {
  try {
    const { sensor, sensorError } = await getTankSensor();
    res.json({ sensor, sensorError, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Handler error multer/global terakhir.
app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
  next();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend hidroponik jalan di port ${PORT}`);
});
