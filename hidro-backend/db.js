const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Lokasi file DB, bisa dioverride lewat env (dipakai di Docker -> volume persisten).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'hidroponik.db');

// Pastikan folder DB ada sebelum membuka koneksi.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ambil daftar nama kolom tabel (untuk migrasi aditif).
function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// Tambah kolom bila belum ada (migrasi aditif Fase 1 -> Fase 2, data lama aman).
function addColumnIfMissing(table, column, definition) {
  if (!columnNames(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migrasi: tambah kolom ${table}.${column}`);
  }
}

// Inisialisasi skema inti (idempotent).
db.exec(`
  CREATE TABLE IF NOT EXISTS PlantCatalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    seedlingDays INTEGER NOT NULL,
    growDays INTEGER NOT NULL,
    totalDays INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS PlantBatch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tableNumber INTEGER NOT NULL CHECK (tableNumber IN (1,2)),
    pipeNumber INTEGER NOT NULL CHECK (pipeNumber BETWEEN 1 AND 6),
    plantId INTEGER NOT NULL REFERENCES PlantCatalog(id),
    sowDate TEXT NOT NULL,
    transferDate TEXT NOT NULL,
    harvestDate TEXT NOT NULL,
    status TEXT NOT NULL
  );
`);

// Migrasi aditif kolom Fase 2.
addColumnIfMissing('PlantBatch', 'notes', 'TEXT');
addColumnIfMissing('PlantBatch', 'harvestedAt', 'TEXT');
addColumnIfMissing('PlantBatch', 'archivedAt', 'TEXT');
addColumnIfMissing('PlantBatch', 'harvestWeightGram', 'INTEGER');

// Tabel gambar batch (Fase 2).
db.exec(`
  CREATE TABLE IF NOT EXISTS BatchImage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batchId INTEGER NOT NULL REFERENCES PlantBatch(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_batch_plant ON PlantBatch(plantId);
  CREATE INDEX IF NOT EXISTS idx_batch_archived ON PlantBatch(archivedAt);
  CREATE INDEX IF NOT EXISTS idx_image_batch ON BatchImage(batchId);
`);

// Ganti unique index lama (semua baris) dengan partial index (hanya batch aktif).
// Tanpa ini, tanam ulang setelah panen akan bentrok karena baris arsip masih ada.
db.exec('DROP INDEX IF EXISTS idx_pipe_unique');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pipe_active
    ON PlantBatch(tableNumber, pipeNumber) WHERE archivedAt IS NULL;
`);

// Seed katalog hanya bila masih kosong.
const catalogCount = db.prepare('SELECT COUNT(*) AS n FROM PlantCatalog').get().n;
if (catalogCount === 0) {
  const insert = db.prepare(
    'INSERT INTO PlantCatalog (name, seedlingDays, growDays, totalDays) VALUES (?, ?, ?, ?)'
  );
  const seed = db.transaction(() => {
    insert.run('Selada', 14, 25, 39);
    insert.run('Pakcoy', 10, 20, 30);
    insert.run('Sawi Caisim', 10, 20, 30);
    insert.run('Kangkung', 7, 18, 25);
  });
  seed();
  console.log('Seed katalog tanaman selesai (4 tanaman).');
}

// Perbaiki typo nama 'Pakcok' -> 'Pakcoy' pada DB lama (agar seed resep cocok).
// Hanya jalan bila belum ada baris 'Pakcoy' (nama UNIQUE), agar tidak bentrok.
const pakcoyExists = db.prepare("SELECT 1 FROM PlantCatalog WHERE name = 'Pakcoy'").get();
const pakcok = db.prepare("SELECT id FROM PlantCatalog WHERE name = 'Pakcok'").get();
if (pakcok && !pakcoyExists) {
  db.prepare("UPDATE PlantCatalog SET name = 'Pakcoy' WHERE id = ?").run(pakcok.id);
  console.log("Migrasi: rename katalog 'Pakcok' -> 'Pakcoy'.");
}

// Tabel RCP: resep nutrisi per tanaman per fase (Fase 3).
db.exec(`
  CREATE TABLE IF NOT EXISTS PlantRecipe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plantId INTEGER NOT NULL REFERENCES PlantCatalog(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('Semai','Pembesaran')),
    ppmTarget INTEGER,
    phMin REAL,
    phMax REAL,
    gramPerLiterA REAL,
    gramPerLiterB REAL,
    konstanta REAL,
    ppmAirDefault INTEGER,
    catatan TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_plant_phase
    ON PlantRecipe(plantId, phase);
`);

// Migrasi aditif Fase 5: volume tangki (liter) untuk perhitungan durasi pompa AB Mix.
// Default NULL -> user wajib mengisi; workflow n8n melewati dosing bila NULL.
addColumnIfMissing('PlantRecipe', 'volumeTangki', 'REAL');

// Tabel pengukuran nutrisi per batch (Fase 3).
db.exec(`
  CREATE TABLE IF NOT EXISTS BatchReading (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batchId INTEGER NOT NULL REFERENCES PlantBatch(id) ON DELETE CASCADE,
    ppm INTEGER,
    ph REAL,
    catatan TEXT,
    measuredAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reading_batch ON BatchReading(batchId);
`);

// Tabel pengaturan generik key/value (Fase 4: panel tangki).
db.exec(`
  CREATE TABLE IF NOT EXISTS AppSetting (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Tebakan awal per tanaman; K = konstanta (ppm per gram/L), air = ppm air baku.
const RECIPE_SEEDS = {
  Selada: {
    Semai: [560, 5.8, 6.2, 1.5, 1.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
    Pembesaran: [840, 5.5, 6.5, 2.5, 2.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
  },
  Pakcoy: {
    Semai: [560, 5.8, 6.2, 1.5, 1.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
    Pembesaran: [840, 5.5, 6.5, 2.5, 2.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
  },
  'Sawi Caisim': {
    Semai: [560, 5.8, 6.2, 1.5, 1.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
    Pembesaran: [840, 5.5, 6.5, 2.5, 2.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
  },
  Kangkung: {
    Semai: [560, 5.8, 6.5, 1.5, 1.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
    Pembesaran: [700, 5.5, 6.5, 2.5, 2.5, 160, 0, 'Tebakan awal, sesuaikan dengan pupuk Anda.'],
  },
};

// Seed resep yang belum ada (per tanaman x fase). Idempotent:
// memperbaiki DB lama yang kehilangan resep (mis. bug nama 'Pakcok' -> 'Pakcoy').
// Tidak menimpa resep yang sudah diisi user.
{
  const plants = db.prepare('SELECT id, name FROM PlantCatalog').all();
  const byName = Object.fromEntries(plants.map((p) => [p.name, p.id]));
  const exists = db.prepare('SELECT 1 FROM PlantRecipe WHERE plantId = ? AND phase = ?');
  const insert = db.prepare(
    `INSERT INTO PlantRecipe
       (plantId, phase, ppmTarget, phMin, phMax, gramPerLiterA, gramPerLiterB,
        konstanta, ppmAirDefault, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let seeded = 0;
  const seedRecipes = db.transaction(() => {
    for (const [name, phases] of Object.entries(RECIPE_SEEDS)) {
      const plantId = byName[name];
      if (!plantId) continue;
      for (const phase of ['Semai', 'Pembesaran']) {
        if (exists.get(plantId, phase)) continue;
        const [ppm, phMin, phMax, gA, gB, k, air, catatan] = phases[phase];
        insert.run(plantId, phase, ppm, phMin, phMax, gA, gB, k, air, catatan);
        seeded += 1;
      }
    }
  });
  seedRecipes();
  if (seeded > 0) console.log(`Seed resep nutrisi (RCP): ${seeded} baris ditambahkan.`);
}

console.log(`SQLite siap di ${DB_PATH}`);

module.exports = db;
