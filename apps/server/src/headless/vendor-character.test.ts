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

test('lockAlwaysRun forces Input.run true and ignores toggles, blur resets and later assignments', async () => {
  const { lockAlwaysRun } = await import('./vendor-runner.js');
  const input: { run: boolean; toggleRun: () => boolean } = { run: false, toggleRun() { this.run = !this.run; return this.run; } };
  assert.equal(lockAlwaysRun(input), true);
  assert.equal(input.run, true);
  input.toggleRun();
  assert.equal(input.run, true);
  input.run = false;
  assert.equal(input.run, true);
  assert.equal(lockAlwaysRun(input), true, 'idempotent on reconnect');
});

test('lockAlwaysRun reports failure instead of throwing for missing or frozen input', async () => {
  const { lockAlwaysRun } = await import('./vendor-runner.js');
  assert.equal(lockAlwaysRun(undefined), false);
  assert.equal(lockAlwaysRun(null), false);
  assert.equal(lockAlwaysRun(Object.freeze({ run: false })), false);
});

test('parseHaltMode only enables stay for the exact value and defaults to disconnect', async () => {
  const { parseHaltMode } = await import('./auto-supervisor.js');
  assert.equal(parseHaltMode('stay'), 'stay');
  assert.equal(parseHaltMode(' STAY '), 'stay');
  assert.equal(parseHaltMode(undefined), 'disconnect');
  assert.equal(parseHaltMode(''), 'disconnect');
  assert.equal(parseHaltMode('disconnect'), 'disconnect');
  assert.equal(parseHaltMode('stayy'), 'disconnect');
  assert.equal(parseHaltMode(1), 'disconnect');
});

test('shouldHandleSocketClose reconnects after halt only in stay mode and never after a stop request', async () => {
  const { shouldHandleSocketClose } = await import('./vendor-runner.js');
  assert.equal(shouldHandleSocketClose(true, 'in_game', 'disconnect'), false);
  assert.equal(shouldHandleSocketClose(true, 'halted', 'stay'), false);
  assert.equal(shouldHandleSocketClose(false, 'in_game', 'disconnect'), true);
  assert.equal(shouldHandleSocketClose(false, 'halted', 'disconnect'), false, 'we closed it ourselves');
  assert.equal(shouldHandleSocketClose(false, 'halted', 'stay'), true, 'real network drop while halted');
});
