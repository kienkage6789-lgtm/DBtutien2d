import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerPool } from './worker-pool.js';
import type { RunnerHandle } from './runner-handle.js';
import type { VendorRunnerSnapshot } from '../headless/vendor-runner.js';

const makeSnapshot = (): VendorRunnerSnapshot => ({
  lifecycle: 'farming', connection: 'IN_GAME', autoRequested: true, supervisor: {},
  packets: { incoming: {}, outgoing: {}, commands: {}, moves: 4, attacks: 2, skills: 1, cmds: 0 },
  hurtCount: 7, lastHurtAt: 1234, killsBySelf: 1, packetErrors: 0, updateErrors: 0, consoleErrors: [],
  frames: 10, fps: 60, uptimeMs: 1000, memory: { rssBytes: 1, rssGrowthBytes: 0 }, tokenExpiresAt: 9000,
  mapId: 'map-fixture', khu: 2, soKhu: 5, khuList: { mapId: 'map-fixture', khu: 2, soKhu: 5, list: [] },
  x: 12, y: 34, hp: 80, maxHp: 100, mp: 30, maxMp: 40, downed: false, vitalsProbeMoves: 0,
  vitals: { hp: 80, maxHp: 100, mp: 30, maxMp: 40, status: 'client', source: 'client', fresh: true, observedAt: 8000 },
  monsters: [], players: [], monstersContext: { mapId: 'map-fixture', khu: 2, observedAt: 8000, fresh: true },
  playersContext: { mapId: 'map-fixture', khu: 2, observedAt: 8000, fresh: true },
  moveTo: { operationId: 'move-fixture', status: 'accepted' }, daily: { operationId: 'daily-fixture' },
  dailyStatus: { phase: 'running' }, logs: [],
} as unknown as VendorRunnerSnapshot);

function runner(stale: boolean): RunnerHandle {
  return {
    getSnapshot: () => ({ value: makeSnapshot(), ageMs: stale ? 2_000 : 0, stale }),
    getFrameMetrics: () => ({ value: null, ageMs: 0, stale: true }),
  } as unknown as RunnerHandle;
}

function addRunner(pool: WorkerPool, accountId: string, handle: RunnerHandle): void {
  (pool as unknown as { activeVendors: Map<string, RunnerHandle> }).activeVendors.set(accountId, handle);
}

test('WorkerPool runtime clears stale position, vitals, map context, and observed maps', () => {
  const pool = new WorkerPool();
  addRunner(pool, 'stale-runtime-fixture', runner(true));

  const runtime = pool.getRuntimeInfo('stale-runtime-fixture');
  assert.equal(runtime.dataStale, true);
  assert.equal(runtime.activity, 'unknown');
  assert.equal(runtime.connection, 'DISCONNECTED');
  assert.equal(runtime.hurtCount, 7);
  assert.equal(runtime.lastHurtAt, 1234);
  assert.equal(runtime.hp, null); assert.equal(runtime.maxHp, null);
  assert.equal(runtime.mp, null); assert.equal(runtime.maxMp, null);
  assert.equal(runtime.vitalsAgeMs, null);
  assert.deepEqual(runtime.vitals, { hp: null, maxHp: null, mp: null, maxMp: null, status: 'unknown', source: null, observedAt: null });
  assert.equal(runtime.downed, null);
  assert.equal(runtime.mapId, null); assert.equal(runtime.khu, null); assert.equal(runtime.soKhu, null);
  assert.equal(runtime.x, null); assert.equal(runtime.y, null);
  assert.equal(runtime.moveTo, null); assert.equal(runtime.daily, null); assert.equal(runtime.dailyStatus, null);
  assert.equal(runtime.khuList, null);
  assert.deepEqual(runtime.dataStatus, { hp: false, maxHp: false, mp: false, maxMp: false, location: false, monsters: false, players: false });
  assert.deepEqual(runtime.mapContext, { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false });
  assert.equal(runtime.mapContextAgeMs, null); assert.equal(runtime.mapContextIsCurrent, false);
  assert.equal(runtime.vendor, undefined);
  assert.deepEqual(pool.getObservedMaps(), []);
});

test('WorkerPool runtime preserves current snapshot values when not stale', () => {
  const pool = new WorkerPool();
  addRunner(pool, 'fresh-runtime-fixture', runner(false));

  const runtime = pool.getRuntimeInfo('fresh-runtime-fixture');
  assert.equal(runtime.dataStale, false);
  assert.equal(runtime.activity, 'farming');
  assert.equal(runtime.mapId, 'map-fixture'); assert.equal(runtime.khu, 2); assert.equal(runtime.soKhu, 5);
  assert.equal(runtime.x, 12); assert.equal(runtime.y, 34);
  assert.equal(runtime.hp, 80); assert.equal(runtime.maxHp, 100);
  assert.equal(runtime.mp, 30); assert.equal(runtime.maxMp, 40);
  assert.equal(runtime.downed, false);
  assert.deepEqual(runtime.moveTo, { operationId: 'move-fixture', status: 'accepted' });
  assert.deepEqual(runtime.daily, { operationId: 'daily-fixture' });
  assert.deepEqual(runtime.dailyStatus, { phase: 'running' });
  assert.equal(runtime.mapContext.mapId, 'map-fixture');
  assert.equal(runtime.mapContext.khu, 2); assert.equal(runtime.mapContext.soKhu, 5);
  assert.ok(runtime.mapContext.observedAt !== null); assert.equal(runtime.mapContext.fresh, true);
  assert.equal(runtime.mapContextIsCurrent, true);
  assert.equal(runtime.vendor?.mapId, 'map-fixture');
  assert.deepEqual(pool.getObservedMaps().map(({ mapId, soKhu }) => ({ mapId, soKhu })), [{ mapId: 'map-fixture', soKhu: 5 }]);
});
