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

console.log('server stationary-probe tests passed');
