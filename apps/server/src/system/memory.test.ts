import test from 'node:test';
import assert from 'node:assert/strict';
import { availableMemoryMb, hasEnoughMemory, parseMemAvailableBytes, readAvailableMemoryBytes } from './memory.js';

test('parses Linux MemAvailable and applies the threshold', () => {
  const bytes = parseMemAvailableBytes('MemTotal:       1024 kB\nMemAvailable:    512 kB\n');
  assert.equal(bytes, 512 * 1024);
  assert.equal(availableMemoryMb(bytes ?? 0), 0);
  assert.equal(hasEnoughMemory(bytes ?? 0, 0), true);
  assert.equal(hasEnoughMemory(bytes ?? 0, 0.5), true);
  assert.equal(hasEnoughMemory(bytes ?? 0, 1), false);
  assert.equal(readAvailableMemoryBytes(() => 'MemAvailable: 2048 kB\n', () => 0, 'linux'), 2048 * 1024);
});

test('returns null for malformed MemAvailable', () => {
  assert.equal(parseMemAvailableBytes('MemFree: 10 kB'), null);
});
