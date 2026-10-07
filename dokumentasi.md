# IoT HTTP Server — Sistem Monitoring Hidroponik

Sistem monitoring dan kontrol hidroponik yang mengintegrasikan sensor (ESP32 via WiFi/HTTP), database InfluxDB, Node-RED, dan dashboard web.

Transport perangkat sekarang **HTTP murni via WiFi** (bukan lagi LoRaWAN/MQTT):
- **Uplink**: ESP32 `POST` JSON ke `POST /terima-sensor` (Node-RED → InfluxDB).
- **Downlink/kontrol**: ESP32 **polling** `GET /api/device/commands` dari `iot-api`, lalu `POST .../:id/ack`.
- **ESP-NOW** ke NodeMCU slave tetap dipakai (pompa, relay, dosing).

Sejak merge, frontend IoT digabung ke satu aplikasi React bersama modul plan tanam (lihat [`README.md`](README.md)). Dashboard vanilla lama (`public/index.html`, `public/trend.html`) sudah dihapus dan diport ke `web/src/features/iot/`.

## 🚀 Arsitektur Sistem

Komponen yang berjalan di dalam Docker:

1. **Node-RED**: orchestrator data; menerima data dari sensor, meneruskan ke InfluxDB.
2. **InfluxDB**: database time-series (suhu udara, kelembapan, TDS, pH, UV, suhu air, relay 1-4).
3. **iot-api** (ex `nodejs-web`): Express API IoT + **antrean perintah in-memory**. **Tidak ada host port** — diakses lewat nginx.
4. **hidro-backend**: Express + SQLite untuk modul plan tanam.
5. **web**: frontend React (nginx) — satu port host, menyajikan seluruh app.
6. **Cloudflared**: tunnel untuk Node-RED (`cloudflared`) dan seluruh app (`cloudflared-web`).
7. **MQTT Broker (ChirpStack)**: **tidak lagi dipakai** oleh alur IoT ini.

## 🛠️ Teknologi yang Digunakan

- **Backend IoT**: Node.js, Express.js 5
- **Backend Plan**: Node.js, Express.js 4, better-sqlite3, multer
- **Database**: InfluxDB 2.7 (sensor), SQLite (plan tanam)
- **Automation**: Node-RED
- **Communication**: HTTP/WiFi (ESP32 ↔ server), ESP-NOW (ESP32 ↔ NodeMCU)
- **Frontend**: React 18 + Vite + Tailwind + chart.js (IoT) / recharts (Plan)
- **Deployment**: Docker & Docker Compose

## 📂 Struktur Folder

```
iot-http-server/
├── docker-compose.yml      # Konfigurasi orchestrasi container
├── .env.example            # CORS_ORIGIN, FRONTEND_PORT, DEVICE_TOKEN, TUNNEL_TOKEN
├── note.txt                # Catatan token dan konfigurasi
├── influxdb-data/          # Data persisten InfluxDB
├── nodered-data/           # Data persisten Node-RED (flows & config)
├── hidro-data/             # Data Plan: hidroponik.db + uploads (bind-mount)
├── iot-api/                # API IoT (ex web-app)
│   └── server.js           # API sensor, antrean perintah, endpoint perangkat
├── hidro-backend/          # API Plan (SQLite + uploads)
└── web/                    # Frontend React (nginx)
    └── src/features/iot/   # Dashboard IoT: MonitoringPage, TrendPage, chart, hook
```

## ⚙️ Konfigurasi & Instalasi

### Prasyarat
- Docker & Docker Compose terinstal.

### Cara Menjalankan
1. Clone repository ini.
2. Siapkan `.env` dari contoh dan isi `DEVICE_TOKEN` (wajib):
   ```bash
   cp .env.example .env
   # DEVICE_TOKEN=$(openssl rand -hex 32)
   ```
3. Jalankan:
   ```bash
   docker compose up -d --build
   ```
4. Akses layanan:
   - **Web App (gabungan)**: `http://localhost:5005` (atau `FRONTEND_PORT`)
   - **Node-RED**: `http://localhost:1880`
   - **InfluxDB**: `http://localhost:8086`

## 🔌 API Endpoints

Semua endpoint diakses lewat nginx pada port `5005` (satu origin). Nginx meneruskan prefix IoT ke `iot-api:3000` dan `/terima-sensor` ke `nodered:1880`.

### 1. Get Sensor Data
`GET /api/sensor-data?filter=[...]`
Mengambil data history sensor dari InfluxDB.

Filter yang didukung (8): `realtime` (default, 40 titik terakhir), `12hour`, `1day`, `1week`, `2week`, `1month`, `3month`, `6month`.
> Catatan: dokumentasi lama hanya menyebut 5 filter; kode `server.js` adalah sumber kebenaran (8 filter).

### 2. Control Pump (Pompa AB Mix)
`POST /api/pompa/kontrol`
```json
{ "durasi": 60 }
```
Perintah di-**enqueue** (bukan lagi MQTT publish). Pompa utama kini dikendalikan lewat Relay 1 (`/api/relay/kontrol`).

### 3. Control Interval
`POST /api/interval/kontrol`
```json
{ "intervalDetik": 300 }
```

### 4. Auto Dosing
`POST /api/autodosing/kontrol`
```json
{ "targetTds": 800, "volumeAir": 180, "konstantaPupuk": 160 }
```

### 5. Control Relay
`POST /api/relay/kontrol`
```json
{ "idRelay": 1, "status": "ON" }
```

### 6. Relay Status
`GET /api/relay/status` -> `{ "success": true, "data": { "relay_1": "ON", ... } }`

### 7. Ingest Sensor (perangkat)
`POST /terima-sensor` — header `X-Device-Token`. Body **wajib** dibungkus `object`:
```json
{ "object": {
  "suhu_udara": 27.9, "kelembapan_udara": 66.6, "kadar_tds": 1046,
  "kadar_ph": 0, "intensitas_uv": 12345, "suhu_air": 26.6,
  "relay_1": 0, "relay_2": 0, "relay_3": 0, "relay_4": 0
} }
```
> Tanpa wrapper `object`/`objectJSON`, fungsi Node-RED mengembalikan `null` dan data diabaikan.

> **URL InfluxDB di Node-RED wajib `http://influxdb:8086`** (nama service compose), BUKAN IP host/LAN lama. Bila server pindah jaringan dan flow masih menunjuk IP lama, write ke InfluxDB akan `RequestTimedOutError` → data terbaru tidak pernah tersimpan meski ESP32 melaporkan "terkirim". Cek node config InfluxDB di `nodered-data/flows.json`.

### 8. Poll Perintah (perangkat)
`GET /api/device/commands` — header `X-Device-Token`:
```json
{ "success": true, "commands": [
  { "id": 12, "type": "pompa", "durasi": 30 },
  { "id": 13, "type": "interval", "intervalDetik": 120 },
  { "id": 14, "type": "autodosing", "targetTds": 800, "volumeAir": 180, "konstantaPupuk": 160 },
  { "id": 15, "type": "relay", "idRelay": 2, "status": "ON" }
] }
```

### 9. ACK Perintah (perangkat)
`POST /api/device/commands/:id/ack` — header `X-Device-Token`. Menghapus perintah dari antrean.

## 🔐 Autentikasi Perangkat

- Semua endpoint perangkat (`/terima-sensor`, `/api/device/*`) wajib menyertakan header `X-Device-Token` yang nilainya sama dengan env `DEVICE_TOKEN` di server.
- Token yang salah/hilang → `401`. Bila `DEVICE_TOKEN` belum diisi di server → `503`.
- Token yang sama dipakai oleh `iot-api` (validasi route device) dan Node-RED (validasi ingest).

## 📡 Kontrak Perintah → Aksi ESP32

| type | Aksi |
|---|---|
| `pompa` | `kirimPerintahKeNodeMCU("POMPA", durasi*1000)` (Pompa AB Mix / MOSFET B) |
| `interval` | set `TX_INTERVAL` |
| `autodosing` | set `targetTDS`, `volumeTandon`, `konstantaPupuk` |
| `relay` | `kirimPerintahKeNodeMCU("RELAY_n_ON"/"RELAY_n_OFF", 0)` + update `status_relay_n` |

- Antrean perintah disimpan **in-memory** di `iot-api`: perintah yang belum di-ACK **hilang saat container restart**.
- Latency kontrol = interval polling ESP32 (default 5 detik).
- Firmware memakai `setInsecure()` untuk HTTPS: **tidak memvalidasi sertifikat** (cukup untuk sekarang, sebaiknya di-pin).

## 🖥️ Frontend IoT (React)

Dashboard IoT diport ke `web/src/features/iot/`:

| File | Isi |
|---|---|
| `MonitoringPage.jsx` | Header + jam + status online/offline, filter waktu, unduh CSV, 6 kartu sensor, panel aktuator, panel relay, 6 chart, tabel riwayat |
| `TrendPage.jsx` | Analisis tren 1 sensor (route `/monitoring/trend/:sensor`) |
| `SensorChart.jsx` | 6 line chart Chart.js (gradient, annotation, tension) |
| `ActuatorPanel.jsx` | Kontrol 1 pompa (AB Mix), interval uplink, auto dosing |
| `RelayPanel.jsx` | 4 tombol relay ON/OFF + sinkron status |
| `useSensorData.js` | Polling 5 detik (sensor + status relay) |
| `utils.js` | Threshold alert, bound chart, annotation, tren, export CSV |

Threshold alert, bound chart, dan garis annotation dipertahankan **persis** dari `index.html` lama:
- Alert: suhu air `>=30`/`>28`; suhu udara `>=35`/`>32`; TDS `<=500 || >=1500`/`<700 || >1300`; kelembapan `<=40 || >=80`; pH `<5.5 || >6.5`; UV `<0 || >2000`.
- Bound chart: suhu_udara 0-50, kelembapan 0-100, TDS auto (floor = ppmTarget resep tangki aktif), pH 0-14, UV auto (floor 50), suhu_air 0-50.
- Annotation: TDS 700/1300, pH 5.5/6.5, suhu_air 30, suhu_udara 34.

