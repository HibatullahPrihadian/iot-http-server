#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include "DHT.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include "DFRobot_LTR390UV.h"

// ================= KONFIGURASI WIFI & SERVER =================
// Kredensial WiFi + token perangkat ada di secrets.h (gitignored).
// Salin secrets.h.example -> secrets.h lalu isi nilai sebenarnya.
#include "secrets.h"

// Basis URL server.
// LAN (lebih cepat, tanpa TLS): http://192.168.2.10:5005
// Produksi (via Cloudflare Tunnel): https://hidroponik.phd.my.id
const char* SERVER_BASE = "https://hidroponik.phd.my.id";

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

struct_message dataKirim;
esp_now_peer_info_t peerInfo;

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
unsigned long waktuWifiTerakhir = 0;
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

// ================= KONEKSI WIFI (AUTO-RECONNECT) =================
void pastikanWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    // Debounce hanya berlaku untuk percobaan ULANG. Percobaan pertama
    // (waktuWifiTerakhir masih 0) harus selalu jalan, jika tidak maka
    // koneksi awal di setup() akan terlewat karena millis() < 5000.
    if (waktuWifiTerakhir != 0 && millis() - waktuWifiTerakhir < 5000) return;
    waktuWifiTerakhir = millis();

    logPrefix(); Serial.print(F("[WiFi] Menyambung ke ")); Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    unsigned long mulai = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - mulai < 10000) {
        delay(250);
    }
    if (WiFi.status() == WL_CONNECTED) {
        logPrefix(); Serial.print(F("[WiFi] Terhubung. IP: ")); Serial.println(WiFi.localIP());
        logPrefix(); Serial.print(F("[WiFi] Channel AP: ")); Serial.println(WiFi.channel());
        // Matikan modem sleep: radio harus tetap aktif untuk ESP-NOW,
        // dan channel harus tetap sama dengan NodeMCU slave.
        WiFi.setSleep(false);
    } else {
        logLine(F("[WiFi] Gagal terhubung, coba lagi nanti."));
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

    // ACK: hapus perintah dari antrean server.
    if (id > 0) {
        String resp;
        String path = "/api/device/commands/" + String(id) + "/ack";
        int status = httpRequest("POST", path, "{}", resp);
        logLine(String(F("[HTTP] ACK #")) + id + F(" -> ") + status);
    }
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

// ================= SETUP =================
void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println(F("--- ESP32 HTTP/WiFi + ESP-NOW Master ---"));

    // WiFi STA wajib sebelum ESP-NOW (ESP-NOW memakai radio WiFi).
    WiFi.mode(WIFI_STA);
    pastikanWiFi();

    // Sinkronkan waktu (NTP butuh internet; jika belum, dicoba lagi di loop()).
    sinkronWaktuNTP();

    if (esp_now_init() != ESP_OK) {
        logLine(F("Gagal inisialisasi ESP-NOW"));
        return;
    }

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
        pollPerintah();
    } else {
        // WiFi belum siap: kirim segera begitu tersambung (jangan tunggu 60s).
        uplinkSegera = true;
        laporRelaySegera = true;
        logLine(F("[HTTP] WiFi belum tersambung, uplink pertama ditunda ke loop()."));
    }
    waktuUplinkTerakhir = millis();
    waktuPollTerakhir = millis();
}

// ================= LOOP =================
void loop() {
    pastikanWiFi();
    sinkronWaktuNTP(); // coba lagi sampai NTP berhasil

    unsigned long sekarang = millis();

    // Polling perintah tiap POLL_INTERVAL (non-blocking).
    if (sekarang - waktuPollTerakhir >= POLL_INTERVAL) {
        waktuPollTerakhir = sekarang;
        pollPerintah();
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
