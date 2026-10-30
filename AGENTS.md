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
npm run version:bump -- patch   # 1.0.1 -> 1.0.2
npm run version:bump -- minor   # 1.0.0 -> 1.1.0
npm run version:bump -- major   # 1.0.0 -> 2.0.0
```

Perintah ini menulis `VERSION` sekaligus menyinkronkan `version` di seluruh
`package.json` (root, `web`, `iot-api`, `hidro-backend`) dan lockfile. Jangan
edit versi manual.

## Tag & Release otomatis

- Push ke `main` yang **mengubah `VERSION`** otomatis membuat annotated tag
  `v<versi>` + GitHub Release (catatan otomatis) lewat
  `.github/workflows/release.yml`.
- Push yang tidak mengubah `VERSION` hanya memberi peringatan di summary
  Actions; tidak ada tag baru dan workflow tetap sukses.
- Alur rilis fitur: `npm run version:bump -- patch|minor|major` -> commit dengan
  subjek memuat `v<versi>` -> `git push origin main`.
- Backfill/ulang Release untuk tag lama: tab **Actions** -> **Release** ->
  **Run workflow**, isi tag (mis. `v1.0.1`). Idempotent, aman diulang.
- Prasyarat repo: **Settings -> Actions -> General -> Workflow permissions** =
  "Read and write", agar `GITHUB_TOKEN` bisa push tag dan membuat Release.
- Fallback manual bila Actions tidak tersedia:
  `git tag -a v<versi> -m "v<versi>" && git push origin v<versi>`, lalu
  `gh release create v<versi> --generate-notes`.

## Operasi umum

```bash
npm run build:web        # build frontend (web)
npm run test:hidro       # self-check backend Plan (HSS/HST)
npm run version:check    # validasi sinkronisasi versi
```

### Deploy: rebuild SEMUA service yang menampilkan versi

Versi di badge UI **di-bake saat build** (`__APP_VERSION__` di-inject Vite dari
`web/package.json`), jadi image lama akan terus menampilkan versi lama walau
kode sudah di-pull. Setelah `version:bump`, rebuild ketiga service:

```bash
docker compose up -d --build iot-api hidro-backend web
```

Jangan hanya rebuild `iot-api`: `hidro-backend` (`/api/version`) dan `web`
(badge versi di UI) akan tertinggal. Verifikasi setelah deploy:

```bash
curl -s https://hidroponik.phd.my.id/api/version          # hidro-backend
curl -s https://hidroponik.phd.my.id/api/version-iot 2>/dev/null || \
  docker exec hidroponik-backend node -e 'fetch("http://iot-api:3000/api/version").then(r=>r.json()).then(j=>console.log(j))'
curl -s https://hidroponik.phd.my.id/ | grep -o 'index-[A-Za-z0-9_-]*\.js'  # bundle web terbaru
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
