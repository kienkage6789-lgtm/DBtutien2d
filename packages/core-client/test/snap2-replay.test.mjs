import test from 'node:test';
import assert from 'node:assert/strict';
import { Snap2Reducer } from '../dist/state/snap2-reducer.js';

test('replays full and delta, rejects gaps/stale data, and requires a new full after map reset', () => {
  const reducer = new Snap2Reducer();
  const context = { mapId: 'tan_vien', khu: 1, contextEpoch: 1, mapEpoch: 7 };
  const full = reducer.apply({ op: 'snap2', full: true, sq: -1, ep: 7,
    pf: [{ id: 'p1', x: 10, y: 20, title: 'old' }],
    ef: [{ id: 'm1', x: 30, y: 40, hp: 8 }],
  }, context, 100);
  assert.equal(full.ok, true);
  assert.deepEqual(full.snapshot.players, [{ id: 'p1', x: 10, y: 20, title: 'old' }]);

  const delta = reducer.apply({ op: 'snap2', sq: 0, ep: 7,
    pf: [{ id: 'p2', x: 12, y: 22 }], gp: ['p1'], p: [],
    ef: [{ id: 'm2', x: 50, y: 60 }], ge: ['m1'], e: [{ id: 'm2', hp: 3 }],
  }, context, 120);
  assert.equal(delta.ok, true);
  assert.deepEqual(delta.snapshot.players, [{ id: 'p2', x: 12, y: 22 }]);
  assert.deepEqual(delta.snapshot.monsters, [{ id: 'm2', x: 50, y: 60, hp: 3 }]);
  assert.equal(reducer.apply({ op: 'snap2', sq: 0, ep: 7 }, context, 121).reason, 'stale');

  assert.equal(reducer.apply({ op: 'snap2', sq: 2, ep: 7 }, context, 130).reason, 'gap');
  assert.equal(reducer.apply({ op: 'snap2', sq: 3, ep: 7 }, context, 140).reason, 'needs_full');
  const recoveredFull = reducer.apply({ op: 'snap2', full: true, sq: 1, ep: 7,
    ef: [{ id: 'recovered-mob', x: 70, y: 80 }],
  }, context, 145);
  assert.equal(recoveredFull.ok, true);
  assert.deepEqual(recoveredFull.snapshot.monsters, [{ id: 'recovered-mob', x: 70, y: 80 }]);
  assert.equal(reducer.apply({ op: 'snap2', full: true, sq: 2, ep: 8, e: [] }, context, 150).reason, 'context');

  const nextMap = { ...context, mapId: 'duoc_vien', contextEpoch: 2, mapEpoch: 8 };
  assert.equal(reducer.apply({ op: 'snap2', sq: 15, ep: 8 }, nextMap, 160).reason, 'needs_full');
  const resetFull = reducer.apply({ op: 'snap2', full: '1', sq: 1, ep: 8,
    pf: [], ef: [{ id: 'new-map-mob', x: 1, y: 2 }],
  }, nextMap, 170);
  assert.equal(resetFull.ok, true);
  assert.deepEqual(resetFull.snapshot.monsters, [{ id: 'new-map-mob', x: 1, y: 2 }]);
});
