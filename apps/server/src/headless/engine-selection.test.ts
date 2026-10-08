import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSingleEngine } from './engine-selection.js';

test('one account cannot start two different engines', () => {
  assert.doesNotThrow(() => assertSingleEngine(null, 'core'));
  assert.doesNotThrow(() => assertSingleEngine('core', 'core'));
  assert.throws(() => assertSingleEngine('core', 'vendor'), /ENGINE_ALREADY_RUNNING/);
  assert.throws(() => assertSingleEngine('vendor', 'core'), /ENGINE_ALREADY_RUNNING/);
});
