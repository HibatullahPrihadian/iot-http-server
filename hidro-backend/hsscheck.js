// Self-check fitur umur tanaman HSS/HST (backend Plan).
// Jalankan: node hsscheck.js   (DB sementara di /tmp, dihapus otomatis)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hidro-hss-'));
const DB_PATH = path.join(TMP, 'test.db');
const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}/api`;

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, DB_PATH, PORT: String(PORT), CORS_ORIGIN: '*' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[err] ${d}`));

  try {
    await waitReady();

    const catalog = (await api('GET', '/catalog')).body;
    const selada = catalog.find((c) => c.name === 'Selada');
    console.log('\n== 1. Tanam di Meja 3 (semai) ==');
    const sowDate = daysAgo(10);
    const created = await api('POST', '/batches', {
      tableNumber: 3,
      pipeNumber: 1,
      plantId: selada.id,
      sowDate,
    });
    check('POST /batches 201', created.status === 201, created.body);
    const id = created.body.id;
    check('HSS = 10 hari sejak semai', created.body.hss === 10, created.body);
    check('HST null (belum dipindah)', created.body.hst === null, created.body);
    check('status Semai', created.body.computedStatus === 'Semai', created.body.computedStatus);
    check(
      'estimasi panen = sowDate + totalDays',
      created.body.harvestDate === iso(new Date(Date.parse(sowDate) + selada.totalDays * 86400000)),
      created.body.harvestDate
    );

    console.log('\n== 2. Pindah ke Meja 1 (HST mulai) ==');
    const moved = await api('POST', `/batches/${id}/transfer`, {
      toPipes: [{ toTable: 1, toPipe: 1 }],
    });
    check('POST /transfer 200', moved.status === 200, moved.body);
    check('transplantDate = hari ini', moved.body.transplantDate === iso(today), moved.body);

    let list = (await api('GET', '/batches')).body;
    let b = list.find((x) => x.id === id);
    check('HSS tetap 10 setelah pindah', b.hss === 10, b);
    check('HST = 0 setelah pindah', b.hst === 0, b);
    check('status Pembesaran', b.computedStatus === 'Pembesaran', b.computedStatus);
    check(
      'estimasi panen = transplantDate + growDays',
      b.harvestDate === iso(new Date(Date.now() + selada.growDays * 86400000)),
      b.harvestDate
    );

    console.log('\n== 3. Koreksi tanggal pindah (3 hari lalu) ==');
    const fixed = await api('PUT', `/batches/${id}`, { transplantDate: daysAgo(3) });
    check('PUT 200', fixed.status === 200, fixed.body);
    check('HST = 3', fixed.body.hst === 3, fixed.body);
    check('HSS tetap 10', fixed.body.hss === 10, fixed.body);
    check(
      'estimasi panen digeser ikut',
      fixed.body.harvestDate === iso(new Date(Date.now() + (selada.growDays - 3) * 86400000)),
      fixed.body.harvestDate
    );

    console.log('\n== 4. Validasi input ==');
    const bad = await api('PUT', `/batches/${id}`, { transplantDate: '2020-99-99' });
    check('tanggal tidak valid ditolak (400)', bad.status === 400, bad.body);
    const future = await api('PUT', `/batches/${id}`, {
      transplantDate: iso(new Date(Date.now() + 86400000)),
    });
    check('tanggal masa depan ditolak (400)', future.status === 400, future.body);
    const before = await api('PUT', `/batches/${id}`, { transplantDate: daysAgo(30) });
    check('tanggal sebelum semai ditolak (400)', before.status === 400, before.body);

    console.log('\n== 5. Split multi-pipa (HST ikut di clone) ==');
    const split = await api('POST', '/batches', {
      tableNumber: 3,
      pipeNumber: 2,
      plantId: selada.id,
      sowDate: daysAgo(12),
    });
    const splitId = split.body.id;
    const splitMove = await api('POST', `/batches/${splitId}/transfer`, {
      toPipes: [
        { toTable: 2, toPipe: 1 },
        { toTable: 2, toPipe: 2 },
      ],
    });
    check('split 200', splitMove.status === 200, splitMove.body);
    check('2 pipa terpindah', splitMove.body.moved === 2, splitMove.body);
    list = (await api('GET', '/batches')).body;
    const clones = list.filter((x) => x.tableNumber === 2 && x.pipeNumber <= 2);
    check('2 batch hasil split', clones.length === 2, clones.length);
    check(
      'semua clone punya HSS 12 & HST 0',
      clones.every((x) => x.hss === 12 && x.hst === 0),
      clones.map((x) => ({ hss: x.hss, hst: x.hst }))
    );

    console.log('\n== 6. Panen -> umur dibekukan ==');
    const harvest = await api('POST', `/batches/${id}/harvest`, { harvestWeightGram: 400 });
    check('harvest 200', harvest.status === 200, harvest.body);
    check('HSS saat panen = 10', harvest.body.hss === 10, harvest.body);
    check('HST saat panen = 3', harvest.body.hst === 3, harvest.body);

    const history = (await api('GET', '/batches/history')).body;
    const h = history.find((x) => x.id === id);
    check('riwayat punya HSS', h.hss === 10, h);
    check('riwayat punya HST', h.hst === 3, h);
    check('riwayat punya tanggal pindah', h.transplantDate === daysAgo(3), h.transplantDate);

    console.log('\n== 7. Statistik HSS/HST ==');
    const stats = (await api('GET', '/stats/summary')).body;
    check('ada hssHstRealisasi', Array.isArray(stats.hssHstRealisasi), stats);
    const seladaStat = stats.hssHstRealisasi.find((s) => s.plant === 'Selada');
    check('target HSS = seedlingDays', seladaStat.estimasiHss === selada.seedlingDays, seladaStat);
    check('target HST = growDays', seladaStat.estimasiHst === selada.growDays, seladaStat);
    check('realisasi HSS = 10', seladaStat.realisasiHss === 10, seladaStat);
    check('realisasi HST = 3', seladaStat.realisasiHst === 3, seladaStat);

    console.log('\n== 8. Fase resep mengikuti pindah aktual ==');
    const recipe = (await api('GET', `/batches/${id}/recipe`)).body;
    check('phase Pembesaran setelah pindah', recipe.phase === 'Pembesaran', recipe.phase);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'SEMUA TEST LULUS' : `${failures} TEST GAGAL`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
