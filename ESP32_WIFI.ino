#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "DHT.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include "DFRobot_LTR390UV.h"

// ================= KONFIGURASI WIFI & SERVER =================
// Kredensial WiFi + token perangkat ada di secrets.h (gitignored).
// Salin secrets.h.example -> secrets.h lalu isi nilai sebenarnya.
// WIFI_SSID/WIFI_PASS hanya dipakai sebagai kredensial AWAL saat NVS kosong;
// setelah itu WiFi diatur dari menu Settings (disimpan di NVS).
#include "secrets.h"

// Basis URL server.
// LAN (lebih cepat, tanpa TLS): http://192.168.2.10:5005
// Produksi (via Cloudflare Tunnel): https://hidroponik.phd.my.id
const char* SERVER_BASE = "https://hidroponik.phd.my.id";

#define FIRMWARE_VERSION "1.1.0"
#define DEVICE_ID "utama"

const unsigned long POLL_INTERVAL = 5000;   // polling perintah (ms)
// Latency lewat Cloudflare + TLS handshake terukur ~1.2-3.0s, jadi timeout
// diberi margin (jangan 5s, terlalu mepet dan request bisa gagal acak).
const uint16_t HTTP_TIMEOUT_MS    = 10000;  // timeout HTTP (ms)

// ================= MAC ADDRESS NODEMCU (SLAVE) =================
uint8_t macNodeMCU[] = {0xEC, 0xFA, 0xBC, 0xCB, 0x21, 0x68}; 

// ================= STRUKTUR DATA ESP-NOW =================
// PENTING: struct ini harus SAMA PERSIS dengan struct di NodeMCU slave.
// perintah[16] agar "RELAY_1_ON" (11 byte) tidak overflow.
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

struct_message dataKirim;
esp_now_peer_info_t peerInfo;

// ================= CONFIG WIFI DI NVS =================
// Namespace hydro-cfg. Kredensial aktif dipakai saat boot; kredensial pending
// (dari Settings) dicoba lebih dulu, dan otomatis di-rollback bila gagal.
Preferences prefs;
String cfgSsid, cfgPass;
String pendSsid, pendPass;
uint16_t revApplied = 0;
uint16_t revPend = 0;
String lastErr;

volatile bool cfgAckOk = false;
volatile uint16_t cfgAckRev = 0;
bool lastLinkOk = true;

// Hasil scan WiFi terakhir (dikirim ke server lewat status).
struct ScanEntry {
    char ssid[33];
    int8_t rssi;
    bool secure;
};
const int SCAN_MAX = 20;
ScanEntry scanList[SCAN_MAX];
int scanCount = 0;
bool scanPendingReport = false;

// Forward declaration (dipakai helper WiFi sebelum definisinya).
int httpRequest(const char* method, const String& path, const String& body, String& response);

// ================= CONFIG SENSOR SUHU UDARA (DHT11) =================
#define DHTPIN 4        
#define DHTTYPE DHT11   
DHT dht(DHTPIN, DHTTYPE);

// ================= CONFIG SENSOR SUHU AIR (DS18B20) =================
#define ONE_WIRE_BUS 23
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// ================= CONFIG SENSOR UV (DFRobot LTR390) =================
#define I2C_SDA 21 
#define I2C_SCL 22 
DFRobot_LTR390UV ltr390(LTR390UV_DEVICE_ADDR, &Wire);

// Variabel non-blocking untuk Sensor LTR390
unsigned long waktuBacaLTR = 0;
uint32_t nilai_uv_global = 0; // Menyimpan nilai penuh (uint32), tidak dipotong 16-bit

// ================= CONFIG SENSOR TDS (ANALOG) =================
#define PIN_SENSOR_TDS 36 

// ================= VARIABEL GLOBAL SENSOR & KONTROL =================
float nilai_tds_global = 0.0;
uint8_t status_relay_1 = 0; // 0 = OFF, 1 = ON
uint8_t status_relay_2 = 0; // 0 = OFF, 1 = ON
uint8_t status_relay_3 = 0; // 0 = OFF, 1 = ON
uint8_t status_relay_4 = 0; // 0 = OFF, 1 = ON       

unsigned int TX_INTERVAL = 60;      // interval uplink (detik)

uint16_t targetTDS = 0;             
uint16_t volumeTandon = 0;          
uint16_t konstantaPupuk = 0;        
const float DEBIT_POMPA = 5.0;      

unsigned long waktuCekTDS = 0;      
unsigned long cooldownPompa = 0;    
const unsigned long INTERVAL_CEK = 60000;   

// ================= TIMER NON-BLOCKING =================
unsigned long waktuUplinkTerakhir = 0;
unsigned long waktuPollTerakhir = 0;
unsigned long waktuStatusTerakhir = 0;
// Uplink sensor "segera" HANYA dipakai saat WiFi baru tersambung (agar data
// pertama tidak menunggu TX_INTERVAL). Perubahan relay TIDAK memicunya lagi:
// status relay dikirim lewat endpoint terpisah tanpa data sensor.
bool uplinkSegera = false;
bool laporRelaySegera = false; // kirim status relay begitu WiFi siap

// ================= LOGGING DENGAN TIMESTAMP =================
// Waktu diambil dari NTP (WIB, UTC+7). Bila belum sinkron, dipakai uptime
// sebagai penanda agar urutan log tetap terbaca.
const long GMT_OFFSET_WIB   = 7 * 3600;
const int  DAYLIGHT_OFFSET  = 0;

void logPrefix() {
    time_t now = time(nullptr);
    struct tm timeinfo;
    localtime_r(&now, &timeinfo);
    if (timeinfo.tm_year > (2016 - 1900)) { // waktu NTP valid
        char buf[16];
        strftime(buf, sizeof(buf), "[%H:%M:%S] ", &timeinfo);
        Serial.print(buf);
    } else {
        Serial.printf("[+%lus] ", millis() / 1000);
    }
}

void logLine(const String& msg) {
    logPrefix();
    Serial.println(msg);
}

// ================= FUNGSI KIRIM ESP-NOW KE NODEMCU =================
void kirimPerintahKeNodeMCU(const char* targetAktuator, int durasiMs) {
    memset(dataKirim.perintah, 0, sizeof(dataKirim.perintah));
    strncpy(dataKirim.perintah, targetAktuator, sizeof(dataKirim.perintah) - 1);
    dataKirim.durasi = durasiMs;

    esp_err_t result = esp_now_send(macNodeMCU, (uint8_t *) &dataKirim, sizeof(dataKirim));
    if (result == ESP_OK) {
        logLine(String(F("[ESP-NOW] Berhasil kirim perintah ke NodeMCU: ")) + targetAktuator
                + F(" | Durasi: ") + durasiMs);
    } else {
        logLine(F("[ESP-NOW] Gagal mengirim data!"));
    }
}

// ================= KONFIGURASI WIFI (NVS + ROLLBACK + PORTAL) =================
void loadWifiConfig() {
    prefs.begin("hydro-cfg", false);
    cfgSsid = prefs.getString("ssid", "");
    cfgPass = prefs.getString("pass", "");
    revApplied = prefs.getUShort("revApplied", 0);
    pendSsid = prefs.getString("ssidPend", "");
    pendPass = prefs.getString("passPend", "");
    revPend = prefs.getUShort("revPend", 0);
    lastErr = prefs.getString("lastErr", "");

    // NVS kosong -> pakai kredensial firmware sebagai titik awal.
    if (cfgSsid.isEmpty()) {
        cfgSsid = WIFI_SSID;
        cfgPass = WIFI_PASS;
        prefs.putString("ssid", cfgSsid);
        prefs.putString("pass", cfgPass);
    }
}

void saveLastError(const String& err) {
    lastErr = err;
    prefs.putString("lastErr", lastErr);
}

bool connectWifi(const String& ssid, const String& pass, unsigned long timeoutMs) {
    if (ssid.isEmpty()) return false;
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
        delay(200);
    }
    if (WiFi.status() == WL_CONNECTED) {
        WiFi.setSleep(false);
        return true;
    }
    return false;
}

bool serverReachable() {
    if (WiFi.status() != WL_CONNECTED) return false;
    String resp;
    int status = httpRequest("GET", "/api/version", "", resp);
    return status >= 200 && status < 300;
}

// Captive portal darurat: hanya aktif bila perangkat tidak bisa masuk AP mana
// pun. Menyimpan config baru lalu restart.
WebServer portalServer(80);
DNSServer portalDns;
bool portalActive = false;

const char PORTAL_PAGE[] PROGMEM = R"HTML(
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Config WiFi Hidroponik</title>
<style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background:#eef2f5;color:#22303c}
.wrap{max-width:420px;margin:0 auto}h1{font-size:18px}
.card{background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.12)}
label{display:block;font-size:12px;font-weight:bold;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;height:38px;padding:0 10px;border:1px solid #cbd5e0;border-radius:6px}
button{margin-top:16px;width:100%;height:40px;border:none;border-radius:6px;background:#2b6cb0;color:#fff;font-size:14px}
p{font-size:12px;color:#6b7c8c}</style></head><body><div class="wrap">
<h1>Config WiFi Hidroponik</h1><div class="card">
<form method="POST" action="/save">
<label>SSID</label><input name="ssid" maxlength="32" required>
<label>Password</label><input name="pass" type="password" maxlength="63">
<button type="submit">Simpan &amp; Restart</button>
</form><p>Perangkat akan restart dan mencoba tersambung. Bila gagal, portal ini muncul lagi.</p>
</div></div></body></html>
)HTML";

void startCaptivePortal() {
    if (portalActive) return;
    portalActive = true;
    logLine(F("[WiFi] Gagal tersambung - membuka captive portal"));

    // Nama AP memakai 4 digit terakhir chip id agar mudah dikenali.
    char apName[24];
    snprintf(apName, sizeof(apName), "Hidro-Setup-%04X", (unsigned)((uint32_t)ESP.getEfuseMac() & 0xFFFF));
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(apName);

    portalDns.start(53, "*", WiFi.softAPIP());
    portalServer.on("/", []() { portalServer.send(200, "text/html", FPSTR(PORTAL_PAGE)); });
    portalServer.on("/save", []() {
        String ssid = portalServer.arg("ssid");
        String pass = portalServer.arg("pass");
        if (ssid.isEmpty()) {
            portalServer.send(400, "text/plain", "SSID wajib diisi");
            return;
        }
        prefs.putString("ssidPend", ssid);
        prefs.putString("passPend", pass);
        prefs.putUShort("revPend", revApplied + 1);
        portalServer.send(200, "text/html",
                          "<h3>Tersimpan. Perangkat restart...</h3>");
        delay(800);
        ESP.restart();
    });
    portalServer.onNotFound([]() {
        portalServer.sendHeader("Location", "http://192.168.4.1/", true);
        portalServer.send(302, "text/plain", "");
    });
    portalServer.begin();

    // Layani portal maksimal 5 menit; setelah itu restart agar perangkat
    // mencoba lagi koneksi normal (mis. AP sempat mati sesaat).
    unsigned long mulaiPortal = millis();
    while (millis() - mulaiPortal < 5UL * 60UL * 1000UL) {
        portalDns.processNextRequest();
        portalServer.handleClient();
        delay(2);
    }
    logLine(F("[WiFi] Portal timeout, restart untuk mencoba ulang."));
    ESP.restart();
}

// Cek kredensial pending saat boot: 30 detik + verifikasi server.
void bootWifi() {
    loadWifiConfig();

    if (revPend > revApplied && !pendSsid.isEmpty()) {
        logLine(String(F("[WiFi] Mencoba config baru: ")) + pendSsid);
        if (connectWifi(pendSsid, pendPass, 30000) && serverReachable()) {
            prefs.putString("ssid", pendSsid);
            prefs.putString("pass", pendPass);
            prefs.putUShort("revApplied", revPend);
            prefs.remove("ssidPend");
            prefs.remove("passPend");
            prefs.putUShort("revPend", 0);
            cfgSsid = pendSsid;
            cfgPass = pendPass;
            revApplied = revPend;
            revPend = 0;
            saveLastError("");
            logLine(F("[WiFi] Config baru diterapkan."));
            return;
        }
        // Rollback: buang pending, kembali ke kredensial lama.
        saveLastError("wifi-apply-failed");
        prefs.remove("ssidPend");
        prefs.remove("passPend");
        prefs.putUShort("revPend", 0);
        revPend = 0;
        logLine(F("[WiFi] Config baru gagal, rollback ke kredensial lama."));
    }

    if (!connectWifi(cfgSsid, cfgPass, 60000)) {
        startCaptivePortal();
    } else {
        logLine(String(F("[WiFi] Terhubung. IP: ")) + WiFi.localIP().toString());
    }
}

// Kirim CFG ke NodeMCU, tunggu ACK (maks 3 detik). true = ACK diterima.
bool sendCfgToNode(const String& ssid, const String& pass, uint16_t rev) {
    struct_config frame;
    memset(&frame, 0, sizeof(frame));
    strncpy(frame.type, "CFG", sizeof(frame.type) - 1);
    strncpy(frame.ssid, ssid.c_str(), sizeof(frame.ssid) - 1);
    strncpy(frame.pass, pass.c_str(), sizeof(frame.pass) - 1);
    frame.revision = rev;
    frame.force = 0;

    cfgAckOk = false;
    cfgAckRev = 0;

    unsigned long start = millis();
    while (millis() - start < 3000) {
        esp_err_t r = esp_now_send(macNodeMCU, (uint8_t*)&frame, sizeof(frame));
        lastLinkOk = (r == ESP_OK);
        delay(400);
        if (cfgAckOk && cfgAckRev == rev) return true;
    }
    return false;
}

void sendGoToNode(uint16_t rev) {
    struct_config frame;
    memset(&frame, 0, sizeof(frame));
    strncpy(frame.type, "GO", sizeof(frame.type) - 1);
    frame.revision = rev;
    esp_now_send(macNodeMCU, (uint8_t*)&frame, sizeof(frame));
}

// Terapkan perintah WiFi dari server.
void applyWifiCommand(const String& ssid, const String& pass, uint16_t rev, bool force) {
    logLine(String(F("[WiFi] Perintah config: ")) + ssid + F(" rev ") + rev);

    bool ack = sendCfgToNode(ssid, pass, rev);
    if (!ack && !force) {
        saveLastError("node-no-ack");
        logLine(F("[WiFi] NodeMCU tidak membalas ACK, config dibatalkan."));
        return;
    }

    prefs.putString("ssidPend", ssid);
    prefs.putString("passPend", pass);
    prefs.putUShort("revPend", rev);
    if (ack) sendGoToNode(rev);

    logLine(F("[WiFi] Config tersimpan, restart untuk menerapkan."));
    delay(300);
    ESP.restart();
}

void requestWifiScan() {
    logLine(F("[WiFi] Memindai SSID sekitar..."));
    int n = WiFi.scanNetworks();
    scanCount = 0;
    for (int i = 0; i < n && scanCount < SCAN_MAX; i++) {
        String s = WiFi.SSID(i);
        if (s.isEmpty()) continue;
        bool dup = false;
        for (int j = 0; j < scanCount; j++) {
            if (s == scanList[j].ssid) { dup = true; break; }
        }
        if (dup) continue;
        strncpy(scanList[scanCount].ssid, s.c_str(), sizeof(scanList[scanCount].ssid) - 1);
        scanList[scanCount].ssid[sizeof(scanList[scanCount].ssid) - 1] = '\0';
        scanList[scanCount].rssi = (int8_t)WiFi.RSSI(i);
        scanList[scanCount].secure = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
        scanCount++;
    }
    scanPendingReport = true;
    logLine(String(F("[WiFi] Scan selesai: ")) + scanCount + F(" SSID"));
}

// Laporkan status perangkat ke server (WiFi, revisi, hasil scan).
void reportStatus() {
    if (WiFi.status() != WL_CONNECTED) return;

    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["role"] = "esp32";
    doc["firmware"] = FIRMWARE_VERSION;
    doc["ssid"] = WiFi.SSID();
    doc["appliedRevision"] = revApplied;
    doc["pendingRevision"] = revPend;
    doc["ip"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    doc["linkOk"] = lastLinkOk;
    doc["lastError"] = lastErr;

    if (scanCount > 0) {
        JsonObject scan = doc["scan"].to<JsonObject>();
        scan["at"] = "";
        JsonArray nets = scan["networks"].to<JsonArray>();
        for (int i = 0; i < scanCount; i++) {
            JsonObject n = nets.add<JsonObject>();
            n["ssid"] = scanList[i].ssid;
            n["rssi"] = scanList[i].rssi;
            n["secure"] = scanList[i].secure;
        }
    }

    String body;
    serializeJson(doc, body);
    String resp;
    int status = httpRequest("POST", "/api/device/status", body, resp);
    if (status >= 200 && status < 300) {
        scanPendingReport = false;
    }
}


// ================= SINKRONISASI WAKTU (NTP) =================
// NTP butuh internet, jadi hanya dijalankan setelah WiFi tersambung.
// Non-blocking: SNTP client berjalan di background; di sini kita hanya membaca
// hasilnya lewat time() tanpa delay sama sekali.
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
    if (timeinfo.tm_year > (2016 - 1900)) { // waktu valid (bukan epoch 1970)
        char buf[32];
        strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
        logLine(String(F("[NTP] Waktu tersinkron: ")) + buf);
        waktuTersinkron = true;
    }
}

// ================= HTTP HELPER =================
// Mengirim request JSON. Mengembalikan status code HTTP (negatif bila gagal).
int httpRequest(const char* method, const String& path, const String& body, String& response) {
    if (WiFi.status() != WL_CONNECTED) return -1;

    String url = String(SERVER_BASE) + path;
    bool isHttps = url.startsWith("https://");

    WiFiClientSecure secureClient;
    WiFiClient plainClient;
    HTTPClient http;

    bool begun;
    if (isHttps) {
        secureClient.setInsecure(); // lihat catatan keamanan: tanpa validasi sertifikat
        begun = http.begin(secureClient, url);
    } else {
        begun = http.begin(plainClient, url);
    }
    if (!begun) return -1;

    http.setTimeout(HTTP_TIMEOUT_MS);
    http.setConnectTimeout(HTTP_TIMEOUT_MS);
    http.addHeader(F("Content-Type"), F("application/json"));
    http.addHeader(F("X-Device-Token"), DEVICE_TOKEN);

    int status;
    if (strcmp(method, "GET") == 0) {
        status = http.GET();
    } else {
        status = http.POST(body);
    }
    response = (status > 0) ? http.getString() : "";
    http.end();
    return status;
}

// ================= BACA SENSOR =================
void bacaSemuaSensor(float &suhuUdara, float &kelembapan, float &suhuAir) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    if (isnan(h) || isnan(t)) { t = 25.0; h = 60.0; }

    sensors.requestTemperatures(); 
    suhuAir = sensors.getTempCByIndex(0);
    if (suhuAir == DEVICE_DISCONNECTED_C) { suhuAir = 25.0; }

    nilai_uv_global = ltr390.readOriginalData();

    int nilaiAnalogTDS = analogRead(PIN_SENSOR_TDS);
    float teganganTDS = nilaiAnalogTDS * (3.3 / 4095.0);
    float kompensasiSuhu = 1.0 + 0.02 * (suhuAir - 25.0); 
    float teganganKompensasi = teganganTDS / kompensasiSuhu;
    
    nilai_tds_global = (133.42 * pow(teganganKompensasi, 3) - 255.86 * pow(teganganKompensasi, 2) + 857.39 * teganganKompensasi) * 0.5;
    if (nilai_tds_global < 0) nilai_tds_global = 0;

    suhuUdara = t;
    kelembapan = h;
}

// ================= UPLINK SENSOR (POST /terima-sensor) =================
void kirimUplinkSensor() {
    float suhuUdara, kelembapan, suhuAir;
    bacaSemuaSensor(suhuUdara, kelembapan, suhuAir);

    logPrefix(); Serial.print(F("📊 [SENSOR] Suhu Air: ")); Serial.print(suhuAir);
    Serial.print(F(" °C | TDS: ")); Serial.print(nilai_tds_global);
    Serial.print(F(" ppm | UV: ")); Serial.println(nilai_uv_global);

    JsonDocument doc;
    JsonObject obj = doc["object"].to<JsonObject>();
    obj["suhu_udara"]      = suhuUdara;        // nilai asli (bukan x10)
    obj["kelembapan_udara"] = kelembapan;
    obj["kadar_tds"]       = nilai_tds_global;
    obj["kadar_ph"]        = 0;                // tidak ada sensor pH
    obj["intensitas_uv"]   = nilai_uv_global;  // uint32 penuh
    obj["suhu_air"]        = suhuAir;
    obj["relay_1"]         = status_relay_1;
    obj["relay_2"]         = status_relay_2;
    obj["relay_3"]         = status_relay_3;
    obj["relay_4"]         = status_relay_4;

    String body;
    serializeJson(doc, body);

    String resp;
    int status = httpRequest("POST", "/terima-sensor", body, resp);
    if (status >= 200 && status < 300) {
        logPrefix(); Serial.print(F("✅ [HTTP] Uplink OK (")); Serial.print(status); Serial.println(F(")"));
    } else {
        logPrefix(); Serial.print(F("❌ [HTTP] Uplink gagal, status: ")); Serial.println(status);
    }
}

// ================= LAPOR STATUS RELAY (tanpa data sensor) =================
// Dikirim setelah relay berubah agar UI cepat sinkron. Payload kecil dan
// TIDAK memicu penulisan data sensor ke InfluxDB.
void laporStatusRelay() {
    JsonDocument doc;
    doc["relay_1"] = status_relay_1;
    doc["relay_2"] = status_relay_2;
    doc["relay_3"] = status_relay_3;
    doc["relay_4"] = status_relay_4;

    String body;
    serializeJson(doc, body);

    String resp;
    int status = httpRequest("POST", "/api/device/relay-status", body, resp);
    if (status >= 200 && status < 300) {
        logLine(F("[HTTP] Status relay dilaporkan."));
    } else {
        logLine(String(F("[HTTP] Gagal lapor status relay, status: ")) + status);
    }
}

// ================= EKSEKUSI PERINTAH DARI SERVER =================
void ackCommand(int id) {
    if (id <= 0) return;
    String resp;
    String path = "/api/device/commands/" + String(id) + "/ack";
    int status = httpRequest("POST", path, "{}", resp);
    logLine(String(F("[HTTP] ACK #")) + id + F(" -> ") + status);
}

void eksekusiPerintah(JsonObject c) {
    const char* type = c["type"] | "";
    int id = c["id"] | -1;

    if (strcmp(type, "pompa") == 0) {
        int durasi = c["durasi"] | 0;
        kirimPerintahKeNodeMCU("POMPA", durasi * 1000);
    }
    else if (strcmp(type, "interval") == 0) {
        TX_INTERVAL = c["intervalDetik"] | TX_INTERVAL;
        logLine(String(F("✅ [HTTP] Interval diubah: ")) + TX_INTERVAL);
    }
    else if (strcmp(type, "autodosing") == 0) {
        targetTDS      = c["targetTds"] | 0;
        volumeTandon   = c["volumeAir"] | 0;
        konstantaPupuk = c["konstantaPupuk"] | 0;
        logLine(F("✅ [HTTP] Konfigurasi Auto Dosing diperbarui"));
    }
    else if (strcmp(type, "relay") == 0) {
        int idRelay = c["idRelay"] | 0;
        bool on = strcmp(c["status"] | "OFF", "ON") == 0;
        char target[16];
        snprintf(target, sizeof(target), "RELAY_%d_%s", idRelay, on ? "ON" : "OFF");
        kirimPerintahKeNodeMCU(target, 0);

        if (idRelay == 1) status_relay_1 = on ? 1 : 0;
        else if (idRelay == 2) status_relay_2 = on ? 1 : 0;
        else if (idRelay == 3) status_relay_3 = on ? 1 : 0;
        else if (idRelay == 4) status_relay_4 = on ? 1 : 0;

        // Laporkan status relay lewat endpoint khusus (bukan uplink sensor),
        // supaya tombol UI cepat sinkron tanpa mengirim data sensor.
        laporStatusRelay();
    }
    else if (strcmp(type, "wifi-scan") == 0) {
        requestWifiScan();
    }
    else if (strcmp(type, "wifi") == 0) {
        String newSsid = c["ssid"] | "";
        String newPass = c["password"] | "";
        uint16_t rev = c["revision"] | 0;
        bool force = c["force"] | false;
        // ACK SEBELUM restart, agar perintah tidak dikirim ulang setelah boot.
        ackCommand(id);
        applyWifiCommand(newSsid, newPass, rev, force);
        return;
    }

    // ACK: hapus perintah dari antrean server.
    ackCommand(id);
}

// ================= POLLING PERINTAH (GET /api/device/commands) =================
void pollPerintah() {
    String resp;
    int status = httpRequest("GET", "/api/device/commands", "", resp);
    if (status < 200 || status >= 300) return;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, resp);
    if (err) {
        logLine(String(F("[HTTP] JSON perintah tidak valid: ")) + err.c_str());
        return;
    }

    JsonArray commands = doc["commands"].as<JsonArray>();
    for (JsonObject c : commands) {
        eksekusiPerintah(c);
    }
}

// ================= CALLBACK ESP-NOW (ACK CONFIG DARI NODEMCU) =================
// Core Arduino-ESP32 3.x memakai esp_now_recv_info_t; 2.x memakai MAC langsung.
void handleConfigAck(const uint8_t* data, int len) {
    if (len != (int)sizeof(struct_config)) return;
    struct_config frame;
    memcpy(&frame, data, sizeof(frame));
    if (strncmp(frame.type, "ACK", 3) == 0) {
        cfgAckRev = frame.revision;
        cfgAckOk = true;
        logLine(String(F("[ESP-NOW] ACK config rev ")) + frame.revision);
    }
}

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    handleConfigAck(data, len);
}
#else
void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
    handleConfigAck(data, len);
}
#endif

// ================= SETUP =================
void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println(F("--- ESP32 HTTP/WiFi + ESP-NOW Master ---"));
    Serial.print(F("sizeof(struct_config) = "));
    Serial.println((int)sizeof(struct_config));

    // WiFi dari NVS dengan rollback + captive portal bila gagal.
    bootWifi();

    // Sinkronkan waktu (NTP butuh internet; jika belum, dicoba lagi di loop()).
    sinkronWaktuNTP();

    if (esp_now_init() != ESP_OK) {
        logLine(F("Gagal inisialisasi ESP-NOW"));
        return;
    }
    esp_now_register_recv_cb(onEspNowRecv);

    memcpy(peerInfo.peer_addr, macNodeMCU, 6);
    peerInfo.channel = 0;  
    peerInfo.encrypt = false;
    
    if (esp_now_add_peer(&peerInfo) != ESP_OK){
        logLine(F("Gagal menambahkan Peer NodeMCU"));
        return;
    }

    pinMode(PIN_SENSOR_TDS, INPUT);

    Wire.begin(I2C_SDA, I2C_SCL);
    delay(1000); 

    if (ltr390.begin() != 0) {
        logLine(F("⚠️ Sensor DFRobot LTR390 tidak terdeteksi! Cek koneksi kabel."));
    } else {
        logLine(F("✅ Sensor DFRobot LTR390 BERHASIL diinisialisasi!"));
        ltr390.setMode(ltr390.eUVSMode); 
        ltr390.setALSOrUVSMeasRate(ltr390.e18bit, ltr390.e100ms); 
        ltr390.setALSOrUVSGain(ltr390.eGain3);
    }

    dht.begin();
    sensors.begin();

    // Uplink & polling pertama hanya bila WiFi sudah tersambung. Jika belum,
    // loop() akan mengirimnya pada kesempatan berikutnya.
    if (WiFi.status() == WL_CONNECTED) {
        kirimUplinkSensor();
        laporStatusRelay(); // sinkronkan state relay server setelah reboot
        reportStatus();     // laporkan revisi WiFi + hasil scan
        pollPerintah();
    } else {
        // WiFi belum siap: kirim segera begitu tersambung (jangan tunggu 60s).
        uplinkSegera = true;
        laporRelaySegera = true;
        logLine(F("[HTTP] WiFi belum tersambung, uplink pertama ditunda ke loop()."));
    }
    waktuUplinkTerakhir = millis();
    waktuPollTerakhir = millis();
    waktuStatusTerakhir = millis();
}

// ================= LOOP =================
void loop() {
    // Reconnect pasif memakai kredensial aktif (tanpa blokir lama).
    if (WiFi.status() != WL_CONNECTED) {
        static unsigned long terakhirCoba = 0;
        if (millis() - terakhirCoba >= 10000) {
            terakhirCoba = millis();
            logLine(F("[WiFi] Terputus, menyambung ulang..."));
            WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
        }
    }

    sinkronWaktuNTP(); // coba lagi sampai NTP berhasil

    unsigned long sekarang = millis();

    // Polling perintah tiap POLL_INTERVAL (non-blocking).
    if (sekarang - waktuPollTerakhir >= POLL_INTERVAL) {
        waktuPollTerakhir = sekarang;
        pollPerintah();
    }

    // Status perangkat (WiFi/scan) tiap 60 detik atau segera setelah scan.
    if (WiFi.status() == WL_CONNECTED &&
        (scanPendingReport || sekarang - waktuStatusTerakhir >= 60000UL)) {
        waktuStatusTerakhir = sekarang;
        reportStatus();
    }

    // Uplink sensor tiap TX_INTERVAL detik (non-blocking).
    // Uplink "segera" (setelah relay berubah / WiFi baru tersambung) hanya
    // dijalankan bila WiFi memang tersambung; jika belum, tetap tertunda.
    bool waktunyaUplink = sekarang - waktuUplinkTerakhir >= (unsigned long)TX_INTERVAL * 1000UL;
    if ((uplinkSegera || waktunyaUplink) && WiFi.status() == WL_CONNECTED) {
        uplinkSegera = false;
        waktuUplinkTerakhir = sekarang;
        kirimUplinkSensor();
    }

    // Lapor status relay tertunda (mis. saat WiFi baru tersambung).
    if (laporRelaySegera && WiFi.status() == WL_CONNECTED) {
        laporRelaySegera = false;
        laporStatusRelay();
    }

    // Auto-dosing berbasis millis (tanpa delay()).
    if (targetTDS > 0 && millis() - waktuCekTDS >= INTERVAL_CEK) {
        waktuCekTDS = millis();

        if (millis() > cooldownPompa) {
            if (nilai_tds_global > 0 && nilai_tds_global < targetTDS && volumeTandon > 0 && konstantaPupuk > 0) {
                float deltaTDS = targetTDS - nilai_tds_global;
                float volumePekatan = (deltaTDS * (float)volumeTandon) / (float)konstantaPupuk;
                float durasiDetik = volumePekatan / DEBIT_POMPA;
                int durasiMs = (int)(durasiDetik * 1000);

                if (durasiMs > 60000) durasiMs = 60000; 

                logLine(String(F("⚠️ TDS rendah! Menyalakan pompa AB Mix selama: "))
                        + (durasiMs / 1000) + F(" detik."));
                
                kirimPerintahKeNodeMCU("POMPA", durasiMs);

                cooldownPompa = millis() + 900000; 
                logLine(F("⏳ Pompa masuk masa cooldown 15 menit."));
            }
        }
    }
}
