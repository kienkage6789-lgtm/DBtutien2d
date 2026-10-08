// Spike: nạp client chính thức (vendor) trong Node với đối tượng giả. KHÔNG mạng, KHÔNG đăng nhập.
// Chạy: node scripts/spike-vendor-client-boot.cjs
// Mục đích: xem logic client có chạy được khi bỏ phần hiển thị không.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', 'vendor/tutien2d-public-client/2026-10-06');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*/, ''));

const timers = [];
function makeStub(name = 'stub') {
  const target = function () {};
  const store = new Map();
  const handler = {
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
  };
  return new Proxy(target, handler);
}

const sockets = [];
class FakeWebSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; }
}
FakeWebSocket.OPEN = 1;

const storage = new Map();
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const doc = makeStub('document');
doc.readyState = 'complete';
doc.hidden = false;
doc.addEventListener = () => {};
doc.createElement = () => { const el = makeStub('el'); el.style = makeStub('style'); el.getContext = () => makeStub('ctx'); el.width = 64; el.height = 64; return el; };
doc.getElementById = () => makeStub('byId');
doc.querySelector = () => makeStub('qs');
doc.querySelectorAll = () => [];
doc.documentElement = makeStub('html');

const win = {
  document: doc,
  localStorage,
  sessionStorage: localStorage,
  navigator: { userAgent: 'node', language: 'vi', maxTouchPoints: 0, getGamepads: () => [] },
  location: { hostname: 'tutien2d.online', search: '', href: 'https://tutien2d.online/', protocol: 'https:', origin: 'https://tutien2d.online', reload() {} },
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  requestAnimationFrame: (cb) => { timers.push(cb); return timers.length; },
  cancelAnimationFrame: () => {},
  WebSocket: FakeWebSocket,
  fetch: () => Promise.reject(new Error('network disabled')),
  Image: function () { return makeStub('img'); },
  Audio: function () { return makeStub('audio'); },
  AudioContext: function () { return makeStub('actx'); },
  webkitAudioContext: function () { return makeStub('actx'); },
  performance: { now: () => Date.now() },
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  setTimeout: (cb) => { timers.push(cb); return timers.length; },
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  Path2D: function () { return makeStub('p2d'); },
  OffscreenCanvas: function () { return makeStub('oc'); },
  ResizeObserver: function () { return makeStub('ro'); },
  IntersectionObserver: function () { return makeStub('io'); },
  XMLHttpRequest: function () { return makeStub('xhr'); },
  Blob: function () { return makeStub('blob'); },
  URL: { createObjectURL: () => '' },
  crypto: require('crypto').webcrypto,
};
win.window = win;
win.self = win;
win.globalThis = win;
const ctx = vm.createContext(win);

const errors = [];
let loaded = 0;
for (const src of scripts) {
  const file = path.join(root, src);
  if (!fs.existsSync(file)) { errors.push([src, 'missing']); continue; }
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: src, timeout: 5000 });
    loaded += 1;
  } catch (e) {
    errors.push([src, String(e && e.message).slice(0, 140)]);
  }
}
const P = win.PNTT || {};
console.log('scripts', scripts.length, 'loaded ok', loaded, 'errors', errors.length);
for (const [s, m] of errors.slice(0, 15)) console.log('ERR', s, '->', m);
console.log('PNTT keys', Object.keys(P).length);
for (const k of ['Game', 'Gateway', 'SceneWorld', 'Player', 'Enemy', 'Skills', 'Targeting', 'Pathfinder', 'TileMap', 'MapData', 'Input', 'Net']) {
  console.log(k, typeof P[k], P[k] && typeof P[k] === 'object' ? Object.keys(P[k]).length + ' keys' : '');
}

const G = P.Game;
console.log('Game keys:', Object.keys(G).join(','));
console.log('Gateway fns (sample):', Object.keys(P.Gateway).filter((k) => typeof P.Gateway[k] === 'function').slice(0, 40).join(','));
console.log('Gateway fields:', Object.keys(P.Gateway).filter((k) => typeof P.Gateway[k] !== 'function').slice(0, 30).join(','));
console.log('SceneWorld fns (sample):', Object.keys(P.SceneWorld).filter((k) => typeof P.SceneWorld[k] === 'function').slice(0, 40).join(','));
console.log('Net keys:', Object.keys(P.Net).join(','));
let ran = 0, thrown = 0;
for (let i = 0; i < 40 && timers.length; i += 1) {
  const cb = timers.shift();
  try { cb(Date.now()); ran += 1; } catch (e) { thrown += 1; if (thrown <= 4) console.log('timer error:', String(e && e.message).slice(0, 160)); }
}
console.log('timers ran', ran, 'thrown', thrown, 'left', timers.length, 'sockets', sockets.length, 'scene', typeof G.scene, G.scene && Object.keys(G.scene).length);
