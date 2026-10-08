import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTrainingState, resolveLiveness, stepTraining } from '../../dist/training/state-machine.js';
import { BotController } from '../../dist/bot-controller.js';

const config = { enabled: true, monsterType: '', mapId: 'm1', khu: 2, area: { x: 100, y: 100, radius: 20 }, attackIntervalMs: 500, snapshotMaxAgeMs: 5000, canSelectKhu: false, canRespawn: false };
const snap = (extra = {}) => {
  const dead = extra.dead === true;
  return { observedAt: 1000, mapId: 'm1', khu: 2, x: 100, y: 100, hp: dead ? 0 : 100, maxHp: 100,
    vitalStatus: 'fresh', vitalObservedAt: 1000, vitalReason: undefined, dead, selfPresence: null, monsters: [], ...extra };
};

assert.equal(resolveLiveness({ vitals: { hp: 0, status: 'fresh', observedAt: 1000 }, selfPresence: null, now: 1000, maxAgeMs: 10_000 }), 'dead');
assert.equal(resolveLiveness({ vitals: { hp: null, status: 'unknown', observedAt: null }, selfPresence: { hpPercent: 0, observedAt: 1000 }, now: 1000, maxAgeMs: 10_000 }), 'unknown');
assert.equal(resolveLiveness({ vitals: { hp: null, status: 'unknown', observedAt: null }, selfPresence: { hpPercent: 80, observedAt: 1000 }, now: 1000, maxAgeMs: 10_000 }), 'alive');
assert.equal(resolveLiveness({ vitals: { hp: null, status: 'unknown', observedAt: null }, selfPresence: { hpPercent: 80, observedAt: 1000 }, derivedMaxComplete: false, now: 1000, maxAgeMs: 10_000 }), 'unknown');
assert.equal(resolveLiveness({ vitals: { hp: 0, status: 'fresh', observedAt: 0 }, selfPresence: { hpPercent: 0, observedAt: 0 }, now: 10_001, maxAgeMs: 10_000 }), 'unknown');

// Unknown liveness can navigate but cannot attack or become a dead-state.
const liveMob = [{ id: 'mob', x: 101, y: 100, alive: true }];
for (const vitalStatus of ['unknown', 'stale', 'invalid', 'conflict']) {
  for (const x of [100, 0]) {
    const guarded = stepTraining(createTrainingState(`guard-${vitalStatus}-${x}`), {
      now: 1000, config, snapshot: snap({ vitalStatus, hp: 0, x, monsters: liveMob }),
    });
    assert.equal(guarded.action?.type, x === 0 ? 'MOVE_TO_AREA' : undefined, `${vitalStatus} vitals may move but do not attack`);
    assert.notEqual(guarded.state.phase, 'BLOCKED');
  }
}
const unknownMove = stepTraining(createTrainingState('unknown-move'), {
  now: 1000, config, snapshot: snap({ vitalStatus: 'unknown', hp: undefined, maxHp: undefined, vitalObservedAt: null, x: 0 }),
});
assert.equal(unknownMove.action?.type, 'MOVE_TO_AREA', 'unknown vitals still allow navigation into the training area');
const zeroStateMove = stepTraining(createTrainingState('zero-state-move'), {
  now: 1000, config, snapshot: snap({ hp: 0, x: 0 }),
});
assert.equal(zeroStateMove.action?.type, 'MOVE_TO_AREA', 'state hp=0 alone does not block movement');
const unknownAttack = stepTraining(createTrainingState('unknown-attack'), {
  now: 1000, config, snapshot: snap({ vitalStatus: 'unknown', hp: undefined, maxHp: undefined, vitalObservedAt: null, monsters: liveMob }),
});
assert.equal(unknownAttack.action, undefined, 'unknown vitals never authorize attack');
assert.equal(unknownAttack.reason, 'VITALS_UNKNOWN');
const staleAttack = stepTraining(createTrainingState('stale-attack'), {
  now: 31_000, config,
  snapshot: snap({ observedAt: 31_000, vitalObservedAt: 0, vitalsAgeMs: 30_001, vitalsKnown: true, monsters: liveMob }),
});
assert.equal(staleAttack.action, undefined, 'stale vitals never authorize attack');
assert.equal(staleAttack.reason, 'VITALS_STALE');
assert.equal(staleAttack.state.phase, 'TRAINING', 'stale vitals only block attack, not training state');
const staleMove = stepTraining(createTrainingState('stale-move'), {
  now: 31_000, config,
  snapshot: snap({ observedAt: 31_000, vitalObservedAt: 0, vitalsAgeMs: 30_001, vitalsKnown: true, x: 0, monsters: liveMob }),
});
assert.equal(staleMove.action?.type, 'MOVE_TO_AREA', 'stale vitals still allow movement');

// The controller-owned async hook is attempted once, then rate-gated; a
// skipped refresh leaves only the attack blocker and does not stop training.
{
  const refreshClient = new EventEmitter();
  refreshClient.state = {
    worldUpdatedAt: Date.now(), mapKnown: true, mapId: 'm1', khuKnown: true, khu: 2,
    positionKnown: true, x: 100, y: 100, selfPresence: null, downed: false,
    vitals: { hp: 100, maxHp: null, mp: null, maxMp: null, status: 'fresh', source: 'state', observedAt: 0 },
    derivedMax: { complete: true }, enemies: [{ id: 'mob', x: 101, y: 100, hp: 100 }],
  };
  const refreshController = new BotController('refresh-hook', refreshClient, {
    autoTraining: true, farmMapId: 'm1', farmKhu: 2, farmX: 100, farmY: 100, trainingRadius: 20,
  });
  let refreshRequests = 0;
  refreshController.setVitalsRefreshRequester(async () => {
    refreshRequests += 1;
    return { status: 'skipped' };
  });
  Object.assign(refreshController, {
    isRunning: true, runGeneration: 1,
    trainingState: { phase: 'TRAINING', sessionId: 'refresh-session', sequence: 0 },
  });
  await refreshController.runTrainingTick(1);
  assert.equal(refreshRequests, 1);
  assert.equal(refreshController.getTrainingState().reason, 'VITALS_STALE');
  assert.equal(refreshController.getTrainingState().phase, 'TRAINING');
  refreshClient.state.worldUpdatedAt = Date.now();
  await refreshController.runTrainingTick(1);
  assert.equal(refreshRequests, 1, 'refresh hook is limited to once per interval');
}
const percentOnly = stepTraining(createTrainingState('percent-zero'), { now: 1000, config,
  snapshot: snap({ vitalStatus: 'unknown', hp: undefined, maxHp: undefined, vitalObservedAt: null, selfPresence: { hpPercent: 0, observedAt: 1000 }, monsters: liveMob }) });
assert.equal(percentOnly.action, undefined, 'zero percent cannot prove death or authorize attack');
assert.equal(percentOnly.state.phase, 'TRAINING');
let guardedState = createTrainingState('fresh-full-hp');
let guardedDecision = stepTraining(guardedState, { now: 1000, config, snapshot: snap({ hp: 100, monsters: liveMob }) });
assert.equal(guardedDecision.action?.type, 'ATTACK', 'fresh full HP remains trainable');
guardedState = { ...createTrainingState('fresh-dead'), phase: 'TRAINING' };
guardedDecision = stepTraining(guardedState, { now: 1000, config, snapshot: snap({ hp: 0, monsters: liveMob }) });
assert.equal(guardedDecision.action, undefined, 'state hp=0 does not authorize attack');
assert.equal(guardedDecision.reason, 'VITALS_UNKNOWN', 'state hp=0 alone is not authoritative downed evidence');
guardedState = { ...createTrainingState('vitals-recovery'), phase: 'RECOVERING', resumePhase: 'TRAINING' };
guardedDecision = stepTraining(guardedState, { now: 1000, config, snapshot: snap({ hp: 100, monsters: liveMob }) });
assert.equal(guardedDecision.action?.type, 'ATTACK', 'fresh vitals recover safely into training');
assert.equal(guardedDecision.state.phase, 'TRAINING');
guardedDecision = stepTraining(createTrainingState('reject-unverified-dead-flag'), { now: 1000, config,
  snapshot: snap({ hp: 100, dead: true, monsters: liveMob }) });
assert.equal(guardedDecision.action?.type, 'ATTACK', 'unverified legacy dead boolean cannot override fresh HP');

const configController = new BotController('monster-config-test', new EventEmitter(), { trainingMonsterType: '   ' });
assert.equal(configController.getConfig().trainingMonsterType, '', 'whitespace-only constructor value normalizes to no filter');
configController.updateConfig({ trainingMonsterType: '  Slime  ' });
assert.equal(configController.getConfig().trainingMonsterType, 'Slime', 'constructor update trims selected monster type');
configController.updateConfig({ trainingMonsterType: undefined });
assert.equal(configController.getConfig().trainingMonsterType, '', 'undefined restores the empty filter');

const makeMovementController = (id) => {
  const client = new EventEmitter();
  client.isConnected = () => true;
  client.disconnect = () => {};
  const controller = new BotController(id, client, { autoTraining: true });
  Object.assign(controller, { isRunning: true, runGeneration: 1 });
  const machine = createTrainingState(`${id}:session`);
  const action = { type: 'MOVE_TO_AREA', operationId: `${id}:session:1`, x: 200, y: 220 };
  Object.assign(controller, { trainingState: { ...machine, phase: 'MOVING_TO_AREA', sequence: 1, pending: action } });
  return { controller, action };
};

// MOVE_TO_AREA is delegated with a cancellation predicate; transport acceptance
// is recorded only after the authoritative server executor resolves successfully.
{
  const { controller, action } = makeMovementController('movement-delegate');
  let finishMove;
  let delegated;
  controller.setTrainingMovementExecutor((request) => {
    delegated = request;
    return new Promise((resolve) => { finishMove = resolve; });
  });
  const running = controller.executeTrainingAction(action, 1, 'movement-delegate:session');
  await Promise.resolve();
  assert.equal(delegated.operationId, action.operationId);
  assert.equal(delegated.mapId, 'tan_vien');
  assert.equal(delegated.khu, 1);
  assert.equal(delegated.x, action.x);
  assert.equal(delegated.y, action.y);
  assert.equal(delegated.arrivalRadius, 16);
  assert.equal(delegated.shouldContinue(), true);
  assert.equal(controller.trainingActionResult, undefined, 'no success before executor confirmation');
  finishMove(true);
  await running;
  assert.deepEqual(controller.trainingActionResult, { operationId: action.operationId, ok: true, error: undefined });
}

// A conflict from the shared server movement owner fails the training action safely.
{
  const { controller, action } = makeMovementController('movement-conflict');
  controller.setTrainingMovementExecutor(async () => { throw new Error('operation_in_progress'); });
  await controller.executeTrainingAction(action, 1, 'movement-conflict:session');
  assert.deepEqual(controller.trainingActionResult, { operationId: action.operationId, ok: false, error: 'operation_in_progress' });
}

// Stopping the bot invalidates the delegate predicate; a late completion cannot
// report a successful action into the stopped training session.
{
  const { controller, action } = makeMovementController('movement-cancel');
  let delegated;
  let finishMove;
  controller.setTrainingMovementExecutor((request) => {
    delegated = request;
    return new Promise((resolve) => { finishMove = resolve; });
  });
  const running = controller.executeTrainingAction(action, 1, 'movement-cancel:session');
  await Promise.resolve();
  controller.stop();
  assert.equal(delegated.shouldContinue(), false);
  finishMove(false);
  await running;
  assert.equal(controller.trainingActionResult, undefined, 'late cancelled result is ignored');
}

let state = createTrainingState('run-a');
let d = stepTraining(state, { now: 1000, config, snapshot: snap({ monsters: [{ id: 'near', x: 101, y: 100, alive: true }, { id: 'outside', x: 500, y: 500, alive: true }] }) });
assert.equal(d.action?.type, 'ATTACK');
assert.equal(d.action?.targetId, 'near');
assert.equal(d.action?.operationId, 'run-a:1');

// Empty filter remains backward compatible; exact name and ID matches are deterministic.
state = createTrainingState('filter-name');
d = stepTraining(state, { now: 1000, config: { ...config, monsterType: 'Slime' }, snapshot: snap({ monsters: [
  { id: 'other', name: 'Other', x: 100, y: 100, alive: true },
  { id: 'named', name: 'Slime', x: 101, y: 100, alive: true },
] }) });
assert.equal(d.action?.targetId, 'named');
d = stepTraining(createTrainingState('filter-id'), { now: 1000, config: { ...config, monsterType: 'wanted-id' }, snapshot: snap({ monsters: [
  { id: 'wanted-id', name: 'Different', x: 101, y: 100, alive: true },
] }) });
assert.equal(d.action?.targetId, 'wanted-id');
d = stepTraining(createTrainingState('filter-no-match'), { now: 1000, config: { ...config, monsterType: 'Slime' }, snapshot: snap({ monsters: [
  { id: 'no-match', name: 'slime', x: 100, y: 100, alive: true },
] }) });
assert.equal(d.action, undefined, 'non-matching monster is never attacked');
assert.equal(d.state.phase, 'TRAINING');
state = d.state;
d = stepTraining(state, { now: 1100, config, snapshot: snap({ observedAt: 1100 }) });
assert.equal(d.action, undefined, 'pending mutation is never emitted twice');

d = stepTraining(createTrainingState('run-b'), { now: 10000, config, snapshot: snap({ observedAt: 900 }) });
assert.equal(d.state.phase, 'RECOVERING');
d = stepTraining(createTrainingState('run-c'), { now: 1000, config, snapshot: snap({ khu: 1 }) });
assert.equal(d.state.phase, 'BLOCKED');
assert.equal(d.reason, 'KHU_PROTOCOL_UNAVAILABLE');
d = stepTraining(createTrainingState('run-d'), { now: 1000, config, snapshot: snap({ dead: true }) });
assert.equal(d.state.phase, 'BLOCKED');
assert.equal(d.reason, 'RESPAWN_PROTOCOL_UNAVAILABLE');

// Successful transport acknowledgement is not state confirmation: map must match.
state = createTrainingState('map-wrong');
d = stepTraining(state, { now: 1000, config, snapshot: snap({ mapId: 'old' }) });
assert.equal(d.action?.type, 'ENTER_MAP');
state = d.state;
d = stepTraining(state, { now: 1100, config, snapshot: snap({ observedAt: 1100, mapId: 'old' }), actionResult: { operationId: state.pending.operationId, ok: true } });
assert.equal(d.state.phase, 'BLOCKED');
assert.equal(d.reason, 'ENTER_MAP_NOT_CONFIRMED');

// khu capability gate and post-ACK khu verification.
const khuConfig = { ...config, canSelectKhu: true };
state = createTrainingState('khu-wrong');
d = stepTraining(state, { now: 1000, config: khuConfig, snapshot: snap({ khu: 1 }) });
assert.equal(d.action?.type, 'SELECT_KHU');
state = d.state;
d = stepTraining(state, { now: 1100, config: khuConfig, snapshot: snap({ observedAt: 1100, khu: 1 }), actionResult: { operationId: state.pending.operationId, ok: true } });
assert.equal(d.reason, 'SELECT_KHU_NOT_CONFIRMED');

// A MOVE ACK with position outside the configured area blocks instead of reissuing.
state = createTrainingState('move-wrong');
d = stepTraining(state, { now: 1000, config, snapshot: snap({ x: 0, y: 0 }) });
assert.equal(d.action?.type, 'MOVE_TO_AREA');
state = d.state;
d = stepTraining(state, { now: 1100, config, snapshot: snap({ observedAt: 1100, x: 0, y: 0 }), actionResult: { operationId: state.pending.operationId, ok: true } });
assert.equal(d.reason, 'MOVE_TO_AREA_NOT_CONFIRMED');

// Death preempts an attack intent and never emits respawn, even if legacy config enables it.
const respawnConfig = { ...config, canRespawn: true };
state = createTrainingState('death-preempts');
d = stepTraining(state, { now: 1000, config: respawnConfig, snapshot: snap({ monsters: [{ id: 'mob', x: 101, y: 100, alive: true }] }) });
assert.equal(d.action?.type, 'ATTACK');
state = d.state;
d = stepTraining(state, { now: 1100, config: respawnConfig, snapshot: snap({ observedAt: 1100, dead: true }) });
assert.equal(d.action, undefined);
assert.notEqual(d.action?.type, 'RESPAWN');
assert.equal(d.state.phase, 'BLOCKED');
assert.equal(d.state.pending, undefined);
assert.equal(d.state.reason, 'RESPAWN_PROTOCOL_UNAVAILABLE');
assert.equal(d.reason, 'RESPAWN_PROTOCOL_UNAVAILABLE');

// A previous failed/completed navigation intent must not poison a fresh recovery cycle.
state = { ...createTrainingState('recovery'), phase: 'RECOVERING', resumePhase: 'MOVING_TO_AREA', lastCompletedAction: 'MOVE_TO_AREA' };
d = stepTraining(state, { now: 1000, config, snapshot: snap({ x: 0, y: 0 }) });
assert.equal(d.action?.type, 'MOVE_TO_AREA');

// Invalid booleans, timestamps, and monster coordinates are rejected as malformed input.
d = stepTraining(createTrainingState('bad-config'), { now: 1000, config: { ...config, canRespawn: 'false' }, snapshot: snap() });
assert.equal(d.reason, 'INVALID_BOOLEAN_CONFIG');
d = stepTraining(createTrainingState('bad-monster-type'), { now: 1000, config: { ...config, monsterType: 42 }, snapshot: snap() });
assert.equal(d.reason, 'INVALID_MONSTER_TYPE');
d = stepTraining(createTrainingState('bad-monster-type-length'), { now: 1000, config: { ...config, monsterType: ' '.repeat(129) }, snapshot: snap() });
assert.equal(d.reason, 'INVALID_MONSTER_TYPE');
d = stepTraining(createTrainingState('bad-snapshot'), { now: 1000, config, snapshot: snap({ observedAt: Number.NaN }) });
assert.equal(d.reason, 'STALE_OR_MISSING_SNAPSHOT');
d = stepTraining(createTrainingState('bad-monster'), { now: 1000, config, snapshot: snap({ monsters: [{ id: 'bad', x: Number.NaN, y: 1, alive: true }] }) });
assert.equal(d.reason, 'MALFORMED_MONSTER');
d = stepTraining(createTrainingState('bad-monster-name-type'), { now: 1000, config, snapshot: snap({ monsters: [{ id: 'x', name: 7, x: 1, y: 1, alive: true }] }) });
assert.equal(d.reason, 'MALFORMED_MONSTER');
d = stepTraining(createTrainingState('bad-monster-name-length'), { now: 1000, config, snapshot: snap({ monsters: [{ id: 'x', name: 'n'.repeat(129), x: 1, y: 1, alive: true }] }) });
assert.equal(d.reason, 'MALFORMED_MONSTER');
d = stepTraining(createTrainingState('bad-monster-name-whitespace-length'), { now: 1000, config, snapshot: snap({ monsters: [{ id: 'x', name: ' '.repeat(129), x: 1, y: 1, alive: true }] }) });
assert.equal(d.reason, 'MALFORMED_MONSTER');

console.log('training state-machine tests passed');
