const express = require('express');
const cors = require('cors');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

// Versi aplikasi (dari package.json service ini; sinkron dengan /VERSION root).
const APP_VERSION = require('./package.json').version;

const app = express();
const port = 3000;

// --- KONFIGURASI INFLUXDB ---
// Token dibaca dari env (wajib diisi lewat .env / docker-compose).
const token = process.env.INFLUXDB_TOKEN || '';
const url = process.env.INFLUXDB_URL || 'http://influxdb:8086';
const client = new InfluxDB({ url, token });
const org = 'hidroponik';
const bucket = 'sensor_data';
const measurement = 'hidroponik_sensor';

// --- FIELD PER DOMAIN ---
// PZEM-004T (listrik) mengirim ~1 Hz -> satu field listrik punya ~21.000 titik
// per 6 jam, sedangkan sensor hidroponik hanya ~1 titik/menit (~300 titik/6 jam).
// Query lama memakai `_field != "energi"` sehingga dashboard hidroponik ikut
// memindai seluruh field listrik (ratusan ribu baris) -> respons 1-8 detik dan
// InfluxDB kehabisan CPU. Sekarang tiap domain hanya memindai field yang dipakai.
const HYDRO_FIELDS = ['suhu_udara', 'kelembapan_udara', 'kadar_tds', 'kadar_ph', 'intensitas_uv', 'suhu_air'];
const LISTRIK_FIELDS = ['tegangan', 'arus', 'daya', 'energi', 'frekuensi', 'power_factor'];

// Filter Flux: r["_field"] == "a" or r["_field"] == "b" ...
function fluxFieldFilter(fields) {
    return fields.map((f) => `r["_field"] == "${f}"`).join(' or ');
}

// --- CACHE ---
// Cache respons singkat + single-flight: beberapa tab/HP membuka dashboard yang
// sama, jadi query InfluxDB yang mahal tidak perlu dijalankan tiap poll dan
// permintaan identik tidak menumpuk saat server lambat.
const SENSOR_CACHE_TTL_MS = Number(process.env.SENSOR_CACHE_TTL_MS) || 2500;
const SENSOR_CACHE_TTL_HISTORY_MS = Number(process.env.SENSOR_CACHE_TTL_HISTORY_MS) || 30000;
const ENERGY_CACHE_TTL_MS = Number(process.env.ENERGY_CACHE_TTL_MS) || 60000;
const sensorCache = new Map();     // key -> { at, payload }
const sensorInflight = new Map();  // key -> Promise<payload>
const energyCache = new Map();     // rangeQuery -> { at, value }

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

// Angka finite (boleh 0). Dipakai field listrik (arus/energi bisa 0).
function isFiniteNumber(v) {
    if (v === null || v === undefined || v === '') return false;
    return Number.isFinite(Number(v));
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

// Helper: hitung pemakaian energi PZEM (kWh) pada rentang filter, dari data MENTAH
// (tanpa downsampling/limit chart). Memakai difference(nonNegative:true) |> sum()
// sehingga kenaikan terjumlah dan reset (nilai turun) diabaikan -> reset-safe.
// Mengembalikan { period, from, to } atau { period: null } bila data < 2 titik.
//
// Hasil di-cache: angka kWh kumulatif berubah lambat, sedangkan query ini
// memindai seluruh titik `energi` (~1 Hz) pada rentang yang diminta. Tanpa cache,
// dashboard Listrik yang polling tiap detik menembak InfluxDB terus-menerus.
async function hitungEnergiPeriode(rangeQuery) {
    const cached = energyCache.get(rangeQuery);
    if (cached && Date.now() - cached.at < ENERGY_CACHE_TTL_MS) {
        return cached.value;
    }

    const queryApi = client.getQueryApi(org);
    const base = `
        from(bucket: "${bucket}")
          |> range(start: ${rangeQuery})
          |> filter(fn: (r) => r["_measurement"] == "hidroponik_sensor")
          |> filter(fn: (r) => r["_field"] == "energi")
          |> filter(fn: (r) => exists r._value)
          |> keep(columns: ["_time", "_value"])
          |> sort(columns: ["_time"])`;

    // Total kenaikan (reset-safe) + titik pertama/terakhir dalam satu query.
    const energyQuery = `
        union(tables: [
          ${base} |> difference(nonNegative: true) |> sum() |> map(fn: (r) => ({ _time: r._time, _kind: "total", _value: r._value })),
          ${base} |> first() |> map(fn: (r) => ({ _time: r._time, _kind: "first", _value: r._value })),
          ${base} |> last()  |> map(fn: (r) => ({ _time: r._time, _kind: "last",  _value: r._value }))
        ])`;

    return await new Promise((resolve) => {
        let total = null;
        let first = null;
        let last = null;
        let count = 0;
        queryApi.queryRows(energyQuery, {
            next(row, tableMeta) {
                const obj = tableMeta.toObject(row);
                count++;
                if (obj._kind === 'total') total = obj._value;
                else if (obj._kind === 'first') first = obj._time;
                else if (obj._kind === 'last') last = obj._time;
            },
            error() {
                // Jangan gagalkan seluruh respons; energi cukup null.
                const value = { period: null, from: null, to: null };
                energyCache.set(rangeQuery, { at: Date.now(), value });
                resolve(value);
            },
            complete() {
                const value = total === null || count < 3
                    ? { period: null, from: first, to: last }
                    : { period: total, from: first, to: last };
                energyCache.set(rangeQuery, { at: Date.now(), value });
                resolve(value);
            },
        });
    });
}

// --- ROUTES (API ENDPOINT) ---
// 1. Route Default (Cek Status Server)
app.get('/', (req, res) => {
    res.json({ message: "Server API Hidroponik Aktif!", version: APP_VERSION });
});

// 1b. Versi aplikasi (untuk indikator versi di UI).
app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION, service: 'iot-api' });
});

// Bangun payload /api/sensor-data. Dipisah dari handler supaya bisa dipakai
// bersama oleh cache single-flight di bawah.
//
// Rentang & field dipilih per domain:
// - realtime hanya butuh titik TERBARU, jadi tidak perlu memindai 6 jam data.
// - tiap domain hanya memindai field miliknya (HYDRO_FIELDS/LISTRIK_FIELDS).
async function bangunDataSensor(filter, includeListrik) {
    const queryApi = client.getQueryApi(org);
    
    // Jendela data chart. `realtime` hanya perlu titik terbaru:
    // - listrik ~1 Hz   -> 120 titik = 2 menit, jendela -10m (ada margin)
    // - hidroponik ~1/m -> 40 titik = 40 menit, jendela -2h
    // Filter riwayat memakai jendela sesuai namanya.
    // `energyRange` dipisah agar kartu "pemakaian periode" pada filter realtime
    // tetap menghitung 6 jam terakhir seperti sebelumnya.
    let rangeQuery = includeListrik ? '-10m' : '-2h';
    let energyRange = '-6h';
    let windowEvery = '';
    // Batasi titik TERAKHIR per _field. Harus SEBELUM pivot: sesudah pivot
    // _field sudah lebur jadi kolom, jadi tail tak bisa grup per field.
    // Listrik dikirim ~1Hz -> 120 titik (~2 menit); hidroponik 40 titik.
    let tailLimit = includeListrik ? 120 : 40;

    // Konfigurasi dinamis rentang waktu dan downsampling.
    // `energi` bersifat kumulatif, jadi TIDAK boleh dirata-rata (mean akan
    // merusak nilai kWh dan differensinya). Field lain di-downsample dengan mean.
    if (filter === '1hour') {
        rangeQuery = '-1h';
        energyRange = '-1h';
        windowEvery = '1m';
        tailLimit = 240;
    } else if (filter === '3hour') {
        rangeQuery = '-3h';
        energyRange = '-3h';
        windowEvery = '3m';
        tailLimit = 240;
    } else if (filter === '6hour') {
        rangeQuery = '-6h';
        energyRange = '-6h';
        windowEvery = '6m';
        tailLimit = 240;
    } else if (filter === '12hour') {
        rangeQuery = '-12h';
        energyRange = '-12h';
        windowEvery = '5m';
    } else if (filter === '1day') {
        rangeQuery = '-24h';
        energyRange = '-24h';
        windowEvery = '15m';
    } else if (filter === '1week') {
        rangeQuery = '-7d';
        energyRange = '-7d';
        windowEvery = '1h';
    } else if (filter === '2week') {
        rangeQuery = '-14d';
        energyRange = '-14d';
        windowEvery = '2h';
    } else if (filter === '1month') {
        rangeQuery = '-30d';
        energyRange = '-30d';
        windowEvery = '6h';
    } else if (filter === '3month') {
        rangeQuery = '-90d';
        energyRange = '-90d';
        windowEvery = '12h';
    } else if (filter === '6month') {
        rangeQuery = '-180d';
        energyRange = '-180d';
        windowEvery = '24h';
    }

    const meanAgg = windowEvery ? `|> aggregateWindow(every: ${windowEvery}, fn: mean, createEmpty: false)` : '';
    const lastAgg = windowEvery ? `|> aggregateWindow(every: ${windowEvery}, fn: last, createEmpty: false)` : '';

    // Hanya field milik domain ini yang dipindai (bukan seluruh measurement).
    const fields = includeListrik ? LISTRIK_FIELDS : HYDRO_FIELDS;
    const fieldFilter = fluxFieldFilter(fields);

    // group + tail(n) mengambil n titik TERAKHIR per field tanpa mengurutkan
    // seluruh hasil (sort global inilah yang mahal pada data 1 Hz).
    // Urutan akhir ASC agar kontrak lama tetap: UI memakai data[data.length-1].
    const tailPerFieldQuery = `
        |> group(columns: ["_field"])
        |> tail(n: ${tailLimit})
        |> group()
        |> sort(columns: ["_time"], desc: false)`;

    const pivotQuery = `
        ${tailPerFieldQuery}
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")`;

    // Realtime (tanpa downsampling) cukup satu aliran.
    // Riwayat domain listrik butuh union: `energi` memakai aggregateWindow(last)
    // agar nilai kumulatif utuh, field lain aggregateWindow(mean).
    let fluxQuery;
    if (!windowEvery) {
        fluxQuery = `
        from(bucket: "${bucket}")
          |> range(start: ${rangeQuery})
          |> filter(fn: (r) => r["_measurement"] == "hidroponik_sensor")
          |> filter(fn: (r) => ${fieldFilter})
          ${pivotQuery}
    `;
    } else if (includeListrik) {
        const nonEnergiFilter = fluxFieldFilter(fields.filter((f) => f !== 'energi'));
        fluxQuery = `
      union(tables: [
        from(bucket: "${bucket}")
          |> range(start: ${rangeQuery})
          |> filter(fn: (r) => r["_measurement"] == "hidroponik_sensor")
          |> filter(fn: (r) => ${nonEnergiFilter})
          ${meanAgg},
        from(bucket: "${bucket}")
          |> range(start: ${rangeQuery})
          |> filter(fn: (r) => r["_measurement"] == "hidroponik_sensor")
          |> filter(fn: (r) => r["_field"] == "energi")
          ${lastAgg}
      ])
        ${pivotQuery}
    `;
    } else {
        fluxQuery = `
        from(bucket: "${bucket}")
          |> range(start: ${rangeQuery})
          |> filter(fn: (r) => r["_measurement"] == "hidroponik_sensor")
          |> filter(fn: (r) => ${fieldFilter})
          ${meanAgg}
          ${pivotQuery}
    `;
    }
    
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
                    
                    // Baris lolos bila punya data hidroponik, atau bila diminta
                    // domain=listrik dan baris punya data listrik (PZEM-004T).
                    // domain=listrik HANYA mengembalikan baris listrik agar
                    // dashboard Listrik tidak menerima baris hidroponik (yang
                    // field PZEM-nya null dan bisa mengacaukan "data terbaru").
                    // Semua field dicek `!= null` (pivot mengembalikan kolom absen
                    // sebagai null). Hidroponik tak bisa 0 valid, tapi cek null lebih
                    // aman daripada `> 0` agar baris yang hanya berisi satu field
                    // tetap tidak terbuang (mis. hanya pH/UV, atau hanya frekuensi/PF).
                    const adaHidroponik =
                        obj.suhu_udara != null || obj.kelembapan_udara != null ||
                        obj.kadar_tds != null || obj.kadar_ph != null ||
                        obj.intensitas_uv != null || obj.suhu_air != null;
                    const adaListrik =
                        obj.tegangan != null || obj.arus != null || obj.daya != null ||
                        obj.energi != null || obj.frekuensi != null || obj.power_factor != null;
                    if (includeListrik ? adaListrik : adaHidroponik) {
                        dataSensor.push({
                            waktu: obj._time,
                            // Atur jumlah desimal sesuai kebutuhan sensor
                            suhu_udara: bulatkan(obj.suhu_udara, 1),         // 1 desimal (contoh: 27.9)
                            kelembapan_udara: bulatkan(obj.kelembapan_udara, 1), // 1 desimal (contoh: 66.6)
                            kadar_tds: bulatkan(obj.kadar_tds, 0),           // Tanpa desimal (contoh: 1046)
                            kadar_ph: bulatkan(obj.kadar_ph, 2),             // 2 desimal (contoh: 6.50)
                            intensitas_uv: bulatkan(obj.intensitas_uv, 0),   // Tanpa desimal
                            suhu_air: bulatkan(obj.suhu_air, 1),             // 1 desimal (contoh: 26.6)
                            // PZEM-004T (listrik)
                            tegangan: bulatkan(obj.tegangan, 1),             // V, 1 desimal (contoh: 220.5)
                            arus: bulatkan(obj.arus, 2),                     // A, 2 desimal (contoh: 1.23)
                            daya: bulatkan(obj.daya, 1),                     // W, 1 desimal (contoh: 271.2)
                            energi: bulatkan(obj.energi, 3),                 // kWh, 3 desimal (kumulatif)
                            frekuensi: bulatkan(obj.frekuensi, 1),           // Hz, 1 desimal (contoh: 50.0)
                            power_factor: bulatkan(obj.power_factor, 2)      // PF, 2 desimal (contoh: 0.95)
                        });
                    }
                },
                error(error) { reject(error); },
                complete() { resolve(); },
            });
        });
        // Energi periode (kWh) dihitung dari data mentah, hanya untuk domain listrik.
        // Dipakai dashboard Listrik agar estimasi biaya tidak memakai data chart
        // yang sudah di-downsample/dipotong.
        let energyPeriod = null;
        let energyFrom = null;
        let energyTo = null;
        if (includeListrik) {
            const e = await hitungEnergiPeriode(energyRange);
            energyPeriod = e.period;
            energyFrom = e.from;
            energyTo = e.to;
        }

        const payload = { success: true, count: dataSensor.length, data: dataSensor };
        if (includeListrik) {
            payload.energyPeriod = energyPeriod;
            payload.energyFrom = energyFrom;
            payload.energyTo = energyTo;
        }
        return payload;
    } catch (error) {
        // Diteruskan ke handler agar respons tetap 500 dengan pesan error.
        throw error;
    }
}

// Route data sensor (grafik & realtime).
// Cache singkat + single-flight: dashboard yang sama dibuka di beberapa tab/HP
// tidak menjalankan query InfluxDB yang sama berkali-kali, dan permintaan yang
// datang saat query masih berjalan memakai promise yang sama (tidak menumpuk).
app.get('/api/sensor-data', async (req, res) => {
    const filter = req.query.filter || 'realtime';
    // domain=listrik -> hanya baris/field listrik (PZEM-004T). Tanpa itu hanya
    // baris hidroponik agar dashboard Monitoring tidak kemasukan baris listrik.
    const includeListrik = req.query.domain === 'listrik';
    const cacheKey = `${filter}|${includeListrik ? 'listrik' : 'hidro'}`;

    const ttl = filter === 'realtime' ? SENSOR_CACHE_TTL_MS : SENSOR_CACHE_TTL_HISTORY_MS;
    const cached = sensorCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ttl) {
        return res.json(cached.payload);
    }

    let job = sensorInflight.get(cacheKey);
    if (!job) {
        job = bangunDataSensor(filter, includeListrik);
        sensorInflight.set(cacheKey, job);
        const clear = () => sensorInflight.delete(cacheKey);
        job.then(clear, clear);
    }

    try {
        const payload = await job;
        sensorCache.set(cacheKey, { at: Date.now(), payload });
        res.json(payload);
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

// 11. Route Perangkat: ingest data listrik PZEM-004T langsung ke InfluxDB.
// Jalur ini TIDAK lewat Node-RED, sehingga data listrik tetap masuk meski flow
// Node-RED belum diperbarui. Ditulis ke `_measurement` yang sama
// (hidroponik_sensor) agar dashboard Listrik (/api/sensor-data?domain=listrik)
// langsung membacanya. Body: 6 field listrik, boleh dibungkus { object: {...} }.
const PZEM_FIELDS = [
    'tegangan',      // V
    'arus',          // A
    'daya',          // W
    'energi',        // kWh (kumulatif)
    'frekuensi',     // Hz
    'power_factor',  // PF
];

// Rentang plausibel tiap field listrik: [min, max]. Nilai di luar ini ditolak
// agar sampel rusak (negatif / mustahil) tidak tersimpan & merusak delta energi.
const PZEM_RANGES = {
    tegangan: [0, 300],        // V
    arus: [0, 100],            // A
    daya: [0, 30000],          // W
    energi: [0, 1e7],          // kWh (kumulatif)
    frekuensi: [0, 100],       // Hz
    power_factor: [0, 1],      // PF
};

app.post('/api/listrik/ingest', deviceAuth, async (req, res) => {
    try {
        const raw = (req.body && req.body.object) ? req.body.object : (req.body || {});

        const point = new Point(measurement);
        let fields = 0;
        for (const key of PZEM_FIELDS) {
            if (!isFiniteNumber(raw[key])) continue;
            const n = Number(raw[key]);
            const [min, max] = PZEM_RANGES[key];
            if (n < min || n > max) continue; // buang nilai di luar rentang plausibel
            point.floatField(key, n);
            fields++;
        }

        if (fields === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada field listrik valid yang dikirim.' });
        }

        const writeApi = client.getWriteApi(org, bucket, 'ns');
        try {
            writeApi.writePoint(point);
            await writeApi.flush();
        } finally {
            await writeApi.close();
        }

        res.json({ success: true, fields });
    } catch (error) {
        console.error('Error Ingest Listrik:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan internal server.' });
    }
});

// --- JALANKAN SERVER ---
app.listen(port, '0.0.0.0', () => {
    console.log(`Backend API berjalan di http://0.0.0.0:${port}`);
    console.log(DEVICE_TOKEN ? '✅ DEVICE_TOKEN terkonfigurasi.' : '⚠️  DEVICE_TOKEN kosong — endpoint perangkat mengembalikan 503.');
});
