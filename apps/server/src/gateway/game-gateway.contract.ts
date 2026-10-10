import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameGateway } from './game-gateway.js';
import type { WalkRequest } from '../headless/walk-navigator.js';

export interface GameGatewayContractFixture {
  gateway: GameGateway;
  /** Marks the gateway's character down without sending network traffic. */
  setDown(): void;
  /** Delivers one observed hurt update without external network traffic. */
  hurt(): void;
  /** Closes the current socket as if the server dropped it. */
  disconnectUnexpectedly(): void;
  /** Number of session sockets created by this fixture. */
  sessionCount(): number;
  /** Whether the current session socket has closed. */
  isSocketClosed(): boolean;
}

export type CreateGameGatewayContractFixture = () => Promise<GameGatewayContractFixture>;

const walkRequest: WalkRequest = {
  target: { x: 372, y: 860 },
  requester: 'contract-test',
  timeoutMs: 60_000,
};

/** Reusable behavior contract, exercised only against a started gateway and offline fixture. */
export function registerGameGatewayContract(name: string, create: CreateGameGatewayContractFixture): void {
  test(`${name} contract: stop closes session, cancels walk, clears waiters, and is idempotent`, async (context) => {
    const fixture = await create();
    const { gateway } = fixture;
    context.after(() => gateway.stop());
    gateway.walkTo(walkRequest);
    await gateway.stop();
    assert.equal(gateway.getLifecycle(), 'stopped');
    assert.equal(fixture.isSocketClosed(), true);
    assert.equal(gateway.getState().walkOperation?.status, 'cancelled');
    assert.equal(gateway.cancelWalk('no-longer-active'), false, 'stopped walk has no active cancellation waiter');
    await assert.doesNotReject(() => gateway.stop());
  });

  test(`${name} contract: cancelWalk only cancels the matching operation and clears its waiter`, async (context) => {
    const { gateway } = await create();
    context.after(() => gateway.stop());
    const operation = gateway.walkTo(walkRequest);
    assert.equal(gateway.cancelWalk(`${operation.operationId}-other`), false);
    assert.equal(gateway.getState().walkOperation?.operationId, operation.operationId);
    assert.equal(gateway.getState().walkOperation?.status, 'accepted');
    assert.equal(gateway.cancelWalk(operation.operationId), true);
    assert.equal(gateway.getState().walkOperation?.status, 'cancelled');
    assert.equal(gateway.cancelWalk(operation.operationId), false, 'completed waiter cannot be cancelled again');
  });

  test(`${name} contract: downed character is rejected by soft movement and strict action gates`, async (context) => {
    const fixture = await create();
    context.after(() => fixture.gateway.stop());
    fixture.setDown();
    assert.equal(fixture.gateway.getState().isDown, true, 'down packet must produce a known down state');
    assert.throws(() => fixture.gateway.walkTo(walkRequest), (error: unknown) => errorCode(error) === 'CHARACTER_DOWN');
    await assert.rejects(() => fixture.gateway.startAuto(), (error: unknown) => errorCode(error) === 'VENDOR_CHARACTER_DOWN');
    await assert.rejects(() => fixture.gateway.changeKhu(1), (error: unknown) => errorCode(error) === 'CHARACTER_DOWN');
  });

  test(`${name} contract: disconnect listeners unsubscribe and throwing observers do not break reconnect`, async (context) => {
    const fixture = await create();
    context.after(() => fixture.gateway.stop());
    let removedCalls = 0;
    let activeCalls = 0;
    const unsubscribe = fixture.gateway.onDisconnect(() => { removedCalls += 1; });
    fixture.gateway.onDisconnect(() => { activeCalls += 1; throw new Error('observer failure'); });
    unsubscribe();
    fixture.disconnectUnexpectedly();
    assert.equal(removedCalls, 0);
    assert.equal(activeCalls, 1);
    await waitUntil(() => fixture.sessionCount() >= 2);
    assert.notEqual(fixture.gateway.getLifecycle(), 'error');
  });

  test(`${name} contract: repeated start does not create a second account session`, async (context) => {
    const fixture = await create();
    context.after(() => fixture.gateway.stop());
    const sessions = fixture.sessionCount();
    await fixture.gateway.start();
    assert.equal(fixture.sessionCount(), sessions);
    assert.equal(fixture.gateway.getLifecycle(), 'in_game');
  });

  test(`${name} contract: hurt count never decreases`, async (context) => {
    const fixture = await create();
    context.after(() => fixture.gateway.stop());
    const before = fixture.gateway.getState().hurtCount;
    fixture.hurt();
    assert.equal(fixture.gateway.getState().hurtCount, before + 1);
  });

  test(`${name} contract: unknown vitals and down state stay null after start before a you packet`, async (context) => {
    const { gateway } = await create();
    context.after(() => gateway.stop());
    const state = gateway.getState();
    assert.equal(state.hp, null);
    assert.equal(state.maxHp, null);
    assert.equal(state.mp, null);
    assert.equal(state.maxMp, null);
    assert.equal(state.isDown, null);
  });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error ? error.message : undefined;
}

async function waitUntil(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !condition()) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), 'fixture condition was not observed before timeout');
}
