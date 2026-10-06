# Laporan — Import `iot-http-server` ke GitHub + Deploy ke Server

Status: **SELESAI (Langkah 1-3 + push GitHub)**. Langkah 4 (rotasi token) **sengaja tidak dijalankan** atas instruksi user.

Referensi plan: `1790429062861-iot-http-server-mac-github-plan.md`.

## Hasil akhir

- Repo GitHub: `HibatullahPrihadian/iot-http-server` (private). Branch `main`, commit `3ec52d91fe14b0d65b3db4229471dfaddbd234f7` (root commit, 60 file, 12795 insertions).
- Mac: `/Users/ibet/Documents/Antigravity/iot-http-server` — git repo, tracking `origin/main`, worktree bersih.
- Server: `/home/ibet/iot-http-server` — git repo, tracking `origin/main`, container sudah di-rebuild dari commit ini.
- Live: `https://hidroponik.phd.my.id` tetap hidup setelah rebuild.

## Koreksi fakta dari handover lama (penting)

Handover perencanaan menyatakan agent TIDAK bisa `ssh`/`scp`/`curl` dan git write ops akan **DENIED**. Semua itu **SALAH** pada sesi ini:

- `git init`/`add`/`commit`/`remote add`/`push` → **BERHASIL**, tidak diblok.
- `ssh ibet@ssh.phd.my.id` → **BERHASIL** (host `server-iot`). `scp` tidak dicoba; `ssh` cukup.
- `curl` → **BERHASIL** (pakai `curl`, bukan `webfetch`).
- `find` → **BERHASIL**.
- Shell chaining / `|` → **BERHASIL** (dipakai `&&`, `echo ---`, `; true`).
- **Pelajaran**: permission ruleset tidak seketat yang dicatat. Selalu uji dulu sebelum menyimpulkan "blocked".

## Yang dilakukan (ringkas)

1. Copy sudah ada di Mac (user scp manual). Inventaris: 6 dir, 5 file root + junk `._*`.
2. **Audit rahasia → 4 temuan, diperbaiki sebelum commit:**
   - `iot-api/server.js:10` hardcode token InfluxDB (`VxZUJYbF...`) → diubah jadi `process.env.INFLUXDB_TOKEN || ''`.
   - `docker-compose.yml`: `DOCKER_INFLUXDB_INIT_PASSWORD=adminpassword` hardcode → `${INFLUXDB_PASSWORD:?...}`; tambah `INFLUXDB_URL`/`INFLUXDB_TOKEN` ke service `iot-api`.
   - `note.txt`: berisi token NodeJS-DB + JWT Axious (rahasia nyata) → disanitasi jadi placeholder.
   - `.env` berisi `DEVICE_TOKEN` asli → **tidak pernah di-stage** (gitignore sudah menangkap `.env`).
3. Berkas publik: rewrite `.gitignore` (kini exclude `.env*`, `influxdb-data/`, `nodered-data/`, `hidro-data/`, `data/`, DB, `._*`), buat root `.dockerignore`, perluas `.env.example` (tambah blok InfluxDB). Hapus junk `._*`.
4. Commit 60 file. Verifikasi: `git ls-files` bersih (tanpa `.env`/data/node_modules), `git grep` token rahasia → kosong.
5. Push ke GitHub via **SSH**. Awalnya gagal: key Mac (`kilo-deploy`) belum terdaftar → user daftarkan → `Hi HibatullahPrihadian!` → push sukses.
6. Server: SSH berhasil. Tambah var InfluxDB ke `.env` server (backup `.env.bak-preimport-*`). `git init` + remote SSH. **Server tak punya keypair** → generate `iot-server-deploy` → user add sebagai **deploy key** repo → fetch + `git checkout -f main` (60 file, `.env`/data utuh).
7. `docker compose up -d --build` di server → `iot-api`/`hidro-backend`/`web` direcreate. Semua `Up`, backend `healthy`. Log iot-api: `✅ DEVICE_TOKEN terkonfigurasi.`

## Verifikasi

| Cek | Hasil |
|---|---|
| `docker compose ps` (server) | semua `Up`; hidro-backend `healthy` |
| `GET /` | `200` |
| `GET /api/relay/status` | `200` |
| `GET /api/tank` | `200` |
| `GET /api/sensor-data?filter=realtime` | `{"success":true,"count":0,"data":[]}` |
| `git ls-remote origin` (Mac) | `3ec52d9... refs/heads/main` |

## Nilai rahasia (JANGAN commit; untuk referensi sesi lanjutan)

- `DEVICE_TOKEN` = `7a21342d1174f32e28314179f70f35d87edfef7f6725d3ca1d8fa38f7a4744fa` — **belum dirotasi** (Langkah 4 dilewati). Kontrol pompa/relay; firmware `IOT/ESP32_ver/ESP32_ver.ino:21` harus sama bila dirotasi.
- InfluxDB token = `VxZUJYbFTBC9X94Rf1qygGNfehXBUX_jSeykiXz3EvpTix96EaEyGSEbiFONIXJz-tuq5K8mM9wiG9NHx-haMQ==` (kini di `.env` server, bukan di repo).
- InfluxDB admin password = `adminpassword` (hanya efek saat init volume; volume sudah ada).

## Item terbuka / risiko

- **Rotasi token belum dilakukan** (Langkah 4): `DEVICE_TOKEN` dan token InfluxDB lama pernah plaintext di Mac + `note.txt`. Disarankan rotasi karena `DEVICE_TOKEN` mengendalikan aktuator fisik.
- `.env` **server** memakai nilai `INFLUXDB_PASSWORD=adminpassword` hasil salin hardcode lama; pada rebuild berikutnya volume InfluxDB sudah ada sehingga tidak berefek, tapi sebaiknya diganti nilai kuat bila volume pernah di-reset.
- Docker build warning `2 vulnerabilities (1 moderate, 1 high)` pada npm deps (`iot-api`, `web`) — belum ditangani.
- Branch server awalnya `master` (default git init) → sudah di-`checkout -f main`, tracking `origin/main`.
- Firmware masih `setInsecure()` (tidak validasi sertifikat) — disebut di `dokumentasi.md`, belum ditangani.

## Perintah update rutin (server)

```bash
cd /home/ibet/iot-http-server
git pull
docker compose up -d --build
docker compose ps
```

## Akses

- Mac SSH key: `~/.ssh/id_ed25519` (`kilo-deploy`) — terdaftar di akun GitHub.
- Server SSH key: `~/.ssh/id_ed25519` (`iot-server-deploy`) — deploy key read-only repo `iot-http-server`.
- Server SSH: `ssh.phd.my.id` (user `ibet`). SSH dari Mac berfungsi.
- LAN server **berubah**: dulu `192.168.2.10`, sekarang `192.168.110.5` (2026-10-06). **Jangan pakai IP LAN di config container** — pakai nama service Docker (`influxdb:8086`).

## Insiden 2026-10-06 — data terbaru tak tampil di dashboard

Gejala: dashboard `/monitoring` (filter realtime) kosong; `/api/tank` `sensorError: "Data sensor kosong"`; ESP32 melaporkan uplink sukses.

Dua bug terpisah:

1. **Ingest mati (server config).** Node influxdb di `nodered-data/flows.json` menunjuk `url: http://192.168.2.10:8086` (IP LAN lama, server pindah ke `192.168.110.5`) → write `RequestTimedOutError` → tidak ada data tersimpan sejak `2026-10-05T07:03:52Z`. Diperbaiki jadi `http://influxdb:8086`, `flows.json` di-`scp` ke server + `docker compose restart nodered`. Data kembali masuk (`2026-10-06T03:12:56Z`).
2. **Query realtime (`iot-api/server.js`).** `|> tail(n:40)` dijalankan **setelah** `pivot`, sehingga tak bisa mengelompokkan per `_field` → hasil sering 0 baris meski data ada. Dihapus (range `-6h` cukup). Diff: hapus `tailQuery` di semua cabang filter.

Verifikasi: `realtime` → `count>0` titik terbaru; `/api/tank` → `sensor.stale:false`, `sensorError:null`.
