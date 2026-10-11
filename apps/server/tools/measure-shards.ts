import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SHARD_PROTOCOL_VERSION, type ChildMessage, type ParentMessage } from '../src/shard/protocol.js';

const SHARDS = Math.max(1, Math.min(16, Math.floor(Number(process.env.MEASURE_SHARDS) || 1)));
const PER_SHARD = Math.max(1, Math.min(100, Math.floor(Number(process.env.MEASURE_BOTS_PER_SHARD) || 1)));
const SECONDS = Math.max(1, Math.min(3600, Math.floor(Number(process.env.MEASURE_SECONDS) || 20)));
const source = fileURLToPath(import.meta.url);
const builtShardMain = path.resolve(path.dirname(source), '../dist/shard/shard-main.js');
const shardMain = fs.existsSync(builtShardMain) ? builtShardMain : path.resolve(path.dirname(source), '../src/shard/shard-main.ts');
const children: ChildProcess[] = [];
const lastProc = new Map<number, Extract<ChildMessage, { type: 'proc' }>>();
let rid = 0;
function measureChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'VENDOR_BAKE_ART', 'VENDOR_UI_THROTTLE_MS']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.TUTIEN_ALLOW_SHARD_TEST_HOOK = '1';
  return env;
}

function send(child: ChildProcess, message: ParentMessage): Promise<void> {
  const requestId = `measure-${++rid}`;
  const payload = { ...message, rid: requestId };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('SHARD_RPC_TIMEOUT')); }, 30_000);
    const onMessage = (raw: unknown) => {
      const msg = raw as { type?: string; rid?: string; ok?: boolean; error?: { code?: string } };
      if (msg?.type !== 'reply' || msg.rid !== requestId) return;
      cleanup(); msg.ok ? resolve() : reject(new Error(msg.error?.code || 'SHARD_RUNNER_ERROR'));
    };
    const cleanup = () => { clearTimeout(timeout); child.off('message', onMessage); };
    child.on('message', onMessage); child.send(payload, (error) => { if (error) { cleanup(); reject(error); } });
  });
}
function waitReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('SHARD_READY_TIMEOUT')); }, 15_000);
    const onMessage = (raw: unknown) => { const msg = raw as { v?: number; type?: string }; if (msg?.v === SHARD_PROTOCOL_VERSION && msg.type === 'ready') { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); };
    child.on('message', onMessage);
    child.on('error', (error) => { cleanup(); reject(error); });
  });
}

async function main(): Promise<void> {
  const ready: Promise<void>[] = [];
  for (let i = 0; i < SHARDS; i += 1) {
    const execArgv = path.extname(shardMain) === '.ts' ? ['--import', createRequire(import.meta.url).resolve('tsx')] : [];
    const child = fork(shardMain, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv, env: measureChildEnv() });
    children.push(child);
    child.on('message', (raw) => { const msg = raw as ChildMessage; if (msg?.type === 'proc' && child.pid) lastProc.set(child.pid, msg); });
    ready.push(waitReady(child));
  }
  await Promise.all(ready);
  for (let shard = 0; shard < children.length; shard += 1) {
    for (let index = 0; index < PER_SHARD; index += 1) {
      const accountId = `measure-${shard}-${index}`;
      await send(children[shard], { v: SHARD_PROTOCOL_VERSION, type: 'start', accountId,
        credentials: { refreshToken: 'offline-fixture' }, gameServerUrl: 'wss://fixture.invalid/game', proxyUrl: null,
        options: { accountName: accountId, gameServerUrl: 'wss://fixture.invalid/game',
          allowedGameServerUrl: 'wss://fixture.invalid/game', vendorClientDir: path.resolve(path.dirname(source), '../../../vendor/tutien2d-public-client/2026-10-06'), reconnectMaxRetries: 0, loopIntervalMs: 16 } });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const cpuBaseline = new Map(children.flatMap((child) => child.pid && lastProc.has(child.pid)
    ? [[child.pid, lastProc.get(child.pid)!] as const] : []));
  const measurementStartedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
  const elapsedSeconds = (Date.now() - measurementStartedAt) / 1000;
  const rows = children.map((child, index) => {
    const proc = child.pid ? lastProc.get(child.pid) : undefined;
    const base = child.pid ? cpuBaseline.get(child.pid) : undefined;
    const cpuMs = proc && base ? ((proc.cpuUserMicros - base.cpuUserMicros) + (proc.cpuSystemMicros - base.cpuSystemMicros)) / 1000 : null;
    return { shard: index + 1, pid: child.pid ?? null, runners: proc?.runners ?? PER_SHARD,
      cpuPercentOneCore: cpuMs === null ? null : +(cpuMs / (elapsedSeconds * 1000) * 100).toFixed(1),
      rssMiB: proc ? +(proc.rssBytes / 1048576).toFixed(1) : null };
  });
  const cpuTotal = rows.reduce((sum, row) => sum + (row.cpuPercentOneCore ?? 0), 0);
  const rssTotal = rows.reduce((sum, row) => sum + (row.rssMiB ?? 0), 0);
  console.log(`Offline fake socket · ${SHARDS} shard × ${PER_SHARD} bot · ${elapsedSeconds.toFixed(1)} s`);
  console.table(rows);
  console.log(`Tổng: CPU ${cpuTotal.toFixed(1)}% của một lõi, RSS ${rssTotal.toFixed(1)} MiB.`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'MEASURE_SHARDS_FAILED'); process.exitCode = 1; })
  .finally(async () => { for (const child of children) { if (child.connected) child.send({ v: SHARD_PROTOCOL_VERSION, type: 'shutdown' }); }
    await Promise.all(children.map((child) => new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 8_000); timer.unref?.(); child.once('exit', () => { clearTimeout(timer); resolve(); }); } }))); });
