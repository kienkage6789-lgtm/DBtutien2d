// Đo tốc độ thật của move-to (engine core) qua server thật: 3 lượt ~300 px, bấm giờ từ lúc gửi tới lúc 'arrived'.
// Chạy: TUTIEN_MEASURE_LIVE=1 node scripts/measure-moveto.cjs [khoảngCáchPx=300] [số lượt=3]
// Tự khởi động/tắt server, dừng ngay nếu hurtCount tăng từ 5 trở lên, luôn dọn dẹp. Không in token/tên/id.
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

if (process.env.TUTIEN_MEASURE_LIVE !== '1') { console.error('Đặt TUTIEN_MEASURE_LIVE=1 để chạy (điều khiển nhân vật thật).'); process.exit(2); }
const DISTANCE = Number(process.argv[2] || 300);
const TRIALS = Number(process.argv[3] || 3);
const repo = path.resolve(__dirname, '..');
const serverDir = path.join(repo, 'apps/server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function api(method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: 4000, path: urlPath, method, timeout: 8000, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
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
const account = async () => { const r = await api('GET', '/api/accounts'); return r.json && r.json.data && r.json.data[0]; };

async function main() {
  const logDir = process.env.TUTIEN_MEASURE_LOG_DIR || repo;
  const out = fs.openSync(path.join(logDir, 'measure-server.log'), 'a');
  const server = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, stdio: ['ignore', out, out], windowsHide: true });
  let exited = false; server.on('exit', () => { exited = true; });
  let id = null; let cleaned = false;
  async function cleanup() {
    if (cleaned) return; cleaned = true;
    if (id && !exited) { console.log('bot stop ->', (await api('POST', `/api/accounts/${id}/stop`, {})).status); await sleep(1500); }
    try { server.kill(); } catch { /* bỏ qua */ }
    await sleep(1200);
  }
  process.on('SIGINT', async () => { await cleanup(); process.exit(1); });

  try {
    for (let i = 0; i < 40; i += 1) { await sleep(500); if ((await api('GET', '/health')).status === 200) break; }
    const a0 = await account(); if (!a0) throw new Error('không có tài khoản');
    id = a0.id;
    const cfg = await api('GET', `/api/accounts/${id}/config`);
    const engine = cfg.json && cfg.json.data && cfg.json.data.engine;
    if (engine && engine !== 'core') throw new Error('engine hiện tại là ' + engine + ', cần core để đo move-to');
    console.log('bot start ->', (await api('POST', `/api/accounts/${id}/start`, {})).status);

    let a = null;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500); a = await account();
      if (a && a.connection === 'IN_GAME' && a.mapContextIsCurrent && Number.isFinite(a.x) && a.mapContext && a.mapContext.khu) break;
    }
    if (!a || !a.mapContextIsCurrent) throw new Error('chưa có map context hiện hành');
    console.log('sẵn sàng: map', a.mapId, '| khu', a.mapContext.khu, '| vị trí', Math.round(a.x), Math.round(a.y), '| quái', (a.monsters || []).length, '| hurtCount', a.hurtCount);

    const walk = await import(pathToFileURL(path.join(serverDir, 'dist/orchestrator/walk-path.js')).href);
    const grid = await import(pathToFileURL(path.join(serverDir, 'dist/config/walk-grid.js')).href);
    const hurt0 = a.hurtCount || 0;
    const results = [];
    let origin = { x: a.x, y: a.y };

    for (let t = 1; t <= TRIALS; t += 1) {
      a = await account();
      const me = { x: a.x, y: a.y };
      const monsters = a.monsters || [];
      // chọn đích: ưu tiên quay về hướng điểm xuất phát ở lượt chẵn
      const angles = [];
      if (t % 2 === 0) { const back = Math.atan2(origin.y - me.y, origin.x - me.x); angles.push(back); }
      for (let k = 0; k < 8; k += 1) angles.push((k * Math.PI) / 4);
      let target = null;
      for (const ang of angles) {
        for (const d of [DISTANCE, DISTANCE * 0.8, DISTANCE * 0.6]) {
          const p = { x: Math.round(me.x + Math.cos(ang) * d), y: Math.round(me.y + Math.sin(ang) * d) };
          const g = grid.getWalkGrid(a.mapId);
          if (!g || p.x < 0 || p.y < 0 || p.x >= g.width * 32 || p.y >= g.height * 32) continue;
          if (!grid.isWalkableTile(a.mapId, Math.floor(p.x / 32), Math.floor(p.y / 32))) continue;
          if (!walk.isWalkSegmentClear(a.mapId, me, p)) continue;
          if (monsters.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 160 || Math.hypot(m.x - me.x, m.y - me.y) < 100)) continue;
          target = p; break;
        }
        if (target) break;
      }
      if (!target) { console.log('lượt', t, ': không tìm được đích an toàn, bỏ qua'); continue; }
      const straight = Math.hypot(target.x - me.x, target.y - me.y);
      const started = Date.now();
      const res = await api('POST', `/api/accounts/${id}/navigation/move-to`, {
        requestId: crypto.randomUUID(), mapId: a.mapId, khu: a.mapContext.khu, x: target.x, y: target.y, arrivalRadius: 20,
      });
      console.log('lượt', t, '| đích cách', Math.round(straight), 'px | move-to ->', res.status, res.json && res.json.errorCode ? res.json.errorCode : '');
      if (res.status !== 200 && res.status !== 202) { results.push({ t, error: res.status, code: res.json && res.json.errorCode }); continue; }

      let final = null; let samples = [];
      while (Date.now() - started < 25_000) {
        await sleep(200);
        const cur = await account();
        if (!cur) continue;
        samples.push({ ms: Date.now() - started, x: Math.round(cur.x), y: Math.round(cur.y) });
        const st = cur.moveTo && cur.moveTo.status;
        if (['arrived', 'failed', 'blocked', 'cancelled'].includes(st)) { final = { st, reason: cur.moveTo.reason, ms: Date.now() - started, x: cur.x, y: cur.y }; break; }
        if ((cur.hurtCount || 0) - hurt0 >= 5) { final = { st: 'aborted_hurt', ms: Date.now() - started }; break; }
      }
      if (!final) final = { st: 'timeout', ms: Date.now() - started };
      const covered = Math.hypot((final.x ?? me.x) - me.x, (final.y ?? me.y) - me.y);
      const speed = final.st === 'arrived' && final.ms > 0 ? Math.round((straight / (final.ms / 1000)) * 10) / 10 : null;
      const r = { t, status: final.st, reason: final.reason || null, seconds: Math.round(final.ms / 100) / 10, straightPx: Math.round(straight), coveredPx: Math.round(covered), avgSpeedPxPerSec: speed, hurtDelta: (await account()).hurtCount - hurt0 };
      results.push(r);
      console.log(JSON.stringify(r));
      if (final.st === 'aborted_hurt') break;
      await sleep(1500);
    }

    const ok = results.filter((r) => r.avgSpeedPxPerSec);
    console.log('=== TÓM TẮT');
    console.log(JSON.stringify({
      lượtThànhCông: ok.length + '/' + results.length,
      tốcĐộTrungBình: ok.length ? Math.round((ok.reduce((s, r) => s + r.avgSpeedPxPerSec, 0) / ok.length) * 10) / 10 : null,
      thamChiếu: { clientThậtĐi: 101, bảnCũƯớcTính: 7, lýThuyếtBảnCũ: 68 },
      kếtQuả: results,
    }));
  } catch (e) {
    console.log('lỗi:', String((e && e.message) || e).slice(0, 200));
  } finally {
    await cleanup();
  }
  process.exit(0);
}
main();
