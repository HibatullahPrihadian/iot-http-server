// Self-check: migrasi CHECK tableNumber + perbaikan FK anak (BatchImage/BatchReading).
// Jalankan: node db.fkcheck.js   (hapus file .db sementara setelahnya)
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DB = path.join('/tmp', `hidro-fkcheck-${Date.now()}.db`);

function fresh() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(DB + suffix, { force: true }); } catch {}
  }
}

// Bangun DB versi skema lama (CHECK 1,2) + anak yang menunjuk PlantBatch.
function makeOld() {
  fresh();
  const d = new Database(DB);
  d.pragma('foreign_keys = ON');
  d.exec(`
    CREATE TABLE PlantCatalog (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, seedlingDays INTEGER NOT NULL, growDays INTEGER NOT NULL, totalDays INTEGER NOT NULL);
    CREATE TABLE PlantBatch (id INTEGER PRIMARY KEY AUTOINCREMENT, tableNumber INTEGER NOT NULL CHECK (tableNumber IN (1,2)), pipeNumber INTEGER NOT NULL CHECK (pipeNumber BETWEEN 1 AND 6), plantId INTEGER NOT NULL REFERENCES PlantCatalog(id), sowDate TEXT NOT NULL, transferDate TEXT NOT NULL, harvestDate TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, harvestedAt TEXT, archivedAt TEXT, harvestWeightGram INTEGER);
    CREATE TABLE BatchImage (id INTEGER PRIMARY KEY AUTOINCREMENT, batchId INTEGER NOT NULL REFERENCES PlantBatch(id) ON DELETE CASCADE, filename TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE BatchReading (id INTEGER PRIMARY KEY AUTOINCREMENT, batchId INTEGER NOT NULL REFERENCES PlantBatch(id) ON DELETE CASCADE, ppm INTEGER, ph REAL, catatan TEXT, measuredAt TEXT NOT NULL);
    INSERT INTO PlantCatalog (name, seedlingDays, growDays, totalDays) VALUES ('Selada', 14, 25, 39);
    INSERT INTO PlantBatch (tableNumber, pipeNumber, plantId, sowDate, transferDate, harvestDate, status) VALUES (1, 1, 1, '2026-09-01', '2026-09-15', '2026-10-10', 'Pembesaran');
    INSERT INTO BatchImage (batchId, filename, createdAt) VALUES (1, 'x.jpg', '2026-09-01T00:00:00Z');
    INSERT INTO BatchReading (batchId, ppm, ph, measuredAt) VALUES (1, 600, 6.0, '2026-09-02T00:00:00Z');
  `);
  d.close();
}

// Simulasi migrasi versi LAMA yang menulis ulang FK anak ke PlantBatch_old lalu drop.
function breakLikeOldMigration() {
  const d = new Database(DB);
  d.pragma('foreign_keys = ON');
  d.pragma('legacy_alter_table = OFF');
  d.exec('ALTER TABLE PlantBatch RENAME TO PlantBatch_old');
  d.exec(`CREATE TABLE PlantBatch (id INTEGER PRIMARY KEY AUTOINCREMENT, tableNumber INTEGER NOT NULL CHECK (tableNumber IN (1,2,3)), pipeNumber INTEGER NOT NULL CHECK (pipeNumber BETWEEN 1 AND 6), plantId INTEGER NOT NULL REFERENCES PlantCatalog(id), sowDate TEXT NOT NULL, transferDate TEXT NOT NULL, harvestDate TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, harvestedAt TEXT, archivedAt TEXT, harvestWeightGram INTEGER);`);
  d.exec('INSERT INTO PlantBatch (id, tableNumber, pipeNumber, plantId, sowDate, transferDate, harvestDate, status, notes, harvestedAt, archivedAt, harvestWeightGram) SELECT id, tableNumber, pipeNumber, plantId, sowDate, transferDate, harvestDate, status, notes, harvestedAt, archivedAt, harvestWeightGram FROM PlantBatch_old');
  d.exec('DROP TABLE PlantBatch_old');
  d.close();
}

function snapshot() {
  const d = new Database(DB);
  const sql = (n) => d.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(n).sql;
  const out = {
    batchFkImage: /REFERENCES\s+"?PlantBatch_old"?/.test(sql('BatchImage')),
    batchFkReading: /REFERENCES\s+"?PlantBatch_old"?/.test(sql('BatchReading')),
    batches: d.prepare('SELECT COUNT(*) n FROM PlantBatch').get().n,
    images: d.prepare('SELECT COUNT(*) n FROM BatchImage').get().n,
    readings: d.prepare('SELECT COUNT(*) n FROM BatchReading').get().n,
    checkOk: sql('PlantBatch').includes('IN (1,2,3)'),
  };
  d.close();
  return out;
}

// ---------- Skenario 1: DB baru ----------
makeOld();
process.env.DB_PATH = DB;
// muat db.js (menjalankan migrasi) dengan cache bersih
delete require.cache[require.resolve('./db.js')];
require('./db.js').close();
let s = snapshot();
assert.ok(s.checkOk, 'CHECK harus 1,2,3');
assert.ok(!s.batchFkImage && !s.batchFkReading, 'FK anak harus menunjuk PlantBatch');
assert.strictEqual(s.batches, 1, 'batch lama harus utuh');
assert.strictEqual(s.images, 1, 'image lama harus utuh (tidak ter-cascade saat migrasi)');
assert.strictEqual(s.readings, 1, 'reading lama harus utuh');
console.log('SKENARIO 1 (DB lama -> migrasi bersih): LULUS');

// ---------- Skenario 2: DB sudah rusak (versi lama yang menggantung) ----------
// Catatan: skenario ini mereplay bug lama yang SUDAH men-cascade baris anak
// (BatchImage/BatchReading) saat DROP PlantBatch_old. Baris itu memang hilang
// sebelum perbaikan; yang diuji di sini adalah pemulihan SKEMA FK + delete.
makeOld();
breakLikeOldMigration();
s = snapshot();
assert.ok(s.batchFkImage && s.batchFkReading, 'prasyarat: FK harus menggantung dulu');
delete require.cache[require.resolve('./db.js')];
require('./db.js').close();
s = snapshot();
assert.ok(!s.batchFkImage && !s.batchFkReading, 'perbaikan harus mengembalikan FK ke PlantBatch');
assert.strictEqual(s.batches, 1, 'batch harus utuh setelah perbaikan');
assert.ok(s.checkOk, 'CHECK harus 1,2,3');

// DELETE dengan cascade harus jalan tanpa error.
{
  const d = new Database(DB);
  d.pragma('foreign_keys = ON');
  d.prepare('DELETE FROM PlantBatch WHERE id = 1').run();
  assert.strictEqual(d.prepare('SELECT COUNT(*) n FROM PlantBatch').get().n, 0);
  assert.deepStrictEqual(d.pragma('foreign_key_check'), [], 'tidak ada FK rusak');
  d.close();
}
console.log('SKENARIO 2 (DB rusak -> perbaikan FK + delete cascade): LULUS');

fresh();
console.log('SEMUA LULUS');
