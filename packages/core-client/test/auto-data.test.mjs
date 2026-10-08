import assert from 'node:assert/strict';
import test from 'node:test';
import { ENEMY_DEFS, SKILL_DEFS, SKILL_SLOT_IDS, THUNDER_DEF, deriveLearnedSkills } from '../dist/state/auto-data.js';
import { KNOWN_ITEM_IDS } from '../dist/state/derived-vitals.generated.js';

test('generated enemy table has the expected vendor definitions', () => {
  assert.equal(Object.keys(ENEMY_DEFS).length, 62);
  assert.equal(ENEMY_DEFS.sau_truc.hpMax, 5);
  assert.equal(ENEMY_DEFS.than_thu_xich_long.bodyRadius, 44);
});

test('generated skill table matches the vendor source shape', () => {
  assert.equal(Object.keys(SKILL_DEFS).length, 27);
  assert.equal(SKILL_SLOT_IDS.length, 28);
  assert.equal(THUNDER_DEF.id, 'loi_chuong');
  assert.equal(SKILL_DEFS.hoa_cau.book, 'bi_tich_hoa_cau');
  assert.equal(SKILL_DEFS.xich_chan.playerTargetOnly, true);
});

test('all generated active and Thunder books exist in generated items', () => {
  for (const def of [THUNDER_DEF, ...Object.values(SKILL_DEFS)]) {
    assert.ok(KNOWN_ITEM_IDS.includes(def.book));
  }
});

test('deriveLearnedSkills uses only positive bag book counts in slot order', () => {
  assert.deepEqual(deriveLearnedSkills({ bag: { bi_tich_hoa_cau: 1, bi_tich_loi_chuong: 1 } }), ['loi_chuong', 'hoa_cau']);
  assert.deepEqual(deriveLearnedSkills({ flags: { phap_thuat_dung: 'hoa_cau' } }), []);
  assert.deepEqual(deriveLearnedSkills({ bag: { bi_tich_hoa_cau: '1' } }), []);
  assert.deepEqual(deriveLearnedSkills(null), []);
});

console.log('core-client generated auto data tests passed');
