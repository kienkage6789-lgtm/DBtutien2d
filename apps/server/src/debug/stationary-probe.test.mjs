import assert from 'node:assert/strict';
import { StationaryProbe, stationaryProbeGuardReason } from '../../dist/debug/stationary-probe.js';

const base = {
  downed: false,
  monsters: [],
  moveToStatus: null,
  navigationPhase: 'idle',
  mapContextIsCurrent: true,
  position: { x: 246, y: 696 },
  dir: 2,
};

assert.equal(stationaryProbeGuardReason({ ...base, downed: true }), 'downed_true');
assert.equal(stationaryProbeGuardReason({ ...base, monsters: [{ x: 246, y: 996 }] }), 'monster_within_300');
assert.equal(stationaryProbeGuardReason({ ...base, moveToStatus: 'running' }), 'move_to_active');
assert.equal(stationaryProbeGuardReason({ ...base, navigationPhase: 'moving_to_portal' }), 'navigation_active');
assert.equal(stationaryProbeGuardReason({ ...base, position: null }), 'position_missing');

let factoryCalls = 0;
let movesSent = 0;
const previousProbeEnv = process.env.TUTIEN_PROBE_STATIONARY;
delete process.env.TUTIEN_PROBE_STATIONARY;
const disabled = new StationaryProbe({ wait: async () => {} });
await disabled.schedule(() => {
  factoryCalls += 1;
  return {};
});
assert.equal(factoryCalls, 0, 'environment-off probe must not create dependencies');
process.env.TUTIEN_PROBE_STATIONARY = 'unexpected';
const disabledUnexpected = new StationaryProbe({ wait: async () => {} });
await disabledUnexpected.schedule(() => {
  factoryCalls += 1;
  return {};
});
assert.equal(factoryCalls, 0, 'only 1 and offset may enable the probe');

if (previousProbeEnv === undefined) delete process.env.TUTIEN_PROBE_STATIONARY;
else process.env.TUTIEN_PROBE_STATIONARY = previousProbeEnv;

const sentStates = [];
const enabled = new StationaryProbe({ enabled: true, wait: async () => {} });
const result = await enabled.schedule(() => ({
  getSnapshot: () => ({ ...base }),
  isConnected: () => true,
  sendMove: async (_x, _y, _dir, st, shouldSend) => {
    assert.equal(shouldSend(), true);
    sentStates.push(st);
    movesSent += 1;
    return true;
  },
  onYou: () => () => {},
}));
assert.equal(result.status, 'completed');
assert.equal(movesSent, 20, 'two stationary batches are the hard upper bound when A has no you');
assert.deepEqual(sentStates, [...Array(10).fill('idle'), ...Array(10).fill('walk')]);

let oneBatchMoves = 0;
let youListener = null;
const oneBatch = new StationaryProbe({ enabled: true, wait: async () => {} });
const oneBatchResult = await oneBatch.schedule(() => ({
  getSnapshot: () => ({ ...base }),
  isConnected: () => true,
  sendMove: async (_x, _y, _dir, _st, shouldSend) => {
    assert.equal(shouldSend(), true);
    oneBatchMoves += 1;
    if (oneBatchMoves === 10) youListener?.({ seq: 10, hp: 225 });
    return true;
  },
  onYou: (listener) => {
    youListener = listener;
    return () => { youListener = null; };
  },
}));
assert.equal(oneBatchResult.status, 'completed');
assert.equal(oneBatchResult.batches.length, 1, 'B must not run after A received you');
assert.equal(oneBatchResult.batches[0].youCount, 1);

const offsetStates = [];
const offsetEnds = [];
let offsetMoves = 0;
let offsetPostMoveWaits = 0;
let offsetYouListener = null;
process.env.TUTIEN_PROBE_STATIONARY = 'offset';
const offset = new StationaryProbe({ wait: async (ms) => {
  if (ms === 3_000) {
    offsetPostMoveWaits += 1;
    if (offsetPostMoveWaits === 1) offsetYouListener?.({ seq: 4, hp: 225, mp: 188, sp: 78, bp: 115, dn: 0, fix: 0 });
  }
} });
const offsetResult = await offset.schedule(() => ({
  getSnapshot: () => ({ ...base }),
  isConnected: () => true,
  sendMove: async (_x, _y, _dir, st, shouldSend) => {
    assert.equal(shouldSend(), true);
    offsetStates.push(st);
    offsetMoves += 1;
    return true;
  },
  onYou: (listener) => {
    offsetYouListener = listener;
    return () => { offsetYouListener = null; };
  },
  recordBatchEnd: (input) => offsetEnds.push(input),
}));
assert.equal(offsetResult.status, 'completed');
assert.equal(offsetMoves, 14, 'offset probe must send exactly 4 + 10 moves');
assert.deepEqual(offsetStates, Array(14).fill('idle'));
assert.deepEqual(offsetResult.batches.map((batch) => batch.label), ['offset-0', 'offset-1']);
assert.deepEqual(offsetResult.batches.map((batch) => batch.movesSent), [4, 10]);
assert.equal(offsetResult.batches[0].youCount, 1, 'a you during the first rest is recorded, not retried');
assert.equal(offsetEnds[0].youDuringPostMoveWait, 1);

let cancelled = false;
let cancelledMoves = 0;
let cancelledPostMoveWaits = 0;
const cancelledOffset = new StationaryProbe({ mode: 'offset', wait: async (ms) => {
  if (ms === 3_000 && cancelledPostMoveWaits++ === 0) cancelled = true;
} });
const cancelledResult = await cancelledOffset.schedule(() => ({
  getSnapshot: () => ({ ...base, downed: cancelled }),
  isConnected: () => true,
  sendMove: async (_x, _y, _dir, _st, shouldSend) => {
    assert.equal(shouldSend(), true);
    cancelledMoves += 1;
    return true;
  },
  onYou: () => () => {},
}));
assert.equal(cancelledResult.status, 'cancelled');
assert.equal(cancelledResult.reason, 'downed_true');
assert.equal(cancelledResult.batches.length, 1, 'guard cancellation must prevent the second offset batch');
assert.equal(cancelledMoves, 4);

process.env.TUTIEN_PROBE_STATIONARY = '1';
const legacyByEnv = new StationaryProbe({ wait: async () => {} });
let legacyEnvMoves = 0;
const legacyEnvStates = [];
const legacyEnvResult = await legacyByEnv.schedule(() => ({
  getSnapshot: () => ({ ...base }),
  isConnected: () => true,
  sendMove: async (_x, _y, _dir, st, shouldSend) => {
    assert.equal(shouldSend(), true);
    legacyEnvMoves += 1;
    legacyEnvStates.push(st);
    return true;
  },
  onYou: () => () => {},
}));
assert.equal(legacyEnvResult.status, 'completed');
assert.equal(legacyEnvMoves, 20, 'env 1 must keep the legacy 10 + 10 behavior');
assert.deepEqual(legacyEnvStates, [...Array(10).fill('idle'), ...Array(10).fill('walk')]);

if (previousProbeEnv === undefined) delete process.env.TUTIEN_PROBE_STATIONARY;
else process.env.TUTIEN_PROBE_STATIONARY = previousProbeEnv;

console.log('server stationary-probe tests passed');
