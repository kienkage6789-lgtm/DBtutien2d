// Spike giai đoạn 2: chạy client chính thức (vendor) trong Node, KHÔNG hiển thị, kết nối game server thật.
// Chỉ quan sát: không gọi Game.start, không bật Auto, không gửi lệnh gameplay.
// Cần: TUTIEN_SPIKE_LIVE=1. Chỉ MỘT phiên đăng nhập mỗi tài khoản: dừng server/bot trước khi chạy.
// Không in token, tên nhân vật hay id. Refresh token xoay vòng được lưu lại vào DB như worker vẫn làm.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

if (process.env.TUTIEN_SPIKE_LIVE !== '1') {
  console.error('Đặt TUTIEN_SPIKE_LIVE=1 để chạy (kết nối game thật bằng phiên tài khoản).');
  process.exit(2);
}

const repo = path.resolve(__dirname, '..');
const vendorRoot = path.join(repo, 'vendor/tutien2d-public-client/2026-10-06');
const OBSERVE_MS = Number(process.env.TUTIEN_SPIKE_OBSERVE_MS || 25000);

function portOpen(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1500 }, () => { req.destroy(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ---------- đối tượng giả cho DOM ----------
function makeStub(name = 'stub') {
  const target = function () {};
  const store = new Map();
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then') return undefined;
      if (prop === 'length') return 0;
      if (prop === 'toString' || prop === 'valueOf') return () => '';
      if (store.has(prop)) return store.get(prop);
      if (typeof prop === 'symbol') return undefined;
      const child = makeStub(name + '.' + String(prop));
      store.set(prop, child);
      return child;
    },
    set(_t, prop, value) { store.set(prop, value); return true; },
    has() { return true; },
    apply() { return makeStub(name + '()'); },
    construct() { return makeStub('new ' + name); },
  });
}

async function main() {
  if (await portOpen(4000)) {
    console.error('Server dashboard đang chạy ở cổng 4000: dừng server/bot trước (một phiên mỗi tài khoản).');
    process.exit(3);
  }

  // ---------- lấy phiên bằng mã của dự án ----------
  process.chdir(path.join(repo, 'apps/server')); // để DATA_DIR = apps/server/data
  const core = await import(pathToFileURL(path.join(repo, 'packages/core-client/dist/index.js')).href);
  const { CONFIG } = await import(pathToFileURL(path.join(repo, 'apps/server/dist/config.js')).href);
  const { db } = await import(pathToFileURL(path.join(repo, 'apps/server/dist/db/database.js')).href);
  const acc = db.data.accounts[0];
  if (!acc) throw new Error('Không có tài khoản trong DB.');
  const creds = db.getCredentials(acc.id);
  const auth = new core.SupabaseAuth({
    url: CONFIG.SUPABASE_URL,
    anonKey: CONFIG.SUPABASE_ANON_KEY,
    gameApiBase: CONFIG.GAME_SERVER_URL.replace(/^ws/i, 'http'),
  });
  const tokens = new core.TokenManager({
    auth,
    identifier: acc.accountName,
    password: creds.password,
    refreshToken: creds.refreshToken,
  });
  tokens.on('sessionUpdated', (s) => {
    if (s && s.refreshToken) { db.updateCredentials(acc.id, { refreshToken: s.refreshToken }); db.flush(); }
  });
  const accessToken = await tokens.getAccessToken();
  console.log('phiên đăng nhập: lấy được access token (không in)');

  // ---------- môi trường vm ----------
  const WS = createRequire(path.join(repo, 'packages/core-client/package.json'))('ws');
  const opCounts = {};
  const handlerErrors = {};
  let closeInfo = null;
  let socketCount = 0;
  class RealWebSocket {
    constructor(url) {
      socketCount += 1;
      this.url = url;
      this._ws = new WS(url);
      this._ws.on('open', () => { if (this.onopen) this.onopen({}); });
      this._ws.on('message', (data) => {
        const text = data.toString();
        try { const op = JSON.parse(text).op; opCounts[op] = (opCounts[op] || 0) + 1; } catch { /* bỏ qua */ }
        try { if (this.onmessage) this.onmessage({ data: text }); } catch (e) {
          const k = String(e && e.message).slice(0, 120);
          handlerErrors[k] = (handlerErrors[k] || 0) + 1;
        }
      });
      this._ws.on('close', (code, reason) => { closeInfo = { code, reason: String(reason).slice(0, 80) }; if (this.onclose) this.onclose({ code }); });
      this._ws.on('error', (e) => { closeInfo = { error: String(e && e.message).slice(0, 120) }; if (this.onerror) this.onerror({}); });
    }
    get readyState() { return this._ws.readyState; }
    send(d) { this._ws.send(d); }
    close() { this._ws.close(); }
  }
  RealWebSocket.CONNECTING = 0; RealWebSocket.OPEN = 1; RealWebSocket.CLOSING = 2; RealWebSocket.CLOSED = 3;

  const timers = [];
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const doc = makeStub('document');
  doc.readyState = 'complete'; doc.hidden = false; doc.addEventListener = () => {};
  doc.createElement = () => { const el = makeStub('el'); el.style = makeStub('style'); el.getContext = () => makeStub('ctx'); el.width = 64; el.height = 64; return el; };
  doc.getElementById = () => makeStub('byId'); doc.querySelector = () => makeStub('qs'); doc.querySelectorAll = () => []; doc.documentElement = makeStub('html');
  const win = {
    document: doc, localStorage, sessionStorage: localStorage,
    navigator: { userAgent: 'node', language: 'vi', maxTouchPoints: 0, getGamepads: () => [] },
    location: { hostname: 'tutien2d.online', search: '', href: 'https://tutien2d.online/', protocol: 'https:', origin: 'https://tutien2d.online', host: 'tutien2d.online', reload() {}, replace() {} },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (cb) => { timers.push(cb); return timers.length; }, cancelAnimationFrame: () => {},
    WebSocket: RealWebSocket,
    fetch: () => Promise.reject(new Error('network disabled')),
    Image: function () { return makeStub('img'); }, Audio: function () { return makeStub('audio'); },
    AudioContext: function () { return makeStub('actx'); }, webkitAudioContext: function () { return makeStub('actx'); },
    performance: { now: () => Date.now() },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: (cb, ms) => { const id = setTimeout(() => { try { cb(); } catch { /* bỏ qua */ } }, Math.min(ms || 0, 60000)); return id; },
    clearTimeout: (id) => clearTimeout(id),
    setInterval: () => 0, clearInterval: () => {},
    Path2D: function () { return makeStub('p2d'); }, OffscreenCanvas: function () { return makeStub('oc'); },
    ResizeObserver: function () { return makeStub('ro'); }, IntersectionObserver: function () { return makeStub('io'); },
    XMLHttpRequest: function () { return makeStub('xhr'); }, Blob: function () { return makeStub('blob'); },
    URL: { createObjectURL: () => '' }, crypto: require('crypto').webcrypto,
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);

  const html = fs.readFileSync(path.join(vendorRoot, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*/, ''));
  let loaded = 0;
  for (const src of scripts) {
    const file = path.join(vendorRoot, src);
    if (!fs.existsSync(file)) continue;
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: src, timeout: 5000 }); loaded += 1; } catch { /* script vô hại */ }
  }
  const P = win.PNTT;
  console.log('client nạp:', loaded + '/' + scripts.length, 'script; serverUrl:', (win.PNTT_RUNTIME_CONFIG || {}).serverUrl);

  // ---------- cấp phiên cho client ----------
  P.Net.online = true;
  P.Net.client = { auth: { getSession: async () => ({ data: { session: { access_token: accessToken } } }) } };

  // ---------- kết nối thật, chỉ quan sát ----------
  const G = P.Gateway;
  const connected = G.connect();
  console.log('Gateway.connect() ->', connected);
  const t0 = Date.now();
  let readyAt = null;
  while (Date.now() - t0 < OBSERVE_MS) {
    await new Promise((r) => setTimeout(r, 500));
    if (readyAt === null && G.ready) readyAt = Date.now() - t0;
    if (closeInfo && closeInfo.error) break;
  }
  const players = Object.keys(G.remotes || {}).length;
  console.log(JSON.stringify({
    connected: !!G.connected,
    ready: !!G.ready,
    readyAfterMs: readyAt,
    hasSelfId: typeof G.selfId === 'string' && G.selfId.length > 0,
    mapId: G.mapId || null,
    mapEpoch: G.mapEpoch,
    remotes: players,
    snapV: G.snapV,
    sockets: socketCount,
    closeInfo,
    opCounts,
    handlerErrors,
  }, null, 1));
  const world = P.SceneWorld;
  console.log('SceneWorld.player:', world && world.player ? 'có' : 'chưa (cảnh chưa khởi động)');

  try { G.socket && G.socket.close(); } catch { /* bỏ qua */ }
  tokens.stop();
  await new Promise((r) => setTimeout(r, 800));
  process.exit(0);
}

main().catch((e) => { console.error('lỗi:', String(e && e.message).slice(0, 200)); process.exit(1); });
