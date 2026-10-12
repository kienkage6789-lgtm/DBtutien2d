import assert from 'node:assert/strict';
import test from 'node:test';
import { getCharacter } from './vendor-runner.js';

const realms = [{ id: 'realm_1', name: 'Cảnh giới 1' }];

test('getCharacter projects HUD numbers and realm name into a JSON-safe fresh snapshot', () => {
  const result = getCharacter({ realmId: 'realm_1', sp: 3, spMax: 10, bp: 7, bpMax: 20, exp: 5, expMax: 100 }, realms, true, 123);
  assert.deepEqual(result, { realmId: 'realm_1', realmName: 'Cảnh giới 1', sp: 3, spMax: 10, bp: 7, bpMax: 20, exp: 5, expMax: 100, stones: null, stonesToday: null, stonesCap: null, stonesSessionNet: null, fresh: true, observedAt: 123 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('getCharacter keeps missing, non-finite, and negative numbers unknown without zero defaults', () => {
  const result = getCharacter({ realmId: 'realm_1', sp: Number.NaN, spMax: Number.POSITIVE_INFINITY, bp: -1, exp: '9' }, realms, true, 123);
  assert.deepEqual(result, { realmId: 'realm_1', realmName: 'Cảnh giới 1', sp: null, spMax: null, bp: null, bpMax: null, exp: null, expMax: null, stones: null, stonesToday: null, stonesCap: null, stonesSessionNet: null, fresh: false, observedAt: null });
});

test('getCharacter retains unknown realm id while leaving realm name null', () => {
  assert.equal(getCharacter({ realmId: 'unknown', sp: 1 }, realms, true, 4)?.realmName, null);
  assert.equal(getCharacter({ realmId: 'unknown', sp: 1 }, realms, true, 4)?.realmId, 'unknown');
});

test('getCharacter bounds and cleans strings and rejects characters outside an active game', () => {
  const result = getCharacter({ realmId: `a\u0000${'x'.repeat(70)}`, sp: 1 }, realms, true, 4);
  assert.equal(result?.realmId, `a${'x'.repeat(63)}`);
  assert.equal(getCharacter({ realmId: 'realm_1', sp: 1 }, realms, false), null);
  assert.equal(getCharacter(null, realms, true), null);
});
