import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { CONFIG } from '../config.js';
import type { VendorRunnerOptions } from '../headless/vendor-runner.js';
import type { FrameMetricsSnapshot } from '../headless/frame-metrics.js';
import type { RunnerHandle, RunnerHandleContext, RunnerHandleFactory } from './runner-handle.js';
import { RemoteRunnerHandle, type RemoteRunnerRecord, type RemoteRunnerTransport } from '../shard/remote-runner-handle.js';
import { isChildMessage, RUNNER_RPC_METHODS, SHARD_PROTOCOL_VERSION, type ChildMessage, type ParentMessage, type SerializableRunnerOptions } from '../shard/protocol.js';
import { redactProxyUrl } from '../network/proxy-url.js';

interface ShardProcess {
  id: string; child: ChildProcess; ready: Promise<void>; resolveReady: () => void; rejectReady: (error: Error) => void;
  accounts: Set<string>; expectedExit: boolean; failureExit: boolean; killReason: string | null; ignoredPackets: number; stderr: string; lastSnapshotAt: number; metrics: { rssBytes: number; eventLoop: { p50Ms: number | null; p99Ms: number | null; maxMs: number | null }; runners: number; ignoredPackets: number; at: number } | null;
}
export interface ShardHealth { id: string; pid: number | null; runners: number; rssBytes: number | null; eventLoop: ShardProcess['metrics'] extends infer T ? T extends { eventLoop: infer E } ? E | null : null : null; stale: boolean; ignoredPackets: number }
export function redactShardStderr(value: string): string {
  return value
    .replace(/\b(?:https?|socks5):\/\/[^\s"'<>]+/gi, (url) => redactProxyUrl(url))
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
    .replace(/\b((?:access|refresh)[_-]?token)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/\b([^\s/@:]+):([^\s/@]+)@([^\s/]+)/g, '<redacted>@$3')
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '<redacted-jwt>')
    .replace(/(password|passwd|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(-4096);
}
export function chooseLeastLoadedShard<T extends { id: string; accounts: Set<string> }>(shards: T[], maxRunners: number): T | undefined {
  return shards.filter((shard) => shard.accounts.size < (maxRunners || Number.MAX_SAFE_INTEGER))
    .sort((a, b) => a.accounts.size - b.accounts.size || a.id.localeCompare(b.id, undefined, { numeric: true }))[0];
}
export interface ShardManagerHooks { onExit?: (accountId: string, shardId: string, details?: { exitCode: number | null; signal: NodeJS.Signals | null; stderr: string; killReason: string | null }) => void; onLog?: (accountId: string, event: import('./runner-handle.js').RunnerHandleLog) => void; onSession?: (accountId: string, refreshToken: string) => void }
export interface ShardManagerSettings { vendorShards: number; maxRunners: number; rpcTimeoutMs: number; stopGraceMs: number; staleKillMs?: number; entryPath?: string }
const defaultSettings: ShardManagerSettings = { vendorShards: CONFIG.VENDOR_SHARDS, maxRunners: CONFIG.SHARD_MAX_RUNNERS,
  rpcTimeoutMs: CONFIG.SHARD_RPC_TIMEOUT_MS, stopGraceMs: CONFIG.SHARD_STOP_GRACE_MS, staleKillMs: CONFIG.SHARD_STALE_KILL_MS };

export class ShardManager implements RemoteRunnerTransport {
  private readonly shards = new Map<string, ShardProcess>();
  private readonly accountShard = new Map<string, string>();
  private readonly startingAccounts = new Set<string>();
  private readonly handles = new Map<string, RemoteRunnerHandle>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; accountId: string; method: string; shardId: string }>();
  private nextRid = 0;
  private nextShard = 0;
  private shuttingDown = false;
  private readonly staleMonitor: NodeJS.Timeout | null;
  public constructor(private hooks: ShardManagerHooks = {}, private readonly settings: ShardManagerSettings = defaultSettings) {
    const staleLimit = settings.staleKillMs ?? CONFIG.SHARD_STALE_KILL_MS;
    if (settings.vendorShards > 0 && staleLimit > 0) {
      this.staleMonitor = setInterval(() => this.checkStale(), Math.min(1_000, Math.max(100, staleLimit)));
      this.staleMonitor.unref?.();
    } else this.staleMonitor = null;
  }
  public setHooks(hooks: ShardManagerHooks): void { this.hooks = hooks; }

  public factory: RunnerHandleFactory = (options, context) => {
    if (!context) throw new Error('SHARD_ACCOUNT_CONTEXT_REQUIRED');
    const handle = new RemoteRunnerHandle(context.accountId, options, this, context.proxyUrl);
    this.handles.set(context.accountId, handle);
    return handle;
  };

  private shardEntryPath(): string {
    const current = fileURLToPath(import.meta.url);
    const ext = path.extname(current);
    const base = path.resolve(path.dirname(current), '../shard/shard-main');
    if (ext === '.ts') return `${base}.ts`;
    return `${base}.js`;
  }
  private shardEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'VENDOR_BAKE_ART', 'VENDOR_UI_THROTTLE_MS']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    if (process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK === '1') {
      env.TUTIEN_ALLOW_SHARD_TEST_HOOK = '1';
      if (process.env.NODE_OPTIONS) env.NODE_OPTIONS = process.env.NODE_OPTIONS;
      if (process.env.TUTIEN_TEST_STOP_HANG === '1') env.TUTIEN_TEST_STOP_HANG = '1';
      if (process.env.TUTIEN_TEST_RPC_HANG === '1') env.TUTIEN_TEST_RPC_HANG = '1';
      if (process.env.TUTIEN_TEST_KEEPALIVE === '1') env.TUTIEN_TEST_KEEPALIVE = '1';
    }
    return env;
  }
  private spawn(): ShardProcess {
    const id = `shard-${++this.nextShard}`;
    let resolveReady!: () => void; let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const sourcePath = this.settings.entryPath ?? this.shardEntryPath();
    const tsx = path.extname(sourcePath) === '.ts' ? pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href : undefined;
    const execArgv = tsx ? ['--import', tsx] : [];
    const child = fork(sourcePath, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv, env: this.shardEnvironment() });
    const shard: ShardProcess = { id, child, ready, resolveReady, rejectReady, accounts: new Set(), expectedExit: false, failureExit: false, killReason: null, ignoredPackets: 0, stderr: '', lastSnapshotAt: Date.now(), metrics: null };
    this.shards.set(id, shard);
    child.on('message', (raw) => this.onMessage(shard, raw));
    child.on('error', () => { /* exit event performs ownership cleanup */ });
    child.on('exit', () => this.onExit(shard));
    child.stderr?.on('data', (chunk: Buffer) => { shard.stderr = redactShardStderr(shard.stderr + chunk.toString('utf8')).slice(-4096); });
    return shard;
  }
  private async chooseShard(): Promise<ShardProcess> {
    if (this.shuttingDown) throw new Error('SHARD_SHUTTING_DOWN');
    const retiring = [...this.shards.values()].filter((shard) => shard.expectedExit || shard.child.killed || !shard.child.connected);
    if (retiring.length > 0) {
      await Promise.all(retiring.map((shard) => this.waitExit(shard.child)));
      return this.chooseShard();
    }
    if (this.shards.size < this.settings.vendorShards) return this.spawn();
    const available = chooseLeastLoadedShard([...this.shards.values()], this.settings.maxRunners);
    if (available) return available;
    throw new Error('SHARD_CAPACITY');
  }
  public async start(accountId: string, options: VendorRunnerOptions, proxyUrl?: string | null): Promise<void> {
    if (this.accountShard.has(accountId) || this.startingAccounts.has(accountId)) throw new Error('ACCOUNT_ALREADY_ASSIGNED');
    this.startingAccounts.add(accountId);
    let shard: ShardProcess;
    try {
      shard = await this.chooseShard();
      shard.accounts.add(accountId); this.accountShard.set(accountId, shard.id);
      await Promise.race([shard.ready, this.timeout(this.settings.rpcTimeoutMs, 'SHARD_READY_TIMEOUT')]);
      const { credentials, accountName, gameServerUrl, allowedGameServerUrl, vendorClientDir, loopIntervalMs, supabaseUrl, supabaseAnonKey,
        transport: _transport, tokenManager: _tokenManager, WebSocketImpl: _webSocketImpl, envFactory: _envFactory, onSnapshotChanged: _onSnapshotChanged,
        onLog: _onLog, onSessionUpdated: _onSessionUpdated, ...rest } = options;
      const serializable = { accountName, gameServerUrl, allowedGameServerUrl, vendorClientDir, loopIntervalMs, supabaseUrl, supabaseAnonKey, ...rest } as SerializableRunnerOptions;
      const startTimeout = Math.max(this.settings.rpcTimeoutMs, (options.loginTimeoutMs ?? 10_000) + 20_000);
      await this.send(shard, { v: SHARD_PROTOCOL_VERSION, type: 'start', accountId, credentials, gameServerUrl, proxyUrl: proxyUrl ?? null, options: serializable }, startTimeout);
    } catch (error) {
      const assigned = this.findShard(accountId);
      const code = error instanceof Error ? error.message : '';
      if (assigned && assigned.child.exitCode === null && code === 'SHARD_RPC_TIMEOUT') {
        await this.recoverStartTimeout(assigned, accountId);
      } else if (assigned && assigned.child.exitCode === null && ['SHARD_DISCONNECTED', 'SHARD_EXITED', 'SHARD_READY_TIMEOUT'].includes(code)) {
        assigned.failureExit = true;
        const exited = this.waitExit(assigned.child); this.killShard(assigned, 'start_failed'); await exited;
      }
      assigned?.accounts.delete(accountId); this.accountShard.delete(accountId); this.handles.delete(accountId);
      throw error;
    } finally { this.startingAccounts.delete(accountId); }
  }
  public async stop(accountId: string): Promise<void> {
    const shard = this.findShard(accountId);
    if (!shard) return;
    try { await this.send(shard, { v: SHARD_PROTOCOL_VERSION, type: 'stop', accountId }, this.settings.stopGraceMs); }
    catch (error) {
      shard.expectedExit = true;
      shard.failureExit = true;
      const exited = this.waitExit(shard.child); this.killShard(shard, 'stop_timeout'); await exited;
      throw error;
    }
    shard.accounts.delete(accountId); this.accountShard.delete(accountId); this.handles.delete(accountId);
  }
  private async recoverStartTimeout(shard: ShardProcess, accountId: string): Promise<void> {
    if (shard.child.exitCode !== null) return;
    if (shard.accounts.size > 1) {
      try {
        await this.send(shard, { v: SHARD_PROTOCOL_VERSION, type: 'stop', accountId }, this.settings.stopGraceMs);
        return;
      } catch { /* a non-responsive shard must be killed to guarantee cleanup */ }
    }
    shard.failureExit = true;
    const exited = this.waitExit(shard.child);
    this.killShard(shard, 'start_timeout');
    await exited;
  }
  public async call<T>(accountId: string, method: string, args: unknown[]): Promise<T> {
    if (!(RUNNER_RPC_METHODS as readonly string[]).includes(method)) throw new Error('SHARD_METHOD_NOT_ALLOWED');
    const shard = this.findShard(accountId); if (!shard) throw new Error('VENDOR_NOT_RUNNING');
    return this.send(shard, { v: SHARD_PROTOCOL_VERSION, type: 'call', rid: `rpc-${++this.nextRid}`, accountId, method, args }) as Promise<T>;
  }
  private findShard(accountId: string): ShardProcess | undefined { const id = this.accountShard.get(accountId); return id ? this.shards.get(id) : undefined; }
  private timeout(ms: number, code: string): Promise<never> { return new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(code)), ms); timer.unref?.(); }); }
  private killShard(shard: ShardProcess, reason: string): void {
    shard.killReason ??= reason;
    shard.child.kill('SIGKILL');
  }
  private waitExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => child.once('exit', () => resolve()));
  }
  private send(shard: ShardProcess, message: ParentMessage, timeoutMs = this.settings.rpcTimeoutMs): Promise<unknown> {
    const rid = message.type === 'call' ? message.rid : `rpc-${++this.nextRid}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(rid); reject(new Error(message.type === 'stop' ? 'SHARD_STOP_TIMEOUT' : 'SHARD_RPC_TIMEOUT')); }, timeoutMs);
      timer.unref?.(); this.pending.set(rid, { resolve, reject, timer, accountId: message.type === 'call' ? message.accountId : message.type === 'start' || message.type === 'stop' ? message.accountId : '', method: message.type, shardId: shard.id });
      const payload = message.type === 'call' ? message : { ...message, rid };
      if (!shard.child.connected) { clearTimeout(timer); this.pending.delete(rid); reject(new Error('SHARD_DISCONNECTED')); return; }
      shard.child.send(payload, (error) => { if (error) { clearTimeout(timer); this.pending.delete(rid); reject(new Error('SHARD_DISCONNECTED')); } });
    });
  }
  private onMessage(shard: ShardProcess, raw: unknown): void {
    if (!isChildMessage(raw)) { shard.ignoredPackets += 1; return; }
    const message = raw as ChildMessage;
    if (message.type === 'ready') { shard.resolveReady(); return; }
    if (message.type === 'reply') {
      const pending = this.pending.get(message.rid); if (!pending) { shard.ignoredPackets += 1; return; }
      clearTimeout(pending.timer); this.pending.delete(message.rid);
      if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error.code));
      return;
    }
    if (message.type === 'snapshot') { shard.lastSnapshotAt = Date.now(); this.handles.get(message.accountId)?.update({ lifecycle: message.snapshot.lifecycle, snapshot: message.snapshot, metrics: message.metrics,
      reachableMaps: message.reachableMaps, khuProbe: message.khuProbe, dailySnapshot: message.dailySnapshot, at: message.at });
    }
    else if (message.type === 'log') { this.handles.get(message.accountId)?.emitLog(message.event); this.hooks.onLog?.(message.accountId, message.event); }
    else if (message.type === 'session') { this.handles.get(message.accountId)?.emitSessionUpdated(message.refreshToken); this.hooks.onSession?.(message.accountId, message.refreshToken); }
    else if (message.type === 'proc') shard.metrics = { rssBytes: message.rssBytes, eventLoop: message.eventLoop, runners: message.runners, ignoredPackets: message.ignoredPackets, at: Date.now() };
  }
  private onExit(shard: ShardProcess): void {
    this.shards.delete(shard.id); shard.rejectReady(new Error('SHARD_EXITED'));
    for (const [rid, pending] of this.pending) { if (pending.shardId === shard.id) { clearTimeout(pending.timer); pending.reject(new Error('SHARD_EXITED')); this.pending.delete(rid); } }
    for (const accountId of shard.accounts) {
      this.accountShard.delete(accountId); this.handles.delete(accountId);
      if (!shard.expectedExit || shard.failureExit) this.hooks.onExit?.(accountId, shard.id, { exitCode: shard.child.exitCode, signal: shard.child.signalCode,
        stderr: shard.expectedExit ? '' : redactShardStderr(shard.stderr), killReason: shard.killReason });
    }
    shard.accounts.clear();
  }
  public health(): ShardHealth[] {
    return [...this.shards.values()].map((shard) => ({ id: shard.id, pid: shard.child.pid ?? null, runners: shard.accounts.size,
      rssBytes: shard.metrics?.rssBytes ?? null, eventLoop: shard.metrics?.eventLoop ?? null,
      stale: !shard.metrics || Date.now() - shard.metrics.at > 3_000, ignoredPackets: Math.max(shard.ignoredPackets, shard.metrics?.ignoredPackets ?? 0) }));
  }
  public checkStale(now = Date.now()): void {
    const limit = this.settings.staleKillMs ?? CONFIG.SHARD_STALE_KILL_MS;
    if (!limit) return;
    for (const shard of this.shards.values()) if (shard.accounts.size && now - shard.lastSnapshotAt > limit) {
      shard.failureExit = true; const exited = this.waitExit(shard.child); this.killShard(shard, 'no_snapshot_for_' + Math.round(limit / 1000) + 's'); void exited;
    }
  }
  public async shutdown(timeoutMs = 20_000): Promise<void> {
    this.shuttingDown = true;
    if (this.staleMonitor) clearInterval(this.staleMonitor);
    const deadline = Date.now() + timeoutMs;
    const shards = [...this.shards.values()];
    for (const shard of shards) {
      shard.expectedExit = true;
      try {
        await Promise.all([...shard.accounts].map((accountId) => this.send(shard,
          { v: SHARD_PROTOCOL_VERSION, type: 'stop', accountId }, Math.max(100, Math.min(this.settings.stopGraceMs, deadline - Date.now())))));
      } catch { shard.failureExit = true; this.killShard(shard, 'shutdown_stop_failed'); }
      if (shard.child.connected) shard.child.send({ v: SHARD_PROTOCOL_VERSION, type: 'shutdown' } satisfies ParentMessage);
    }
    await Promise.all(shards.map(async (shard) => Promise.race([this.waitExit(shard.child), new Promise<void>((resolve) => {
      const timer = setTimeout(() => { shard.failureExit = true; this.killShard(shard, 'shutdown_timeout'); resolve(); }, Math.max(1, deadline - Date.now())); timer.unref?.();
    })])));
  }
}

export const shardManager = new ShardManager();
