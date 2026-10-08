import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSingleEngine } from './engine-selection.js';

test('runtime selection is vendor-only', () => {
  assert.doesNotThrow(() => assertSingleEngine(null, 'vendor'));
  assert.doesNotThrow(() => assertSingleEngine('vendor', 'vendor'));
});
