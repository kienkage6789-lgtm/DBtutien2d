import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { AuthSession } from '@tutien2d/core-client';
import { VendorRunner, type VendorTokenManagerLike } from './vendor-runner.js';
import type { VendorSocketLike } from './vendor-env.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const vendorClientDir = path.join(repoRoot, 'vendor/tutien2d-public-client/2026-10-06');

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
}

class FakeSocket implements VendorSocketLike {
  public static instances: FakeSocket[] = [];
  public static emitYouAfterMoveCount: number | null = null;
  public static emitHurtAfterMoveCount: number | null = null;
  public static mapId = 'tan_vien';
  public static mapKhu: number | undefined = 1;
  public static mapDelayMs = 0;
  public static respondToEnter = false;
  public static enterDelayMs = 25;
  public static enterSpawns: Record<string, { x: number; y: number }> = {};
  /** Điểm xuất hiện trong gói `map`; mặc định cũ nằm trong ô bị chặn của tan_vien nên không đi bộ được. */
  public static spawn = { x: 240, y: 192 };
  public static moves: Array<{ seq: number; st?: string; x?: number; y?: number }> = [];
  public static outgoing: Array<{ op?: string; mapId?: string }> = [];
  /** false: giả lập server thật, gói `you` chỉ đến sau khi nhân vật di chuyển (không có ngay lúc vào game). */
  public static emitYou = true;
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
    const packet = JSON.parse(data) as { op?: string; mapId?: string; seq?: number; st?: string; x?: number; y?: number };
    FakeSocket.outgoing.push({ op: packet.op, mapId: (packet as { mapId?: string }).mapId });
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
        this.emit({ op: 'map', mapId: targetMapId, khu: 1, soKhu: 1, ep: 1, x: spawn.x, y: spawn.y, dir: 0, p: [] });
        this.emit({ op: 'snap2', full: true, ep: 1, seq: 1, p: [], m: [] });
      }, FakeSocket.enterDelayMs);
    }
    if (packet.op !== 'hello') return;
    queueMicrotask(() => {
      this.emit({ op: 'welcome', serverTime: Date.now(), hasChar: true, snap: 2, ep: 1 });
      setTimeout(() => {
        this.emit({ op: 'state', save: { realm: 'luyen_khi_8', exp: 0, equipment: {} } });
        setTimeout(() => {
          this.emit({ op: 'map', mapId: FakeSocket.mapId, ...(FakeSocket.mapKhu === undefined ? {} : { khu: FakeSocket.mapKhu }), soKhu: 1, ep: 1, x: FakeSocket.spawn.x, y: FakeSocket.spawn.y, dir: 0, p: [] });
          this.emit({ op: 'snap2', full: true, ep: 1, seq: 1, p: [], m: [] });
          if (FakeSocket.emitYou) this.emit({ op: 'you', seq: 10, x: 240, y: 192, hp: 100, mp: 50, dn: false, fix: true });
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

  private emit(packet: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(packet) });
  }
}

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
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(runner.getSnapshot().frames, beforeStop, 'stop must clear the frame timer');
  } finally {
    await runner.stop();
  }
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
