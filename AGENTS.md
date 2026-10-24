# AGENTS.md — Aturan Kerja Repo iot-http-server

## Versi aplikasi (WAJIB di setiap commit)

Sumber versi tunggal: file `VERSION` di root repo. Semua `package.json`
(root, `web`, `iot-api`, `hidro-backend`) harus berisi versi yang sama;
`scripts/check-version.mjs` menegakkan sinkronisasi ini.

**Setiap pesan commit wajib memuat versi aplikasi**, format `v<versi>`,
contoh:

```
Fitur HSS/HST: hitung umur tanaman [v1.0.0]
v1.0.1: fix hitung mundur pipa
```

Hook `commit-msg` (`.githooks/commit-msg`) menolak commit yang pesannya tidak
memuat versi. Hook dipasang lewat `git config core.hooksPath .githooks` —
file ini disimpan di `.git/config`, jadi **tidak ikut ter-commit**. Clone baru
wajib menjalankan:

```bash
npm run setup
```

Untuk naikkan versi:

```bash
npm run version:bump -- patch   # 1.0.0 -> 1.0.1
npm run version:bump -- minor   # 1.0.0 -> 1.1.0
npm run version:bump -- major   # 1.0.0 -> 2.0.0
```

Setelah menaikkan versi, perbarui juga `version` di seluruh `package.json`
agar `npm run version:check` lulus.

## Operasi umum

```bash
npm run build:web        # build frontend (web)
npm run test:hidro       # self-check backend Plan (HSS/HST)
npm run version:check    # validasi sinkronisasi versi
```

## Arsitektur singkat

| Service | Port | Peran |
|---|---|---|
| `iot-api` | 3000 | Data sensor/-listrik (InfluxDB), antrean perintah perangkat, ingest PZEM |
| `hidro-backend` | 5000 | Plan tanam (SQLite + uploads), resep nutrisi, statistik |
| `web` | 80 (nginx) | SPA React: Monitoring, Listrik, Plan |
| `nodered` | 1880 | Ingest sensor dari ESP32 |

Frontend talks ke `/api/*`; nginx mem-proxy `/api/sensor-data`, `/api/pompa/`,
`/api/interval/`, `/api/autodosing/`, `/api/relay/`, `/api/device/`,
`/api/listrik/` ke `iot-api`, sisanya ke `hidro-backend`.

## Aturan kode

- Migrasi DB **aditif** (tambah kolom/tabel), idempotent, jalan di `db.js`.
- Backend Plan = Express 4 + better-sqlite3; `iot-api` = Express 5.
- Tailwind v4 (CSS-first config via `@config`); jangan pakai directive v3 lama.
- Jangan log atau commit rahasia (`.env`, token InfluxDB, `note.txt`).
- Data persisten (`hidro-data/`, `*.db`) tidak ikut ter-commit.
