import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEnoughMemory } from '../system/memory.js';

test('runner capacity rejects low memory and accepts enough memory', () => {
  assert.equal(hasEnoughMemory(299 * 1024 * 1024, 300), false);
  assert.equal(hasEnoughMemory(300 * 1024 * 1024, 300), true);
  assert.equal(hasEnoughMemory(0, 0), true);
});
