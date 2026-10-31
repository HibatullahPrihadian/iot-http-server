#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <espnow.h>
#include <SoftwareSerial.h>
#include <PZEM004Tv30.h>
#include <EEPROM.h>

// ================= KONFIGURASI WIFI =================
// WAJIB sama dengan WIFI_SSID/WIFI_PASS di ESP32.
// swNodeMCU ikut connect ke AP yang sama agar channel radionya sama dengan ESP32
// (ESP-NOW hanya bisa antar-device di channel yang sama).
// Nilai di bawah hanya dipakai saat EEPROM kosong (flash pertama). Setelah itu,
// WiFi diatur dari menu Settings di web dan dikirim lewat ESP-NOW.
const char* WIFI_SSID = "GANTI_SSID";
const char* WIFI_PASS = "GANTI_PASS";

#define FIRMWARE_VERSION "1.1.0"
#define DEVICE_ID "utama"

// Definisi Pin NodeMCU ke Pin PWM Modul MOSFET (Pompa AB Mix)
const int pinMOSFET_B = 14; // Pin D5 NodeMCU -> Hubungkan ke PWM MOSFET Pompa AB Mix

// Definisi Pin NodeMCU ke Modul Relay 4 Channel (Active High)
const int pinRelay1 = 4;     // Pin D2
const int pinRelay2 = 0;     // Pin D3
const int pinRelay3 = 12;    // Pin D6
const int pinRelay4 = 13;    // Pin D7

// ================= KONFIGURASI PZEM-004T =================
// PZEM via SoftwareSerial (UART "buatan") agar Serial Monitor tetap bebas.
// RX NodeMCU <- TX PZEM, TX NodeMCU -> RX PZEM.
#define PZEM_RX D1   // GPIO5
#define PZEM_TX D0   // GPIO16

SoftwareSerial pzemSerial(PZEM_RX, PZEM_TX);
PZEM004Tv30 pzem(pzemSerial);

// ================= KONFIGURASI SERVER (PLACEHOLDER — GANTI) =================
// SERVER_HOST: host saja TANPA "http://" (skema ditambahkan otomatis di bawah).
// Contoh LAN: "192.168.1.100". Bila pakai domain/TLS, set SERVER_HTTPS=true.
const char* SERVER_HOST = "hidroponik.phd.my.id"; // GANTI dengan IP/host server
const int   SERVER_PORT = 5005;                   // GANTI bila perlu (FRONTEND_PORT nginx)
const bool  SERVER_HTTPS = false;                 // true -> pakai https (port 443 / tunnel)
const char* SERVER_PATH = "/api/listrik/ingest";  // Ingest listrik langsung ke iot-api
const char* DEVICE_TOKEN = "ganti-token";         // GANTI: samakan dengan DEVICE_TOKEN di .env

// Struktur data HARUS SAMA PERSIS dengan struct di ESP32
typedef struct struct_message {
    char perintah[16];
    int durasi;
} struct_message;

// Frame config WiFi. WAJIB identik & packed di kedua sisi (target 108 byte).
typedef struct __attribute__((packed)) {
    char type[8];      // "CFG" | "ACK" | "GO"
    char ssid[33];
    char pass[64];
    uint16_t revision;
    uint8_t force;
} struct_config;

struct_message dataTerima;

// ================= CONFIG WIFI DI EEPROM =================
struct NodeCfg {
    uint32_t magic;
    char ssid[33];
    char pass[64];
    uint16_t revApplied;
    uint16_t revPend;
    char ssidPend[33];
    char passPend[64];
    char lastErr[32];
};

const uint32_t CFG_MAGIC = 0x48445231; // "HDR1"
NodeCfg cfg;

// Konfigurasi pending yang dikirim ESP32 lewat ESP-NOW (belum di-commit).
bool cfgPendingValid = false;
String cfgPendSsid;
String cfgPendPass;
uint16_t cfgPendRev = 0;
unsigned long cfgPendingExpire = 0;

// Jadwal restart setelah frame GO.
unsigned long restartAt = 0;
bool restartScheduled = false;
bool goPending = false;   // commit EEPROM dilakukan di loop(), bukan di callback

// Variabel Kontrol Pompa AB Mix (State Machine)
bool pompaB_Aktif = false;
unsigned long waktuMulaiB = 0;
unsigned long durasiB = 0;

// ================= WEB SERVER =================
ESP8266WebServer server(80);

// ================= LOGGING DENGAN TIMESTAMP =================
// Waktu dari NTP (WIB, UTC+7). Bila belum sinkron, dipakai uptime.
const long GMT_OFFSET_WIB  = 7 * 3600;
const int  DAYLIGHT_OFFSET = 0;

void timestampNow(char* buf, size_t len) {
  time_t now = time(nullptr);
  struct tm timeinfo;
  localtime_r(&now, &timeinfo);
  if (timeinfo.tm_year > (2016 - 1900)) { // waktu NTP valid
    strftime(buf, len, "%H:%M:%S", &timeinfo);
  } else {
    snprintf(buf, len, "+%lus", millis() / 1000);
  }
}

void logPrefix() {
  char buf[16];
  timestampNow(buf, sizeof(buf));
  Serial.printf("[%s] ", buf);
}

void logLine(const String& msg) {
  logPrefix();
  Serial.println(msg);
}

void logPrefixTo(String& out) {
  char buf[16];
  timestampNow(buf, sizeof(buf));
  out += '[';
  out += buf;
  out += "] ";
}

// ================= SINKRONISASI WAKTU (NTP) =================
// NTP butuh internet; hanya jalan setelah WiFi tersambung. Non-blocking:
// SNTP jalan di background, di sini hanya membaca hasil lewat time().
bool ntpDimulai = false;
bool waktuTersinkron = false;

void sinkronWaktuNTP() {
  if (waktuTersinkron) return;
  if (WiFi.status() != WL_CONNECTED) return;

  if (!ntpDimulai) {
    configTime(GMT_OFFSET_WIB, DAYLIGHT_OFFSET, "pool.ntp.org", "time.google.com");
    ntpDimulai = true;
    return; // beri kesempatan SNTP melakukan request pertama
  }

  time_t now = time(nullptr);
  struct tm timeinfo;
  localtime_r(&now, &timeinfo);
  if (timeinfo.tm_year > (2016 - 1900)) {
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    logLine(String(F("[NTP] Waktu tersinkron: ")) + buf);
    waktuTersinkron = true;
  }
}

// ================= STATUS PIN =================
bool pinRelay[4] = {false, false, false, false}; // false = OFF

const int pinRelayArr[4] = {pinRelay1, pinRelay2, pinRelay3, pinRelay4};

// ================= LOG RIWAYAT PERINTAH (RAM, maks 20 entri) =================
const int LOG_MAX = 20;
String logRiwayat[LOG_MAX];
int logCount = 0;
int logHead = 0;

void tambahLog(const char* sumber, const String& perintah) {
  String entry;
  entry.reserve(64);
  logPrefixTo(entry);
  entry += sumber;
  entry += " - ";
  entry += perintah;
  logRiwayat[logHead] = entry;
  logHead = (logHead + 1) % LOG_MAX;
  if (logCount < LOG_MAX) logCount++;
}

// ================= PZEM-004T: STATE & CACHE =================
// Handler HTTP HANYA membaca cache ini; serial PZEM dibaca dari loop() saja
// agar SoftwareSerial tidak bentrok dengan WiFi/HTTP.
float pzemTegangan = NAN;
float pzemArus     = NAN;
float pzemDaya     = NAN;
float pzemEnergi   = NAN;
float pzemFrekuensi = NAN;
float pzemPF       = NAN;
bool  pzemValid    = false;

const unsigned long INTERVAL_PZEM = 2000; // baca & kirim tiap 2 detik
unsigned long terakhirBacaPZEM   = 0;
unsigned long terakhirKirimPZEM  = 0;

// Baca keenam nilai PZEM sekaligus. Semua-harus-valid; jika ada NaN → invalid.
void bacaPZEM() {
  if (millis() - terakhirBacaPZEM < INTERVAL_PZEM) return;
  terakhirBacaPZEM = millis();

  float v  = pzem.voltage();
  float a  = pzem.current();
  float w  = pzem.power();
  float e  = pzem.energy();
  float hz = pzem.frequency();
  float pf = pzem.pf();

  bool sebelumnyaValid = pzemValid;
  if (isnan(v) || isnan(a) || isnan(w) || isnan(e) || isnan(hz) || isnan(pf)) {
    pzemValid = false;
    if (sebelumnyaValid) {
      logLine(F("PZEM: pembacaan gagal (semua nilai jadi --)"));
    }
    return;
  }

  pzemTegangan  = v;
  pzemArus      = a;
  pzemDaya      = w;
  pzemEnergi    = e;
  pzemFrekuensi = hz;
  pzemPF        = pf;
  pzemValid = true;

  if (!sebelumnyaValid) {
    logLine(F("PZEM: terdeteksi, mulai membaca data listrik"));
  }
}

// Kirim nilai PZEM (dari cache) ke endpoint ingest listrik iot-api tiap 2 detik.
void kirimPZEMKeServer() {
  if (millis() - terakhirKirimPZEM < INTERVAL_PZEM) return;
  terakhirKirimPZEM = millis();

  if (!pzemValid) return;                       // jangan kirim data invalid
  if (WiFi.status() != WL_CONNECTED) return;    // tanpa WiFi lewati saja

  String payload;
  payload.reserve(192);
  payload  = F("{\"object\":{\"tegangan\":");
  payload += String(pzemTegangan, 1);
  payload += F(",\"arus\":");
  payload += String(pzemArus, 2);
  payload += F(",\"daya\":");
  payload += String(pzemDaya, 1);
  payload += F(",\"energi\":");
  payload += String(pzemEnergi, 3);
  payload += F(",\"frekuensi\":");
  payload += String(pzemFrekuensi, 1);
  payload += F(",\"power_factor\":");
  payload += String(pzemPF, 2);
  payload += F("}}");

  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_HTTPS ? F("https://") : F("http://")) + SERVER_HOST + ":" + SERVER_PORT + SERVER_PATH;

  http.setTimeout(3000);
  if (http.begin(client, url)) {
    http.addHeader(F("Content-Type"), F("application/json"));
    http.addHeader(F("X-Device-Token"), DEVICE_TOKEN);
    int code = http.POST(payload);
    if (code > 0) {
      logLine(String(F("PZEM->server: HTTP ")) + code);
    } else {
      logLine(String(F("PZEM->server: gagal, ")) + http.errorToString(code));
    }
    http.end();
  } else {
    logLine(F("PZEM->server: tidak bisa membuka koneksi"));
  }
}

// ================= EKSEKUSI PERINTAH (DIPAKAI ESP-NOW & WEB) =================
void jalankanPerintah(const String& cmd, int durasi, const char* sumber) {
  if (cmd == "POMPA") {
    if (!pompaB_Aktif) {
      durasiB = durasi > 0 ? (unsigned long)durasi : 0;
      waktuMulaiB = millis();
      pompaB_Aktif = true;
      digitalWrite(pinMOSFET_B, HIGH); // Buka gerbang MOSFET B (Pompa AB Mix Menyala)
      logLine(F("Status: MOSFET B AKTIF (Pompa AB Mix Menyala)"));
      tambahLog(sumber, String(F("POMPA ")) + durasiB + F(" ms"));
    } else {
      tambahLog(sumber, F("POMPA (diabaikan, sudah aktif)"));
    }
    return;
  }

  if (cmd == "POMPA_STOP") {
    digitalWrite(pinMOSFET_B, LOW);
    pompaB_Aktif = false;
    logLine(F("Status: Pompa AB Mix DIHENTIKAN"));
    tambahLog(sumber, F("POMPA STOP"));
    return;
  }

  int idx = -1;
  bool nyala = false;
  if (cmd.startsWith(F("RELAY_"))) {
    int n = cmd.charAt(6) - '0';
    if (n >= 1 && n <= 4) {
      idx = n - 1;
      nyala = cmd.endsWith(F("_ON"));
    }
  }

  if (idx >= 0) {
    digitalWrite(pinRelayArr[idx], nyala ? HIGH : LOW); // Active High
    pinRelay[idx] = nyala;
    logLine(String(F("Relay ")) + (idx + 1) + (nyala ? F(" ON") : F(" OFF")));
    tambahLog(sumber, String(F("RELAY_")) + (idx + 1) + (nyala ? F("_ON") : F("_OFF")));
  } else {
    logLine(String(F("Perintah tidak dikenal: ")) + cmd);
    tambahLog(sumber, String(F("? ")) + cmd);
  }
}

// ================= CONFIG WIFI: EEPROM, ROLLBACK, STATUS =================
void loadCfg() {
  EEPROM.begin(512);
  EEPROM.get(0, cfg);
  if (cfg.magic != CFG_MAGIC) {
    memset(&cfg, 0, sizeof(cfg));
    cfg.magic = CFG_MAGIC;
    strncpy(cfg.ssid, WIFI_SSID, sizeof(cfg.ssid) - 1);
    strncpy(cfg.pass, WIFI_PASS, sizeof(cfg.pass) - 1);
    EEPROM.put(0, cfg);
    EEPROM.commit();
  }
}

void saveCfg() {
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

bool connectWifi(const char* ssid, const char* pass, unsigned long timeoutMs) {
  if (!ssid || !ssid[0]) return false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(200);
  }
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleepMode(WIFI_NONE_SLEEP);
    return true;
  }
  return false;
}

// Cek server terjangkau (dipakai untuk memastikan kredensial baru benar-benar
// membawa perangkat kembali online sebelum config pending dipromosikan).
bool serverReachable() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_HTTPS ? F("https://") : F("http://")) + SERVER_HOST + ":" + SERVER_PORT + "/api/version";
  http.setTimeout(5000);
  if (!http.begin(client, url)) return false;
  http.addHeader(F("X-Device-Token"), DEVICE_TOKEN);
  int code = http.GET();
  http.end();
  return code >= 200 && code < 300;
}

void bootWifi() {
  loadCfg();

  if (cfg.revPend > cfg.revApplied && cfg.ssidPend[0]) {
    logLine(String(F("[WiFi] Mencoba config baru: ")) + cfg.ssidPend);
    if (connectWifi(cfg.ssidPend, cfg.passPend, 20000) && serverReachable()) {
      strncpy(cfg.ssid, cfg.ssidPend, sizeof(cfg.ssid) - 1);
      strncpy(cfg.pass, cfg.passPend, sizeof(cfg.pass) - 1);
      cfg.revApplied = cfg.revPend;
      cfg.ssidPend[0] = '\0';
      cfg.passPend[0] = '\0';
      cfg.revPend = 0;
      cfg.lastErr[0] = '\0';
      saveCfg();
      logLine(F("[WiFi] Config baru diterapkan."));
      return;
    }
    strncpy(cfg.lastErr, "wifi-apply-failed", sizeof(cfg.lastErr) - 1);
    cfg.ssidPend[0] = '\0';
    cfg.passPend[0] = '\0';
    cfg.revPend = 0;
    saveCfg();
    logLine(F("[WiFi] Config baru gagal, rollback ke kredensial lama."));
  }

  if (!connectWifi(cfg.ssid, cfg.pass, 30000)) {
    logLine(F("[WiFi] Gagal menyambung. Menunggu config dari ESP32/portal."));
  } else {
    logLine(String(F("[WiFi] Terhubung. IP: ")) + WiFi.localIP().toString());
  }
}

// Kirim frame balasan (ACK) ke ESP32 pengirim.
void sendFrame(uint8_t* mac, const char* type, uint16_t rev) {
  struct_config frame;
  memset(&frame, 0, sizeof(frame));
  strncpy(frame.type, type, sizeof(frame.type) - 1);
  frame.revision = rev;

  esp_now_add_peer(mac, ESP_NOW_ROLE_CONTROLLER, WiFi.channel(), NULL, 0);
  esp_now_send(mac, (uint8_t*)&frame, sizeof(frame));
}

// Lapor status perangkat ke server (WiFi + revisi config).
void reportStatus() {
  if (WiFi.status() != WL_CONNECTED) return;

  String body;
  body.reserve(260);
  body  = F("{\"deviceId\":\"");
  body += DEVICE_ID;
  body += F("\",\"role\":\"node\",\"firmware\":\"");
  body += FIRMWARE_VERSION;
  body += F("\",\"ssid\":\"");
  body += WiFi.SSID();
  body += F("\",\"appliedRevision\":");
  body += cfg.revApplied;
  body += F(",\"pendingRevision\":");
  body += cfg.revPend;
  body += F(",\"ip\":\"");
  body += WiFi.localIP().toString();
  body += F("\",\"rssi\":");
  body += WiFi.RSSI();
  body += F(",\"linkOk\":true,\"lastError\":\"");
  body += cfg.lastErr;
  body += F("\"}");

  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_HTTPS ? F("https://") : F("http://")) + SERVER_HOST + ":" + SERVER_PORT + "/api/device/status";
  http.setTimeout(3000);
  if (http.begin(client, url)) {
    http.addHeader(F("Content-Type"), F("application/json"));
    http.addHeader(F("X-Device-Token"), DEVICE_TOKEN);
    int code = http.POST(body);
    http.end();
    if (code >= 200 && code < 300) {
      logLine(F("[HTTP] Status perangkat dilaporkan."));
    }
  }
}

// Fungsi Callback saat data diterima via ESP-NOW dari ESP32
void OnDataRecv(uint8_t * mac, uint8_t *incomingData, uint8_t len) {
  // Frame config WiFi (ukurannya beda dari struct_message lama).
  if (len == sizeof(struct_config)) {
    struct_config frame;
    memcpy(&frame, incomingData, sizeof(frame));
    frame.type[sizeof(frame.type) - 1] = '\0';

    if (strcmp(frame.type, "CFG") == 0) {
      if (goPending) return; // sudah dijadwalkan pindah, abaikan CFG baru
      cfgPendSsid = String(frame.ssid);
      cfgPendPass = String(frame.pass);
      cfgPendRev = frame.revision;
      cfgPendingValid = true;
      cfgPendingExpire = millis() + 30000;
      logLine(String(F("[WiFi] CFG diterima rev ")) + cfgPendRev);
      sendFrame(mac, "ACK", frame.revision);
      return;
    }

    if (strcmp(frame.type, "GO") == 0) {
      if (cfgPendingValid && frame.revision == cfgPendRev) {
        // Commit EEPROM & restart ditangani loop() agar tidak menulis flash
        // di dalam callback WiFi.
        goPending = true;
        restartAt = millis() + 12000;
        cfgPendingValid = false;
        logLine(F("[WiFi] GO diterima, restart dalam 12 detik."));
        sendFrame(mac, "ACK", frame.revision);
      }
      return;
    }
    return;
  }

  // Perintah aktuator lama.
  memcpy(&dataTerima, incomingData, sizeof(dataTerima));
  dataTerima.perintah[sizeof(dataTerima.perintah) - 1] = '\0';

  logLine(F("=== PERINTAH MASUK (ESP-NOW) ==="));
  logLine(String(F("Target: ")) + dataTerima.perintah);
  logLine(String(F("Durasi: ")) + dataTerima.durasi + F(" ms"));

  jalankanPerintah(String(dataTerima.perintah), dataTerima.durasi, "ESP-NOW");
}

// ================= HALAMAN WEB =================
const char HALAMAN_INDEX[] PROGMEM = R"=====(
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Green House Control</title>
<style>
  *{box-sizing:border-box;}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:16px;background:#eef2f5;color:#22303c;}
  .wrap{max-width:520px;margin:0 auto;}
  h1{font-size:20px;margin:0 0 4px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;}
  .sub{font-size:12px;color:#6b7c8c;margin:0 0 12px;}
  .card{background:#fff;border-radius:10px;padding:14px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.12);}
  .row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 0;border-bottom:1px solid #eef2f5;}
  .row:last-child{border-bottom:none;}
  .name{font-weight:bold;}
  .state{font-size:12px;color:#6b7c8c;margin-left:8px;}
  .actions{display:flex;gap:6px;flex-wrap:wrap;}
  button{border:none;border-radius:6px;padding:0 14px;height:36px;font-size:13px;color:#fff;cursor:pointer;}
  .on{background:#2e9e5b;}
  .off{background:#c0392b;}
  .go{background:#2b6cb0;}
  .stop{background:#8e44ad;}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;color:#fff;background:#95a5a6;}
  .badge.on{background:#2e9e5b;}
  input[type=number]{width:110px;height:36px;padding:0 8px;border:1px solid #cbd5e0;border-radius:6px;font-size:13px;}
  #log{font-family:Consolas,monospace;font-size:12px;max-height:230px;overflow:auto;background:#0f1b26;color:#b8e0c0;border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;}
  @media (max-width:480px){
    body{padding:12px;}
    button{font-size:12px;padding:0 10px;}
    input[type=number]{width:96px;}
  }
</style>
</head>
<body>
<div class="wrap">
<h1>Green House Control <span class="badge" id="pompaBadge">Pompa: OFF</span></h1>
<div class="sub" id="ip">Memuat...</div>

<div class="card">
  <div class="row"><span><span class="name">Relay 1</span><span class="state" id="s1">OFF</span></span>
    <span class="actions"><button class="on" onclick="relay(1,1)">ON</button><button class="off" onclick="relay(1,0)">OFF</button></span></div>
  <div class="row"><span><span class="name">Relay 2</span><span class="state" id="s2">OFF</span></span>
    <span class="actions"><button class="on" onclick="relay(2,1)">ON</button><button class="off" onclick="relay(2,0)">OFF</button></span></div>
  <div class="row"><span><span class="name">Relay 3</span><span class="state" id="s3">OFF</span></span>
    <span class="actions"><button class="on" onclick="relay(3,1)">ON</button><button class="off" onclick="relay(3,0)">OFF</button></span></div>
  <div class="row"><span><span class="name">Relay 4</span><span class="state" id="s4">OFF</span></span>
    <span class="actions"><button class="on" onclick="relay(4,1)">ON</button><button class="off" onclick="relay(4,0)">OFF</button></span></div>
</div>

<div class="card">
  <div class="row"><span class="name">Pompa AB Mix</span><span class="state" id="sPompa">OFF</span></div>
  <div class="row"><span>Durasi (ms)</span>
    <span class="actions"><input type="number" id="durasi" value="5000" min="1" step="100">
    <button class="go" onclick="pompa()">Jalankan</button>
    <button class="stop" onclick="stopPompa()">Stop</button></span></div>
</div>

<div class="card">
  <div class="row"><span class="name">PZEM-004T</span><span class="badge" id="pzemBadge">PZEM: --</span></div>
  <div class="row"><span>Tegangan</span><span class="state" id="pzV">--</span></div>
  <div class="row"><span>Arus</span><span class="state" id="pzA">--</span></div>
  <div class="row"><span>Daya</span><span class="state" id="pzW">--</span></div>
  <div class="row"><span>Energi</span><span class="state" id="pzE">--</span></div>
  <div class="row"><span>Frekuensi</span><span class="state" id="pzHz">--</span></div>
  <div class="row"><span>Power Factor</span><span class="state" id="pzPF">--</span></div>
</div>

<div class="card">
  <div class="name" style="margin-bottom:8px;">WiFi (read-only)</div>
  <div class="row"><span>SSID</span><span class="state" id="wfSsid">--</span></div>
  <div class="row"><span>IP</span><span class="state" id="wfIp">--</span></div>
  <div class="row"><span>Sinyal</span><span class="state" id="wfRssi">--</span></div>
  <div class="row"><span>Revisi config</span><span class="state" id="wfRev">--</span></div>
  <div class="row"><span>Error terakhir</span><span class="state" id="wfErr">-</span></div>
  <div class="sub" style="margin:8px 0 0;">Ubah WiFi dari dashboard web (menu Settings &gt; WiFi).</div>
</div>

<div class="card">
  <div class="name" style="margin-bottom:8px;">Log Riwayat Perintah</div>
  <div id="log"></div>
</div>
</div>

<script>
function relay(n,st){fetch('/relay?n='+n+'&state='+(st?'on':'off')).then(update);}
function pompa(){var d=parseInt(document.getElementById('durasi').value)||0;fetch('/pompa?durasi='+d).then(update);}
function stopPompa(){fetch('/pompa/stop').then(update);}
function update(){fetch('/status').then(function(r){return r.json();}).then(function(j){
  for(var i=1;i<=4;i++){document.getElementById('s'+i).textContent=j.relay[i-1]?'ON':'OFF';}
  var pb=document.getElementById('pompaBadge');
  document.getElementById('sPompa').textContent=j.pompa?'ON ('+j.sisa+' ms)':'OFF';
  pb.textContent='Pompa: '+(j.pompa?'ON':'OFF');
  pb.className='badge'+(j.pompa?' on':'');
  document.getElementById('ip').textContent='IP: '+j.ip;
  document.getElementById('wfSsid').textContent=j.ssid||'--';
  document.getElementById('wfIp').textContent=j.ip||'--';
  document.getElementById('wfRssi').textContent=(j.rssi||j.rssi===0)?(j.rssi+' dBm'):'--';
  document.getElementById('wfRev').textContent=(j.rev||0);
  document.getElementById('wfErr').textContent=j.err||'-';
});fetch('/log').then(function(r){return r.text();}).then(function(t){document.getElementById('log').textContent=t;});}
function f(v,d,s){return (v===null||v===undefined)?'--':v.toFixed(d)+' '+s;}
function updatePZEM(){fetch('/pzem').then(function(r){return r.json();}).then(function(j){
  var pz=document.getElementById('pzemBadge');
  pz.textContent='PZEM: '+(j.valid?'OK':'--');
  pz.className='badge'+(j.valid?' on':'');
  document.getElementById('pzV').textContent=f(j.tegangan,1,'V');
  document.getElementById('pzA').textContent=f(j.arus,2,'A');
  document.getElementById('pzW').textContent=f(j.daya,1,'W');
  document.getElementById('pzE').textContent=f(j.energi,3,'kWh');
  document.getElementById('pzHz').textContent=f(j.frekuensi,1,'Hz');
  document.getElementById('pzPF').textContent=f(j.pf,2,'');
});}
update();updatePZEM();setInterval(function(){update();updatePZEM();},2000);
</script>
</body>
</html>
)=====";

void handleIndex() {
  server.send(200, F("text/html"), FPSTR(HALAMAN_INDEX));
}

void handleRelay() {
  int n = server.hasArg("n") ? server.arg("n").toInt() : 0;
  String st = server.arg("state");
  if (n < 1 || n > 4 || (st != "on" && st != "off")) {
    server.send(400, F("text/plain"), F("Parameter tidak valid"));
    return;
  }
  jalankanPerintah(String(F("RELAY_")) + n + (st == "on" ? F("_ON") : F("_OFF")), 0, "WEB");
  server.send(200, F("application/json"),
              String(F("{\"ok\":true,\"relay\":")) + n + F(",\"state\":\"") + st + F("\"}"));
}

void handlePompa() {
  int d = server.hasArg("durasi") ? server.arg("durasi").toInt() : 0;
  jalankanPerintah(F("POMPA"), d, "WEB");
  server.send(200, F("application/json"), String(F("{\"ok\":true,\"durasi\":")) + d + F("}"));
}

void handlePompaStop() {
  jalankanPerintah(F("POMPA_STOP"), 0, "WEB");
  server.send(200, F("application/json"), F("{\"ok\":true}"));
}

void handleStatus() {
  unsigned long sisa = 0;
  if (pompaB_Aktif) {
    unsigned long elapsed = millis() - waktuMulaiB;
    sisa = (elapsed >= durasiB) ? 0 : (durasiB - elapsed);
  }
  String j;
  j.reserve(280);
  j += F("{\"relay\":[");
  for (int i = 0; i < 4; i++) {
    if (i) j += ',';
    j += pinRelay[i] ? F("true") : F("false");
  }
  j += F("],\"pompa\":");
  j += pompaB_Aktif ? F("true") : F("false");
  j += F(",\"sisa\":");
  j += sisa;
  j += F(",\"ip\":\"");
  j += WiFi.localIP().toString();
  j += F("\",\"ssid\":\"");
  j += WiFi.SSID();
  j += F("\",\"rssi\":");
  j += WiFi.RSSI();
  j += F(",\"rev\":");
  j += cfg.revApplied;
  j += F(",\"err\":\"");
  j += cfg.lastErr;
  j += F("\"}");
  server.send(200, F("application/json"), j);
}

void handleLog() {
  String out;
  out.reserve(1200);
  int start = (logCount < LOG_MAX) ? 0 : logHead;
  for (int i = 0; i < logCount; i++) {
    int idx = (start + i) % LOG_MAX;
    out += logRiwayat[idx];
    out += '\n';
  }
  if (out.length() == 0) out = F("(belum ada perintah)\n");
  server.send(200, F("text/plain"), out);
}

void handlePZEM() {
  String j;
  j.reserve(200);
  j += F("{\"valid\":");
  j += pzemValid ? F("true") : F("false");
  if (pzemValid) {
    j += F(",\"tegangan\":");  j += String(pzemTegangan, 1);
    j += F(",\"arus\":");      j += String(pzemArus, 2);
    j += F(",\"daya\":");      j += String(pzemDaya, 1);
    j += F(",\"energi\":");    j += String(pzemEnergi, 3);
    j += F(",\"frekuensi\":"); j += String(pzemFrekuensi, 1);
    j += F(",\"pf\":");        j += String(pzemPF, 2);
  } else {
    j += F(",\"tegangan\":null,\"arus\":null,\"daya\":null,");
    j += F("\"energi\":null,\"frekuensi\":null,\"pf\":null");
  }
  j += F("}");
  server.send(200, F("application/json"), j);
}

void handleNotFound() {
  server.send(404, F("text/plain"), F("Halaman tidak ditemukan"));
}

void setupWebServer() {
  server.on(F("/"), handleIndex);
  server.on(F("/relay"), handleRelay);
  server.on(F("/pompa"), handlePompa);
  server.on(F("/pompa/stop"), handlePompaStop);
  server.on(F("/status"), handleStatus);
  server.on(F("/log"), handleLog);
  server.on(F("/pzem"), handlePZEM);
  server.onNotFound(handleNotFound);
  server.begin();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Serial untuk PZEM via SoftwareSerial (9600 8N1, Modbus-RTU)
  pzemSerial.begin(9600);

  // Set pin MOSFET sebagai OUTPUT
  pinMode(pinMOSFET_B, OUTPUT);
  
  // Set pin Relay sebagai OUTPUT
  pinMode(pinRelay1, OUTPUT);
  pinMode(pinRelay2, OUTPUT);
  pinMode(pinRelay3, OUTPUT);
  pinMode(pinRelay4, OUTPUT);
  
  // Pastikan di awal gerbang MOSFET tertutup (Pompa Mati)
  digitalWrite(pinMOSFET_B, LOW);

  // Pastikan Relay mati di awal (Active High: LOW = OFF)
  digitalWrite(pinRelay1, LOW);
  digitalWrite(pinRelay2, LOW);
  digitalWrite(pinRelay3, LOW);
  digitalWrite(pinRelay4, LOW);

  // Aktifkan WiFi Mode Station (Syarat ESP-NOW)
  WiFi.mode(WIFI_STA);

  // Connect ke AP dari EEPROM (fallback ke kredensial firmware saat kosong).
  // Koneksi ini menyamakan channel ESP-NOW, sekaligus dipakai untuk mengirim
  // data PZEM ke server (POST /api/listrik/ingest).
  bootWifi();
  Serial.print(F("\n"));
  Serial.print(F("sizeof(struct_config) = "));
  Serial.println((int)sizeof(struct_config));

  // Sinkronkan waktu untuk timestamp log (NTP butuh internet). Bila gagal,
  // akan dicoba lagi dari loop() setelah WiFi tersambung.
  sinkronWaktuNTP();

  // Matikan WiFi modem sleep agar radio selalu aktif menerima ESP-NOW.
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  
  // Tampilkan MAC Address ke Serial Monitor agar bisa di-copy ke ESP32
  logLine(String(F("MAC Address NodeMCU: ")) + WiFi.macAddress());

  // Inisialisasi ESP-NOW
  if (esp_now_init() != 0) {
    logLine(F("Gagal menginisialisasi ESP-NOW!"));
    return;
  }
  
  // Peran COMBO: menerima perintah DAN membalas ACK config ke ESP32.
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_register_recv_cb(OnDataRecv);
  
  // Aktifkan web server untuk kontrol relay & pompa
  setupWebServer();
  logLine(String(F("Web server aktif di http://")) + WiFi.localIP().toString() + F("/"));

  if (WiFi.status() == WL_CONNECTED) reportStatus();

  logLine(F("NodeMCU Siap Mengontrol MOSFET LR7843 via ESP-NOW!"));
}

void loop() {
  // Layani request HTTP dari browser (non-blocking)
  server.handleClient();

  // Commit config pending setelah GO (di luar callback ESP-NOW).
  if (goPending && !restartScheduled) {
    memset(cfg.ssidPend, 0, sizeof(cfg.ssidPend));
    memset(cfg.passPend, 0, sizeof(cfg.passPend));
    strncpy(cfg.ssidPend, cfgPendSsid.c_str(), sizeof(cfg.ssidPend) - 1);
    strncpy(cfg.passPend, cfgPendPass.c_str(), sizeof(cfg.passPend) - 1);
    cfg.revPend = cfgPendRev;
    saveCfg();
    restartScheduled = true;
    logLine(F("[WiFi] Config pending disimpan ke EEPROM."));
  }

  // Jadwal restart setelah frame GO (diberi jeda agar ESP32 selesai ACK).
  if (restartScheduled && millis() >= restartAt) {
    logLine(F("[WiFi] Restart untuk menerapkan config baru."));
    delay(100);
    ESP.restart();
  }

  // Buang config pending yang tidak pernah menerima GO.
  if (cfgPendingValid && millis() > cfgPendingExpire) {
    cfgPendingValid = false;
    cfgPendSsid = "";
    cfgPendPass = "";
    logLine(F("[WiFi] Config pending kedaluwarsa (tanpa GO)."));
  }

  // Jaga koneksi WiFi (channel harus tetap sama dengan ESP32).
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long terakhirCoba = 0;
    if (millis() - terakhirCoba >= 5000) {
      terakhirCoba = millis();
      logLine(F("WiFi terputus, menyambung ulang..."));
      WiFi.begin(cfg.ssid, cfg.pass);
    }
  } else {
    sinkronWaktuNTP(); // coba lagi sampai NTP berhasil

    // Status perangkat tiap 60 detik.
    static unsigned long terakhirStatus = 0;
    if (millis() - terakhirStatus >= 60000UL) {
      terakhirStatus = millis();
      reportStatus();
    }
  }

  // Pengecekan Waktu Otomatis untuk Pompa AB Mix (Non-blocking)
  if (pompaB_Aktif) {
    if (millis() - waktuMulaiB >= durasiB) {
      digitalWrite(pinMOSFET_B, LOW); // Tutup gerbang MOSFET B (Pompa Mati)
      pompaB_Aktif = false;
      logLine(F("Status: Pompa AB Mix SELESAI (MATI)"));
      tambahLog("SISTEM", F("POMPA SELESAI (auto)"));
    }
  }

  // PZEM: baca tiap 2 detik, lalu kirim ke server (keduanya non-blocking)
  bacaPZEM();
  kirimPZEMKeServer();
}
