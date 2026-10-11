import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedEnvInt } from './orchestrator/shard-config.js';

test('bounded integer env values clamp bounds and fall back on malformed input', () => {
  assert.equal(boundedEnvInt(undefined, 0, 0, 16), 0);
  assert.equal(boundedEnvInt(' ', 15000, 100, 120000), 15000);
  assert.equal(boundedEnvInt('2', 0, 0, 16), 2);
  assert.equal(boundedEnvInt('99', 0, 0, 16), 16);
  assert.equal(boundedEnvInt('-2', 0, 0, 16), 0);
  assert.equal(boundedEnvInt('2.5', 7, 0, 16), 7);
  assert.equal(boundedEnvInt('invalid', 15000, 100, 120000), 15000);
  assert.equal(boundedEnvInt('9007199254740993', 15000, 100, 120000), 15000);
  assert.equal(boundedEnvInt('999999', 60000, 1000, 300000), 300000);
  assert.equal(boundedEnvInt('0', 60000, 1000, 300000), 1000);
  assert.equal(boundedEnvInt('invalid', 60000, 1000, 300000), 60000);
  assert.equal(boundedEnvInt('0', 1800000, 0, 86400000), 0);
  assert.equal(boundedEnvInt('90000000', 1800000, 0, 86400000), 86400000);
});
