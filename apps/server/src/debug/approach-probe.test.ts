import assert from 'node:assert/strict';
import {
  APPROACH_PROBE_MAX_DISTANCE_PX,
  APPROACH_PROBE_MIN_DISTANCE_PX,
  APPROACH_PROBE_POLL_MS,
  APPROACH_PROBE_WINDOW_MS,
  ApproachProbe,
  chooseApproachTarget,
  resetApproachProbeStateForTests,
} from './approach-probe.js';
import { ENEMY_DEFS } from '@tutien2d/core-client';
import type { ApproachMonster, Point } from '@tutien2d/automation-engine';
import type { ApproachProbeDependencies } from './approach-probe.js';
import type { ApproachSnapshot } from '../orchestrator/approach-runner.js';

const defs = ENEMY_DEFS as Record<string, (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS]>;
type MutableSnapshot = { -readonly [Key in keyof ApproachSnapshot]: ApproachSnapshot[Key] };

const safeEntry = Object.entries(defs).find(([, def]) => !def.isBoss && !def.human && !def.tuSi
  && typeof def.contactDmg === 'number' && def.contactDmg * 10 < def.hpMax);
if (!safeEntry) throw new Error('fixture must contain one low-contact enemy');
const safeType = safeEntry[0];
const safeDef = safeEntry[1];
const bossType = Object.keys(defs).find((type) => defs[type].isBoss)!;
const humanType = Object.keys(defs).find((type) => defs[type].human)!;
const tuSiType = Object.keys(defs).find((type) => defs[type].tuSi)!;
const highContactType = Object.keys(defs).find((type) => {
  const def = defs[type];
  return !def.isBoss && !def.human && typeof def.contactDmg === 'number' && def.contactDmg * 10 >= def.hpMax;
})!;

const pathDeps = {
  isWalkablePoint: (_mapId: string, _point: Point) => true,
  nearestWalkable: (_mapId: string, x: number, y: number) => ({ x, y }),
  pathLength: () => 100,
};

function makeSnapshot(monsters: ApproachMonster[], overrides: Partial<ApproachSnapshot> = {}): MutableSnapshot {
  return {
    inGame: true,
    mapContextIsCurrent: true,
    mapId: 'fixture',
    khu: 1,
    position: { x: 0, y: 0 },
    downed: false,
    moveToStatus: null,
    navigationActive: false,
    botRunning: true,
    vitals: { status: 'fresh', observedAt: 1_000, hp: 100 },
    monsters,
    monstersFresh: true,
    monstersObservedAt: 1_000,
    ...overrides,
  };
}

function target(id: string, x: number, type = safeType, extra: Partial<ApproachMonster> = {}): ApproachMonster {
  return { id, x, y: 0, t: type, hp: defs[type].hpMax, hm: defs[type].hpMax, d: 0, ...extra };
}

const base = makeSnapshot([target('safe', 200)]);
const chosen = chooseApproachTarget(base, pathDeps, 1_000);
if (!chosen.target) throw new Error(`safe target was rejected: ${chosen.reason}`);
assert.equal(chosen.target.id, 'safe');
assert.equal(chosen.pathLength, 100);

for (const [name, monster] of [
  ['boss', target('boss', 200, bossType)],
  ['human', target('human', 200, humanType)],
  ['tuSi', target('tusi', 200, tuSiType)],
  ['contact damage', target('danger', 200, highContactType)],
] as const) {
  const result = chooseApproachTarget(makeSnapshot([monster]), pathDeps, 1_000);
  assert.equal(result.target, null, `${name} must be blocked`);
}

assert.equal(chooseApproachTarget(makeSnapshot([target('near', APPROACH_PROBE_MIN_DISTANCE_PX - 1)]), pathDeps, 1_000).target, null);
assert.equal(chooseApproachTarget(makeSnapshot([target('far', APPROACH_PROBE_MAX_DISTANCE_PX + 1)]), pathDeps, 1_000).target, null);
assert.equal(chooseApproachTarget(makeSnapshot([target('blocked', 200)]), { ...pathDeps, pathLength: () => null }, 1_000).target, null);
assert.equal(chooseApproachTarget(makeSnapshot([target('long', 200)]), { ...pathDeps, pathLength: () => 481 }, 1_000).target, null);
assert.equal(chooseApproachTarget(makeSnapshot([target('old-vitals', 200)], {
  vitals: { status: 'fresh', observedAt: 0, hp: 100 },
}), pathDeps, 31_001).target, null);
assert.equal(chooseApproachTarget(makeSnapshot([target('move', 200)], { moveToStatus: 'running' }), pathDeps, 1_000).target, null);
assert.equal(chooseApproachTarget(makeSnapshot([target('unknown-hp', 200, safeType, { hp: undefined })]), pathDeps, 1_000).target, null);

const aggroEntry = Object.entries(defs).find(([, def]) => !def.isBoss && !def.human && !def.tuSi
  && typeof def.aggro === 'number' && def.aggro > 0 && typeof def.contactDmg === 'number' && def.contactDmg * 10 < def.hpMax);
if (aggroEntry) {
  const aggroTarget = target('aggro-target', 200, aggroEntry[0]);
  const withoutOther = chooseApproachTarget(makeSnapshot([aggroTarget]), pathDeps, 1_000);
  if (!withoutOther.target) throw new Error(`aggro fixture was rejected: ${withoutOther.reason}`);
  const withOther = chooseApproachTarget(makeSnapshot([
    aggroTarget,
    target('other', withoutOther.goal.x, safeType, { y: withoutOther.goal.y }),
  ]), pathDeps, 1_000);
  assert.equal(withOther.target, null);
  assert.equal(withOther.reason, 'other_monster_in_aggro');
}

resetApproachProbeStateForTests();
const oldEnv = process.env.TUTIEN_PROBE_APPROACH;
delete process.env.TUTIEN_PROBE_APPROACH;
let disabledFactoryCalls = 0;
const disabled = new ApproachProbe({ wait: async () => {} });
assert.equal(await disabled.schedule(() => { disabledFactoryCalls += 1; return {} as ApproachProbeDependencies; }), undefined);
assert.equal(disabledFactoryCalls, 0);
process.env.TUTIEN_PROBE_APPROACH = 'unexpected';
const unexpected = new ApproachProbe({ wait: async () => {} });
assert.equal(await unexpected.schedule(() => { disabledFactoryCalls += 1; return {} as ApproachProbeDependencies; }), undefined);
assert.equal(disabledFactoryCalls, 0);
if (oldEnv === undefined) delete process.env.TUTIEN_PROBE_APPROACH;
else process.env.TUTIEN_PROBE_APPROACH = oldEnv;

resetApproachProbeStateForTests();
process.env.TUTIEN_PROBE_APPROACH = '1';
const unsafeProbe = new ApproachProbe({ wait: async () => {} });
let unsafeCalls = 0;
let unsafeClock = 1_000;
const unsafeResult = await unsafeProbe.schedule(() => ({
  ...pathDeps,
  getSnapshot: () => makeSnapshot([target('boss', 200, bossType)]),
  isConnected: () => true,
  // Đồng hồ giả tiến theo wait: điều kiện không bao giờ an toàn nên hết cửa sổ thì hủy.
  now: () => unsafeClock,
  wait: async (ms: number) => { unsafeClock += ms; },
  startMoveTo: () => { throw new Error('must not move'); },
  cancelMoveTo: () => {},
  recordCancellation: (reason: string) => { unsafeCalls += reason.startsWith('window_expired:') ? 1 : 0; },
}));
assert.equal(unsafeResult?.status, 'cancelled');
assert.ok(unsafeResult?.reason?.startsWith('window_expired:'), 'hết cửa sổ thì hủy với lý do window_expired:<lý do cuối>');
assert.equal(unsafeCalls, 1);
assert.ok(unsafeClock - 1_000 >= APPROACH_PROBE_WINDOW_MS, 'phải chờ hết cửa sổ rồi mới hủy');
assert.equal(await unsafeProbe.schedule(() => { throw new Error('one-shot violated'); }), undefined);
if (oldEnv === undefined) delete process.env.TUTIEN_PROBE_APPROACH;
else process.env.TUTIEN_PROBE_APPROACH = oldEnv;

resetApproachProbeStateForTests();
const liveSnapshot = makeSnapshot([target('live', 200)]);
let moveStarts = 0;
let moveCancels = 0;
let waitsAfterArrival = 0;
const liveWait = async (ms: number): Promise<void> => {
  if (ms === 100) liveSnapshot.position = { x: 174, y: 0 };
  if (ms === 3_000) waitsAfterArrival += 1;
};
const liveProbe = new ApproachProbe({ enabled: true, wait: async () => {} });
const liveResult = await liveProbe.schedule(() => ({
  ...pathDeps,
  getSnapshot: () => liveSnapshot,
  isConnected: () => true,
  now: () => 1_000,
  wait: liveWait,
  startMoveTo: () => { moveStarts += 1; return { operationId: 'live-move' }; },
  cancelMoveTo: async () => { moveCancels += 1; },
}));
assert.equal(liveResult?.status, 'completed');
assert.equal(liveResult?.approach?.status, 'arrived');
assert.equal(moveStarts, 1);
assert.equal(moveCancels, 1);
assert.equal(waitsAfterArrival, 1);

// Điều kiện tạm thời (chưa sang map có quái): chờ rồi chạy khi quái xuất hiện, vẫn chỉ một lần.
resetApproachProbeStateForTests();
{
  let polls = 0;
  const lateSnapshot = makeSnapshot([]);
  let lateClock = 1_000;
  let lateMoves = 0;
  const lateProbe = new ApproachProbe({ enabled: true, wait: async () => {} });
  const lateResult = await lateProbe.schedule(() => ({
    ...pathDeps,
    getSnapshot: () => lateSnapshot,
    isConnected: () => true,
    now: () => lateClock,
    wait: async (ms: number) => {
      lateClock += ms;
      if (ms === APPROACH_PROBE_POLL_MS) {
        polls += 1;
        if (polls === 3) lateSnapshot.monsters = [target('late', 200)];
      }
      if (ms === 100) lateSnapshot.position = { x: 174, y: 0 };
    },
    startMoveTo: () => { lateMoves += 1; return { operationId: 'late-move' }; },
    cancelMoveTo: async () => {},
  }));
  assert.ok(polls >= 3, 'phải thăm dò lại khi chưa có quái');
  assert.equal(lateResult?.status, 'completed');
  assert.equal(lateMoves, 1);
}

// Lý do dứt khoát (gục) hủy ngay, không chờ cửa sổ.
resetApproachProbeStateForTests();
{
  let waited = 0;
  const downedProbe = new ApproachProbe({ enabled: true, wait: async () => {} });
  const downedSnapshot = makeSnapshot([target('d', 200)]);
  downedSnapshot.downed = true;
  const downedResult = await downedProbe.schedule(() => ({
    ...pathDeps,
    getSnapshot: () => downedSnapshot,
    isConnected: () => true,
    now: () => 1_000,
    wait: async () => { waited += 1; },
    startMoveTo: () => { throw new Error('must not move'); },
    cancelMoveTo: () => {},
  }));
  assert.equal(downedResult?.status, 'cancelled');
  assert.equal(downedResult?.reason, 'downed_true');
  assert.equal(waited, 0);
}

console.log(`approach-probe tests passed (guards, one-shot, arrived-without-follow-up; safe type ${safeType})`);
