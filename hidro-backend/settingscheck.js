// Self-check menu Settings (hidro-backend).
// Jalankan: node hidro-backend/settingscheck.js   (DB sementara di /tmp)
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hidro-settings-'));
const DB_PATH = path.join(TMP, 'test.db');
const PORT = 5098;
const BASE = `http://127.0.0.1:${PORT}/api`;
const PIN = '1234';

// Mock iot-api: mencatat request dari hidro-backend (config WiFi).
const MOCK_PORT = 5097;
const IOT_SECRET = 'test-secret';
const INTERNAL_KEY = 'test-internal-key';
const iotCalls = [];
const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    iotCalls.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/device/status' && req.method === 'GET') {
      res.end(
        JSON.stringify({
          success: true,
          devices: { 'utama:esp32': { role: 'esp32', appliedRevision: 1, at: new Date().toISOString() } },
          updatedAt: new Date().toISOString(),
        })
      );
      return;
    }
    res.end(JSON.stringify({ success: true }));
  });
});

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

async function api(method, url, body, pin) {
  const headers = { 'Content-Type': 'application/json' };
  if (pin !== undefined) headers['X-Settings-Pin'] = pin;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server tidak siap');
}

(async () => {
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      DB_PATH,
      PORT: String(PORT),
      CORS_ORIGIN: '*',
      UPLOAD_DIR: path.join(TMP, 'uploads'),
      SETTINGS_SECRET: IOT_SECRET,
      IOT_INTERNAL_KEY: INTERNAL_KEY,
      IOT_BASE: `http://127.0.0.1:${MOCK_PORT}`,
      DEVICE_TOKEN: 'test-device-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[err] ${d}`));

  try {
    await waitReady();

    console.log('\n== 1. Default & PIN awal ==');
    const initial = await api('GET', '/settings');
    check('GET /settings 200', initial.status === 200, initial.body);
    const settings = initial.body.settings;
    check('pinIsDefault true', initial.body.pinIsDefault === true, initial.body.pinIsDefault);
    check('seksi lengkap', ['general', 'plan', 'monitoring', 'listrik', 'device', 'limits'].every((s) => settings[s]), Object.keys(settings));
    check('default tarif 1444.7', settings.listrik.tariffPerKwh === 1444.7, settings.listrik.tariffPerKwh);
    check('default farmName Hidroponik', settings.general.farmName === 'Hidroponik', settings.general.farmName);
    check('PIN tidak bocor di respons', !JSON.stringify(initial.body).includes('hash'), 'ada field hash');

    console.log('\n== 2. Proteksi PIN ==');
    const noPin = await api('PUT', '/settings', { plan: { harvestReadyDays: 5 } });
    check('PUT tanpa PIN 401', noPin.status === 401, noPin.body);
    const wrongPin = await api('PUT', '/settings', { plan: { harvestReadyDays: 5 } }, '9999');
    check('PUT PIN salah 401', wrongPin.status === 401, wrongPin.body);

    console.log('\n== 3. Simpan parsial ==');
    const saved = await api('PUT', '/settings', { plan: { harvestReadyDays: 5 } }, PIN);
    check('PUT valid 200', saved.status === 200, saved.body);
    const after = (await api('GET', '/settings')).body.settings;
    check('harvestReadyDays = 5', after.plan.harvestReadyDays === 5, after.plan.harvestReadyDays);
    check(
      'field plan lain tidak berubah',
      after.plan.harvestBannerDays === settings.plan.harvestBannerDays &&
        after.plan.ppmTolerancePct === settings.plan.ppmTolerancePct,
      after.plan
    );
    check('seksi lain tidak berubah', after.listrik.tariffPerKwh === 1444.7, after.listrik);

    const asString = await api('PUT', '/settings', { plan: { harvestReadyDays: '7' } }, PIN);
    check('nilai string dari form diterima 200', asString.status === 200, asString.body);
    check(
      'nilai string dinormalisasi jadi angka',
      asString.body.settings.plan.harvestReadyDays === 7,
      asString.body.settings.plan.harvestReadyDays
    );
    await api('PUT', '/settings', { plan: { harvestReadyDays: 5 } }, PIN);

    console.log('\n== 4. Validasi nilai ==');
    const badRange = await api('PUT', '/settings', { plan: { harvestReadyDays: 99 } }, PIN);
    check('di luar rentang 400', badRange.status === 400, badRange.body);
    const badOrder = await api(
      'PUT',
      '/settings',
      { monitoring: { thresholds: { kadar_tds: { dangerLow: 2000 } } } },
      PIN
    );
    check('urutan TDS salah 400', badOrder.status === 400, badOrder.body);
    const badSection = await api('PUT', '/settings', { nope: { a: 1 } }, PIN);
    check('seksi tak dikenal 400', badSection.status === 400, badSection.body);
    const badOption = await api(
      'PUT',
      '/settings',
      { device: { uplinkIntervalOptions: [120, 180] } },
      PIN
    );
    check('opsi interval tanpa nilai aktif 400', badOption.status === 400, badOption.body);

    console.log('\n== 5. Nilai default lolos validasi ==');
    const defaults = await api('PUT', '/settings', settings, PIN);
    check('PUT semua default 200', defaults.status === 200, defaults.body);

    console.log('\n== 6. Batas catatan mengikuti setting ==');
    const catalog = (await api('GET', '/catalog')).body;
    const plant = catalog[0];
    const longNote = 'x'.repeat(101);
    const tooLong = await api(
      'PUT',
      `/catalog/${plant.id}/recipes/Semai`,
      { catatan: longNote },
      PIN
    );
    check('catatan 101 char masih 200 (limit 2000)', tooLong.status === 200, tooLong.body);

    const limitSaved = await api('PUT', '/settings', { limits: { maxNotesChars: 100 } }, PIN);
    check('set maxNotesChars 100 -> 200', limitSaved.status === 200, limitSaved.body);
    const rejected = await api(
      'PUT',
      `/catalog/${plant.id}/recipes/Semai`,
      { catatan: longNote },
      PIN
    );
    check('catatan 101 char ditolak 400', rejected.status === 400, rejected.body);
    check(
      'pesan menyebut batas baru',
      typeof rejected.body.error === 'string' && rejected.body.error.includes('100'),
      rejected.body
    );
    await api('PUT', '/settings', { limits: { maxNotesChars: 2000 } }, PIN);

    console.log('\n== 7. Batas unggahan mengikuti setting ==');
    const today = new Date().toISOString().slice(0, 10);
    const batch = await api('POST', '/batches', {
      tableNumber: 3,
      pipeNumber: 6,
      plantId: plant.id,
      sowDate: today,
    });
    check('buat batch uji 201', batch.status === 201, batch.body);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    async function uploadImage(bytes) {
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: 'image/png' }), 'uji.png');
      const res = await fetch(`${BASE}/batches/${batch.body.id}/images`, {
        method: 'POST',
        body: form,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, body: json };
    }

    const first = await uploadImage(png);
    check('upload gambar 201', first.status === 201, first.body);

    const oneImage = await api('PUT', '/settings', { limits: { maxImagesPerBatch: 1 } }, PIN);
    check('set maxImagesPerBatch 1 -> 200', oneImage.status === 200, oneImage.body);
    const second = await uploadImage(png);
    check('gambar ke-2 ditolak 409', second.status === 409, second.body);

    const oneMb = await api('PUT', '/settings', { limits: { maxImageMb: 1 } }, PIN);
    check('set maxImageMb 1 -> 200', oneMb.status === 200, oneMb.body);
    await api('PUT', '/settings', { limits: { maxImagesPerBatch: 5 } }, PIN);
    const big = Buffer.alloc(1.2 * 1024 * 1024, 1);
    const tooBig = await uploadImage(big);
    check('gambar > 1MB ditolak 400', tooBig.status === 400, tooBig.body);
    check(
      'pesan ukuran memakai nilai setting',
      typeof tooBig.body.error === 'string' && tooBig.body.error.includes('1MB'),
      tooBig.body
    );
    await api('PUT', '/settings', { limits: { maxImageMb: 5, maxImagesPerBatch: 5 } }, PIN);

    console.log('\n== 8. Ganti PIN ==');
    const changed = await api('PUT', '/settings/pin', { newPin: '4321' }, PIN);
    check('ganti PIN 200', changed.status === 200, changed.body);
    check('pinIsDefault false', changed.body.pinIsDefault === false, changed.body);
    const oldPin = await api('PUT', '/settings', { plan: { harvestReadyDays: 3 } }, PIN);
    check('PIN lama ditolak 401', oldPin.status === 401, oldPin.body);
    const newPin = await api('PUT', '/settings', { plan: { harvestReadyDays: 3 } }, '4321');
    check('PIN baru diterima 200', newPin.status === 200, newPin.body);
    const shortPin = await api('PUT', '/settings/pin', { newPin: '12' }, '4321');
    check('PIN < 4 karakter ditolak 400', shortPin.status === 400, shortPin.body);

    console.log('\n== 9. Enkripsi password WiFi ==');
    process.env.SETTINGS_SECRET = IOT_SECRET;
    const wifiLib = require('./wifi');
    const enc = wifiLib.encryptSecret('abc12345');
    check('ciphertext tidak memuat plaintext', !JSON.stringify(enc).includes('abc12345'));
    check('round-trip dekripsi', wifiLib.decryptSecret(enc) === 'abc12345');
    process.env.SETTINGS_SECRET = '';
    check('tanpa SETTINGS_SECRET -> ready false', wifiLib.isReady() === false);
    process.env.SETTINGS_SECRET = IOT_SECRET;
    check('dengan SETTINGS_SECRET -> ready true', wifiLib.isReady() === true);

    console.log('\n== 10. Settings WiFi (API) ==');
    const wifiInitial = await api('GET', '/settings/wifi');
    check('GET wifi 200', wifiInitial.status === 200, wifiInitial.body);
    check('GET wifi ready true', wifiInitial.body.ready === true, wifiInitial.body.ready);
    check(
      'GET wifi tidak membocorkan password',
      !JSON.stringify(wifiInitial.body).includes('passwordEnc') &&
        !JSON.stringify(wifiInitial.body).includes('password'),
      wifiInitial.body
    );

    const wifiNoPin = await api('PUT', '/settings/wifi', { ssid: 'Green House', password: 'rahasia123' });
    check('PUT wifi tanpa PIN 401', wifiNoPin.status === 401, wifiNoPin.body);

    iotCalls.length = 0;
    const wifiSaved = await api(
      'PUT',
      '/settings/wifi',
      { ssid: 'Green House', password: 'rahasia123' },
      '4321'
    );
    check('PUT wifi 200', wifiSaved.status === 200, wifiSaved.body);
    check('revision = 1', wifiSaved.body.revision === 1, wifiSaved.body);
    check('queued true', wifiSaved.body.queued === true, wifiSaved.body);

    const configCall = iotCalls.find((c) => c.url === '/api/device/config');
    check('config diteruskan ke iot-api', Boolean(configCall), iotCalls.map((c) => c.url));
    check(
      'header internal terkirim',
      configCall && configCall.headers['x-internal-key'] === INTERNAL_KEY,
      configCall && configCall.headers
    );
    check(
      'payload password plaintext hanya ke iot-api',
      configCall && JSON.parse(configCall.body).password === 'rahasia123',
      configCall && configCall.body
    );

    const wifiAfter = await api('GET', '/settings/wifi');
    check('desired ssid tersimpan', wifiAfter.body.desired?.ssid === 'Green House', wifiAfter.body.desired);
    check('desired hasPassword true', wifiAfter.body.desired?.hasPassword === true, wifiAfter.body.desired);
    check(
      'GET setelah simpan tetap tanpa password',
      !JSON.stringify(wifiAfter.body).includes('rahasia123'),
      wifiAfter.body
    );

    const shortPass = await api('PUT', '/settings/wifi', { ssid: 'Green House', password: '1234567' }, '4321');
    check('password 7 karakter ditolak 400', shortPass.status === 400, shortPass.body);
    const longSsid = await api('PUT', '/settings/wifi', { ssid: 'x'.repeat(33) }, '4321');
    check('SSID 33 karakter ditolak 400', longSsid.status === 400, longSsid.body);
    const openNet = await api('PUT', '/settings/wifi', { ssid: 'OpenNet', password: '' }, '4321');
    check('jaringan terbuka diterima 200', openNet.status === 200, openNet.body);
    const afterOpen = await api('GET', '/settings/wifi');
    check('hasPassword false untuk jaringan terbuka', afterOpen.body.desired?.hasPassword === false, afterOpen.body.desired);

    iotCalls.length = 0;
    const resend = await api('POST', '/settings/wifi/resend', {}, '4321');
    check('resend 200', resend.status === 200, resend.body);
    check(
      'resend tidak menaikkan revisi',
      resend.body.revision === afterOpen.body.desired.revision,
      resend.body
    );

    iotCalls.length = 0;
    const scan = await api('POST', '/settings/wifi/scan', {}, '4321');
    check('scan 200', scan.status === 200, scan.body);
    check(
      'scan diteruskan ke iot-api',
      iotCalls.some((c) => c.url === '/api/device/config/scan'),
      iotCalls.map((c) => c.url)
    );

    console.log('\n== 11. Rate limit PIN salah ==');
    let limited = null;
    for (let i = 0; i < 12; i++) {
      const res = await api('PUT', '/settings', { plan: { harvestReadyDays: 3 } }, '0000');
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    check('429 setelah 10 kegagalan', Boolean(limited), limited && limited.body);
  } finally {
    child.kill('SIGTERM');
    mockServer.closeAllConnections?.();
    mockServer.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'SEMUA TEST LULUS' : `${failures} TEST GAGAL`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
