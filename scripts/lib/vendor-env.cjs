// Dựng môi trường giả để chạy client chính thức (vendor) trong Node, không hiển thị.
// Dùng bởi các spike; không phụ thuộc mạng trừ khi truyền WebSocketImpl.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..', '..');
const vendorRoot = path.join(repo, 'vendor/tutien2d-public-client/2026-10-06');

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

/**
 * @param {object} [opts]
 * @param {Function} [opts.WebSocketImpl] lớp WebSocket thật; mặc định là lớp giả không mở mạng.
 * @param {number} [opts.nowStart] mốc thời gian giả ban đầu (ms); nếu có, `performance.now`/`Date.now` trong vm dùng đồng hồ giả điều khiển bằng `advanceClock`.
 */
function createVendorEnv(opts = {}) {
  const rafQueue = [];
  const loadErrors = [];
  const consoleErrors = [];
  const sentPackets = [];
  let fakeNow = opts.nowStart ?? null;

  class OfflineWebSocket {
    constructor(url) { this.url = url; this.readyState = 0; }
    send(data) { sentPackets.push(data); }
    close() { this.readyState = 3; }
  }
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

  const clock = () => (fakeNow === null ? Date.now() : fakeNow);
  const win = {
    document: doc, localStorage, sessionStorage: localStorage,
    navigator: { userAgent: 'node', language: 'vi', maxTouchPoints: 0, getGamepads: () => [] },
    location: { hostname: 'tutien2d.online', search: '', href: 'https://tutien2d.online/', protocol: 'https:', origin: 'https://tutien2d.online', host: 'tutien2d.online', reload() {}, replace() {} },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; }, cancelAnimationFrame: () => {},
    WebSocket: opts.WebSocketImpl || OfflineWebSocket,
    fetch: () => Promise.reject(new Error('network disabled')),
    Image: function () { return makeStub('img'); }, Audio: function () { return makeStub('audio'); },
    AudioContext: function () { return makeStub('actx'); }, webkitAudioContext: function () { return makeStub('actx'); },
    performance: { now: clock },
    console: { log() {}, warn() {}, error(...a) { consoleErrors.push(a.map(String).join(' ').slice(0, 200)); }, info() {}, debug() {} },
    setTimeout: (cb, ms) => setTimeout(() => { try { cb(); } catch { /* bỏ qua */ } }, Math.min(ms || 0, 60000)),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: () => 0, clearInterval: () => {},
    Path2D: function () { return makeStub('p2d'); }, OffscreenCanvas: function () { return makeStub('oc'); },
    ResizeObserver: function () { return makeStub('ro'); }, IntersectionObserver: function () { return makeStub('io'); },
    XMLHttpRequest: function () { return makeStub('xhr'); }, Blob: function () { return makeStub('blob'); },
    URL: { createObjectURL: () => '' }, crypto: require('crypto').webcrypto,
  };
  if (fakeNow !== null) {
    // Date giả trong vm: client dùng Date.now() cho nhiều bộ đếm.
    const RealDate = Date;
    win.Date = class extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(fakeNow); }
      static now() { return fakeNow; }
    };
  }
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);

  const html = fs.readFileSync(path.join(vendorRoot, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*/, ''));
  let loaded = 0;
  for (const src of scripts) {
    const file = path.join(vendorRoot, src);
    if (!fs.existsSync(file)) { loadErrors.push([src, 'missing']); continue; }
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: src, timeout: 5000 });
      loaded += 1;
    } catch (e) { loadErrors.push([src, String(e && e.message).slice(0, 140)]); }
  }
  return {
    win, ctx, P: win.PNTT, scripts, loaded, loadErrors, consoleErrors, sentPackets, rafQueue,
    advanceClock(ms) { if (fakeNow !== null) fakeNow += ms; },
    // Chạy các callback requestAnimationFrame đã xếp hàng (client dùng rAF lồng nhau để tắt hiệu ứng mờ
    // và đặt SceneWorld.transitioning = false). Gọi một lần mỗi khung hình.
    flushRaf() {
      if (!rafQueue.length) return 0;
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const cb of batch) { try { cb(clock()); } catch { /* bỏ qua */ } }
      return batch.length;
    },
    now: clock,
    run(code) { return vm.runInContext(code, ctx); },
  };
}

module.exports = { createVendorEnv, makeStub, repo, vendorRoot };
