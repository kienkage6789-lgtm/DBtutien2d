// Spike giai đoạn 4 (ONLINE): chạy client chính thức không hiển thị, kết nối game thật, bật Auto trong thời gian ngắn.
// Cần TUTIEN_SPIKE_LIVE=1. Một phiên mỗi tài khoản: dừng server/bot trước (script tự kiểm tra cổng 4000).
// Lớp an toàn bao ngoài Auto: ngưỡng HP, gục, giới hạn thời gian, ngắt phiên khi vi phạm.
// Không in token, tên, id. Refresh token xoay vòng được lưu lại vào DB như worker vẫn làm.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { createVendorEnv, repo } = require('./lib/vendor-env.cjs');

if (process.env.TUTIEN_SPIKE_LIVE !== '1') {
  console.error('Đặt TUTIEN_SPIKE_LIVE=1 để chạy (kết nối game thật, bật Auto).');
  process.exit(2);
}
const AUTO_MS = Number(process.env.TUTIEN_SPIKE_AUTO_MS || 30000);
const HP_STOP_RATIO = Number(process.env.TUTIEN_SPIKE_HP_STOP || 0.5);
const SETTLE_MS = Number(process.env.TUTIEN_SPIKE_SETTLE_MS || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1500 }, () => { req.destroy(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

let P_selfId = () => null;
async function main() {
  if (await portOpen(4000)) { console.error('Cổng 4000 đang có server: dừng server/bot trước.'); process.exit(3); }

  // ---- phiên đăng nhập bằng mã dự án ----
  process.chdir(path.join(repo, 'apps/server'));
  const core = await import(pathToFileURL(path.join(repo, 'packages/core-client/dist/index.js')).href);
  const { CONFIG } = await import(pathToFileURL(path.join(repo, 'apps/server/dist/config.js')).href);
  const { db } = await import(pathToFileURL(path.join(repo, 'apps/server/dist/db/database.js')).href);
  const acc = db.data.accounts[0];
  if (!acc) throw new Error('Không có tài khoản trong DB.');
  const creds = db.getCredentials(acc.id);
  const auth = new core.SupabaseAuth({ url: CONFIG.SUPABASE_URL, anonKey: CONFIG.SUPABASE_ANON_KEY, gameApiBase: CONFIG.GAME_SERVER_URL.replace(/^ws/i, 'http') });
  const tokens = new core.TokenManager({ auth, identifier: acc.accountName, password: creds.password, refreshToken: creds.refreshToken });
  tokens.on('sessionUpdated', (s) => { if (s && s.refreshToken) { db.updateCredentials(acc.id, { refreshToken: s.refreshToken }); db.flush(); } });
  const accessToken = await tokens.getAccessToken();

  // ---- WebSocket thật có đếm gói ----
  const WS = createRequire(path.join(repo, 'packages/core-client/package.json'))('ws');
  const inCounts = {};
  const outCounts = {};
  const outMoves = [];
  const outCmds = {};
  let killsBySelf = 0;
  const handlerErrors = {};
  let closeInfo = null;
  let rawSocket = null;
  class CountingWebSocket {
    constructor(url) {
      this._ws = new WS(url);
      rawSocket = this._ws;
      this._ws.on('open', () => { if (this.onopen) this.onopen({}); });
      this._ws.on('message', (data) => {
        const text = data.toString();
        try { const pk = JSON.parse(text); inCounts[pk.op] = (inCounts[pk.op] || 0) + 1; if (pk.op === 'kill' && pk.by && P_selfId() && String(pk.by) === P_selfId()) killsBySelf += 1; } catch { /* bỏ qua */ }
        try { if (this.onmessage) this.onmessage({ data: text }); } catch (e) {
          const k = String(e && e.message).slice(0, 100);
          handlerErrors[k] = (handlerErrors[k] || 0) + 1;
        }
      });
      this._ws.on('close', (code) => { closeInfo = { code }; if (this.onclose) this.onclose({ code }); });
      this._ws.on('error', (e) => { closeInfo = { error: String(e && e.message).slice(0, 100) }; if (this.onerror) this.onerror({}); });
    }
    get readyState() { return this._ws.readyState; }
    send(d) {
      try {
        const p = JSON.parse(d);
        outCounts[p.op] = (outCounts[p.op] || 0) + 1;
        if (p.op === 'cmd') { const k = String(p.cmd); outCmds[k] = (outCmds[k] || 0) + 1; }
        if (p.op === 'move') outMoves.push({ at: Date.now(), st: p.st, seq: p.seq });
      } catch { /* bỏ qua */ }
      this._ws.send(d);
    }
    close() { this._ws.close(); }
  }
  CountingWebSocket.CONNECTING = 0; CountingWebSocket.OPEN = 1; CountingWebSocket.CLOSING = 2; CountingWebSocket.CLOSED = 3;

  const env = createVendorEnv({ WebSocketImpl: CountingWebSocket });
  const { P } = env;
  P_selfId = () => (P.Gateway && typeof P.Gateway.selfId === 'string' ? P.Gateway.selfId : null);
  const W = P.SceneWorld;
  const G = P.Gateway;
  P.Assets.ensureMap = () => Promise.resolve([]);
  P.Assets.idle = (cb) => { if (typeof cb === 'function') cb(); };
  P.Net.online = true;
  P.Net.client = { auth: { getSession: async () => ({ data: { session: { access_token: accessToken } } }) } };
  process.on('unhandledRejection', (e) => console.log('UNHANDLED:', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)));

  // ---- vòng lặp thời gian thật (như vòng lặp của Game, nhưng không vẽ) ----
  let running = true;
  let lastFrame = Date.now();
  let frames = 0;
  let updateErrors = 0;
  const loop = setInterval(() => {
    if (!running) return;
    const now = Date.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    P.Game.time += dt;
    frames += 1;
    try { if (P.Game.scene && P.Game.scene.update) P.Game.scene.update(dt); } catch (e) {
      updateErrors += 1;
      if (updateErrors <= 3) console.log('update lỗi:', String(e && e.message).slice(0, 160));
    }
  }, 16);

  // ---- đăng nhập rồi dựng cảnh (giống main.js: login xong mới vào cảnh) ----
  P.Game.init();
  const loggedIn = await G.login(10000);
  console.log('Gateway.login ->', loggedIn ? 'có phản hồi' : 'không phản hồi', '| ready', !!G.ready, '| map', G.mapId || null);
  W.nuongNenDau(W.startMapData());
  P.Game.changeScene(W, null, true);
  await sleep(SETTLE_MS);
  if (W.transitioning) { await sleep(2000); if (W.transitioning) { W.transitioning = false; console.log('transitioning kẹt -> tắt tay'); } }

  const me = () => W.player;
  const hpRatio = () => (me() && me().hpMax > 0 ? me().hp / me().hpMax : 1);
  console.log('cảnh:', 'map', W.map && W.map.data && W.map.data.id, '| player', !!me(),
    '| vị trí', me() ? [Math.round(me().x), Math.round(me().y)] : null,
    '| hp', me() ? me().hp + '/' + me().hpMax : null, '| quái', (W.enemies || []).length,
    '| đã gửi', JSON.stringify(outCounts));

  let abort = null;
  if (!me()) abort = 'không có nhân vật trong cảnh';
  else if (!W.map || W.map.data.id !== G.mapId) abort = 'bản đồ cảnh khác bản đồ server';
  else if (me().downed) abort = 'nhân vật đang gục';
  if (abort) { console.log('HỦY trước khi bật Auto:', abort); }

  const hurtAtStart = inCounts.hurt || 0;
  const startPos = me() ? { x: me().x, y: me().y } : null;
  let autoOnAt = null;
  const samples = [];
  if (!abort && AUTO_MS > 0) {
    P.Input.pressAutoToggle();
    await sleep(100);
    autoOnAt = Date.now();
    console.log('--- Auto', W.autoOn ? 'BẬT' : 'KHÔNG bật được', '| giới hạn', AUTO_MS, 'ms | dừng khi HP <', Math.round(HP_STOP_RATIO * 100) + '%');
    let lastPrint = 0;
    while (Date.now() - autoOnAt < AUTO_MS) {
      await sleep(250);
      if (closeInfo) { abort = 'mất kết nối ' + JSON.stringify(closeInfo); break; }
      if (!me()) { abort = 'mất nhân vật'; break; }
      if (me().downed || me().state === 'down') { abort = 'nhân vật gục'; break; }
      if (hpRatio() < HP_STOP_RATIO) { abort = 'HP dưới ngưỡng ' + Math.round(hpRatio() * 100) + '%'; break; }
      if (Date.now() - lastPrint >= 2000) {
        lastPrint = Date.now();
        const t = Math.round((Date.now() - autoOnAt) / 1000);
        samples.push({ t, hp: Math.round(me().hp) });
        console.log('t=' + t + 's', 'pos', [Math.round(me().x), Math.round(me().y)], 'state', me().state, 'hp', Math.round(me().hp) + '/' + me().hpMax,
          '| hurt', (inCounts.hurt || 0) - hurtAtStart, '| gửi move', outCounts.move || 0, 'attack', outCounts.attack || 0, 'skill', outCounts.skill || 0,
          '| kill nhận', inCounts.kill || 0);
      }
    }
    // tắt Auto và dừng nhân vật trước khi rời
    if (W.autoOn) P.Input.pressAutoToggle();
    try { if (me()) me().stop(); if (W.cancelApproach) W.cancelApproach(); } catch { /* bỏ qua */ }
    console.log('--- Auto TẮT', abort ? '(vì: ' + abort + ')' : '(hết thời gian)');
    await sleep(1500);
  }

  const moveTimes = outMoves.map((m) => m.at);
  const moveRate = moveTimes.length > 1 ? Math.round((moveTimes.length - 1) / ((moveTimes[moveTimes.length - 1] - moveTimes[0]) / 1000) * 10) / 10 : null;
  const stCounts = {};
  for (const m of outMoves) stCounts[m.st] = (stCounts[m.st] || 0) + 1;
  console.log(JSON.stringify({
    abort,
    autoOnMs: autoOnAt ? Date.now() - autoOnAt : null,
    quãngĐường: startPos && me() ? Math.round(Math.hypot(me().x - startPos.x, me().y - startPos.y)) : null,
    hpCuối: me() ? Math.round(me().hp) + '/' + me().hpMax : null,
    hurtTrongAuto: (inCounts.hurt || 0) - hurtAtStart,
    gửi: outCounts,
    lệnhCmd: outCmds,
    quáiHạTrongPhiên: killsBySelf,
    nhận: inCounts,
    tốcĐộMovePerGiây: moveRate,
    moveTheoSt: stCounts,
    frames,
    lỗiUpdate: updateErrors,
    lỗiXửLýGói: handlerErrors,
    consoleError: env.consoleErrors.slice(0, 3),
    closeInfo,
  }, null, 1));

  running = false;
  clearInterval(loop);
  try { rawSocket && rawSocket.close(); } catch { /* bỏ qua */ }
  tokens.stop();
  await sleep(800);
  process.exit(0);
}

main().catch((e) => { console.error('lỗi:', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)); process.exit(1); });
