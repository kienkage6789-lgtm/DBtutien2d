// Soak test: chạy engine vendor + Auto qua server thật trong N phút, giám sát và LUÔN dọn dẹp.
// Chạy: TUTIEN_SOAK_LIVE=1 node scripts/soak-vendor.cjs [phút=30]
// Quy trình: khởi động server (con của script) -> engine=vendor -> start bot -> auto/start -> giám sát mỗi 5 s,
// ghi mẫu mỗi 30 s -> dọn dẹp (auto/stop, bot stop, engine=core, tắt server). Không in token/tên/id.
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

if (process.env.TUTIEN_SOAK_LIVE !== '1') { console.error('Đặt TUTIEN_SOAK_LIVE=1 để chạy (kết nối game thật, bật Auto).'); process.exit(2); }
const MINUTES = Number(process.argv[2] || 30);
const BASE = { host: '127.0.0.1', port: 4000 };
const repo = path.resolve(__dirname, '..');
const serverDir = path.join(repo, 'apps/server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function api(method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ ...BASE, path: urlPath, method, timeout: 8000, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* bỏ qua */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null }); });
    if (data) req.write(data);
    req.end();
  });
}

function rssMB(pid) {
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`], { encoding: 'utf8', timeout: 8000 });
    const n = Number(String(r.stdout).trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n / 1048576) : null;
  } catch { return null; }
}
function cpuSeconds(pid) {
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).CPU`], { encoding: 'utf8', timeout: 8000 });
    const n = Number(String(r.stdout).trim());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

async function main() {
  const logPath = path.join(process.env.TUTIEN_SOAK_LOG_DIR || repo, 'soak-server.log');
  const out = fs.openSync(logPath, 'a');
  const server = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, stdio: ['ignore', out, out], windowsHide: true });
  let serverExited = false;
  server.on('exit', () => { serverExited = true; });
  let accountId = null;
  let cleaned = false;
  let reason = 'hết thời gian';

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    console.log('--- dọn dẹp');
    if (accountId && !serverExited) {
      console.log('auto/stop ->', (await api('POST', `/api/accounts/${accountId}/auto/stop`, {})).status);
      console.log('bot stop ->', (await api('POST', `/api/accounts/${accountId}/stop`, {})).status);
      await sleep(2000);
      console.log('engine -> core ->', (await api('PUT', `/api/accounts/${accountId}/config`, { engine: 'core' })).status);
    }
    try { server.kill(); } catch { /* bỏ qua */ }
    await sleep(1500);
  }
  process.on('SIGINT', async () => { reason = 'SIGINT'; await cleanup(); process.exit(1); });

  try {
    // chờ server
    for (let i = 0; i < 30; i += 1) { await sleep(500); if ((await api('GET', '/health')).status === 200) break; }
    const list = await api('GET', '/api/accounts');
    if (list.status !== 200 || !list.json || !list.json.data || !list.json.data[0]) throw new Error('không lấy được danh sách tài khoản');
    accountId = list.json.data[0].id;
    console.log('engine -> vendor ->', (await api('PUT', `/api/accounts/${accountId}/config`, { engine: 'vendor' })).status);
    console.log('bot start ->', (await api('POST', `/api/accounts/${accountId}/start`, {})).status);
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      const a = (await api('GET', '/api/accounts')).json;
      const v = a && a.data && a.data[0] && a.data[0].vendor;
      if (v && v.lifecycle === 'in_game') break;
    }
    const startRes = await api('POST', `/api/accounts/${accountId}/auto/start`, {});
    console.log('auto/start ->', startRes.status, startRes.json && startRes.json.errorCode ? startRes.json.errorCode : '');
    if (startRes.status !== 200) throw new Error('không bật được Auto');

    const t0 = Date.now();
    const endAt = t0 + MINUTES * 60_000;
    const samples = [];
    let lastSample = 0;
    let notInGameSince = null;
    let apiDownSince = null;
    const rss0 = rssMB(server.pid);
    const cpu0 = cpuSeconds(server.pid);
    console.log('server pid', server.pid, '| RSS ban đầu', rss0, 'MB | bắt đầu soak', MINUTES, 'phút');

    while (Date.now() < endAt) {
      await sleep(5000);
      if (serverExited) { reason = 'server thoát bất ngờ'; break; }
      const res = await api('GET', '/api/accounts');
      const a = res.json && res.json.data && res.json.data[0];
      if (!a) {
        apiDownSince = apiDownSince || Date.now();
        if (Date.now() - apiDownSince > 30_000) { reason = 'API không phản hồi quá 30 s'; break; }
        continue;
      }
      apiDownSince = null;
      const v = a.vendor || {};
      const sup = v.supervisor || {};
      if (sup.phase === 'halted') { reason = 'giám sát dừng: ' + (sup.reasonCode || '?'); break; }
      if (v.lifecycle === 'error' || v.lifecycle === 'stopped') { reason = 'runner ' + v.lifecycle; break; }
      if (v.lifecycle !== 'in_game' && v.lifecycle !== 'farming' && v.lifecycle !== 'recovering' && v.lifecycle !== 'traveling') {
        notInGameSince = notInGameSince || Date.now();
        if (Date.now() - notInGameSince > 90_000) { reason = 'mất kết nối quá 90 s (' + v.lifecycle + ')'; break; }
      } else notInGameSince = null;

      if (Date.now() - lastSample >= 30_000) {
        lastSample = Date.now();
        const out2 = v.packets && v.packets.outgoing ? v.packets.outgoing : {};
        const sample = {
          min: Math.round((Date.now() - t0) / 6000) / 10,
          life: v.lifecycle, phase: sup.phase, map: v.mapId, pos: [Math.round(v.x), Math.round(v.y)],
          hp: v.hp !== undefined && v.hp !== null ? Math.round(v.hp) + '/' + v.maxHp : null,
          deaths: sup.stats && sup.stats.deaths, trips: sup.stats && sup.stats.trips, resumed: sup.stats && sup.stats.resumed,
          kills: v.killsBySelf, hurt: v.hurtCount, move: out2.move || 0, attack: out2.attack || 0, skill: out2.skill || 0, cmd: out2.cmd || 0, ping: out2.ping || 0,
          fps: v.fps && Math.round(v.fps), upd: v.updateErrors, perr: v.packetErrors, cerr: (v.consoleErrors || []).length,
          rssMB: rssMB(server.pid), memApi: v.memory || null,
        };
        samples.push(sample);
        console.log(JSON.stringify(sample));
      }
    }

    const last = samples[samples.length - 1] || {};
    const rss1 = rssMB(server.pid);
    const cpu1 = cpuSeconds(server.pid);
    const elapsedSec = (Date.now() - t0) / 1000;
    const rssSeries = samples.map((s) => s.rssMB).filter((x) => typeof x === 'number');
    console.log('=== TÓM TẮT');
    console.log(JSON.stringify({
      lýDoKếtThúc: reason,
      thờiGianThựcGiây: Math.round(elapsedSec),
      mẫu: samples.length,
      rssMB: { đầu: rss0, cuối: rss1, thấpNhất: rssSeries.length ? Math.min(...rssSeries) : null, caoNhất: rssSeries.length ? Math.max(...rssSeries) : null },
      cpuTrungBình: cpu0 !== null && cpu1 !== null ? Math.round(((cpu1 - cpu0) / elapsedSec) * 1000) / 10 + ' % của một lõi' : null,
      cuối: last,
      fpsThấpNhất: Math.min(...samples.map((s) => s.fps || 999)),
    }));
  } catch (e) {
    reason = 'lỗi: ' + String((e && e.message) || e).slice(0, 160);
    console.log(reason);
  } finally {
    await cleanup();
  }
  process.exit(0);
}

main();
