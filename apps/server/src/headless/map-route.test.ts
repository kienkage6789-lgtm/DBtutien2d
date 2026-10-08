import assert from 'node:assert/strict';
import test from 'node:test';
import { planMapRoute, reachableMaps } from './map-route.js';

const graph = {
  a: [
    { tx: 9, ty: 9, toMapId: 'b' },
    { tx: 1, ty: 1, toMapId: 'b', byHand: true },
    { tx: 2, ty: 2, toMapId: 'ignored', cooldownSec: 10 },
  ],
  b: [{ tx: 4, ty: 4, toMapId: 'c' }],
  c: [{ tx: 0, ty: 0, toMapId: 'a' }],
  ignored: [],
} as const;

test('planMapRoute uses shortest usable portal edges and nearest first gate', () => {
  const route = planMapRoute((mapId) => graph[mapId as keyof typeof graph] ?? [], 'a', 'c', { x: 32, y: 32 });
  assert.deepEqual(route, [
    { fromMapId: 'a', toMapId: 'b', gate: { tx: 9, ty: 9 } },
    { fromMapId: 'b', toMapId: 'c', gate: { tx: 4, ty: 4 } },
  ]);
});

test('reachableMaps includes the origin and excludes byHand/cooldown/dead edges', () => {
  assert.deepEqual(reachableMaps((mapId) => graph[mapId as keyof typeof graph] ?? [], ['a', 'b', 'c', 'ignored'], 'a'), [
    { mapId: 'a', hops: 0, route: ['a'] },
    { mapId: 'b', hops: 1, route: ['a', 'b'] },
    { mapId: 'c', hops: 2, route: ['a', 'b', 'c'] },
  ]);
});

test('planMapRoute reports no route when only non-automatic portals connect maps', () => {
  assert.equal(planMapRoute(() => [{ tx: 1, ty: 1, toMapId: 'b', cooldownGroup: 'gate' }], 'a', 'b'), null);
});
