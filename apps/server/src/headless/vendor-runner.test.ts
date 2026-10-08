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
    const packet = JSON.parse(data) as { op?: string };
    if (packet.op !== 'hello') return;
    queueMicrotask(() => {
      this.emit({ op: 'welcome', serverTime: Date.now(), hasChar: true, snap: 2, ep: 1 });
      setTimeout(() => {
        this.emit({ op: 'state', save: { realm: 'luyen_khi_8', exp: 0, equipment: {} } });
        this.emit({ op: 'map', mapId: 'tan_vien', khu: 1, soKhu: 1, ep: 1, x: 240, y: 192, dir: 0, p: [] });
        this.emit({ op: 'snap2', full: true, ep: 1, seq: 1, p: [], m: [] });
        if (FakeSocket.emitYou) this.emit({ op: 'you', seq: 10, x: 240, y: 192, hp: 100, mp: 50, dn: false, fix: true });
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

test('VendorRunner starts Auto without an authoritative vitals packet, then stops it if none arrives', async () => {
  // Hồi quy: trước đây startAuto đòi gói you/hurt/revived, nhưng server thật chỉ gửi you SAU khi nhân vật
  // di chuyển nên nhân vật đứng yên không bao giờ bật được Auto.
  FakeSocket.instances = [];
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
  });
  try {
    await runner.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(runner.getSnapshot().vitals.fresh, false, 'chưa có gói vitals chính thức');
    await runner.startAuto();
    const started = runner.getSnapshot();
    assert.equal(started.autoRequested, true, 'phải bật được Auto khi chưa có gói vitals chính thức');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const after = runner.getSnapshot();
    assert.equal(after.autoRequested, false, 'Auto phải dừng khi quá hạn mà vẫn chưa được xác nhận');
    assert.equal(after.lifecycle, 'in_game');
  } finally {
    FakeSocket.emitYou = true;
    await runner.stop();
  }
});
