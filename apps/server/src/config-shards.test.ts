import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedEnvInt } from './orchestrator/shard-config.js';

test('shard env values accept integer input, clamp bounds, and fallback on malformed values', () => {
  assert.equal(boundedEnvInt(undefined, 0, 0, 16), 0);
  assert.equal(boundedEnvInt(' ', 15000, 100, 120000), 15000);
  assert.equal(boundedEnvInt('2', 0, 0, 16), 2);
  assert.equal(boundedEnvInt('99', 0, 0, 16), 16);
  assert.equal(boundedEnvInt('-2', 0, 0, 16), 0);
  assert.equal(boundedEnvInt('2.5', 7, 0, 16), 7);
  assert.equal(boundedEnvInt('invalid', 15000, 100, 120000), 15000);
  assert.equal(boundedEnvInt('9007199254740993', 15000, 100, 120000), 15000);
});
