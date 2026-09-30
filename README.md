# Hidroponik — Monitoring IoT + Plan Tanam

Satu aplikasi web (React) yang menggabungkan dua sistem:

1. **Monitoring IoT** — dashboard sensor realtime (via InfluxDB) + kontrol aktuator & relay. Perangkat ESP32 terhubung lewat **HTTP/WiFi** (uplink JSON + polling perintah), bukan LoRaWAN/MQTT.
2. **Plan Tanam** — pemantauan masa tanam & estimasi panen 2 meja hidroponik (6 pipa PVC per meja), riwayat panen, statistik, katalog tanaman, dan resep nutrisi (RCP).

## Arsitektur

```
iot-http-server/
├── docker-compose.yml      # semua service
├── .env.example            # CORS_ORIGIN, FRONTEND_PORT, DEVICE_TOKEN, TUNNEL_TOKEN
├── dokumentasi.md          # dokumentasi IoT (API, kontrak HTTP, payload)
├── note.txt                # catatan token (jangan commit bila bisa)
├── nodered-data/           # data persisten Node-RED
├── influxdb-data/          # data persisten InfluxDB
├── hidro-data/             # bind-mount data Plan (SQLite + uploads)
│   ├── hidroponik.db       # DB SQLite (mode WAL)
│   └── uploads/            # gambar batch
├── iot-api/                # Express IoT — build Dockerfile, antrean perintah in-memory
│   ├── Dockerfile
│   └── server.js
├── hidro-backend/          # Express + better-sqlite3 (ex Hidroponik-Plan/backend)
│   ├── Dockerfile
│   ├── server.js
│   ├── db.js
│   └── uploads.js
└── web/                    # React + Vite + Tailwind + nginx (gabungan)
    ├── Dockerfile          # build Vite -> nginx
    ├── nginx.conf          # SPA + proxy /api/* split + /terima-sensor + /uploads/*
    ├── tailwind.config.js  # token glassmorphism iOS
    └── src/
        ├── main.jsx, App.jsx   # router
        ├── api.js              # client Plan (base /api)
        ├── components/         # komponen Plan
        ├── utils/status.js     # helper Plan
        └── features/iot/       # dashboard IoT (migrasi dari index.html + trend.html)
```

### Service (docker compose)

| Service | Image/Build | Port host | Keterangan |
|---|---|---|---|
| `nodered` | `nodered/node-red:latest` | `1880` | Orchestrator ingest sensor -> InfluxDB |
| `influxdb` | `influxdb:2.7-alpine` | `8086` | Time-series DB (`hidroponik` / `sensor_data`) |
| `iot-api` | build `./iot-api` | — | API IoT (sensor + antrean perintah), internal `3000` |
| `hidro-backend` | build `./hidro-backend` | — | API Plan (SQLite + uploads), internal `5000` |
| `web` | build `./web` | `${FRONTEND_PORT:-5005}` | Frontend gabungan (nginx), satu origin |
| `cloudflared` | `cloudflare/cloudflared` | — | Tunnel ke `nodered:1880` |
| `cloudflared-web` | `cloudflare/cloudflared` | — | Named tunnel ke `web:80` (fallback quick tunnel) |

## Cara Jalan

```bash
cp .env.example .env      # WAJIB: isi DEVICE_TOKEN
docker compose up -d --build
```

Buka **http://localhost:5005**

- `/monitoring` — dashboard IoT (default, redirect dari `/`)
- `/monitoring/trend/<sensor>` — grafik tren 1 sensor
- `/plan` — dashboard plan tanam; sub-tab `/plan/history`, `/plan/stats`, `/plan/catalog`

Perintah lain:

```bash
docker compose ps            # cek status (hidro-backend harus "healthy")
docker compose logs -f       # lihat log
docker compose down          # hentikan
```

## Konfigurasi (env)

| Variabel | Default | Keterangan |
|---|---|---|
| `CORS_ORIGIN` | kosong | Origin CORS, dipisah koma. Kosong = tanpa CORS — aman karena UI satu origin lewat nginx `/api/`. |
| `FRONTEND_PORT` | `5005` | Port host untuk frontend. |
| `DEVICE_TOKEN` | — (wajib) | Token statis `X-Device-Token` untuk endpoint perangkat. Harus sama dengan firmware ESP32. Buat: `openssl rand -hex 32`. |
| `TUNNEL_TOKEN` | kosong | Token named Cloudflare Tunnel (`iot.phd.my.id` -> `web:80`). Kosong = fallback quick tunnel (hostname acak). |

## Routing nginx (satu origin)

`web/nginx.conf` memisah API berdasarkan prefix path:

- `/terima-sensor` → `nodered:1880` (ingest sensor)
- `/api/sensor-data`, `/api/pompa/`, `/api/interval/`, `/api/autodosing/`, `/api/relay/`, `/api/device/` → `iot-api:3000`
- `/api/` (sisanya), `/uploads/` → `hidro-backend:5000`
- `/` → SPA fallback (react-router)

**Tidak ada path yang bentrok** antara endpoint IoT dan Plan. Bila menambah endpoint IoT baru, tambahkan `location` spesifik agar tidak jatuh ke backend Plan.

## API

### IoT (`iot-api/server.js`, Express v5)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/sensor-data?filter=...` | Data sensor; filter: `realtime, 12hour, 1day, 1week, 2week, 1month, 3month, 6month` |
| POST | `/api/pompa/kontrol` | `{ durasi }` → enqueue (pompa AB Mix) |
| POST | `/api/interval/kontrol` | `{ intervalDetik }` → enqueue |
| POST | `/api/autodosing/kontrol` | `{ targetTds, volumeAir, konstantaPupuk }` → enqueue |
| POST | `/api/relay/kontrol` | `{ idRelay, status: 'ON'|'OFF' }` → enqueue |
| GET | `/api/relay/status` | `{ success, data: { relay_1..4 } }` |
| GET | `/api/device/commands` | Perangkat: perintah pending (butuh `X-Device-Token`) |
| POST | `/api/device/commands/:id/ack` | Perangkat: hapus perintah (butuh `X-Device-Token`) |

### Ingest (Node-RED)

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/terima-sensor` | Body `{ "object": { ...sensor, relay_1..4 } }`, butuh `X-Device-Token` |

Detail kontrak HTTP + token ada di [`dokumentasi.md`](dokumentasi.md).

### Plan (`hidro-backend/server.js`, Express v4)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/health` | Healthcheck -> `{ status: 'ok' }` |
| GET | `/api/catalog` | Daftar tanaman (+ `hasRecipe`) |
| POST | `/api/catalog` | Tambah tanaman: `{ name, seedlingDays, growDays }` |
| PUT | `/api/catalog/:id` | Update tanaman + recompute `harvestDate` batch aktif |
| DELETE | `/api/catalog/:id` | Hapus tanaman (tolak `409` bila dipakai batch) |
| GET | `/api/batches` | Batch **aktif** + `computedStatus`, `daysRemaining`, `hasHistory` |
| POST | `/api/batches` | Tanam baru: `{ tableNumber, pipeNumber, plantId, sowDate }` |
| PUT | `/api/batches/:id` | Edit batch aktif: `{ plantId?, sowDate? }` |
| DELETE | `/api/batches/:id` | Batal tanam (hapus permanen + file gambar) |
| POST | `/api/batches/:id/harvest` | Panen/arsip: `{ harvestWeightGram?, notes? }` |
| GET | `/api/batches/history` | Riwayat arsip; filter `tableNumber, pipeNumber, plantId, from, to, limit, offset` |
| PUT | `/api/batches/:id/notes` | Set/hapus catatan: `{ notes }` |
| POST | `/api/batches/:id/images` | Upload gambar (multipart field `image`, maks 5MB, maks 5/batch) |
| GET | `/api/batches/:id/images` | Daftar gambar batch |
| DELETE | `/api/batches/:id/images/:imageId` | Hapus gambar + file fisik |
| GET | `/api/stats/summary` | `{ harvestByMonth, harvestByPlant, estimasiVsRealisasi, occupancy }` |

#### RCP (resep nutrisi)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/catalog/:id/recipes` | Resep 2 fase (selalu 2 baris: `Semai`, `Pembesaran`) |
| PUT | `/api/catalog/:id/recipes/:phase` | Upsert resep 1 fase |
| GET | `/api/batches/:id/recipe` | Resep fase aktif batch: `{ phase, hasRecipe, recipe }` |
| POST | `/api/batches/:id/dose` | Hitung dosis: `{ volumeAir, ppmAirAwal?, targetPpm? }` -> `{ gramA, gramB, ... }` |
| GET | `/api/batches/:id/readings` | Pengukuran (terbaru dulu, maks 500) + `phase` + `recipe` |
| POST | `/api/batches/:id/readings` | Tambah pengukuran: `{ ppm?, ph?, catatan? }` |
| DELETE | `/api/batches/:id/readings/:readingId` | Hapus pengukuran |
| GET | `/api/stats/nutrition` | `{ trend, outOfRange }` |

Rumus kalkulator dosis (perkiraan, bukan rekomendasi agronomis):

```
gram = (targetPpm - ppmAirAwal) * volumeAir / 1000 * konstanta
```

## Catatan

- **Status**: tersimpan hanya `Semai` / `Pembesaran`; `Siap Panen` dihitung runtime bila `daysRemaining <= 3`.
- **Panen = arsip** (`archivedAt`), bukan hapus; pipa jadi kosong dan bisa ditanam ulang (partial unique index `WHERE archivedAt IS NULL`).
- **Gambar**: JPG/PNG/WEBP, maks 5MB (`client_max_body_size 6m` + multer 5MB), maks 5/batch; disajikan via `/uploads/<file>`.
- Migrasi DB bersifat **aditif**; data lama tetap utuh.
- **Dua chart library**: recharts (halaman Plan), chart.js (halaman IoT) — tidak dicampur satu halaman.
- **Kredensial hardcode** di `iot-api/server.js` (token InfluxDB) dan `note.txt` (dapat dioverride lewat env `INFLUXDB_TOKEN`/`INFLUXDB_URL`). Sebaiknya dipindah penuh ke `.env` di task terpisah.
- **Antrean perintah in-memory**: perintah yang belum di-ACK hilang saat `iot-api` restart. Pindah ke SQLite bila perlu durabilitas.
- **HTTPS ESP32**: firmware memakai `setInsecure()` — tidak memvalidasi sertifikat. Cukup untuk sekarang; sebaiknya pin sertifikat/root CA.
- **Keamanan**: rute dashboard (`POST /api/*/kontrol`) juga lewat tunnel; token hanya melindungi endpoint perangkat. Rekomendasi: Cloudflare Access untuk dashboard.

## Data & Backup

Data Plan ada di folder bind-mount `hidro-data/` (container path `/app/data`):

```bash
# backup
tar czf hidro-backup.tgz -C hidro-data .
# restore
tar xzf hidro-backup.tgz -C hidro-data
```

Catatan kepemilikan: backend berjalan sebagai `root` di container, jadi file di `hidro-data/` dimiliki `root:root` di host. Saat pindah server mungkin perlu `sudo chown -R "$USER" hidro-data/`.

## Development Lokal (tanpa Docker)

```bash
# Backend Plan
cd hidro-backend && npm install && npm start        # http://localhost:5000

# API IoT
cd iot-api && npm install && node server.js         # http://localhost:3000

# Frontend
cd web && npm install && npm run dev                # http://localhost:3000
```

Saat dev, arahkan proxy Vite ke kedua backend, atau jalankan lewat compose agar nginx meneruskan `/api/` dan `/uploads/`.
