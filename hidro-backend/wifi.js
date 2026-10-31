// Konfigurasi WiFi perangkat (menu Settings > WiFi).
//
// Disimpan di AppSetting key `wifi.desired` sebagai satu objek JSON. Password
// dienkripsi AES-256-GCM dengan kunci dari env SETTINGS_SECRET, dan API tidak
// pernah mengembalikan password maupun ciphertext-nya.

const crypto = require('crypto');
const { getSetting, setSetting } = require('./settings');

const WIFI_KEY = 'wifi.desired';
const ALGO = 'aes-256-gcm';

function secretKey() {
  const secret = process.env.SETTINGS_SECRET || '';
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

// Enkripsi: kembalikan { iv, tag, ct } dalam base64, atau null bila tanpa kunci.
function encryptSecret(plain) {
  const key = secretKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

// Dekripsi; mengembalikan null bila kunci/tag tidak cocok atau data rusak.
function decryptSecret(enc) {
  const key = secretKey();
  if (!key || !enc || typeof enc !== 'object') return null;
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(enc.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(enc.ct, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

function readRecord() {
  const raw = getSetting(WIFI_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    console.error('Setting wifi.desired rusak (bukan JSON).');
    return null;
  }
}

function writeRecord(record) {
  setSetting(WIFI_KEY, JSON.stringify(record));
}

// Validasi input dari form. Password boleh kosong (jaringan terbuka).
function validateWifi({ ssid, password }) {
  if (typeof ssid !== 'string') return { error: 'SSID wajib diisi' };
  const cleanSsid = ssid.trim();
  if (cleanSsid.length < 1 || cleanSsid.length > 32) {
    return { error: 'SSID harus 1-32 karakter' };
  }
  if (/[\r\n]/.test(cleanSsid)) return { error: 'SSID tidak boleh berisi baris baru' };

  if (password === undefined || password === null || password === '') {
    return { value: { ssid: cleanSsid, password: '' } };
  }
  if (typeof password !== 'string') return { error: 'Password harus teks' };
  // 8-63 karakter (WPA passphrase) atau 64 hex (raw PSK).
  const isHex64 = /^[0-9a-fA-F]{64}$/.test(password);
  if (!isHex64 && (password.length < 8 || password.length > 63)) {
    return { error: 'Password harus 8-63 karakter (atau 64 hex)' };
  }
  return { value: { ssid: cleanSsid, password } };
}

// Simpan config baru: revisi naik bila SSID/password berubah.
// password undefined = pakai password tersimpan (bila ada).
function saveWifi({ ssid, password }) {
  if (!secretKey()) {
    return { error: 'SETTINGS_SECRET belum diset di server' };
  }

  const validated = validateWifi({ ssid, password });
  if (validated.error) return validated;

  const prev = readRecord();
  const sameSsid = prev && prev.ssid === validated.value.ssid;

  let passwordEnc = prev?.passwordEnc || null;
  if (password !== undefined && password !== null && password !== '') {
    passwordEnc = encryptSecret(validated.value.password);
  } else if (!sameSsid) {
    // SSID baru tanpa password: jaringan terbuka.
    passwordEnc = null;
  }

  if (!sameSsid && !passwordEnc && prev?.passwordEnc && password === undefined) {
    // Pindah SSID tapi password tidak dikirim dan yang lama tidak valid:
    // tolak agar pengguna tidak tanpa sengaja membuat config kosong.
    return { error: 'Password wajib diisi saat mengganti SSID' };
  }

  const revision = (prev?.revision || 0) + 1;
  const record = {
    v: 1,
    ssid: validated.value.ssid,
    passwordEnc,
    revision,
    updatedAt: new Date().toISOString(),
  };
  writeRecord(record);
  return { value: record };
}

// Bentuk aman untuk API: tanpa ciphertext.
function getPublicWifiConfig() {
  const record = readRecord();
  if (!record) {
    return { ssid: '', hasPassword: false, revision: 0, updatedAt: null };
  }
  return {
    ssid: record.ssid || '',
    hasPassword: Boolean(record.passwordEnc),
    revision: Number(record.revision) || 0,
    updatedAt: record.updatedAt || null,
  };
}

// Payload yang dikirim ke iot-api (berisi password plaintext hanya untuk
// perangkat, lewat jaringan internal Docker).
function getDeviceWifiPayload(force = false) {
  const record = readRecord();
  if (!record) return null;
  const password = record.passwordEnc ? decryptSecret(record.passwordEnc) : '';
  if (record.passwordEnc && password === null) {
    return { error: 'Password tersimpan tidak bisa didekripsi (SETTINGS_SECRET berubah?)' };
  }
  return {
    value: {
      ssid: record.ssid,
      password: password || '',
      revision: Number(record.revision) || 0,
      force: Boolean(force),
    },
  };
}

function hasWifiConfig() {
  return Boolean(readRecord());
}

module.exports = {
  WIFI_KEY,
  encryptSecret,
  decryptSecret,
  validateWifi,
  saveWifi,
  getPublicWifiConfig,
  getDeviceWifiPayload,
  hasWifiConfig,
  isReady: () => Boolean(secretKey()),
};
