// Đo hiệu năng VendorRunner OFFLINE (socket giả, không mạng, không đăng nhập, không chạm game thật).
// Dùng để HIỆU CHỈNH tỉ lệ giữa các máy: chạy cùng lệnh trên máy phát triển, TV box, VPS rồi so avgMs/p95Ms.
// Chạy: cd apps/server && pnpm measure        (hoặc: npx tsx tools/measure-runner.ts)
// Biến môi trường: MEASURE_MAP (mặc định thanh_truc_lam), MEASURE_SECONDS (mặc định 20).
// Giới hạn: mẫu KHÔNG có quái và không có lưu lượng gói tin thật => là mức cơ sở "rảnh/Auto không đánh", không phải tải đánh quái thật.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { VendorRunner } from '../src/headless/vendor-runner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MAP = process.env.MEASURE_MAP || 'thanh_truc_lam';
const SECONDS = Math.max(5, Number(process.env.MEASURE_SECONDS) || 20);
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0; onopen?: (e: unknown) => void; onmessage?: (e: { data: string }) => void; onerror?: (e: unknown) => void; onclose?: (e: unknown) => void;
  constructor(public url: string) { queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
  emit(p: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(p) }); }
  send(data: string) {
    const p = JSON.parse(data);
    if (p.op !== 'hello') return;
    queueMicrotask(() => {
      this.emit({ op: 'welcome', serverTime: Date.now(), hasChar: true, snap: 2, ep: 1 });
      setTimeout(() => {
        this.emit({ op: 'state', save: { realm: 'luyen_khi_8', exp: 0, equipment: {} } });
        setTimeout(() => {
          this.emit({ op: 'map', mapId: MAP, khu: 1, soKhu: 1, ep: 1, x: 240, y: 192, dir: 0, p: [] });
          this.emit({ op: 'snap2', full: true, ep: 1, seq: 1, p: [], m: [] });
          this.emit({ op: 'you', seq: 10, x: 240, y: 192, hp: 225, mp: 188, dn: false, fix: true });
        }, 0);
      }, 5);
    });
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000, reason: 'close' }); }
}
const tm = { getAccessToken: async () => 'x', getSession: () => ({ accessToken: 'x', refreshToken: 'x', expiresAt: Date.now() + 6e4, ttlMs: 6e4, email: 'f@example.invalid' }), stop() {}, on() {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const runner = new VendorRunner({ accountName: 'measure', credentials: { refreshToken: 'x' }, gameServerUrl: 'wss://fixture.invalid/g', vendorClientDir: path.join(repoRoot, 'vendor/tutien2d-public-client/2026-10-06'), tokenManager: tm as never, WebSocketImpl: FakeSocket as never, reconnectMaxRetries: 0, loginTimeoutMs: 120000, vitalsConfirmMs: 600000 } as never);
  const t0 = performance.now();
  await runner.start();
  for (let i = 0; i < 6000 && runner.getSnapshot().mapId !== MAP; i += 1) await sleep(10);
  const tMap = performance.now() - t0;
  const warm = runner.getFrameMetrics();
  await runner.startAuto({ mapId: MAP, khu: 1, x: 240, y: 192 });
  await sleep(2000);
  const a = runner.getFrameMetrics().frames; const t1 = performance.now();
  await sleep(SECONDS * 1000);
  const m = runner.getFrameMetrics(); const dt = (performance.now() - t1) / 1000;
  console.log(JSON.stringify({ may: { cpu: os.cpus()[0]?.model, nhan: os.cpus().length, node: process.version, arch: process.arch }, map: MAP, giay_do: SECONDS, thoi_gian_toi_in_game_ms: Math.round(tMap), khung_luc_khoi_dong: warm.frames, auto: runner.getSnapshot().autoRequested, khung_moi_giay: +(((m.frames - a) / dt)).toFixed(1), avgMs: m.avgMs && +m.avgMs.toFixed(2), p95Ms: m.p95Ms && +m.p95Ms.toFixed(2), maxMs: m.maxMs && +m.maxMs.toFixed(1), busyRatio: m.busyRatio && +m.busyRatio.toFixed(3), rssMB: Math.round(process.memoryUsage().rss / 1048576) }, null, 1));
  await runner.stop(); process.exit(0);
})().catch((e) => { console.log('LỖI', String(e?.stack || e).split('\n').slice(0, 5).join(' | ')); process.exit(1); });
