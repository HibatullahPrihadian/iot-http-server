const express = require('express');
const cors = require('cors');
const { InfluxDB } = require('@influxdata/influxdb-client');

const app = express();
const port = 3000;

// --- KONFIGURASI INFLUXDB ---
// Token dibaca dari env (wajib diisi lewat .env / docker-compose).
const token = process.env.INFLUXDB_TOKEN || '';
const url = process.env.INFLUXDB_URL || 'http://influxdb:8086';
const client = new InfluxDB({ url, token });
const org = 'hidroponik';
const bucket = 'sensor_data';

// --- TOKEN PERANGKAT (X-Device-Token) ---
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';

// --- ANTREAN PERINTAH (IN-MEMORY) ---
// Single instance. Antrean hilang saat container restart (perintah yang belum di-ACK).
const MAX_QUEUE = 100;
let nextCommandId = 1;
const commandQueue = [];

// --- STATE RELAY (IN-MEMORY) ---
// Status relay terkini yang dilaporkan perangkat. Ini BUKAN data time-series,
// jadi tidak ditulis ke InfluxDB; perangkat melaporkannya lewat endpoint
// terpisah agar tidak memicu uplink sensor penuh.
let relayState = null; // { relay_1: 'ON'|'OFF', ... } atau null bila belum pernah dilaporkan

function normalizeRelayStatus(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value.toUpperCase() === 'ON' ? 'ON' : 'OFF';
    return Number(value) === 1 ? 'ON' : 'OFF';
}

function enqueue(command) {
    const entry = { id: nextCommandId++, createdAt: new Date().toISOString(), ...command };
    commandQueue.push(entry);
    // Buang perintah terlama bila antrean penuh, agar tidak tumbuh tanpa batas.
    while (commandQueue.length > MAX_QUEUE) commandQueue.shift();
    console.log(`[QUEUE] #${entry.id} ${entry.type} ditambahkan (pending: ${commandQueue.length})`);
    return entry;
}

// Angka finite > 0 (tolak 0, negatif, NaN, string non-numerik).
function isPositiveNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Middleware autentikasi perangkat: header X-Device-Token harus cocok dengan DEVICE_TOKEN.
function deviceAuth(req, res, next) {
    if (!DEVICE_TOKEN) {
        return res.status(503).json({ success: false, message: 'DEVICE_TOKEN belum dikonfigurasi di server.' });
    }
    if (req.get('X-Device-Token') !== DEVICE_TOKEN) {
        return res.status(401).json({ success: false, message: 'Token perangkat tidak valid.' });
    }
    next();
}

// --- ROUTES (API ENDPOINT) ---
// 1. Route Default (Cek Status Server)
app.get('/', (req, res) => {
    res.json({ message: "Server API Hidroponik Aktif!" });
});

// 2. Route untuk Mengambil History Data Sensor (untuk Grafik & Realtime)
app.get('/api/sensor-data', async (req, res) => {
    const queryApi = client.getQueryApi(org);
    const filter = req.query.filter || 'realtime';
    
    let rangeQuery = '-6h';
    let aggregateQuery = ''; // Menampung query agregasi/downsampling
    // Batasi 40 titik TERAKHIR per _field. Harus SEBELUM pivot: sesudah pivot
    // _field sudah lebur jadi kolom, jadi tail/limit tak bisa grup per field
    // (itu penyebab bug realtime kosong sebelumnya).
    // Urutan akhir dikembalikan ASC (naik) agar konsisten dengan kontrak lama:
    // UI mengambil titik terbaru di data[data.length-1].
    let tailPerFieldQuery = `
        |> sort(columns: ["_time"], desc: true)
        |> group(columns: ["_field"])
        |> limit(n: 40)
        |> group()
        |> sort(columns: ["_time"], desc: false)`;

    // Konfigurasi dinamis rentang waktu dan downsampling.
    if (filter === '12hour') { 
        rangeQuery = '-12h';
        aggregateQuery = '|> aggregateWindow(every: 5m, fn: mean, createEmpty: false)';
    } else if (filter === '1day') {
        rangeQuery = '-24h';
        aggregateQuery = '|> aggregateWindow(every: 15m, fn: mean, createEmpty: false)';
    } else if (filter === '1week') {
        rangeQuery = '-7d';
        aggregateQuery = '|> aggregateWindow(every: 1h, fn: mean, createEmpty: false)';
    } else if (filter === '2week') {
        rangeQuery = '-14d';
        aggregateQuery = '|> aggregateWindow(every: 2h, fn: mean, createEmpty: false)';
    } else if (filter === '1month') {
        rangeQuery = '-30d';
        aggregateQuery = '|> aggregateWindow(every: 6h, fn: mean, createEmpty: false)';
    } else if (filter === '3month') {
        rangeQuery = '-90d';
        aggregateQuery = '|> aggregateWindow(every: 12h, fn: mean, createEmpty: false)';
    } else if (filter === '6month') {
        rangeQuery = '-180d';
        aggregateQuery = '|> aggregateWindow(every: 24h, fn: mean, createEmpty: false)';
    }

    // Agregasi (jika ada) dijalankan sebelum pivot.
    const fluxQuery = `
      from(bucket: "${bucket}")
        |> range(start: ${rangeQuery})
        |> filter(fn: (r) => r["_measurement"] == "hidroponik_sensor")
        ${aggregateQuery}
        ${tailPerFieldQuery}
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    `;
    
    let dataSensor = [];
    try {
        await new Promise((resolve, reject) => {
            // FUNGSI BANTUAN UNTUK MEMBULATKAN DESIMAL
            const bulatkan = (nilai, jumlahDesimal) => {
                if (nilai === null || nilai === undefined) return null;
                return Number(Number(nilai).toFixed(jumlahDesimal));
            };

            queryApi.queryRows(fluxQuery, {
                next(row, tableMeta) {
                    const obj = tableMeta.toObject(row);
                    
                    if (obj.suhu_udara > 0 || obj.kelembapan_udara > 0 || obj.kadar_tds > 0 || obj.suhu_air > 0) {
                        dataSensor.push({
                            waktu: obj._time,
                            // Atur jumlah desimal sesuai kebutuhan sensor
                            suhu_udara: bulatkan(obj.suhu_udara, 1),         // 1 desimal (contoh: 27.9)
                            kelembapan_udara: bulatkan(obj.kelembapan_udara, 1), // 1 desimal (contoh: 66.6)
                            kadar_tds: bulatkan(obj.kadar_tds, 0),           // Tanpa desimal (contoh: 1046)
                            kadar_ph: bulatkan(obj.kadar_ph, 2),             // 2 desimal (contoh: 6.50)
                            intensitas_uv: bulatkan(obj.intensitas_uv, 0),   // Tanpa desimal
                            suhu_air: bulatkan(obj.suhu_air, 1)              // 1 desimal (contoh: 26.6)
                        });
                    }
                },
                error(error) { reject(error); },
                complete() { resolve(); },
            });
        });
        res.json({ success: true, count: dataSensor.length, data: dataSensor });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Route untuk Kontrol Pompa AB Mix (enqueue perintah HTTP polling)
app.post('/api/pompa/kontrol', (req, res) => {
    try {
        const { durasi } = req.body;

        if (!isPositiveNumber(durasi)) {
            return res.status(400).json({ success: false, message: "durasi harus angka > 0!" });
        }

        enqueue({ type: 'pompa', durasi: Number(durasi) });
        res.json({
            success: true,
            message: `Perintah diteruskan untuk Pompa AB Mix (${durasi} detik)`
        });
    } catch (error) {
        console.error("Error Kontrol Pompa:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal server." });
    }
});

// 4. Route untuk Kontrol Interval Pengiriman (enqueue perintah HTTP polling)
app.post('/api/interval/kontrol', (req, res) => {
    try {
        const { intervalDetik } = req.body;

        if (!isPositiveNumber(intervalDetik)) {
            return res.status(400).json({ success: false, message: "intervalDetik harus angka > 0!" });
        }

        enqueue({ type: 'interval', intervalDetik: Number(intervalDetik) });
        res.json({
            success: true,
            message: `Perintah diteruskan untuk ubah interval ke ${intervalDetik} detik`
        });
    } catch (error) {
        console.error("Error Kontrol Interval:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal server." });
    }
});

// 5. Route untuk Konfigurasi Dosing Otomatis (enqueue perintah HTTP polling)
app.post('/api/autodosing/kontrol', (req, res) => {
    try {
        const { targetTds, volumeAir, konstantaPupuk } = req.body;

        if (!isPositiveNumber(targetTds) || !isPositiveNumber(volumeAir) || !isPositiveNumber(konstantaPupuk)) {
            return res.status(400).json({ success: false, message: "Semua parameter harus angka > 0!" });
        }

        enqueue({
            type: 'autodosing',
            targetTds: Number(targetTds),
            volumeAir: Number(volumeAir),
            konstantaPupuk: Number(konstantaPupuk)
        });
        res.json({
            success: true,
            message: "Konfigurasi otomatisasi berhasil masuk antrean."
        });
    } catch (error) {
        console.error("Error Kontrol Auto Dosing:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal server." });
    }
});

// 6. Route untuk Kontrol Relay (enqueue perintah HTTP polling)
app.post('/api/relay/kontrol', (req, res) => {
    try {
        const { idRelay, status } = req.body;

        if (!idRelay || !status) {
            return res.status(400).json({ success: false, message: "Parameter tidak lengkap!" });
        }

        const relayId = Number(idRelay);
        if (![1, 2, 3, 4].includes(relayId)) {
            return res.status(400).json({ success: false, message: "idRelay harus 1-4!" });
        }
        if (status !== 'ON' && status !== 'OFF') {
            return res.status(400).json({ success: false, message: "status harus 'ON' atau 'OFF'!" });
        }

        enqueue({ type: 'relay', idRelay: relayId, status });
        res.json({ success: true, message: `Relay ${idRelay} berhasil diubah menjadi ${status}` });
    } catch (error) {
        console.error("Error Kontrol Relay:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal server." });
    }
});

// 7. Route untuk Mengambil Status Relay Terkini
// Utamakan state in-memory yang dilaporkan perangkat (endpoint 10). Bila belum
// pernah dilaporkan, fallback ke InfluxDB agar kompatibel dengan data lama.
app.get('/api/relay/status', async (req, res) => {
    if (relayState) {
        return res.json({ success: true, data: relayState, source: 'device' });
    }

    const queryApi = client.getQueryApi(org);
    
    const fluxQuery = `
      from(bucket: "${bucket}")
        |> range(start: -1d)
        |> filter(fn: (r) => r["_measurement"] == "hidroponik_sensor")
        |> last()
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    `;
    
    try {
        let statusRelay = { relay_1: "OFF", relay_2: "OFF", relay_3: "OFF", relay_4: "OFF" };
        
        await new Promise((resolve, reject) => {
            queryApi.queryRows(fluxQuery, {
                next(row, tableMeta) {
                    const obj = tableMeta.toObject(row);
                    
                    // Jika data ada di database, ubah angka 1 menjadi ON, dan 0 menjadi OFF.
                    // Nilai Flux datang sebagai string ("1"/"0"), jadi pakai normalizeRelayStatus.
                    if (obj.relay_1 !== undefined) statusRelay.relay_1 = normalizeRelayStatus(obj.relay_1);
                    if (obj.relay_2 !== undefined) statusRelay.relay_2 = normalizeRelayStatus(obj.relay_2);
                    if (obj.relay_3 !== undefined) statusRelay.relay_3 = normalizeRelayStatus(obj.relay_3);
                    if (obj.relay_4 !== undefined) statusRelay.relay_4 = normalizeRelayStatus(obj.relay_4);
                },
                error(error) { reject(error); },
                complete() { resolve(); },
            });
        });
        res.json({ success: true, data: statusRelay });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8. Route Perangkat: ambil perintah pending (polling ESP32, wajib X-Device-Token)
app.get('/api/device/commands', deviceAuth, (req, res) => {
    res.json({ success: true, commands: commandQueue });
});

// 9. Route Perangkat: ACK perintah -> hapus dari antrean (wajib X-Device-Token)
app.post('/api/device/commands/:id/ack', deviceAuth, (req, res) => {
    const id = Number(req.params.id);
    const index = commandQueue.findIndex((c) => c.id === id);

    if (index === -1) {
        return res.status(404).json({ success: false, message: `Perintah #${id} tidak ditemukan.` });
    }

    const [removed] = commandQueue.splice(index, 1);
    console.log(`[QUEUE] #${removed.id} ${removed.type} di-ACK (pending: ${commandQueue.length})`);
    res.json({ success: true, message: `Perintah #${id} dihapus.`, id });
});

// 10. Route Perangkat: lapor status relay (payload kecil, TIDAK menulis sensor).
// Dipakai setelah relay diubah agar UI cepat sinkron tanpa memicu uplink sensor.
app.post('/api/device/relay-status', deviceAuth, (req, res) => {
    const body = req.body || {};
    const next = { ...(relayState || { relay_1: 'OFF', relay_2: 'OFF', relay_3: 'OFF', relay_4: 'OFF' }) };

    let changed = false;
    for (const key of ['relay_1', 'relay_2', 'relay_3', 'relay_4']) {
        const val = normalizeRelayStatus(body[key]);
        if (val !== undefined) {
            next[key] = val;
            changed = true;
        }
    }

    if (!changed) {
        return res.status(400).json({ success: false, message: 'Tidak ada status relay valid.' });
    }

    relayState = next;
    console.log(`[RELAY] Status diperbarui dari perangkat: ${JSON.stringify(relayState)}`);
    res.json({ success: true, data: relayState });
});

// --- JALANKAN SERVER ---
app.listen(port, '0.0.0.0', () => {
    console.log(`Backend API berjalan di http://0.0.0.0:${port}`);
    console.log(DEVICE_TOKEN ? '✅ DEVICE_TOKEN terkonfigurasi.' : '⚠️  DEVICE_TOKEN kosong — endpoint perangkat mengembalikan 503.');
});
