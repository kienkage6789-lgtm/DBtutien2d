import { VendorRunner, type VendorRunnerOptions } from '../headless/vendor-runner.js';
import { createProxyTransport } from '../network/proxy-transport.js';
import { ProcessMetrics } from '../orchestrator/process-metrics.js';
import { isChildMessage, RUNNER_RPC_METHODS, SHARD_PROTOCOL_VERSION, SNAPSHOT_INTERVAL_MS, type ChildMessage, type ParentMessage } from './protocol.js';
import { ShardTestWebSocket, shardTestTokenManager } from './test-hook.js';

const runners = new Map<string, VendorRunner>();
const transports = new Map<string, { close(): Promise<void> }>();
const metrics = new ProcessMetrics(); metrics.start();
const cpuStarted = process.cpuUsage();
let ignoredPackets = 0;
let shuttingDown = false;
const testKeepAlive = process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK === '1' && process.env.TUTIEN_TEST_KEEPALIVE === '1'
  ? setInterval(() => undefined, 1_000) : null;
const send = (message: ChildMessage) => { if (process.connected) process.send?.(message); };
function pushSnapshot(accountId: string): void {
  const runner = runners.get(accountId); if (!runner) return;
  try {
    let reachableMaps = null; let dailySnapshot = { status: null, current: null } as { status: import('../headless/daily-quests.js').DailyStatus | null; current: import('../headless/daily-quests.js').DailyOperation | null };
    try { reachableMaps = runner.getReachableMaps(); } catch { /* not available until map data is ready */ }
    try { dailySnapshot = runner.getDailySnapshot(false); } catch { /* not in game yet */ }
    send({ v: SHARD_PROTOCOL_VERSION, type: 'snapshot', accountId, snapshot: runner.getSnapshot(), metrics: runner.getFrameMetrics(), reachableMaps,
      khuProbe: runner.getKhuProbe(), dailySnapshot, at: Date.now() });
  }
  catch { /* a stopping runner may no longer expose a snapshot */ }
}
async function stopRunner(accountId: string): Promise<void> {
  const runner = runners.get(accountId); if (!runner) return;
  try { await runner.stop(); } finally {
    pushSnapshot(accountId);
    runners.delete(accountId);
    const transport = transports.get(accountId); transports.delete(accountId);
    try { await transport?.close(); } catch { /* cleanup is best effort */ }
  }
}
async function shutdown(): Promise<void> {
  if (shuttingDown) return; shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 5_000); deadline.unref?.();
  await Promise.allSettled([...runners.keys()].map((id) => stopRunner(id)));
  clearTimeout(deadline); metrics.stop();
  if (testKeepAlive) clearInterval(testKeepAlive);
  if (process.connected) process.disconnect();
  process.exit(0);
}
function errorData(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : 'SHARD_RUNNER_ERROR';
  const code = /^[A-Z][A-Z0-9_]{2,79}$/.test(message.split(':', 1)[0]) ? message.split(':', 1)[0] : 'SHARD_RUNNER_ERROR';
  return { code, message: code };
}

async function handle(message: ParentMessage & { rid?: string }): Promise<void> {
  const rid = message.rid;
  try {
    if (message.type === 'start') {
      if (runners.has(message.accountId)) throw new Error('ACCOUNT_ALREADY_RUNNING');
      const transport = message.proxyUrl ? createProxyTransport(message.proxyUrl) : undefined;
      const runnerOptions = { ...message.options, credentials: message.credentials, gameServerUrl: message.gameServerUrl,
        ...(transport ? { transport: transport as unknown as NonNullable<VendorRunnerOptions['transport']> } : {}),
        ...(process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK === '1' ? { WebSocketImpl: ShardTestWebSocket, tokenManager: shardTestTokenManager } : {}),
        onLog: (event: Parameters<NonNullable<VendorRunnerOptions['onLog']>>[0]) => { send({ v: SHARD_PROTOCOL_VERSION, type: 'log', accountId: message.accountId, event }); pushSnapshot(message.accountId); },
        onSnapshotChanged: () => pushSnapshot(message.accountId),
        onSessionUpdated: (session: Parameters<NonNullable<VendorRunnerOptions['onSessionUpdated']>>[0]) => send({ v: SHARD_PROTOCOL_VERSION, type: 'session', accountId: message.accountId, refreshToken: session.refreshToken }),
      } satisfies VendorRunnerOptions;
      const runner = new VendorRunner(runnerOptions); runners.set(message.accountId, runner);
      if (transport) transports.set(message.accountId, transport);
      try { await runner.start(); pushSnapshot(message.accountId); }
      catch (error) { runners.delete(message.accountId); transports.delete(message.accountId); await transport?.close(); throw error; }
    } else if (message.type === 'stop') {
      if (process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK === '1' && process.env.TUTIEN_TEST_STOP_HANG === '1') await new Promise<void>(() => undefined);
      await stopRunner(message.accountId);
    }
    else if (message.type === 'call') {
      if (!RUNNER_RPC_METHODS.includes(message.method as typeof RUNNER_RPC_METHODS[number])) { ignoredPackets += 1; return; }
      const runner = runners.get(message.accountId); if (!runner) throw new Error('VENDOR_NOT_RUNNING');
      const method = (runner as unknown as Record<string, (...args: unknown[]) => unknown>)[message.method];
      if (typeof method !== 'function') throw new Error('SHARD_METHOD_NOT_ALLOWED');
      if (process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK === '1' && process.env.TUTIEN_TEST_RPC_HANG === '1' && message.method === 'questProbe') await new Promise<void>(() => undefined);
      const result = await method.apply(runner, message.args); pushSnapshot(message.accountId);
      send({ v: SHARD_PROTOCOL_VERSION, type: 'reply', rid: rid!, ok: true, result }); return;
    } else if (message.type === 'shutdown') { await shutdown(); return; }
    if (rid) send({ v: SHARD_PROTOCOL_VERSION, type: 'reply', rid, ok: true });
  } catch (error) {
    if (rid) send({ v: SHARD_PROTOCOL_VERSION, type: 'reply', rid, ok: false, error: errorData(error) });
  }
}

process.on('message', (raw) => {
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== SHARD_PROTOCOL_VERSION || !isParentMessage(raw)) { ignoredPackets += 1; return; }
  void handle(raw);
});
function isParentMessage(value: unknown): value is ParentMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.v !== SHARD_PROTOCOL_VERSION) return false;
  if (message.type === 'shutdown') return true;
  if (message.type === 'stop') return typeof message.accountId === 'string' && typeof message.rid === 'string';
  if (message.type === 'call') return typeof message.accountId === 'string' && typeof message.rid === 'string'
    && typeof message.method === 'string' && Array.isArray(message.args);
  if (message.type === 'start') return typeof message.accountId === 'string' && typeof message.gameServerUrl === 'string'
    && (message.proxyUrl === null || typeof message.proxyUrl === 'string') && !!message.options && typeof message.options === 'object'
    && !!message.credentials && typeof message.credentials === 'object' && typeof message.rid === 'string';
  return false;
}
process.on('disconnect', () => { void shutdown(); });
process.on('uncaughtException', () => { send({ v: SHARD_PROTOCOL_VERSION, type: 'fatal', code: 'SHARD_UNCAUGHT_EXCEPTION' }); void shutdown().finally(() => process.exit(1)); });
process.on('unhandledRejection', () => { send({ v: SHARD_PROTOCOL_VERSION, type: 'fatal', code: 'SHARD_UNHANDLED_REJECTION' }); void shutdown().finally(() => process.exit(1)); });
const snapshotTimer = setInterval(() => { for (const accountId of runners.keys()) pushSnapshot(accountId); }, SNAPSHOT_INTERVAL_MS); snapshotTimer.unref?.();
const metricsTimer = setInterval(() => { const snapshot = metrics.snapshot(runners.size); const cpu = process.cpuUsage(cpuStarted); send({ v: SHARD_PROTOCOL_VERSION, type: 'proc', rssBytes: snapshot.rssBytes, eventLoop: snapshot.eventLoopDelay, runners: runners.size, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, ignoredPackets }); }, 1000); metricsTimer.unref?.();
send({ v: SHARD_PROTOCOL_VERSION, type: 'ready' });
void ignoredPackets;
