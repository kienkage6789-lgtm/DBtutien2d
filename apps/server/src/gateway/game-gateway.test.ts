import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { AuthSession } from '@tutien2d/core-client';
import { VendorRunner, type VendorTokenManagerLike } from '../headless/vendor-runner.js';
import type { VendorSocketLike } from '../headless/vendor-env.js';
import { VendorGateway } from './vendor-gateway.js';
import type { GameGateway, GatewayLifecycle, GatewayState } from './game-gateway.js';
import type { WalkRequest } from '../headless/walk-navigator.js';
import { registerGameGatewayContract, type GameGatewayContractFixture } from './game-gateway.contract.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const vendorClientDir = path.join(repoRoot, 'vendor/tutien2d-public-client/2026-10-06');
const fixtureSession: AuthSession = {
  accessToken: 'offline-fixture', refreshToken: 'offline-fixture', expiresAt: 1, ttlMs: 1,
  email: 'fixture@example.invalid',
};

class FixtureTokenManager implements VendorTokenManagerLike {
  public getAccessToken(): Promise<string> { return Promise.resolve(fixtureSession.accessToken); }
  public getSession(): AuthSession { return fixtureSession; }
  public stop(): void {}
  public on(): void {}
}

/** Offline socket fixture modeled on vendor-runner.test.ts; it never opens a real connection. */
class ContractSocket implements VendorSocketLike {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public readyState = ContractSocket.CONNECTING;
  public onopen?: (event: unknown) => void;
  public onmessage?: (event: { data: string }) => void;
  public onerror?: (event: unknown) => void;
  public onclose?: (event: { code?: number; reason?: string }) => void;

  public constructor(public readonly url: string) {
    queueMicrotask(() => {
      if (this.readyState !== ContractSocket.CONNECTING) return;
      this.readyState = ContractSocket.OPEN;
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
        // Intentionally no `you` packet: contract verifies unknown vitals remain unknown.
      }, 5);
    });
  }

  public close(): void {
    if (this.readyState === ContractSocket.CLOSED) return;
    this.readyState = ContractSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'fixture_close' });
  }

  public serverClose(): void { this.close(); }
  public serverDown(): void {
    this.onmessage?.({ data: JSON.stringify({ op: 'you', seq: 20, x: 240, y: 192, hp: 100, mp: 50, dn: true, fix: true }) });
  }
  public serverHurt(): void { this.onmessage?.({ data: JSON.stringify({ op: 'hurt', hp: 90, mp: 50 }) }); }

  private emit(packet: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(packet) });
  }
}

class FakeGateway implements GameGateway {
  public readonly daily = {} as GameGateway['daily'];
  private lifecycle: GatewayLifecycle = 'stopped';
  private down: boolean | null = null;
  private hurts = 0;
  private operationSeq = 0;
  private walk: GatewayState['walkOperation'] = null;
  private sessions = 0;
  private readonly listeners = new Set<() => void>();
  public async start(): Promise<void> {
    if (this.lifecycle !== 'stopped') return;
    this.lifecycle = 'in_game';
    this.sessions += 1;
  }
  public async stop(): Promise<void> { this.walk = this.walk ? { ...this.walk, status: 'cancelled' } : null; this.lifecycle = 'stopped'; }
  public getLifecycle(): GatewayLifecycle { return this.lifecycle; }
  public onDisconnect(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  public getFrameMetrics() { return null; }
  public getState(): GatewayState {
    return { lifecycle: this.lifecycle, connection: this.lifecycle === 'in_game' ? 'IN_GAME' : 'DISCONNECTED',
      mapId: 'tan_vien', khu: 1, x: 240, y: 192, hp: null, maxHp: null, mp: null, maxMp: null,
      isDown: this.down, hurtCount: this.hurts, autoActive: false, soKhu: 1, reachableMaps: ['tan_vien'], walkOperation: this.walk };
  }
  public walkTo(_request: WalkRequest): NonNullable<GatewayState['walkOperation']> {
    if (this.lifecycle !== 'in_game') throw Object.assign(new Error('NOT_IN_GAME'), { code: 'NOT_IN_GAME' });
    if (this.down === true) throw Object.assign(new Error('CHARACTER_DOWN'), { code: 'CHARACTER_DOWN' });
    if (this.walk?.status === 'accepted' || this.walk?.status === 'running') throw new Error('OPERATION_IN_PROGRESS');
    const now = Date.now();
    this.walk = { operationId: `fake-walk-${++this.operationSeq}`, target: _request.target ?? null, resolvedTarget: _request.target ?? null,
      status: 'accepted', requester: _request.requester, startedAt: now, updatedAt: now };
    return this.walk;
  }
  public cancelWalk(operationId: string): boolean {
    if (!this.walk || this.walk.operationId !== operationId || this.walk.status !== 'accepted') return false;
    this.walk = { ...this.walk, status: 'cancelled' };
    return true;
  }
  public async startAuto(): Promise<never> {
    if (this.down === true) throw Object.assign(new Error('VENDOR_CHARACTER_DOWN'), { code: 'VENDOR_CHARACTER_DOWN' });
    throw Object.assign(new Error('VENDOR_VITALS_UNKNOWN'), { code: 'VENDOR_VITALS_UNKNOWN' });
  }
  public stopAuto() { return {} as ReturnType<GameGateway['stopAuto']>; }
  public getKhuInfo() { return { mapId: 'tan_vien', khu: 1, soKhu: 1, list: null }; }
  public async requestKhuList(): Promise<never> { throw new Error('NOT_IN_GAME'); }
  public async changeKhu(): Promise<never> {
    if (this.down === true) throw Object.assign(new Error('CHARACTER_DOWN'), { code: 'CHARACTER_DOWN' });
    throw Object.assign(new Error('KHU_PROTOCOL_UNAVAILABLE'), { code: 'KHU_PROTOCOL_UNAVAILABLE' });
  }
  public setDown(): void { this.down = true; }
  public hurt(): void { this.hurts += 1; }
  public disconnectUnexpectedly(): void {
    for (const listener of this.listeners) { try { listener(); } catch { /* observer errors do not break reconnect */ } }
    this.lifecycle = 'connecting';
    setTimeout(() => { this.sessions += 1; this.lifecycle = 'in_game'; }, 10);
  }
  public sessionCount(): number { return this.sessions; }
}

function createVendorGateway(): Promise<GameGatewayContractFixture> {
  const sockets: ContractSocket[] = [];
  class FixtureSocket extends ContractSocket {
    public constructor(url: string) { super(url); sockets.push(this); }
  }
  const runner = new VendorRunner({
    accountName: 'fixture-account',
    credentials: { refreshToken: 'offline-fixture' },
    gameServerUrl: 'wss://fixture.invalid/game',
    vendorClientDir,
    tokenManager: new FixtureTokenManager(),
    WebSocketImpl: FixtureSocket as unknown as new (url: string) => VendorSocketLike,
    reconnectMaxRetries: 3,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 10,
    loginTimeoutMs: 500,
    loopIntervalMs: 5,
  });
  const gateway = new VendorGateway(runner);
  return gateway.start().then(async () => {
    await waitUntil(() => gateway.getState().mapId !== null);
    return {
      gateway,
      setDown: () => sockets.at(-1)?.serverDown(),
      hurt: () => sockets.at(-1)?.serverHurt(),
      disconnectUnexpectedly: () => sockets.at(-1)?.serverClose(),
      sessionCount: () => sockets.length,
      isSocketClosed: () => sockets.at(-1)?.readyState === ContractSocket.CLOSED,
    };
  });
}

async function createFakeGateway(): Promise<GameGatewayContractFixture> {
  const fake = new FakeGateway();
  await fake.start();
  return {
    gateway: fake,
    setDown: () => fake.setDown(),
    hurt: () => fake.hurt(),
    disconnectUnexpectedly: () => fake.disconnectUnexpectedly(),
    sessionCount: () => fake.sessionCount(),
    isSocketClosed: () => fake.getLifecycle() === 'stopped',
  };
}

async function waitUntil(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !condition()) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), 'offline gateway fixture did not become ready');
}

registerGameGatewayContract('FakeGateway', createFakeGateway);
registerGameGatewayContract('VendorGateway', createVendorGateway);

test('FakeGateway fixture is an in-memory implementation of the started contract', async () => {
  const { gateway } = await createFakeGateway();
  const operation = gateway.walkTo({ target: { x: 372, y: 860 }, requester: 'contract-test' });
  assert.equal(gateway.getState().walkOperation?.operationId, operation.operationId);
  assert.equal(gateway.cancelWalk(operation.operationId), true);
  assert.equal(gateway.getState().walkOperation?.status, 'cancelled');
});
