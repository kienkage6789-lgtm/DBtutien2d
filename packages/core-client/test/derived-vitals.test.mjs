import assert from 'node:assert/strict';
import { deriveMaxima } from '../dist/state/derived-vitals.js';

assert.deepEqual(deriveMaxima('luyen_khi_8', []), {
  maxHp: 225, maxMp: 188, complete: true, source: 'derived',
});

const boosted = deriveMaxima('luyen_khi_8', ['mu_bach_van']);
assert.deepEqual(boosted, {
  maxHp: 233, maxMp: 193, complete: true, source: 'derived',
});
assert.equal(deriveMaxima('luyen_khi_8', ['tay_ue_thao']).complete, true, 'known item without maxima bonuses is complete');
assert.equal(deriveMaxima('luyen_khi_8', ['unknown_item']).complete, false, 'unknown equipped item makes result incomplete');
assert.equal(deriveMaxima('unknown_realm', []), null);

console.log('core-client derived vitals tests passed');
