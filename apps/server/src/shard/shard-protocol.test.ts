import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { RemoteRunnerHandle } from './remote-runner-handle.js';
import { isChildMessage, RUNNER_RPC_METHODS, SHARD_PROTOCOL_VERSION } from './protocol.js';
import type { RemoteRunnerTransport } from './remote-runner-handle.js';
import type { VendorRunnerOptions, VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import { registerRunnerHandleContract } from '../orchestrator/runner-handle.contract.js';
import type { AuthSession } from '@tutien2d/core-client';
import type { RemoteRunnerRecord } from './remote-runner-handle.js';
import { chooseLeastLoadedShard, redactShardStderr, ShardManager } from '../orchestrator/shard-manager.js';

test('IPC protocol accepts only known versioned child packet types', () => {
  assert.equal(isChildMessage({ v: SHARD_PROTOCOL_VERSION, type: 'ready' }), true);
  assert.equal(isChildMessage({ v: SHARD_PROTOCOL_VERSION + 1, type: 'ready' }), false);
  assert.equal(isChildMessage({ v: SHARD_PROTOCOL_VERSION, type: 'execute' }), false);
  assert.ok(RUNNER_RPC_METHODS.includes('stopAuto'));
  assert.equal((RUNNER_RPC_METHODS as readonly string[]).includes('constructor'), false);
});

test('shard placement balances runners, uses the lower id on ties, and respects capacity', () => {
  const allocation = [{ id: 'shard-1', accounts: new Set<string>() }, { id: 'shard-2', accounts: new Set<string>() }];
  for (let index = 0; index < 6; index += 1) chooseLeastLoadedShard(allocation, 0)!.accounts.add(`bot-${index}`);
  assert.deepEqual(allocation.map((entry) => entry.accounts.size), [3, 3]);
  const shards = [
    { id: 'shard-1', accounts: new Set(['a', 'b', 'c']) },
    { id: 'shard-2', accounts: new Set(['d', 'e', 'f']) },
  ];
  expectShard(chooseLeastLoadedShard(shards, 0)?.id, 'shard-1');
  shards[0].accounts.delete('a');
  expectShard(chooseLeastLoadedShard(shards, 0)?.id, 'shard-1');
  const capped = [{ id: 'shard-1', accounts: new Set(['a', 'b']) }, { id: 'shard-2', accounts: new Set(['c', 'd']) }];
  expectShard(chooseLeastLoadedShard(capped, 2), undefined);
});

test('shard stderr redaction removes proxy credentials, bearer tokens, and token assignments', () => {
  const redacted = redactShardStderr('failed http://user:pass@proxy.invalid:8080 Bearer secret-value refresh_token=also-secret');
  assert.doesNotMatch(redacted, /user|pass|secret-value|also-secret/);
  const tail = redactShardStderr(`${'x'.repeat(5_000)}stderr-tail`);
  assert.equal(tail.length, 4_096);
  assert.ok(tail.endsWith('stderr-tail'));
});

test('stale shard detection kills the process and reports every assigned account once', async (t) => {
  const stopped: string[] = [];
  const manager = new ShardManager({ onExit: (accountId) => stopped.push(accountId) },
    { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 100, stopGraceMs: 100, staleKillMs: 30_000 });
  t.after(async () => manager.shutdown(2_000).catch(() => undefined));
  let restartCalls = 0;
  const internals = manager as unknown as { shards: Map<string, any>; onExit(shard: any): void; spawn(): any };
  internals.spawn = () => { restartCalls += 1; return {}; };
  const child: any = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null, connected: true, killed: false,
    kill(signal: NodeJS.Signals) { child.killed = true; child.signalCode = signal; setImmediate(() => child.emit('exit', null, signal)); return true; } });
  const shard: any = { id: 'shard-1', child, ready: Promise.resolve(), resolveReady() {}, rejectReady() {},
    accounts: new Set(['account-a', 'account-b']), expectedExit: false, failureExit: false, ignoredPackets: 0,
    stderr: '', lastSnapshotAt: 1, metrics: null };
  child.on('exit', () => internals.onExit(shard));
  internals.shards.set(shard.id, shard);
  manager.checkStale(30_002);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.killed, true);
  assert.deepEqual(stopped.sort(), ['account-a', 'account-b']);
  assert.equal(restartCalls, 0, 'crashed shards are not restarted automatically');
  assert.equal(manager.health().length, 0);
});

test('timed out start stops only its account when shard peers remain, killing only on stop timeout', async () => {
  const makeShard = (manager: any) => {
    const child: any = new EventEmitter();
    Object.assign(child, { exitCode: null, signalCode: null, connected: true, killed: false,
      kill(signal: NodeJS.Signals) { child.killed = true; child.signalCode = signal; setImmediate(() => child.emit('exit', null, signal)); return true; } });
    const shard: any = { id: 'shard-1', child, accounts: new Set(['bot-a', 'bot-b']), expectedExit: false, failureExit: false,
      rejectReady() {}, stderr: '',
      lastSnapshotAt: Date.now(), ignoredPackets: 0, metrics: null };
    child.on('exit', () => manager.onExit(shard));
    return shard;
  };
  const manager: any = new ShardManager({}, { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 100, stopGraceMs: 100, staleKillMs: 0 });
  const shard = makeShard(manager);
  let stoppedAccount = '';
  manager.send = async (_shard: unknown, message: { type: string; accountId: string }) => { stoppedAccount = message.accountId; };
  await manager.recoverStartTimeout(shard, 'bot-b');
  assert.equal(stoppedAccount, 'bot-b');
  assert.equal(shard.child.killed, false);

  const stopped: string[] = [];
  const failedManager: any = new ShardManager({ onExit: (id: string) => stopped.push(id) },
    { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 100, stopGraceMs: 100, staleKillMs: 0 });
  const failedShard = makeShard(failedManager);
  failedManager.send = async () => { throw new Error('SHARD_STOP_TIMEOUT'); };
  await failedManager.recoverStartTimeout(failedShard, 'bot-b');
  assert.equal(failedShard.child.killed, true);
  assert.deepEqual(stopped.sort(), ['bot-a', 'bot-b']);
});

test('ShardManager.start recovers a timed out bot in place and kills a shard with no peers', async () => {
  const makeManager = (peerAccount?: string) => {
    const manager: any = new ShardManager({}, { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 100, stopGraceMs: 100, staleKillMs: 0 });
    let shardId = 0;
    manager.spawn = () => {
      const child: any = new EventEmitter();
      Object.assign(child, { exitCode: null, signalCode: null, connected: true, killed: false,
        kill(signal: NodeJS.Signals) {
          child.killed = true; child.signalCode = signal; child.exitCode = 1;
          setImmediate(() => child.emit('exit', 1, signal)); return true;
        } });
      const shard: any = { id: `fake-${++shardId}`, child, ready: Promise.resolve(), resolveReady() {}, rejectReady() {},
        accounts: new Set(peerAccount ? [peerAccount] : []), expectedExit: false, failureExit: false,
        ignoredPackets: 0, stderr: '', lastSnapshotAt: Date.now(), metrics: null };
      child.on('exit', () => manager.onExit(shard));
      manager.shards.set(shard.id, shard);
      if (peerAccount) manager.accountShard.set(peerAccount, shard.id);
      return shard;
    };
    manager.stopTargets = [];
    manager.send = async (_shard: unknown, message: { type: string; accountId: string }) => {
      if (message.type === 'start') throw new Error('SHARD_RPC_TIMEOUT');
      if (message.type === 'stop') { manager.stopTargets.push(message.accountId); return; }
      throw new Error(`unexpected ${message.type}`);
    };
    return manager;
  };
  const options = { accountName: 'fixture', credentials: {}, gameServerUrl: 'wss://fixture.invalid', vendorClientDir: '' } as VendorRunnerOptions;

  const shared = makeManager('bot-a');
  await assert.rejects(shared.start('bot-b', options), /SHARD_RPC_TIMEOUT/);
  const sharedShard = [...shared.shards.values()][0];
  assert.ok(sharedShard, 'the peer shard remains alive');
  assert.equal(sharedShard.child.killed, false);
  assert.deepEqual([...sharedShard.accounts], ['bot-a']);
  assert.equal(shared.accountShard.get('bot-a'), sharedShard.id);
  assert.equal(shared.accountShard.has('bot-b'), false);
  assert.deepEqual(shared.stopTargets, ['bot-b']);

  const solo = makeManager();
  await assert.rejects(solo.start('bot-only', options), /SHARD_RPC_TIMEOUT/);
  assert.equal(solo.shards.size, 0, 'a shard with no peer is killed and reaped');
  assert.equal(solo.accountShard.has('bot-only'), false);
});

test('RemoteRunnerHandle marks old pushed state stale and clears unknown values', async () => {
  let now = 10_000;
  const originalNow = Date.now; Date.now = () => now;
  try {
    const transport: RemoteRunnerTransport = { start: async () => undefined, stop: async () => undefined, call: async <T>() => null as T };
    const options = { accountName: 'fixture', credentials: {}, gameServerUrl: 'wss://fixture.invalid', vendorClientDir: '' } as VendorRunnerOptions;
    const handle = new RemoteRunnerHandle('account-fixture', options, transport);
    const snapshot = { ...handle.getSnapshot().value, connection: 'IN_GAME', mapId: 'known', x: 12, y: 34, hp: 50,
      vitals: { hp: 50, maxHp: null, mp: null, maxMp: null, status: 'client', source: 'client', fresh: true, observedAt: now } } as VendorRunnerSnapshot;
    handle.update({ lifecycle: 'in_game', snapshot, metrics: { frames: 10, avgMs: 1, p95Ms: 2, maxMs: 3, busyRatio: 0.2, windowMs: 10 },
      reachableMaps: null, khuProbe: { events: [], mapId: null, khu: null, soKhu: null }, dailySnapshot: { status: null, current: null }, at: now });
    assert.equal(handle.getSnapshot().stale, false);
    now += 1_501;
    const stale = handle.getSnapshot();
    assert.equal(stale.stale, true); assert.equal(stale.value.hp, null); assert.equal(stale.value.mapId, null); assert.equal(stale.value.x, null);
    assert.equal(stale.value.vitals.fresh, false);
  } finally { Date.now = originalNow; }
});

test('RemoteRunnerHandle propagates RPC errors without changing stable code', async () => {
  const transport: RemoteRunnerTransport = { start: async () => undefined, stop: async () => undefined,
    call: async <T>() => { throw new Error('CHARACTER_DOWN'); } };
  const options = { accountName: 'fixture', credentials: {}, gameServerUrl: 'wss://fixture.invalid', vendorClientDir: '' } as VendorRunnerOptions;
  const handle = new RemoteRunnerHandle('account-fixture', options, transport);
  await assert.rejects(handle.startAuto(), /CHARACTER_DOWN/);
});

registerRunnerHandleContract('RemoteRunnerHandle', () => {
  const options = { accountName: 'fixture', credentials: {}, gameServerUrl: 'wss://fixture.invalid', vendorClientDir: '' } as VendorRunnerOptions;
  let handle!: RemoteRunnerHandle; let down = false; let socketClosed = true; let starts = 0;
  const inventoryReference = { known: false, items: [] as Array<{ id: string; name: string; count: number; openable: boolean; type: string | null; grade: string | number | null; slot: string | null; icon: string | null; desc: string | null; group: 'vat-pham' | 'trang-bi' | 'dao-thuat' | null }>, bag: null, equipment: null, totalKinds: null, totalCount: null, caveChest: null, at: 1 };
  let operation: import('../headless/walk-navigator.js').WalkOperation | null = null;
  const update = (lifecycle: VendorRunnerSnapshot['lifecycle'], connection: VendorRunnerSnapshot['connection'] = 'IN_GAME') => {
    const snapshot = { ...blank, lifecycle, connection, downed: down, moveTo: operation } as VendorRunnerSnapshot;
    const record: RemoteRunnerRecord = { lifecycle, snapshot, metrics: { frames: 0, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null },
      reachableMaps: { currentMapId: 'tan_vien', maps: [] }, khuProbe: { events: [], mapId: 'tan_vien', khu: 1, soKhu: 1 }, dailySnapshot: { status: null, current: null }, at: Date.now() };
    handle.update(record);
  };
  const transport: RemoteRunnerTransport = {
    start: async () => { if (socketClosed) { socketClosed = false; starts += 1; update('in_game'); } },
    stop: async () => { socketClosed = true; update('stopped', 'DISCONNECTED'); },
    call: async <T>(_accountId: string, method: string, args: unknown[]): Promise<T> => {
      if (method === 'startAuto' && down) throw new Error('VENDOR_CHARACTER_DOWN');
      if (method === 'walkTo' && down) throw Object.assign(new Error('CHARACTER_DOWN'), { code: 'CHARACTER_DOWN' });
      if (method === 'walkTo') { operation = { operationId: 'walk-remote', target: (args[0] as any).target, resolvedTarget: (args[0] as any).target, status: 'accepted', requester: 'test', startedAt: 1, updatedAt: 1 }; update('in_game'); return operation as T; }
      if (method === 'cancelWalk') { if (args[0] !== operation?.operationId) return false as T; operation = { ...operation!, status: 'cancelled' }; update('in_game'); return true as T; }
      if (method === 'startAuto' || method === 'stopAuto') return { phase: method === 'startAuto' ? 'farming' : 'idle' } as T;
      if (method === 'getKhuInfo') return { mapId: null, khu: null, soKhu: null, list: null } as T;
      if (method === 'requestKhuList') return { mapId: 'tan_vien', khu: 1, dem: [], toiDa: 1, tran: [], observedAt: 0 } as T;
      if (method === 'changeKhu') return { mapId: 'tan_vien', khu: 1, soKhu: null, list: null } as T;
      if (method === 'startDailyCheckin' || method === 'startDailySeed' || method === 'cancelDaily') return { operationId: 'daily', kind: 'checkin', status: 'accepted', step: 'checkin_ack', runIndex: 1, runsTotal: 1, startedAt: 1, updatedAt: 1 } as T;
      if (method === 'questProbe') return { act: args[0], at: 1, result: null } as T;
      if (method === 'khuProbe') return { sent: true, at: 1, x: null, y: null, mapId: null, khu: null } as T;
      if (method === 'getInventory') return inventoryReference as T;
      throw new Error('SHARD_METHOD_NOT_ALLOWED');
    },
  };
  handle = new RemoteRunnerHandle('fixture-account', options, transport);
  const session = { accessToken: 'fixture', refreshToken: 'fixture', expiresAt: 1, ttlMs: 1, email: 'fixture@example.invalid' } as AuthSession;
  return { handle, setDown: (value) => { down = value; update(value ? 'in_game' : 'in_game'); },
    emitDisconnect: () => update('stopped', 'DISCONNECTED'), emitSession: (value) => handle.emitSessionUpdated(value.refreshToken),
    emitLog: (event) => handle.emitLog(event), sessionCount: () => starts, isSocketClosed: () => socketClosed,
    waitReady: async () => undefined, forceStop: () => transport.stop('fixture-account'), pinInventoryReference: () => {} };
});

const blank = { lifecycle: 'stopped', connection: 'DISCONNECTED', autoRequested: false, supervisor: {}, packets: { incoming: {}, outgoing: {}, commands: {}, moves: 0, attacks: 0, skills: 0, cmds: 0 },
  hurtCount: 0, lastHurtAt: null, killsBySelf: 0, packetErrors: 0, updateErrors: 0, consoleErrors: [], frames: 0, fps: 0, uptimeMs: 0, memory: { rssBytes: 0, rssGrowthBytes: 0 }, tokenExpiresAt: null,
  mapId: null, khu: null, x: null, y: null, hp: null, maxHp: null, mp: null, maxMp: null, downed: null, vitalsProbeMoves: 0, soKhu: null, khuList: null, monsters: [], players: [],
  monstersContext: { mapId: null, khu: null, observedAt: null, fresh: false }, playersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
  vitals: { hp: null, maxHp: null, mp: null, maxMp: null, status: 'unknown', source: null, fresh: false, observedAt: null }, moveTo: null, daily: null, dailyStatus: null, logs: [] } as unknown as VendorRunnerSnapshot;

function expectShard(actual: unknown, expected: unknown): void { assert.equal(actual, expected); }

test('a shard killed by the server reports why; an external SIGKILL reports no server reason', async () => {
  const reasons: Array<string | null | undefined> = [];
  const make = (killedByServer: boolean) => {
    const manager = new ShardManager({ onExit: (_accountId, _shardId, details) => reasons.push(details?.killReason) },
      { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 100, stopGraceMs: 100, staleKillMs: 30_000 });
    const internals = manager as unknown as { shards: Map<string, any>; onExit(shard: any): void };
    const child: any = new EventEmitter();
    Object.assign(child, { exitCode: null, signalCode: null, connected: true, killed: false,
      kill(signal: NodeJS.Signals) { child.killed = true; child.signalCode = signal; setImmediate(() => child.emit('exit', null, signal)); return true; } });
    const shard: any = { id: 'shard-1', child, ready: Promise.resolve(), resolveReady() {}, rejectReady() {},
      accounts: new Set(['account-a']), expectedExit: false, failureExit: false, killReason: null, ignoredPackets: 0,
      stderr: '', lastSnapshotAt: 1, metrics: null };
    child.on('exit', () => internals.onExit(shard));
    internals.shards.set(shard.id, shard);
    return { manager, child, killedByServer };
  };
  const server = make(true);
  server.manager.checkStale(30_002);
  await new Promise((resolve) => setImmediate(resolve));
  const external = make(false);
  external.child.signalCode = 'SIGKILL'; external.child.emit('exit', null, 'SIGKILL');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reasons[0], 'no_snapshot_for_30s');
  assert.equal(reasons[1], null);
});
