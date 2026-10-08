import assert from 'node:assert/strict';
import {
  resetApproachRunnerStateForTests,
  runApproach,
  type ApproachRunnerDependencies,
  type ApproachSnapshot,
} from './approach-runner.js';

const baseSnapshot = (): MutableSnapshot => ({
  inGame: true,
  mapContextIsCurrent: true,
  mapId: 'fixture',
  khu: 1,
  position: { x: 0, y: 0 },
  downed: false,
  moveToStatus: null,
  moveToOperationId: null,
  navigationActive: false,
  botRunning: true,
  vitals: { status: 'fresh', observedAt: 0, hp: 100 },
  monsters: [{ id: 'target', x: 100, y: 0, hp: 100, hm: 100, t: 'sau_truc', d: 0 }],
  monstersFresh: true,
  monstersObservedAt: 0,
});

type MutableSnapshot = { -readonly [Key in keyof ApproachSnapshot]: ApproachSnapshot[Key] };

let accountSequence = 0;

function makeDeps(
  snapshot: ApproachSnapshot,
  options: {
    accountId?: string;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
    onHurt?: (listener: () => void) => () => void;
    startMoveTo?: ApproachRunnerDependencies['startMoveTo'];
    cancelMoveTo?: ApproachRunnerDependencies['cancelMoveTo'];
    isConnected?: () => boolean;
  } = {},
): ApproachRunnerDependencies {
  return {
    accountId: options.accountId ?? `account-${accountSequence++}`,
    getSnapshot: () => snapshot,
    isConnected: options.isConnected ?? (() => true),
    startMoveTo: options.startMoveTo ?? (() => ({ operationId: 'move-1' })),
    cancelMoveTo: options.cancelMoveTo ?? (() => {}),
    isWalkablePoint: () => true,
    nearestWalkable: () => ({ x: 0, y: 0 }),
    pathLength: () => 100,
    now: options.now ?? (() => 0),
    wait: options.wait ?? (async () => {}),
    onHurt: options.onHurt,
  };
}

resetApproachRunnerStateForTests();

let time = 0;
const successSnapshot = baseSnapshot();
let successCancelCount = 0;
const success = await runApproach(makeDeps(successSnapshot, {
  accountId: 'success',
  now: () => time,
  wait: async () => {
    time = 100;
    successSnapshot.position = { x: 74, y: 0 };
  },
  startMoveTo: () => ({ operationId: 'success-move' }),
  cancelMoveTo: async () => { successCancelCount += 1; },
}));
assert.equal(success.status, 'arrived');
assert.equal(success.replans, 0);
assert.equal(successCancelCount, 1, 'arrived must cancel the move operation');

const skippedCases: Array<[string, keyof ApproachSnapshot | 'connected', string]> = [
  ['not in game', 'inGame', 'not_in_game'],
  ['stale context', 'mapContextIsCurrent', 'map_context_not_current'],
  ['missing position', 'position', 'position_missing'],
  ['downed', 'downed', 'downed_true'],
  ['move-to', 'moveToStatus', 'move_to_active'],
  ['navigation', 'navigationActive', 'navigation_active'],
  ['stale vitals', 'vitals', 'vitals_stale_or_unknown'],
  ['stale monsters', 'monstersFresh', 'monsters_stale_or_unknown'],
  ['no target', 'monsters', 'no_target'],
  ['bot stopped', 'botRunning', 'bot_stopped'],
];
for (const [name, field, expected] of skippedCases) {
  resetApproachRunnerStateForTests();
  const snapshot = baseSnapshot() as unknown as Record<string, unknown>;
  if (field === 'position') snapshot.position = null;
  else if (field === 'vitals') snapshot.vitals = { status: 'stale', observedAt: 0, hp: 100 };
  else if (field === 'monsters') snapshot.monsters = [];
  else if (field === 'monstersFresh') snapshot.monstersFresh = false;
  else if (field === 'moveToStatus') snapshot.moveToStatus = 'running';
  else snapshot[field as string] = field === 'downed' || field === 'navigationActive' ? true : false;
  const result = await runApproach(makeDeps(snapshot as unknown as ApproachSnapshot, { accountId: `skip-${name}` }));
  assert.equal(result.status, 'skipped', name);
  assert.equal(result.reason, expected, name);
}

resetApproachRunnerStateForTests();
const disconnected = await runApproach(makeDeps(baseSnapshot(), { accountId: 'skip-disconnected', isConnected: () => false }));
assert.equal(disconnected.status, 'skipped');
assert.equal(disconnected.reason, 'disconnected');

resetApproachRunnerStateForTests();
{
  const snapshot = baseSnapshot();
  let started = false;
  let cancelled = 0;
  const result = await runApproach(makeDeps(snapshot, {
    accountId: 'abort-hp',
    wait: async () => { if (started) snapshot.vitals = { ...snapshot.vitals, hp: 99 }; },
    startMoveTo: () => { started = true; return { operationId: 'abort-hp-move' }; },
    cancelMoveTo: async () => { cancelled += 1; },
  }));
  assert.equal(result.status, 'aborted');
  assert.equal(result.reason, 'hp_decreased');
  assert.equal(cancelled, 1);
}

for (const [name, mutate, reason] of [
  ['downed', () => {}, 'downed_true'],
  ['disconnect', () => {}, 'disconnected'],
  ['context', () => {}, 'map_context_not_current'],
  ['stopped', () => {}, 'bot_stopped'],
] as const) {
  resetApproachRunnerStateForTests();
  const snapshot = baseSnapshot();
  let started = false;
  let connected = true;
  let cancelled = 0;
  const result = await runApproach(makeDeps(snapshot, {
    accountId: `abort-${name}`,
    isConnected: () => connected,
    wait: async () => {
      if (started) {
        if (name === 'downed') snapshot.downed = true;
        if (name === 'context') snapshot.mapContextIsCurrent = false;
        if (name === 'stopped') snapshot.botRunning = false;
        if (name === 'disconnect') connected = false;
      }
    },
    startMoveTo: () => { started = true; return { operationId: `move-${name}` }; },
    cancelMoveTo: async () => { cancelled += 1; },
  }));
  assert.equal(result.status, 'aborted');
  assert.equal(result.reason, reason);
  assert.equal(cancelled, 1);
  void mutate;
}

resetApproachRunnerStateForTests();
let hurtListener: (() => void) | null = null;
const hurtSnapshot = baseSnapshot();
let hurtStarted = false;
let hurtCancelled = 0;
const hurt = await runApproach(makeDeps(hurtSnapshot, {
  accountId: 'abort-hurt',
  wait: async () => {
    if (hurtStarted) hurtListener?.();
  },
  startMoveTo: () => { hurtStarted = true; return { operationId: 'hurt-move' }; },
  cancelMoveTo: async () => { hurtCancelled += 1; },
  onHurt: (listener) => { hurtListener = listener; return () => { hurtListener = null; }; },
}));
assert.equal(hurt.status, 'aborted');
assert.equal(hurt.reason, 'hurt_received');
assert.equal(hurtCancelled, 1);
assert.equal(hurtListener, null, 'hurt listener must be removed');

resetApproachRunnerStateForTests();
{
  const snapshot = baseSnapshot();
  let release!: () => void;
  const first = runApproach(makeDeps(snapshot, {
    accountId: 'same-account',
    wait: () => new Promise<void>((resolve) => { release = resolve; }),
  }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const second = await runApproach(makeDeps(snapshot, { accountId: 'same-account' }));
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'approach_in_progress');
  snapshot.position = { x: 74, y: 0 };
  release();
  assert.equal((await first).status, 'arrived');
}

resetApproachRunnerStateForTests();
{
  const snapshot = baseSnapshot();
  let listenerRemoved = false;
  let cancelled = 0;
  await assert.rejects(() => runApproach(makeDeps(snapshot, {
    accountId: 'runner-error',
    wait: async () => { throw new Error('fixture wait failed'); },
    cancelMoveTo: async () => { cancelled += 1; },
    onHurt: () => () => { listenerRemoved = true; },
  })), /fixture wait failed/);
  assert.equal(cancelled, 1);
  assert.equal(listenerRemoved, true, 'listener must be removed when the runner errors');
}

console.log('approach-runner tests passed (guards, abort cancellation, one-run lock, cleanup)');
