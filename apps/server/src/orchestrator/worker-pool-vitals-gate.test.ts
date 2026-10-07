import assert from 'node:assert/strict';
import type { VitalSnapshot } from '@tutien2d/core-client';
import { resolveMoveVitalError, resolveStrictVitalError } from './worker-pool.js';

const vitals = (overrides: Partial<VitalSnapshot> = {}): VitalSnapshot => ({
  hp: null,
  maxHp: null,
  mp: null,
  maxMp: null,
  status: 'unknown',
  source: null,
  observedAt: null,
  ...overrides,
});

assert.equal(resolveMoveVitalError(null, vitals()), null, 'training movement allows unknown vitals');
assert.equal(resolveMoveVitalError(true, vitals()), 'character_down', 'authoritative downed=true blocks training movement');
assert.equal(resolveMoveVitalError(null, vitals({ hp: 0, maxHp: 100, status: 'fresh', source: 'state' })), null, 'state hp=0 alone does not block training movement');
assert.equal(resolveMoveVitalError(null, vitals({ hp: 0, maxHp: 100, status: 'fresh', source: 'you' })), 'character_down', 'you hp=0 is authoritative downed evidence');
assert.equal(resolveMoveVitalError(null, vitals({ hp: 0, maxHp: 100, status: 'fresh', source: 'hurt' })), 'character_down', 'hurt hp=0 is authoritative downed evidence');

assert.equal(resolveStrictVitalError(null, vitals()), 'vitals_unknown', 'strict attack gate rejects unknown vitals');
assert.equal(resolveStrictVitalError(null, vitals({ hp: 0, maxHp: 100, status: 'fresh', source: 'state' })), 'vitals_unknown', 'strict attack gate does not infer death from state hp=0');
assert.equal(resolveStrictVitalError(null, vitals({ hp: 80, maxHp: 100, status: 'fresh', source: 'state' })), null, 'strict attack gate accepts fresh positive vitals');
assert.equal(resolveStrictVitalError(true, vitals({ hp: 80, maxHp: 100, status: 'fresh', source: 'state' })), 'character_down');

console.log('worker-pool vitals gate tests passed');
