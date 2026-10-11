import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeTest from 'node:test';
import { AuthError, type AuthSession } from '@tutien2d/core-client';
import { VendorRunner, type VendorTokenManagerLike } from './vendor-runner.js';
import type { VendorSocketLike } from './vendor-env.js';
import { InProcessRunnerHandle } from '../orchestrator/runner-handle.js';
import { registerRunnerHandleContract } from '../orchestrator/runner-handle.contract.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const vendorClientDir = path.join(repoRoot, 'vendor/tutien2d-public-client/2026-10-06');
const test = (name: string, fn: () => void | Promise<void>) => nodeTest(name, { timeout: 20_000 }, fn);

class ManualReconnectClock {
  public nowMs = 0;
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  public now(): number { return this.nowMs; }
  public setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  public clearTimeout(timer: ReturnType<typeof setTimeout>): void { this.timers.delete(timer as unknown as number); }
  public nextDelay(): number | null {
    const due = [...this.timers.values()].map((timer) => timer.at).sort((a, b) => a - b)[0];
    return due === undefined ? null : due - this.nowMs;
  }
  public advance(ms: number): void {
    this.nowMs += ms;
    while (true) {
      const next = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.nowMs).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      next[1].callback();
    }
  }
}

const fixtureSession: AuthSession = {
  accessToken: 'fixture-access-token',
  refreshToken: 'fixture-refresh-token',
  expiresAt: Date.now() + 60_000,
  ttlMs: 60_000,
  email: 'fixture@example.invalid',
};

class FakeTokenManager implements VendorTokenManagerLike {
  private readonly listeners = new Set<(session: AuthSession) => void>();
  public getAccessToken(): Promise<string> { return Promise.resolve(fixtureSession.accessToken); }
  public getSession(): AuthSession { return fixtureSession; }
  public stop(): void {}
  public on(_event: 'sessionUpdated', listener: (session: AuthSession) => void): void { this.listeners.add(listener); }
  public emitSessionUpdated(): void { for (const listener of this.listeners) listener({ ...fixtureSession, refreshToken: 'fixture-refreshed-token' }); }
}

class FakeSocket implements VendorSocketLike {
  public static instances: FakeSocket[] = [];
  public static emitYouAfterMoveCount: number | null = null;
  public static emitHurtAfterMoveCount: number | null = null;
  public static mapId = 'tan_vien';
  public static mapKhu: number | undefined = 1;
  public static soKhu = 1;
  public static mapEp = 1;
  public static khuLastChangeAt = 0;
  public static khuNoResponse = false;
  public static mapDelayMs = 0;
  public static respondToEnter = false;
  public static enterDelayMs = 25;
  public static enterSpawns: Record<string, { x: number; y: number }> = {};
  public static dailyAckResponses = false;
  /** Điểm xuất hiện trong gói `map`; mặc định cũ nằm trong ô bị chặn của tan_vien nên không đi bộ được. */
  public static spawn = { x: 240, y: 192 };
  public static moves: Array<{ seq: number; st?: string; x?: number; y?: number }> = [];
  public static outgoing: Array<{ op?: string; act?: string; khu?: number; mapId?: string; cmd?: string; rid?: number }> = [];
  /** false: giả lập server thật, gói `you` chỉ đến sau khi nhân vật di chuyển (không có ngay lúc vào game). */
  public static emitYou = true;
  public static downed = false;
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public readyState = FakeSocket.CONNECTING;
  public onopen?: (event: unknown) => void;
  public onmessage?: (event: { data: string }) => void;
  public onerror?: (event: unknown) => void;
  public onclose?: (event: { code?: number; reason?: string }) => void;

  public constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== FakeSocket.CONNECTING) return;
      this.readyState = FakeSocket.OPEN;
      this.onopen?.({});
    });
  }

  public send(data: string): void {
    const packet = JSON.parse(data) as { op?: string; act?: string; khu?: number; mapId?: string; cmd?: string; rid?: number; seq?: number; st?: string; x?: number; y?: number };
    FakeSocket.outgoing.push({ op: packet.op, act: packet.act, khu: packet.khu, mapId: packet.mapId, cmd: packet.cmd, rid: packet.rid });
    if (packet.op === 'move' && typeof packet.seq === 'number') {
      FakeSocket.moves.push({ seq: packet.seq, st: packet.st, x: packet.x, y: packet.y });
      const moveCount = FakeSocket.moves.length;
      if (FakeSocket.emitHurtAfterMoveCount !== null && moveCount >= FakeSocket.emitHurtAfterMoveCount) {
        FakeSocket.emitHurtAfterMoveCount = null;
        queueMicrotask(() => this.emit({ op: 'hurt', hp: 90, mp: 40 }));
      }
      if (FakeSocket.emitYouAfterMoveCount !== null && moveCount >= FakeSocket.emitYouAfterMoveCount && packet.seq % 10 === 0) {
        FakeSocket.emitYouAfterMoveCount = null;
        queueMicrotask(() => this.emit({ op: 'you', seq: packet.seq, x: packet.x, y: packet.y, hp: 100, mp: 50, dn: false, fix: true }));
      }
    }
    if (packet.op === 'enter' && FakeSocket.respondToEnter && typeof packet.mapId === 'string') {
      const targetMapId = packet.mapId;
      FakeSocket.mapId = targetMapId;
      const spawn = FakeSocket.enterSpawns[targetMapId] ?? FakeSocket.spawn;
      setTimeout(() => {
        this.emit({ op: 'map', mapId: targetMapId, khu: 1, soKhu: FakeSocket.soKhu, ep: FakeSocket.mapEp, x: spawn.x, y: spawn.y, dir: 0, p: [] });
        this.emit({ op: 'snap2', full: true, ep: 1, seq: 1, p: [], m: [] });
      }, FakeSocket.enterDelayMs);
    }
    if (packet.op === 'khu' && packet.act === 'xem') {
      if (!FakeSocket.khuNoResponse) queueMicrotask(() => this.emitKhu());
    }
    if (packet.op === 'khu' && packet.act === 'chon' && Number.isInteger(packet.khu)) {
      if (FakeSocket.khuNoResponse) return;
      const target = Number(packet.khu);
      const now = Date.now();
      if (FakeSocket.mapKhu === target) {
        queueMicrotask(() => this.emit({ op: 'toast', text: 'Đang ở khu này rồi.' }));
        queueMicrotask(() => this.emitKhu());
      } else if (now - FakeSocket.khuLastChangeAt < 5_000) {
        const retryAfter = Math.max(1, Math.ceil((5_000 - (now - FakeSocket.khuLastChangeAt)) / 1_000));
        queueMicrotask(() => this.emit({ op: 'toast', text: `Vừa đổi khu, chờ ${retryAfter} giây nữa.` }));
        queueMicrotask(() => this.emitKhu());
      } else if (target >= 1 && target <= FakeSocket.soKhu) {
        FakeSocket.khuLastChangeAt = now;
        FakeSocket.mapKhu = target;
        FakeSocket.mapEp += 1;
        queueMicrotask(() => this.emit({ op: 'map', mapId: FakeSocket.mapId, khu: target, soKhu: FakeSocket.soKhu, ep: FakeSocket.mapEp, x: FakeSocket.spawn.x, y: FakeSocket.spawn.y, dir: 0, p: [] }));
        queueMicrotask(() => this.emit({ op: 'status' }));
        queueMicrotask(() => this.emit({ op: 'bosses' }));
        queueMicrotask(() => this.emit({ op: 'formation' }));
        queueMicrotask(() => this.emit({ op: 'toast', text: `Đã sang khu ${target}.`, kind: 'success' }));
        queueMicrotask(() => this.emitKhu());
      }
    }
    if (packet.op === 'cmd' && FakeSocket.dailyAckResponses && typeof packet.cmd === 'string') {
      const command = packet.cmd;
      queueMicrotask(() => this.emit({ op: 'ack', cmd: 'seed.start', rid: packet.rid, ok: true }));
      queueMicrotask(() => this.emit({ op: 'ack', cmd: command, rid: packet.rid, ok: true, toast: 'fixture daily ack' }));
      queueMicrotask(() => this.emit({ op: 'state', reason: command }));
    }
    if (packet.op !== 'hello') return;
    queueMicrotask(() => {
      this.emit({ op: 'welcome', serverTime: Date.now(), hasChar: true, snap: 2, ep: 1 });
      setTimeout(() => {
        this.emit({ op: 'state', save: { realm: 'luyen_khi_8', exp: 0, equipment: {} } });
        setTimeout(() => {
          this.emit({ op: 'map', mapId: FakeSocket.mapId, ...(FakeSocket.mapKhu === undefined ? {} : { khu: FakeSocket.mapKhu }), soKhu: FakeSocket.soKhu, ep: FakeSocket.mapEp, x: FakeSocket.spawn.x, y: FakeSocket.spawn.y, dir: 0, p: [] });
          this.emit({ op: 'snap2', full: true, ep: 1, seq: 1, p: [], m: [] });
          if (FakeSocket.emitYou) this.emit({ op: 'you', seq: 10, x: 240, y: 192, hp: 100, mp: 50, dn: FakeSocket.downed, fix: true });
        }, FakeSocket.mapDelayMs);
      }, 5);
    });
  }

  public close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'fixture_close' });
  }

  public serverClose(): void { this.close(); }

  private emitKhu(): void {
    const count = Array.from({ length: FakeSocket.soKhu }, (_, index) => index === 0 ? 20 : 3);
    const capacity = Array.from({ length: FakeSocket.soKhu }, () => 20);
    this.emit({ op: 'khu', mapId: FakeSocket.mapId, khu: FakeSocket.mapKhu, dem: count, toiDa: 20, tran: capacity });
  }

  private emit(packet: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(packet) });
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !condition()) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(condition(), 'fixture condition was not observed before timeout');
}

function resetKhuFixture(): void {
  FakeSocket.soKhu = 1;
  FakeSocket.mapKhu = 1;
  FakeSocket.khuLastChangeAt = 0;
  FakeSocket.mapEp = 1;
  FakeSocket.khuNoResponse = false;
  FakeSocket.mapId = 'tan_vien';
  FakeSocket.spawn = { x: 240, y: 192 };
  FakeSocket.outgoing = [];
  FakeSocket.moves = [];
  FakeSocket.dailyAckResponses = false;
  FakeSocket.downed = false;
}

function createKhuRunner(options: Partial<ConstructorParameters<typeof VendorRunner>[0]> = {}): VendorRunner {
  return new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
    ...options,
  });
}

function createKhuHandle(tokenManager = new FakeTokenManager()): InProcessRunnerHandle {
  resetKhuFixture();
  return new InProcessRunnerHandle({
    accountName: 'fixture-account', credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game', vendorClientDir, tokenManager,
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0, loginTimeoutMs: 500, loopIntervalMs: 5,
  });
}

registerRunnerHandleContract('InProcessRunnerHandle', () => {
  FakeSocket.instances = [];
  const tokenManager = new FakeTokenManager();
  const handle = createKhuHandle(tokenManager);
  FakeSocket.soKhu = 20;
  return {
    handle,
    setDown: (value) => { (handle.runner as any).P.SceneWorld.player.downed = value; },
    emitDisconnect: () => FakeSocket.instances[0]?.serverClose(),
    emitSession: () => tokenManager.emitSessionUpdated(),
    emitLog: (event) => (handle.runner as any).recordLog(event.code, { at: event.at }),
    sessionCount: () => FakeSocket.instances.length,
    isSocketClosed: () => FakeSocket.instances.every((socket) => socket.readyState === FakeSocket.CLOSED),
    waitReady: async () => { await waitForMapReady(handle.runner); },
    pinSnapshotReference: () => {
      const snapshot = handle.runner.getSnapshot();
      (handle.runner as any).getSnapshot = () => snapshot;
    },
    forceStop: () => handle.runner.stop(),
  };
});

async function waitForMapReady(runner: VendorRunner): Promise<void> {
  for (let turn = 0; turn < 2_000; turn += 1) {
    if ((runner as any).isMapReady()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('fixture map readiness was not observed');
}

test('VendorRunner closes a measured frame in finally and preserves a frame exception', async () => {
  const runner = createKhuRunner();
  const internals = runner as unknown as { frame: () => void; runMeasuredFrame: () => void };
  internals.frame = () => {};
  assert.equal(internals.runMeasuredFrame(), undefined);
  const expected = new Error('fixture frame error');
  internals.frame = () => { throw expected; };
  assert.throws(() => internals.runMeasuredFrame(), (error) => error === expected);
  assert.equal(runner.getFrameMetrics().frames, 2, 'normal and throwing frames are both closed');
  await runner.stop();
});

test('VendorRunner logs in through fake WebSocket, counts packets, reconnects, and stops cleanly', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 10,
    reconnectMaxRetries: 2,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });

  try {
    await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const started = runner.getSnapshot();
    assert.equal(started.lifecycle, 'in_game');
    assert.ok(started.packets.incoming.welcome >= 1);
    assert.ok(started.packets.incoming.state >= 1);
    assert.ok(started.packets.outgoing.hello >= 1);
    assert.ok(started.frames > 0);
    const measured = runner.getFrameMetrics();
    assert.ok(measured.frames > 0, 'frame metrics must advance while runner is active');
    assert.ok(measured.avgMs !== null && measured.p95Ms !== null && measured.maxMs !== null);

    const first = FakeSocket.instances[0];
    assert.ok(first);
    first.serverClose();
    for (let i = 0; i < 20 && FakeSocket.instances.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(FakeSocket.instances.length >= 2, 'closed socket must schedule a reconnect');
    assert.notEqual(runner.getSnapshot().lifecycle, 'error');

    const beforeStop = runner.getSnapshot().frames;
    await runner.stop();
    const stopped = runner.getSnapshot();
    assert.equal(stopped.lifecycle, 'stopped');
    assert.equal(stopped.autoRequested, false, 'stop must clear the Auto request');
    assert.equal(runner.getFrameMetrics().avgMs, null, 'stop resets frame metrics');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(runner.getSnapshot().frames, beforeStop, 'stop must clear the frame timer');
  } finally {
    await runner.stop();
  }
});

test('VendorRunner stays alive across a virtual five minute outage and resets its reconnect window on success', async () => {
  FakeSocket.instances = [];
  const clock = new ManualReconnectClock();
  const runner = createKhuRunner({ reconnectClock: clock, reconnectRandom: () => 0.5, reconnectMaxDelayMs: 2_000, reconnectGiveUpMs: 600_000 });
  try {
    await runner.start();
    FakeSocket.instances[0]!.serverClose();
    assert.equal(runner.getSnapshot().lifecycle, 'connecting');
    clock.advance(5 * 60_000);
    await waitUntil(() => FakeSocket.instances.length >= 2 && runner.getSnapshot().lifecycle === 'in_game');
    const state = runner as unknown as { reconnectAttempts: number; reconnectStartedAt: number | null };
    assert.equal(state.reconnectAttempts, 0);
    assert.equal(state.reconnectStartedAt, null);
  } finally { await runner.stop(); }
});

test('VendorRunner gives up only after the continuous disconnect deadline and caps retry delay', async () => {
  const clock = new ManualReconnectClock();
  const logs: Array<{ code: string }> = [];
  const runner = createKhuRunner({ reconnectClock: clock, reconnectRandom: () => 0.5, reconnectBaseDelayMs: 1_000,
    reconnectMaxDelayMs: 2_500, reconnectGiveUpMs: 5_000, onLog: (event) => logs.push(event) });
  (runner as unknown as { connectAndBuild: () => Promise<void> }).connectAndBuild = async () => { throw new Error('SOCKET_DOWN'); };
  (runner as unknown as { handleSocketClosed: () => void }).handleSocketClosed();
  assert.equal(clock.nextDelay(), 1_000);
  clock.advance(1_000); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(clock.nextDelay(), 2_000);
  clock.advance(2_000); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(clock.nextDelay(), 2_500, 'backoff must stop growing at the configured ceiling');
  clock.advance(2_500); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runner.getLifecycle(), 'error');
  assert.ok(logs.some((event) => event.code === 'reconnect_exhausted'));
  await runner.stop();
});

test('VendorRunner retries forever when give-up is zero and stops immediately on permanent AuthError', async () => {
  const clock = new ManualReconnectClock();
  const runner = createKhuRunner({ reconnectClock: clock, reconnectRandom: () => 0, reconnectMaxDelayMs: 1_500, reconnectGiveUpMs: 0 });
  (runner as unknown as { connectAndBuild: () => Promise<void> }).connectAndBuild = async () => { throw new Error('SOCKET_DOWN'); };
  (runner as unknown as { handleSocketClosed: () => void }).handleSocketClosed();
  for (let i = 0; i < 10; i += 1) {
    const delay = clock.nextDelay();
    assert.notEqual(delay, null);
    assert.ok(delay! <= 1_500);
    clock.advance(delay!); await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(runner.getLifecycle(), 'connecting');
  assert.equal((runner as unknown as { reconnectAttempts: number }).reconnectAttempts, 11);
  await runner.stop();

  const authClock = new ManualReconnectClock();
  const authLogs: Array<{ code: string; reasonCode?: string }> = [];
  const authRunner = createKhuRunner({ reconnectClock: authClock, onLog: (event) => authLogs.push(event) });
  (authRunner as unknown as { connectAndBuild: () => Promise<void> }).connectAndBuild = async () => { throw new AuthError('REFRESH_INVALID', 'fixture revoked'); };
  (authRunner as unknown as { handleSocketClosed: () => void }).handleSocketClosed();
  authClock.advance(authClock.nextDelay()!); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(authRunner.getLifecycle(), 'error');
  assert.equal(authClock.nextDelay(), null, 'permanent auth failure must not schedule another retry');
  assert.ok(authLogs.some((event) => event.code === 'auth_failed' && event.reasonCode === 'REFRESH_INVALID'));
  await authRunner.stop();
});

test('VendorRunner retries through the same proxy transport and never falls back to a direct socket', async () => {
  FakeSocket.instances = [];
  const clock = new ManualReconnectClock();
  let proxySockets = 0;
  let directSockets = 0;
  class FailingProxySocket extends FakeSocket {
    public constructor(url: string) { super(url); proxySockets += 1; }
    public send(data: string): void {
      super.send(data);
      const packet = JSON.parse(data) as { op?: string };
      if (packet.op === 'hello' && proxySockets === 1) queueMicrotask(() => this.serverClose());
    }
  }
  class DirectSocket extends FakeSocket { public constructor(url: string) { super(url); directSockets += 1; } }
  const runner = createKhuRunner({ reconnectClock: clock, reconnectRandom: () => 0.5,
    WebSocketImpl: DirectSocket as unknown as new (url: string) => VendorSocketLike,
    transport: { fetch: globalThis.fetch, WebSocketImpl: FailingProxySocket as unknown as new (url: string) => VendorSocketLike, close() {} } });
  try {
    await runner.start();
    clock.advance(5_000);
    await waitUntil(() => proxySockets >= 2 && runner.getSnapshot().lifecycle === 'in_game');
    assert.equal(directSockets, 0);
  } finally { await runner.stop(); }
});

test('VendorRunner preserves Auto preference on reconnect and never enables it for a downed player', async () => {
  FakeSocket.instances = [];
  const clock = new ManualReconnectClock();
  const runner = createKhuRunner({ reconnectClock: clock, reconnectRandom: () => 0.5 });
  try {
    await runner.start();
    await waitUntil(() => runner.getSnapshot().mapId !== null);
    await runner.startAuto();
    assert.equal(runner.getSnapshot().autoRequested, true);
    FakeSocket.instances[0]!.serverClose();
    clock.advance(5_000);
    await waitUntil(() => FakeSocket.instances.length >= 2 && runner.getSnapshot().lifecycle === 'farming');
    assert.equal(runner.getSnapshot().supervisor.phase, 'farming');
    await runner.stop();
  } finally { await runner.stop(); }

  FakeSocket.instances = [];
  const offClock = new ManualReconnectClock();
  const offRunner = createKhuRunner({ reconnectClock: offClock, reconnectRandom: () => 0.5 });
  try {
    await offRunner.start();
    FakeSocket.instances[0]!.serverClose();
    offClock.advance(5_000);
    await waitUntil(() => FakeSocket.instances.length >= 2 && offRunner.getSnapshot().lifecycle === 'in_game');
    assert.equal(offRunner.getSnapshot().autoRequested, false);
    assert.notEqual(offRunner.getSnapshot().supervisor.phase, 'farming');
  } finally { await offRunner.stop(); }

  FakeSocket.instances = [];
  FakeSocket.downed = false;
  const downClock = new ManualReconnectClock();
  const downRunner = createKhuRunner({ reconnectClock: downClock, reconnectRandom: () => 0.5 });
  try {
    await downRunner.start();
    await waitUntil(() => downRunner.getSnapshot().mapId !== null);
    await downRunner.startAuto();
    FakeSocket.downed = true;
    FakeSocket.instances[0]!.serverClose();
    downClock.advance(5_000);
    await waitUntil(() => FakeSocket.instances.length >= 2 && downRunner.getSnapshot().lifecycle === 'in_game');
    assert.equal(downRunner.getSnapshot().autoRequested, false);
    assert.equal(downRunner.getSnapshot().downed, true);
  } finally { FakeSocket.downed = false; await downRunner.stop(); }
});

test('VendorRunner validates the configured game URL before loading the client', () => {
  assert.throws(() => new VendorRunner({
    accountName: 'fixture-account',
    credentials: {},
    gameServerUrl: 'https://fixture.invalid/not-websocket',
    vendorClientDir,
  }), /VENDOR_GAME_URL_INVALID/);
});

test('VendorRunner keeps map and position unknown until the observed map is committed', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.mapId = 'thanh_truc_lam';
  FakeSocket.mapDelayMs = 120;
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  try {
    await runner.start();
    const beforeMap = runner.getSnapshot();
    assert.equal(beforeMap.mapId, null);
    assert.equal(beforeMap.khu, null);
    assert.equal(beforeMap.x, null);
    assert.equal(beforeMap.y, null);

    for (let i = 0; i < 30 && (runner.getSnapshot().packets.incoming.map ?? 0) < 1; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const duringTransition = runner.getSnapshot();
    assert.equal(duringTransition.packets.incoming.map, 1);
    assert.equal(duringTransition.mapId, null);
    assert.equal(duringTransition.khu, null);
    assert.equal(duringTransition.x, null);
    assert.equal(duringTransition.y, null);

    for (let i = 0; i < 600 && runner.getSnapshot().mapId === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const afterMap = runner.getSnapshot();
    assert.equal(afterMap.mapId, 'thanh_truc_lam');
    assert.notEqual(afterMap.mapId, 'tan_vien');
    assert.equal(afterMap.x, 240);
    assert.equal(afterMap.y, 192);
  } finally {
    FakeSocket.mapId = 'tan_vien';
    FakeSocket.mapDelayMs = 0;
    await runner.stop();
  }
});

test('VendorRunner gates Auto on map readiness and rejects a mismatched anchor', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.mapId = 'thanh_truc_lam';
  FakeSocket.mapDelayMs = 160;
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  try {
    await runner.start();
    await assert.rejects(() => runner.startAuto(), /VENDOR_MAP_NOT_READY/);

    for (let i = 0; i < 600 && runner.getSnapshot().mapId !== 'thanh_truc_lam'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(runner.getSnapshot().mapId, 'thanh_truc_lam');
    await assert.rejects(() => runner.startAuto({ mapId: 'tan_vien', khu: 1, x: 240, y: 192 }), /AUTO_ANCHOR_MAP_MISMATCH/);

    const started = await runner.startAuto({ mapId: 'thanh_truc_lam', khu: 1, x: 240, y: 192 });
    assert.equal(started.anchor?.mapId, 'thanh_truc_lam');
    assert.equal(started.autoRequested, true);
  } finally {
    FakeSocket.mapId = 'tan_vien';
    FakeSocket.mapDelayMs = 0;
    await runner.stop();
  }
});

test('VendorRunner starts Auto without an authoritative vitals packet, then stops it if none arrives', async () => {
  // Hồi quy: trước đây startAuto đòi gói you/hurt/revived, nhưng server thật chỉ gửi you SAU khi nhân vật
  // di chuyển nên nhân vật đứng yên không bao giờ bật được Auto.
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.emitYou = false;
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
    vitalsConfirmMs: 150,
    vitalsProbeIntervalMs: 5,
  });
  try {
    await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(runner.getSnapshot().vitals.fresh, false, 'chưa có gói vitals chính thức');
    await runner.startAuto();
    const started = runner.getSnapshot();
    assert.equal(started.autoRequested, true, 'phải bật được Auto khi chưa có gói vitals chính thức');
    for (let i = 0; i < 120 && runner.getSnapshot().autoRequested; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    const after = runner.getSnapshot();
    assert.ok(after.vitalsProbeMoves <= 10, 'vitals probe must be bounded to ten moves');
    assert.ok(FakeSocket.moves.some((move) => move.st === 'idle'), 'probe must use idle moves');
    assert.equal(after.autoRequested, false, 'Auto phải dừng khi quá hạn mà vẫn chưa được xác nhận');
    assert.equal(after.lifecycle, 'in_game');
  } finally {
    FakeSocket.emitYou = true;
    FakeSocket.emitYouAfterMoveCount = null;
    FakeSocket.emitHurtAfterMoveCount = null;
    FakeSocket.mapKhu = 1;
    FakeSocket.moves = [];
    await runner.stop();
  }
});

test('VendorRunner probes idle through Gateway and keeps Auto when you arrives on a matching seq', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.emitYou = false;
  FakeSocket.emitYouAfterMoveCount = null;
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
    vitalsConfirmMs: 4000,
    vitalsProbeIntervalMs: 5,
  });
  try {
    await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    FakeSocket.moves = [];
    FakeSocket.emitYouAfterMoveCount = 1; // server thật trả you ở mọi seq chia hết cho 10
    await runner.startAuto();
    for (let i = 0; i < 120 && !(runner.getSnapshot().packets.incoming.you >= 1); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const snapshot = runner.getSnapshot();
    assert.equal(snapshot.autoRequested, true, 'authoritative you must keep Auto enabled');
    assert.ok(snapshot.vitalsProbeMoves > 0 && snapshot.vitalsProbeMoves <= 10);
    assert.ok(FakeSocket.moves.some((move) => move.seq % 10 === 0 && move.st === 'idle'), 'probe must reach a seq accepted by the fake server');
    assert.ok(snapshot.packets.incoming.you >= 1, 'fake server must not emit you before the matching move');
  } finally {
    FakeSocket.emitYou = true;
    FakeSocket.emitYouAfterMoveCount = null;
    FakeSocket.moves = [];
    await runner.stop();
  }
});

test('VendorRunner stops an idle vitals probe as soon as hurt arrives', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.emitYou = false;
  FakeSocket.emitHurtAfterMoveCount = null;
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
    vitalsConfirmMs: 4000,
    vitalsProbeIntervalMs: 5,
  });
  try {
    await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    FakeSocket.moves = [];
    FakeSocket.emitHurtAfterMoveCount = 2;
    await runner.startAuto();
    for (let i = 0; i < 120 && runner.getSnapshot().hurtCount < 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    const snapshot = runner.getSnapshot();
    assert.equal(snapshot.hurtCount, 1);
    assert.ok(snapshot.vitalsProbeMoves <= 2, 'hurt must stop the probe before it reaches the ten-move limit');
  } finally {
    FakeSocket.emitYou = true;
    FakeSocket.emitHurtAfterMoveCount = null;
    FakeSocket.moves = [];
    await runner.stop();
  }
});

test('VendorRunner does not probe while down or while the client reports manual movement', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.emitYou = false;
  const downRunner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
    vitalsConfirmMs: 4000,
    vitalsProbeIntervalMs: 5,
  });
  try {
    await downRunner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    (downRunner as any).P.SceneWorld.player.downed = true;
    await assert.rejects(() => downRunner.startAuto(), /VENDOR_CHARACTER_DOWN/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(downRunner.getSnapshot().vitalsProbeMoves, 0);
  } finally {
    await downRunner.stop();
  }

  FakeSocket.instances = [];
  FakeSocket.moves = [];
  const movingRunner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
    vitalsConfirmMs: 4000,
    vitalsProbeIntervalMs: 5,
  });
  try {
    await movingRunner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    (movingRunner as any).P.Input.hasManualMove = () => true;
    await movingRunner.startAuto();
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(movingRunner.getSnapshot().vitalsProbeMoves, 0);
  } finally {
    FakeSocket.emitYou = true;
    await movingRunner.stop();
  }
});

test('VendorRunner preserves unknown khu and exports current SceneWorld markers', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.mapKhu = undefined;
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  try {
    await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const P = (runner as any).P;
    P.SceneWorld.enemies = [{ id: 'monster-fixture', type: 'fixture', x: 300, y: 220, hp: 8, hpMax: 10, dead: false, def: { name: 'fixture monster' } }];
    P.Gateway.remotes = { 'player-fixture': { id: 'player-fixture', name: 'fixture player', x: 280, y: 210, realm: 'realm', hp: 0.75, seen: true } };
    const snapshot = runner.getSnapshot();
    assert.equal(snapshot.mapId, 'tan_vien');
    assert.equal(snapshot.khu, null, 'missing map.khu must remain unknown');
    assert.deepEqual(snapshot.monsters[0], { id: 'monster-fixture', name: 'fixture monster', x: 300, y: 220, hp: 8, maxHp: 10 });
    assert.deepEqual(snapshot.players[0], { id: 'player-fixture', name: 'fixture player', x: 280, y: 210, realm: 'realm', hp: 75 });
    assert.equal(snapshot.monstersContext.fresh, true);
    assert.equal(snapshot.playersContext.fresh, true);
  } finally {
    FakeSocket.mapKhu = 1;
    FakeSocket.emitYou = true;
    await runner.stop();
  }
});

test('VendorRunner walks with the official pathfinder, arrives, and lets Auto win the control handoff', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.emitYou = true;
  FakeSocket.spawn = { x: 272, y: 860 };
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  try {
    await runner.start();
    for (let i = 0; i < 100 && runner.getSnapshot().mapId === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(runner.getSnapshot().mapId, 'tan_vien');

    const accepted = runner.moveTo({ target: { x: 372, y: 860 }, requester: 'user' });
    assert.equal(accepted.status, 'accepted');
    assert.ok(accepted.resolvedTarget, 'route phải cho đích đã snap');
    assert.ok(Math.hypot(accepted.resolvedTarget.x - 372, accepted.resolvedTarget.y - 860) <= 6 * 32, 'đích snap trong 6 ô');
    for (let i = 0; i < 150 && runner.getSnapshot().moveTo?.status !== 'arrived'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(runner.getSnapshot().moveTo?.status, 'arrived');

    const manual = runner.moveTo({ target: { x: 272, y: 860 }, requester: 'user' });
    const auto = await runner.startAuto();
    assert.equal(auto.autoRequested, true);
    assert.equal(runner.getSnapshot().moveTo?.operationId, manual.operationId);
    assert.equal(runner.getSnapshot().moveTo?.status, 'cancelled');
    assert.equal(runner.getSnapshot().moveTo?.reason, 'auto_started');
  } finally {
    await runner.stop();
    FakeSocket.spawn = { x: 240, y: 192 };
    FakeSocket.emitYou = true;
    FakeSocket.moves = [];
  }
});

test('official vendor client changes map when setPath crosses a real tan_vien portal', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.outgoing = [];
  FakeSocket.spawn = { x: 240, y: 896 };
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  try {
    await runner.start();
    for (let i = 0; i < 100 && runner.getSnapshot().mapId === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const P = (runner as any).P;
    const portal = P.SceneWorld.map.portals.find((entry: { tx: number; ty: number; toMap?: string }) => entry.toMap === 'thanh_truc_lam');
    assert.ok(portal, 'tan_vien fixture must expose a real portal to thanh_truc_lam');
    const player = P.SceneWorld.player;
    player.x = portal.tx * 32 + 16;
    player.y = portal.ty * 32 - 16;
    player.setPath([{ x: portal.tx * 32 + 16, y: portal.ty * 32 + 16 }]);

    for (let i = 0; i < 200 && !FakeSocket.outgoing.some((packet) => packet.op === 'enter' && packet.mapId === 'thanh_truc_lam'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(
      FakeSocket.outgoing.some((packet) => packet.op === 'enter' && packet.mapId === 'thanh_truc_lam'),
      'setPath through the real portal must produce the client enter request',
    );
  } finally {
    await runner.stop();
    FakeSocket.spawn = { x: 240, y: 192 };
    FakeSocket.outgoing = [];
    FakeSocket.respondToEnter = false;
    FakeSocket.enterSpawns = {};
  }
});

test('VendorRunner completes a portal leg when the fixture server replies to enter with a delayed map packet', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.outgoing = [];
  FakeSocket.respondToEnter = true;
  FakeSocket.enterSpawns = { thanh_truc_lam: { x: 240, y: 192 } };
  FakeSocket.spawn = { x: 272, y: 860 };
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  try {
    await runner.start();
    for (let i = 0; i < 100 && runner.getSnapshot().mapId === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const accepted = runner.moveTo({ targetMapId: 'thanh_truc_lam', requester: 'user' });
    assert.deepEqual(accepted.route, ['tan_vien', 'thanh_truc_lam']);
    for (let i = 0; i < 500 && runner.getSnapshot().moveTo?.status !== 'arrived'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(runner.getSnapshot().moveTo?.status, 'arrived');
    assert.equal(runner.getSnapshot().mapId, 'thanh_truc_lam');
    assert.ok(FakeSocket.outgoing.some((packet) => packet.op === 'enter' && packet.mapId === 'thanh_truc_lam'));
  } finally {
    await runner.stop();
    FakeSocket.spawn = { x: 240, y: 192 };
    FakeSocket.mapId = 'tan_vien';
    FakeSocket.respondToEnter = false;
    FakeSocket.enterSpawns = {};
    FakeSocket.outgoing = [];
  }
});

test('VendorRunner daily checkin waits for the matching ACK cmd and ignores another command', async () => {
  resetKhuFixture();
  FakeSocket.instances = [];
  FakeSocket.outgoing = [];
  FakeSocket.spawn = { x: 1057, y: 646 };
  FakeSocket.emitYou = false;
  FakeSocket.dailyAckResponses = true;
  const runner = createKhuRunner({ loopIntervalMs: 5 });
  try {
    await runner.start();
    await waitUntil(() => runner.getSnapshot().mapId === 'tan_vien');
    const status = runner.getDailyStatus();
    assert.ok(status.seedTasks.some((task) => task.id === 'duoc_moc'), 'official client seedTaskList must expose duoc_moc');
    assert.equal(status.seedTasks.find((task) => task.id === 'truc_gia')?.supported, true, 'truc_gia must be supported');
    assert.equal(status.seedTasks.find((task) => task.id === 'cau_ca')?.supported, true, 'cau_ca must be supported');
    assert.equal(status.seedTasks.find((task) => task.id === 'ho_tong_chau')?.supported, true, 'ho_tong_chau must be supported');
    const operation = runner.startDailyCheckin();
    await waitUntil(() => FakeSocket.outgoing.some((packet) => packet.op === 'cmd' && packet.cmd === 'diemdanh'), 10_000);
    await waitUntil(() => runner.getSnapshot().daily?.status === 'done', 10_000);
    assert.equal(runner.getSnapshot().daily?.operationId, operation.operationId);
    assert.equal(runner.getSnapshot().daily?.rewards?.stones, 10);
    assert.equal(FakeSocket.outgoing.filter((packet) => packet.op === 'cmd' && packet.cmd === 'diemdanh').length, 1);
  } finally {
    await runner.stop();
    resetKhuFixture();
    FakeSocket.emitYou = true;
    FakeSocket.dailyAckResponses = false;
  }
});

test('VendorRunner changes khu from the measured map response and applies both cooldown guards', async () => {
  resetKhuFixture();
  FakeSocket.soKhu = 20;
  FakeSocket.spawn = { x: 272, y: 860 };
  const runner = createKhuRunner();
  try {
    await runner.start();
    await waitUntil(() => runner.getSnapshot().mapId === 'tan_vien');
    const changed = await runner.changeKhu(2);
    assert.equal(changed.mapId, 'tan_vien');
    assert.equal(changed.khu, 2);
    await waitUntil(() => runner.getSnapshot().khuList?.khu === 2);
    assert.equal(runner.getSnapshot().khu, 2);
    assert.ok(FakeSocket.outgoing.some((packet) => packet.op === 'khu' && packet.act === 'chon' && packet.khu === 2));

    const beforeClientCooldown = FakeSocket.outgoing.filter((packet) => packet.op === 'khu' && packet.act === 'chon').length;
    await assert.rejects(() => runner.changeKhu(3), (error: unknown) => {
      const candidate = error as { code?: string; retryAfterSec?: number };
      return candidate.code === 'KHU_COOLDOWN' && (candidate.retryAfterSec ?? 0) >= 1;
    });
    assert.equal(FakeSocket.outgoing.filter((packet) => packet.op === 'khu' && packet.act === 'chon').length, beforeClientCooldown);

    (runner as any).lastKhuChangeAt = Date.now() - 6_000;
    FakeSocket.khuLastChangeAt = Date.now();
    await assert.rejects(() => runner.changeKhu(3), (error: unknown) => {
      const candidate = error as { code?: string; retryAfterSec?: number };
      return candidate.code === 'KHU_COOLDOWN' && (candidate.retryAfterSec ?? 0) >= 1;
    });
    assert.ok(FakeSocket.outgoing.filter((packet) => packet.op === 'khu' && packet.act === 'chon').length > beforeClientCooldown);

    (runner as any).lastKhuChangeAt = Date.now() - 6_000;
    FakeSocket.khuLastChangeAt = Date.now() - 6_000;
    const beforeAlreadyHere = FakeSocket.outgoing.filter((packet) => packet.op === 'khu' && packet.act === 'chon').length;
    await assert.rejects(() => runner.changeKhu(2), /KHU_ALREADY_HERE/);
    assert.equal(FakeSocket.outgoing.filter((packet) => packet.op === 'khu' && packet.act === 'chon').length, beforeAlreadyHere);

    (runner as any).observedKhu = null;
    const beforeServerAlreadyHere = FakeSocket.outgoing.filter((packet) => packet.op === 'khu' && packet.act === 'chon').length;
    await assert.rejects(() => runner.changeKhu(2), (error: unknown) => (error as { code?: string }).code === 'KHU_ALREADY_HERE');
    assert.equal(FakeSocket.outgoing.filter((packet) => packet.op === 'khu' && packet.act === 'chon').length, beforeServerAlreadyHere + 1);

    const move = runner.moveTo({ target: { x: 372, y: 860 }, requester: 'user' });
    (runner as any).recordIncoming({ op: 'map', mapId: 'tan_vien', khu: 3, soKhu: 20, ep: 3, x: 272, y: 860 });
    assert.equal(runner.getSnapshot().moveTo?.operationId, move.operationId);
    assert.equal(runner.getSnapshot().moveTo?.status, 'cancelled');
    assert.equal(runner.getSnapshot().moveTo?.reason, 'khu_changed');
  } finally {
    await runner.stop();
    resetKhuFixture();
    FakeSocket.spawn = { x: 240, y: 192 };
  }
});

test('VendorRunner requests and sanitizes khu lists, and rejects invalid or unsplit targets before sending', async () => {
  resetKhuFixture();
  FakeSocket.soKhu = 20;
  const runner = createKhuRunner();
  try {
    await runner.start();
    await waitUntil(() => runner.getSnapshot().mapId === 'tan_vien');
    const list = await runner.requestKhuList();
    assert.equal(list.dem.length, 20);
    assert.equal(list.tran.length, 20);
    const beforeInvalid = FakeSocket.outgoing.length;
    await assert.rejects(() => runner.changeKhu(21), /TARGET_INVALID/);
    assert.equal(FakeSocket.outgoing.length, beforeInvalid);
    (runner as any).recordIncoming({ op: 'khu', mapId: 'tan_vien', khu: 1, dem: ['bad'], toiDa: 20, tran: [20] });
    assert.equal(runner.getSnapshot().khuList?.dem.length, 20, 'malformed khu packet must not replace the last valid list');
  } finally {
    await runner.stop();
    resetKhuFixture();
  }

  FakeSocket.soKhu = 1;
  const unsplit = createKhuRunner();
  try {
    await unsplit.start();
    await waitUntil(() => unsplit.getSnapshot().mapId === 'tan_vien');
    const before = FakeSocket.outgoing.length;
    await assert.rejects(() => unsplit.changeKhu(1), /MAP_NOT_SPLIT/);
    assert.equal(FakeSocket.outgoing.length, before);
  } finally {
    await unsplit.stop();
    resetKhuFixture();
  }
});

test('VendorRunner blocks khu changes while Auto or walkTo owns the character', async () => {
  resetKhuFixture();
  FakeSocket.soKhu = 20;
  FakeSocket.spawn = { x: 272, y: 860 };
  const autoRunner = createKhuRunner();
  try {
    await autoRunner.start();
    await waitUntil(() => autoRunner.getSnapshot().mapId === 'tan_vien');
    await autoRunner.startAuto();
    await assert.rejects(() => autoRunner.changeKhu(2), /AUTO_ACTIVE/);
    autoRunner.stopAuto();
  } finally {
    await autoRunner.stop();
  }

  const walkingRunner = createKhuRunner();
  try {
    await walkingRunner.start();
    await waitUntil(() => walkingRunner.getSnapshot().mapId === 'tan_vien');
    walkingRunner.moveTo({ target: { x: 372, y: 860 }, requester: 'user' });
    await assert.rejects(() => walkingRunner.changeKhu(2), /OPERATION_IN_PROGRESS/);
  } finally {
    await walkingRunner.stop();
    resetKhuFixture();
    FakeSocket.spawn = { x: 240, y: 192 };
  }
});

test('VendorRunner reports KHU_TIMEOUT when the fixture does not answer', async () => {
  resetKhuFixture();
  FakeSocket.soKhu = 20;
  FakeSocket.khuNoResponse = true;
  const runner = createKhuRunner({ khuChangeTimeoutMs: 80 });
  try {
    await runner.start();
    await waitUntil(() => runner.getSnapshot().mapId === 'tan_vien');
    const pending = runner.changeKhu(2);
    await assert.rejects(() => runner.changeKhu(3), /KHU_IN_PROGRESS/);
    await assert.rejects(() => pending, /KHU_TIMEOUT/);
  } finally {
    await runner.stop();
    resetKhuFixture();
  }
});

test('VendorRunner rate-limits watchdog warnings instead of logging one per frame', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
    // Ngưỡng 0 ms: mọi khung hình đều "trễ", trước đây ghi một cảnh báo mỗi khung hình.
    watchdogMaxFrameDelayMs: 0,
  });
  try {
    await runner.start();
    for (let i = 0; i < 400 && runner.getSnapshot().frames < 40; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const snapshot = runner.getSnapshot();
    assert.ok(snapshot.frames >= 40, 'enough frames ran to exercise the watchdog');
    const warnings = snapshot.logs.filter((log) => log.code === 'watchdog_warning' && log.reasonCode === 'frame_delay');
    assert.ok(warnings.length >= 1, 'the first warning is still recorded');
    assert.ok(warnings.length <= 1, 'but not one per frame');
    assert.match(String(warnings[0]?.detail), /^delayMs=\d+$/);
  } finally {
    await runner.stop();
  }
});

test('VendorRunner suy toạ độ prop của map khác từ ô MapData và chỉ liệt kê cây Linh Chi của map đã tải', async () => {
  FakeSocket.instances = [];
  FakeSocket.moves = [];
  FakeSocket.respondToEnter = true;
  FakeSocket.enterSpawns = { thanh_truc_lam: { x: 432, y: 927 } };
  FakeSocket.spawn = { x: 272, y: 860 };
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'fixture-refresh-token' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FakeTokenManager(),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 0,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  try {
    await runner.start();
    for (let i = 0; i < 400 && runner.getSnapshot().mapId === null; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(runner.getSnapshot().mapId, 'tan_vien');
    const internals = runner as unknown as {
      getDailyProp(mapId: string, propId: string): { id: string; x: number; y: number } | null;
      getDailyProps(mapId: string, type: string): Array<{ id: string; x: number; y: number }>;
    };
    // Map khác (duoc_vien): chỉ có ô tx/ty trong MapData; đã đối chiếu: dai_phu ô (14,8) -> (464,288), cổ thụ ô (34,25) -> (1104,832).
    assert.deepEqual(internals.getDailyProp('duoc_vien', 'dai_phu')?.x, 464);
    assert.deepEqual(internals.getDailyProp('duoc_vien', 'dai_phu')?.y, 288);
    assert.deepEqual(internals.getDailyProp('duoc_vien', 'ho_bich_thuy_cong')?.x, 592);
    assert.deepEqual(internals.getDailyProp('duoc_vien', 'ho_bich_thuy_cong')?.y, 528);
    const fishingSpots = internals.getDailyProps('duoc_vien', 'interactable');
    assert.ok(fishingSpots.some((prop) => prop.id === 'ho_bich_thuy_cong'), 'MapData interactables must be listed for fishing');
    assert.deepEqual(internals.getDailyProp('duoc_vien', 'co_thu_linh_moc')?.x, 1104);
    assert.deepEqual(internals.getDailyProp('duoc_vien', 'co_thu_linh_moc')?.y, 832);
    assert.deepEqual(internals.getDailyProp('tan_vien', 'su_phu')?.x, 304);
    assert.deepEqual(internals.getDailyProp('tan_vien', 'su_phu')?.y, 352);
    // Map đang tải (tan_vien): cây Linh Chi có x/y (bố cục theo ngày); map khác thì không liệt kê.
    const loaded = internals.getDailyProps('tan_vien', 'ling_chi_prop');
    assert.ok(loaded.length >= 1, 'map đã tải phải có cây Linh Chi');
    assert.ok(loaded.every((prop) => Number.isFinite(prop.x) && Number.isFinite(prop.y)));
    assert.deepEqual(internals.getDailyProps('duoc_vien', 'ling_chi_prop'), []);
    const move = runner.moveTo({ targetMapId: 'thanh_truc_lam', requester: 'user' });
    await waitUntil(() => runner.getSnapshot().moveTo?.operationId === move.operationId && runner.getSnapshot().moveTo?.status === 'arrived', 10_000);
    const bamboo = internals.getDailyProps('thanh_truc_lam', 'seed_bamboo_prop');
    assert.equal(bamboo.length, 4, 'loaded thanh_truc_lam must expose four bamboo props');
    assert.ok(bamboo.every((prop) => Number.isFinite(prop.x) && Number.isFinite(prop.y)));
  } finally {
    FakeSocket.mapId = 'tan_vien';
    FakeSocket.spawn = { x: 240, y: 192 };
    FakeSocket.respondToEnter = false;
    FakeSocket.enterSpawns = {};
    await runner.stop();
  }
});
