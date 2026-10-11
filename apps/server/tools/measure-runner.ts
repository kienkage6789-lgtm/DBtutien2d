// Đo hiệu năng VendorRunner OFFLINE (socket giả, không mạng, không đăng nhập, không chạm game thật).
// Dùng để HIỆU CHỈNH tỉ lệ giữa các máy: chạy cùng lệnh trên máy phát triển, TV box, VPS rồi so avgMs/p95Ms.
// Chạy: cd apps/server && pnpm measure        (hoặc: npx tsx tools/measure-runner.ts)
// Biến môi trường: MEASURE_LOOP_MS (chu kỳ vòng lặp bot, mặc định 16; thử 33 để so 30 Hz với 60 Hz), MEASURE_MAP (mặc định thanh_truc_lam), MEASURE_SECONDS (mặc định 40, bội của 5).
// Giới hạn: mẫu KHÔNG có quái và không có lưu lượng gói tin thật => là mức cơ sở "rảnh/Auto không đánh", không phải tải đánh quái thật.
import os from 'node:os';
import fs from 'node:fs';
/** Linux: CPU (tick) theo từng luồng của tiến trình, để phân biệt luồng chính với luồng phụ của V8/libuv. */
export function parseThreadStat(content: string): { name: string; ticks: number } | null {
  const open = content.indexOf('('); const close = content.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const rest = content.slice(close + 2).trim().split(/\s+/);
  const utime = Number(rest[11]); const stime = Number(rest[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return { name: content.slice(open + 1, close), ticks: utime + stime };
}
function readThreads(): Map<string, { name: string; ticks: number }> {
  const out = new Map<string, { name: string; ticks: number }>();
  try {
    for (const tid of fs.readdirSync('/proc/self/task')) {
      try { const parsed = parseThreadStat(fs.readFileSync(`/proc/self/task/${tid}/stat`, 'utf8')); if (parsed) out.set(tid, parsed); } catch { /* luồng đã thoát */ }
    }
  } catch { /* không phải Linux */ }
  return out;
}
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { VendorRunner } from '../src/headless/vendor-runner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MAP = process.env.MEASURE_MAP || 'thanh_truc_lam';
const SECONDS = Math.max(5, Number(process.env.MEASURE_SECONDS) || 40);
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
  const runner = new VendorRunner({ accountName: 'measure', credentials: { refreshToken: 'x' }, gameServerUrl: 'wss://fixture.invalid/g', vendorClientDir: path.join(repoRoot, 'vendor/tutien2d-public-client/2026-10-06'), tokenManager: tm as never, WebSocketImpl: FakeSocket as never, reconnectMaxRetries: 0, loginTimeoutMs: 120000, vitalsConfirmMs: 600000, ...(Number(process.env.MEASURE_LOOP_MS) > 0 ? { loopIntervalMs: Number(process.env.MEASURE_LOOP_MS) } : {}) } as never);
  const t0 = performance.now();
  await runner.start();
  for (let i = 0; i < 6000 && runner.getSnapshot().mapId !== MAP; i += 1) await sleep(10);
  const tMap = performance.now() - t0;
  const warm = runner.getFrameMetrics();
  await runner.startAuto({ mapId: MAP, khu: 1, x: 240, y: 192 });
  await sleep(2000);
  // Đo theo từng khoảng 5 s để tách pha khởi động (tạo ảnh map...) khỏi trạng thái ổn định.
  const INTERVAL_S = 5;
  const histogram = monitorEventLoopDelay({ resolution: 20 }); histogram.enable();
  const timeline: Array<Record<string, number | null>> = [];
  let lastFrames = runner.getFrameMetrics().frames; let lastCpu = process.cpuUsage(); let lastAt = performance.now();
  let threadsBefore = readThreads();
  for (let elapsed = INTERVAL_S; elapsed <= SECONDS; elapsed += INTERVAL_S) {
    if (elapsed === SECONDS) threadsBefore = readThreads();
    await sleep(INTERVAL_S * 1000);
    const now = performance.now(); const cpu = process.cpuUsage(lastCpu); const wallMs = now - lastAt;
    const m = runner.getFrameMetrics();
    timeline.push({
      tu_giay: elapsed,
      khung_moi_giay: +(((m.frames - lastFrames) / (wallMs / 1000))).toFixed(1),
      avgMs: m.avgMs === null ? null : +m.avgMs.toFixed(2),
      p95Ms: m.p95Ms === null ? null : +m.p95Ms.toFixed(2),
      cpuTienTrinh_phanTram: +((cpu.user + cpu.system) / 1000 / wallMs * 100).toFixed(0),
      doTreVongLap_p99Ms: +Math.max(0, histogram.percentile(99) / 1e6 - 20).toFixed(1),
    });
    histogram.reset(); lastFrames = m.frames; lastCpu = process.cpuUsage(); lastAt = now;
  }
  histogram.disable();
  const m = runner.getFrameMetrics();
  const last = timeline[timeline.length - 1];
  console.log(JSON.stringify({ may: { cpu: os.cpus()[0]?.model, nhan: os.cpus().length, node: process.version, arch: process.arch }, map: MAP, giay_do: SECONDS, thoi_gian_toi_in_game_ms: Math.round(tMap), khung_luc_khoi_dong: warm.frames, auto: runner.getSnapshot().autoRequested, rssMB: Math.round(process.memoryUsage().rss / 1048576), maxMs_toanBo: m.maxMs && +m.maxMs.toFixed(1) }, null, 1));
  console.log('\nTheo từng 5 s (cpuTienTrinh_phanTram: 100 = một nhân đầy; đáng tin hơn busyRatio vì tính cả việc ngoài frame()):');
  console.table(timeline);
  const threadsAfter = readThreads();
  if (threadsAfter.size > 0) {
    const lastWallS = INTERVAL_S;
    const rows = [...threadsAfter.entries()].map(([tid, now]) => ({ luong: now.name, tid, cpu_phanTram: +(((now.ticks - (threadsBefore.get(tid)?.ticks ?? now.ticks)) / 100) / lastWallS * 100).toFixed(0) }))
      .sort((a, b) => b.cpu_phanTram - a.cpu_phanTram).slice(0, 8);
    console.log('CPU theo luồng trong khoảng cuối (100 = một nhân đầy; luồng chính tên "node"):');
    console.table(rows);
  }
  console.log('Khoảng cuối cùng (gần trạng thái ổn định nhất):', JSON.stringify(last));
  await runner.stop(); process.exit(0);
})().catch((e) => { console.log('LỖI', String(e?.stack || e).split('\n').slice(0, 5).join(' | ')); process.exit(1); });
