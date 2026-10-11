import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export interface VendorSocketEvent {
  data: string;
}

export interface VendorSocketLike {
  readyState: number;
  onopen?: (event: unknown) => void;
  onmessage?: (event: VendorSocketEvent) => void;
  onerror?: (event: unknown) => void;
  onclose?: (event: { code?: number; reason?: string }) => void;
  send(data: string): void;
  close(): void;
}

export type VendorWebSocketConstructor = new (url: string) => VendorSocketLike;

export interface VendorEnvOptions {
  vendorClientDir: string;
  WebSocketImpl?: VendorWebSocketConstructor;
  /** Fake time is deliberately opt-in and is for offline simulation only. */
  nowStart?: number;
  randomSeed?: number;
  maxConsoleErrors?: number;
}

export interface VendorEnv {
  readonly win: Record<string, unknown>;
  readonly context: vm.Context;
  readonly P: Record<string, any>;
  readonly scripts: string[];
  readonly loaded: number;
  readonly loadErrors: Array<{ script: string; message: string }>;
  readonly consoleErrors: string[];
  readonly sentPackets: string[];
  readonly rafQueue: Array<(timestamp: number) => void>;
  readonly now: () => number;
  readonly fakeClock: boolean;
  advanceClock(ms: number): void;
  flushRaf(): number;
  run(code: string): unknown;
  dispose(): void;
}

const DEFAULT_MAX_CONSOLE_ERRORS = 50;

export function makeStub(name = 'stub'): any {
  const target = function stubFunction(): void {};
  const store = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(_target, property: PropertyKey) {
      if (property === Symbol.toPrimitive) return () => 0;
      if (property === 'then') return undefined;
      if (property === 'length') return 0;
      if (property === 'toString' || property === 'valueOf') return () => '';
      if (store.has(property)) return store.get(property);
      if (typeof property === 'symbol') return undefined;
      const child = makeStub(`${name}.${String(property)}`);
      store.set(property, child);
      return child;
    },
    set(_target, property: PropertyKey, value: unknown) {
      store.set(property, value);
      return true;
    },
    has() { return true; },
    apply() { return makeStub(`${name}()`); },
    construct() { return makeStub(`new ${name}`); },
  });
}

/**
 * Context 2D giả cho client chạy headless. Các hàm vẽ chỉ-ghi trả `undefined` như trình duyệt thật và không cấp phát;
 * mọi tên khác (measureText, getImageData, createLinearGradient, thuộc tính lạ...) rơi về Proxy `makeStub` như trước,
 * nên hành vi với mã client không đổi. Tạo ảnh map gọi canvas hàng chục nghìn lần: Proxy + Proxy mới mỗi lời gọi rất tốn CPU.
 */
const CANVAS_DRAW_ONLY_METHODS = [
  'fillRect', 'strokeRect', 'clearRect', 'fill', 'stroke', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo',
  'ellipse', 'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'save', 'restore', 'translate', 'rotate', 'scale',
  'transform', 'setTransform', 'resetTransform', 'drawImage', 'putImageData', 'fillText', 'strokeText', 'clip', 'setLineDash',
] as const;

function makeCanvasContext(): any {
  const fallback = makeStub('context');
  const context: Record<string, any> = Object.create(fallback);
  const noop = (): void => undefined;
  for (const name of CANVAS_DRAW_ONLY_METHODS) context[name] = noop;
  // Mã vẽ ảnh map ghi từng điểm ảnh vào createImageData(...).data[i]: dùng mảng typed thật như trình duyệt (nhanh hơn Proxy rất nhiều).
  context.createImageData = (widthOrImage: unknown, height?: unknown) => {
    const source = widthOrImage as { width?: number; height?: number } | number;
    const width = Math.max(0, Math.floor(Number(typeof source === 'object' && source ? source.width : source)) || 0);
    const rows = Math.max(0, Math.floor(Number(typeof source === 'object' && source ? source.height : height)) || 0);
    return { width, height: rows, data: new Uint8ClampedArray(width * rows * 4) };
  };
  Object.assign(context, {
    fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    miterLimit: 10, lineDashOffset: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none',
  });
  return context;
}

function seededRandom(seed: number): () => number {
  let value = (seed >>> 0) || 0x9e3779b9;
  return () => {
    value = (Math.imul(value ^ (value >>> 15), 1 | value) + 0x6d2b79f5) >>> 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 7), 61 | next) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function blockedXmlHttpRequest(): any {
  return class BlockedXmlHttpRequest {
    public open(): never { throw new Error('vendor network disabled: XMLHttpRequest'); }
    public send(): never { throw new Error('vendor network disabled: XMLHttpRequest'); }
  };
}

function offlineSocketClass(sentPackets: string[]): VendorWebSocketConstructor {
  class OfflineWebSocket implements VendorSocketLike {
    public static readonly CONNECTING = 0;
    public static readonly OPEN = 1;
    public static readonly CLOSING = 2;
    public static readonly CLOSED = 3;
    public readyState = OfflineWebSocket.CLOSED;
    public onopen?: (event: unknown) => void;
    public onmessage?: (event: VendorSocketEvent) => void;
    public onerror?: (event: unknown) => void;
    public onclose?: (event: { code?: number; reason?: string }) => void;
    public constructor(public readonly url: string) {
      void url;
    }
    public send(data: string): void { sentPackets.push(data); }
    public close(): void {
      this.readyState = OfflineWebSocket.CLOSED;
      this.onclose?.({ code: 1000, reason: 'offline' });
    }
  }
  return OfflineWebSocket;
}

function safeScriptList(vendorClientDir: string): string[] {
  const indexPath = path.join(vendorClientDir, 'index.html');
  if (!fs.existsSync(vendorClientDir) || !fs.statSync(vendorClientDir).isDirectory()) {
    throw new Error(`VENDOR_CLIENT_DIR_MISSING: vendor client directory does not exist: ${vendorClientDir}`);
  }
  if (!fs.existsSync(indexPath)) {
    throw new Error(`VENDOR_CLIENT_INDEX_MISSING: index.html not found in ${vendorClientDir}`);
  }
  const html = fs.readFileSync(indexPath, 'utf8');
  return [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
    .map((match) => match[1].replace(/\?.*/, ''));
}

/**
 * Loads the checked-in official client into a restricted vm context.
 * This is isolation for capability control, not a security boundary: the
 * snapshot is trusted, reviewed input and node:vm is explicitly not a
 * hardened sandbox.
 */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string): string | null => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string): void => { data.set(key, String(value)); },
    removeItem: (key: string): void => { data.delete(key); },
    clear: (): void => { data.clear(); },
    key: (index: number): string | null => Array.from(data.keys())[index] ?? null,
    get length(): number { return data.size; },
  };
}

export function createVendorEnv(options: VendorEnvOptions): VendorEnv {
  const scripts = safeScriptList(options.vendorClientDir);
  const loadErrors: Array<{ script: string; message: string }> = [];
  const consoleErrors: string[] = [];
  const sentPackets: string[] = [];
  const rafQueue: Array<(timestamp: number) => void> = [];
  const timerIds = new Set<ReturnType<typeof setTimeout>>();
  const intervalIds = new Set<ReturnType<typeof setInterval>>();
  const maxConsoleErrors = options.maxConsoleErrors ?? DEFAULT_MAX_CONSOLE_ERRORS;
  let fakeNow = options.nowStart ?? null;
  const fakeClock = fakeNow !== null;
  const clock = () => (fakeNow === null ? Date.now() : fakeNow);
  const trackTimeout = (callback: () => void, delay?: number): ReturnType<typeof setTimeout> => {
    const id = setTimeout(() => {
      timerIds.delete(id);
      try { callback(); } catch { /* vendor errors are surfaced through its console hook */ }
    }, Math.min(Math.max(delay ?? 0, 0), 60_000));
    timerIds.add(id);
    return id;
  };
  const trackInterval = (callback: () => void, delay?: number): ReturnType<typeof setInterval> => {
    const id = setInterval(() => {
      try { callback(); } catch { /* vendor errors are surfaced through its console hook */ }
    }, Math.max(delay ?? 0, 0));
    intervalIds.add(id);
    return id;
  };

  const document = makeStub('document') as Record<string, any>;
  document.readyState = 'complete';
  document.hidden = false;
  document.addEventListener = () => {};
  document.createElement = () => {
    const element = makeStub('element') as Record<string, any>;
    element.style = makeStub('style');
    element.classList = makeStub('classList');
    element.getContext = () => makeCanvasContext();
    element.width = 64;
    element.height = 64;
    return element;
  };
  document.getElementById = () => makeStub('byId');
  document.querySelector = () => makeStub('querySelector');
  document.querySelectorAll = () => [];
  document.documentElement = makeStub('html');

  const RealDate = Date;
  const DateImpl = fakeClock ? class FakeDate extends RealDate {
    public constructor(...args: any[]) { super(...((args.length > 0 ? args : [fakeNow as number]) as [number])); }
    public static now(): number { return fakeNow as number; }
  } : RealDate;
  const math = Object.create(Math) as typeof Math;
  if (options.randomSeed !== undefined) math.random = seededRandom(options.randomSeed);

  const win: Record<string, any> = {
    document,
    // Kho PHẢI lưu thật (trong bộ nhớ, riêng cho từng runner). Client ghi bản lưu nhận từ gói `state` vào
    // đây (PROGRESS_KEY) rồi đọc lại bằng Quest.load() để dựng cảnh giới, trang bị và kỹ năng. Kho rỗng khiến
    // nhân vật chạy với cảnh giới mặc định (hpMax 100) và không biết kỹ năng nào.
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    // Do not spoof a browser User-Agent. The vendor snapshot only needs the
    // non-network capability hints below for its feature checks.
    navigator: { language: 'vi', maxTouchPoints: 0, getGamepads: () => [] },
    location: {
      hostname: 'tutien2d.online', search: '', href: 'https://tutien2d.online/',
      protocol: 'https:', origin: 'https://tutien2d.online', host: 'tutien2d.online',
      reload() {}, replace() {},
    },
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      rafQueue.push(callback);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
    WebSocket: options.WebSocketImpl || offlineSocketClass(sentPackets),
    fetch: () => Promise.reject(new Error('vendor network disabled: fetch')),
    Image: function Image(): any { return makeStub('image'); },
    Audio: function Audio(): any { return makeStub('audio'); },
    AudioContext: function AudioContext(): any { return makeStub('audioContext'); },
    webkitAudioContext: function WebkitAudioContext(): any { return makeStub('audioContext'); },
    performance: { now: clock },
    console: {
      log() {},
      warn() {},
      info() {},
      debug() {},
      error(...args: unknown[]) {
        if (consoleErrors.length < maxConsoleErrors) consoleErrors.push(args.map(String).join(' ').slice(0, 240));
      },
    },
    setTimeout: trackTimeout,
    clearTimeout: (id: ReturnType<typeof setTimeout>) => { timerIds.delete(id); clearTimeout(id); },
    setInterval: trackInterval,
    clearInterval: (id: ReturnType<typeof setInterval>) => { intervalIds.delete(id); clearInterval(id); },
    Path2D: function Path2D(): any { return makeStub('path2d'); },
    OffscreenCanvas: function OffscreenCanvas(): any { return makeStub('offscreenCanvas'); },
    ResizeObserver: function ResizeObserver(): any { return makeStub('resizeObserver'); },
    IntersectionObserver: function IntersectionObserver(): any { return makeStub('intersectionObserver'); },
    XMLHttpRequest: blockedXmlHttpRequest(),
    Blob: function Blob(): any { return makeStub('blob'); },
    URL: { createObjectURL: () => '' },
    crypto: globalThis.crypto,
    Math: math,
    Date: DateImpl,
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;

  const context = vm.createContext(win);
  let loaded = 0;
  for (const script of scripts) {
    const file = path.resolve(options.vendorClientDir, script);
    if (!file.startsWith(path.resolve(options.vendorClientDir) + path.sep) || !fs.existsSync(file)) {
      loadErrors.push({ script, message: 'missing or outside vendor directory' });
      continue;
    }
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: script, timeout: 5_000 });
      loaded += 1;
    } catch (error) {
      loadErrors.push({ script, message: String(error instanceof Error ? error.message : error).slice(0, 180) });
    }
  }

  // The official browser loop normally resolves these asynchronously. In the
  // headless runner images are deliberately absent, so both hooks must settle
  // immediately or SceneWorld can remain transitioning forever.
  if (win.PNTT?.Assets) {
    win.PNTT.Assets.ensureMap = () => Promise.resolve([]);
    win.PNTT.Assets.idle = (callback: unknown) => { if (typeof callback === 'function') callback(); };
  }

  return {
    win,
    context,
    P: win.PNTT as Record<string, any>,
    scripts,
    loaded,
    loadErrors,
    consoleErrors,
    sentPackets,
    rafQueue,
    now: clock,
    fakeClock,
    advanceClock(ms: number) { if (fakeNow !== null) fakeNow += ms; },
    flushRaf() {
      if (rafQueue.length === 0) return 0;
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const callback of batch) {
        try { callback(clock()); } catch { /* rAF is best-effort visual cleanup */ }
      }
      return batch.length;
    },
    run(code: string) { return vm.runInContext(code, context); },
    dispose() {
      for (const id of timerIds) clearTimeout(id);
      for (const id of intervalIds) clearInterval(id);
      timerIds.clear();
      intervalIds.clear();
      rafQueue.splice(0, rafQueue.length);
    },
  };
}
