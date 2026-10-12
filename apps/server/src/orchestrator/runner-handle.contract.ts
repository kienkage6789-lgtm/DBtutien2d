import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthSession } from '@tutien2d/core-client';
import type { RunnerHandle, RunnerHandleLog } from './runner-handle.js';
import type { WalkRequest } from '../headless/walk-navigator.js';

export interface RunnerHandleContractFixture {
  handle: RunnerHandle;
  setDown(value: boolean): void;
  emitDisconnect(): void;
  emitSession(session: AuthSession): void;
  emitLog(event: RunnerHandleLog): void;
  sessionCount(): number;
  isSocketClosed(): boolean;
  waitReady(): Promise<void>;
  /** Pins the underlying snapshot source so the copy contract tests cached() itself. */
  pinSnapshotReference?(): void;
  pinInventoryReference?(): void;
  /** Test-only emergency cleanup for mutants that break the public stop boundary. */
  forceStop?(): Promise<void>;
}

export type CreateRunnerHandleContractFixture = () => RunnerHandleContractFixture | Promise<RunnerHandleContractFixture>;

const timeout = { timeout: 5_000 };
const walkRequest: WalkRequest = { target: { x: 270, y: 220 }, requester: 'runner-handle-contract', timeoutMs: 60_000 };
const session = { accessToken: 'fixture', refreshToken: 'fixture', expiresAt: 1, ttlMs: 1, email: 'fixture@example.invalid' } as AuthSession;
const log: RunnerHandleLog = { code: 'contract_fixture', at: 1 };

/** Shared behavioral contract for fake, in-process, and future remote handles. */
export function registerRunnerHandleContract(name: string, create: CreateRunnerHandleContractFixture): void {
  test(`${name}: unknown snapshot values remain null`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    const snapshot = handle.getSnapshot();
    assert.equal(snapshot.value.hp, null);
    assert.equal(snapshot.value.mp, null);
    assert.equal(snapshot.value.mapId, null);
    assert.equal(snapshot.value.khu, null);
    assert.equal(snapshot.value.x, null);
    assert.equal(snapshot.value.y, null);
    assert.equal(snapshot.value.downed, null);
    assert.equal(snapshot.value.character, null);
  });

  test(`${name}: stop reaches stopped and is idempotent`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    await handle.start();
    await handle.stop();
    await handle.stop();
    assert.equal(handle.getLifecycle(), 'stopped');
    assert.equal(fixture.isSocketClosed(), true);
  });

  test(`${name}: repeated start retains one session`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    await handle.start();
    const sessions = fixture.sessionCount();
    await handle.start();
    assert.equal(fixture.sessionCount(), sessions);
  });

  test(`${name}: cancelWalk only cancels the matching operation id`, timeout, async (t) => {
    const fixture = await create(); const { handle, waitReady } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    await handle.start(); await waitReady();
    const operation = await handle.walkTo(walkRequest);
    assert.equal(await handle.cancelWalk(`${operation.operationId}-wrong`), false);
    assert.equal(handle.getSnapshot().value.moveTo?.status, 'accepted');
    assert.equal(await handle.cancelWalk(operation.operationId), true);
    assert.equal(handle.getSnapshot().value.moveTo?.status, 'cancelled');
  });

  test(`${name}: down state rejects walk and Auto with stable codes`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    await handle.start(); await fixture.waitReady(); fixture.setDown(true);
    await assert.rejects(handle.walkTo(walkRequest), (error: unknown) => errorCode(error) === 'CHARACTER_DOWN');
    await assert.rejects(handle.startAuto(), /VENDOR_CHARACTER_DOWN/);
  });

  test(`${name}: synchronous reads are safe before start`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    assert.doesNotThrow(() => {
      handle.getSnapshot(); handle.getFrameMetrics(); handle.getReachableMaps(); handle.getKhuProbe(); handle.getDailySnapshot();
    });
    assert.equal((await handle.getInventory()).known, false);
  });

  test(`${name}: returned data survives a plain JSON round trip`, timeout, async (t) => {
    const fixture = await create(); const { handle, waitReady } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    const values: unknown[] = [handle.getSnapshot().value, handle.getFrameMetrics().value, handle.getReachableMaps().value,
      handle.getKhuProbe().value, handle.getDailySnapshot().value, await handle.getInventory()];
    await handle.start(); await waitReady();
    const walk = await handle.walkTo(walkRequest);
    values.push(await handle.startAuto(), await handle.stopAuto(), await handle.getKhuInfo(), await handle.requestKhuList(),
      await handle.changeKhu(2), walk, await handle.cancelWalk(walk.operationId),
      await handle.questProbe('status', {}), await handle.khuProbe('xem'));
    const checkin = await handle.startDailyCheckin(); values.push(checkin, await handle.cancelDaily(checkin.operationId));
    for (const value of values) assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
    const snapshot = handle.getSnapshot().value;
    const character = snapshot.character;
    assert.deepEqual(JSON.parse(JSON.stringify(character)), character);
    if (character) {
      for (const value of [character.stones, character.stonesToday, character.stonesCap]) assert.ok(value === null || (Number.isFinite(value) && value >= 0));
      assert.ok(character.stonesSessionNet === null || Number.isFinite(character.stonesSessionNet));
      const originalSp = character.sp;
      character.sp = 99;
      assert.equal(handle.getSnapshot().value.character?.sp, originalSp);
    }
  });

  test(`${name}: event subscriptions forward and unsubscribe`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    let disconnects = 0; let sessions = 0;
    const offDisconnect = handle.onDisconnect(() => disconnects++);
    const offSession = handle.onSessionUpdated(() => sessions++);
    await handle.start();
    fixture.emitSession(session); fixture.emitDisconnect();
    assert.equal(sessions, 1); assert.equal(disconnects, 1);
    offDisconnect(); offSession(); fixture.emitSession(session); fixture.emitDisconnect();
    assert.equal(sessions, 1); assert.equal(disconnects, 1);
  });

  test(`${name}: onLog forwards and unsubscribe stops delivery`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    let calls = 0;
    const off = handle.onLog((event) => { assert.deepEqual(event, log); calls++; });
    fixture.emitLog(log);
    assert.equal(calls, 1);
    off(); fixture.emitLog(log);
    assert.equal(calls, 1);
  });

  test(`${name}: a returned snapshot is a copy`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    fixture.pinSnapshotReference?.();
    const first = handle.getSnapshot();
    (first.value as { connection: string }).connection = 'MUTATED_BY_READER';
    const originalSp = first.value.character?.sp;
    if (first.value.character) first.value.character.sp = 99;
    const second = handle.getSnapshot();
    assert.notEqual(second.value.connection, 'MUTATED_BY_READER');
    if (originalSp !== undefined) assert.equal(second.value.character?.sp, originalSp);
  });

  test(`${name}: fresh cached reads are not stale`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    for (const cached of [handle.getSnapshot(), handle.getFrameMetrics(), handle.getReachableMaps(), handle.getKhuProbe(), handle.getDailySnapshot()]) {
      assert.equal(cached.stale, false);
      assert.equal(cached.ageMs, 0);
    }
  });

  test(`${name}: inventory results are returned as copies`, timeout, async (t) => {
    const fixture = await create(); const { handle } = fixture;
    t.after(async () => { try { await handle.stop(); } finally { await fixture.forceStop?.(); } });
    fixture.pinInventoryReference?.();
    const first = await handle.getInventory();
    (first.items as Array<{ id: string; name: string; count: number; openable: boolean }>).push({ id: 'mutated', name: 'mutated', count: 1, openable: false });
    const second = await handle.getInventory();
    assert.equal(second.items.some((item) => item.id === 'mutated'), false);
  });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error ? error.message : undefined;
}
