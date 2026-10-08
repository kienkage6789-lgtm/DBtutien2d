import assert from 'node:assert/strict';
import test from 'node:test';
import { ENEMY_DEFS, SKILL_DEFS, SKILL_SLOT_IDS, THUNDER_DEF, deriveLearnedSkills } from '../dist/state/auto-data.js';
import { KNOWN_ITEM_IDS } from '../dist/state/derived-vitals.generated.js';
import {
  normalizeActPacket,
  normalizeBossesPacket,
  normalizeCombatPacket,
  normalizeDownPacket,
  normalizeHurtPacket,
  normalizeJoinPacket,
  normalizeKillPacket,
  normalizeLeavePacket,
  normalizeLootGonePacket,
  normalizeLootPacket,
  normalizeRevivedPacket,
  normalizeSkillResultPacket,
} from '../dist/state/combat-packets.js';
import { combatFixtures, saveFixture } from './fixtures/combat-packets.fixture.mjs';

test('generated enemy table has 62 definitions and three source cross-checks', () => {
  assert.equal(Object.keys(ENEMY_DEFS).length, 62);
  assert.deepEqual(
    (({ name, hpMax, exp, isBoss, human }) => ({ name, hpMax, exp, isBoss, human }))(ENEMY_DEFS.sau_truc),
    { name: 'Bọ Ngựa', hpMax: 5, exp: 3, isBoss: false, human: false },
  );
  assert.deepEqual(
    (({ name, hpMax, isBoss, human }) => ({ name, hpMax, isBoss, human }))(ENEMY_DEFS.linh_ho_tran_son),
    { name: 'Linh Hổ Trấn Sơn · Yêu Thú Cấp 4', hpMax: 200000, isBoss: true, human: false },
  );
  assert.deepEqual(
    (({ name, hpMax, isBoss, human }) => ({ name, hpMax, isBoss, human }))(ENEMY_DEFS.tieu_phu),
    { name: 'Tiều Phu', hpMax: 60, isBoss: false, human: true },
  );
  assert.equal(ENEMY_DEFS.than_thu_xich_long.bodyRadius, 44);
});

test('generated skill table matches DEFS, SLOTS and Thunder source values', () => {
  assert.equal(Object.keys(SKILL_DEFS).length, 27);
  assert.equal(SKILL_SLOT_IDS.length, 28);
  assert.equal(THUNDER_DEF.id, 'loi_chuong');
  assert.equal(THUNDER_DEF.coef, 5.45);
  assert.equal(SKILL_DEFS.hoa_cau.book, 'bi_tich_hoa_cau');
  assert.equal(SKILL_DEFS.xich_chan.playerTargetOnly, true);
  assert.equal(SKILL_DEFS.dia_thich.instantOnPress, true);
  assert.equal(SKILL_DEFS.xich_ma_hoa_than.bienHinh.hinh, 'xich_ma');
  assert.equal(SKILL_DEFS.hoa_cau.allowedWeapons, null);
  assert.equal(SKILL_DEFS.ngu_kiem_sat.boostWeapon, 'huyet_kiem');
});

test('all generated active and Thunder books exist in generated ITEMS', () => {
  for (const def of [THUNDER_DEF, ...Object.values(SKILL_DEFS)]) {
    assert.ok(KNOWN_ITEM_IDS.includes(def.book), `missing item ${def.book}`);
  }
});

test('deriveLearnedSkills uses only positive bag book counts in slot order', () => {
  assert.deepEqual(deriveLearnedSkills(saveFixture), ['loi_chuong', 'hoa_cau']);
  assert.deepEqual(deriveLearnedSkills({ flags: { phap_thuat_dung: 'hoa_cau' } }), []);
  assert.deepEqual(deriveLearnedSkills({ bag: { bi_tich_hoa_cau: '1' } }), []);
  assert.deepEqual(deriveLearnedSkills(null), []);
});

test('normalizes valid combat fixtures', () => {
  assert.equal(normalizeKillPacket(combatFixtures.kill)?.id, 'enemy-synthetic-1');
  assert.equal(normalizeSkillResultPacket(combatFixtures.skillRes)?.n, 0);
  assert.equal(normalizeDownPacket(combatFixtures.down)?.left, 60);
  assert.equal(normalizeHurtPacket(combatFixtures.hurt)?.hp, 40);
  assert.equal(normalizeActPacket(combatFixtures.act)?.k, 'enemy_poison');
  assert.equal(normalizeLootPacket(combatFixtures.loot)?.l?.[0].item, 'linh_thuy');
  assert.equal(normalizeLootGonePacket(combatFixtures.lootGone)?.id, 'loot-synthetic-1');
  assert.equal(normalizeJoinPacket(combatFixtures.join)?.id, 'remote-synthetic-1');
  assert.equal(normalizeLeavePacket(combatFixtures.leave)?.id, 'remote-synthetic-1');
  assert.deepEqual(normalizeBossesPacket(combatFixtures.bosses)?.boards, []);
  assert.equal(normalizeRevivedPacket(combatFixtures.revived)?.hp, 60);
  assert.equal(normalizeCombatPacket(combatFixtures.kill)?.op, 'kill');
});

test('normalizers reject missing required fields and wrong types', () => {
  assert.equal(normalizeKillPacket({ op: 'kill', exp: 1 }), null);
  assert.equal(normalizeSkillResultPacket({ op: 'skill_res', n: -1 }), null);
  assert.equal(normalizeSkillResultPacket({ op: 'skill_res', n: 1.5 }), null);
  assert.equal(normalizeHurtPacket({ op: 'hurt', hp: 4 }), null);
  assert.equal(normalizeHurtPacket({ op: 'hurt', hp: 4, dmg: '5' }), null);
  assert.equal(normalizeActPacket({ op: 'act', k: 1 }), null);
  assert.equal(normalizeLootPacket({ op: 'loot', l: [{ id: 'x', item: 'y', x: 1 }] }), null);
  assert.equal(normalizeLootGonePacket({ op: 'loot_gone' }), null);
  assert.equal(normalizeJoinPacket({ op: 'join', id: 'x', pos: 1 }), null);
  assert.equal(normalizeLeavePacket({ op: 'leave', id: null }), null);
  assert.equal(normalizeBossesPacket({ op: 'bosses', boards: {} }), null);
  assert.equal(normalizeRevivedPacket({ op: 'revived', hp: 1, mp: '2' }), null);
  assert.equal(normalizeCombatPacket({ op: 'unknown' }), null);
});

test('normalizers preserve valid boundary values and client-tolerated omissions', () => {
  assert.deepEqual(normalizeSkillResultPacket({ op: 'skill_res', n: 0 }), { op: 'skill_res', n: 0 });
  assert.deepEqual(normalizeDownPacket({ op: 'down' }), { op: 'down' });
  assert.deepEqual(normalizeLootPacket({ op: 'loot' }), { op: 'loot' });
  assert.equal(normalizeHurtPacket({ op: 'hurt', hp: 0, dmg: 0 })?.hp, 0);
  assert.equal(normalizeActPacket({ op: 'act', k: 'll_ta_hoa', pts: [], w: 0, r: 0 })?.k, 'll_ta_hoa');
  assert.equal(normalizeActPacket({ op: 'act', k: 'vankiem_release', flight: 1 })?.flight, 1);
  assert.equal(normalizeLootPacket({ op: 'loot', l: [{ id: 'x', item: 'y', x: 0, y: 0, boss: 0, daily: 1, ht: 0 }] })?.l?.[0].daily, 1);
  assert.equal(normalizeRevivedPacket({ op: 'revived', hp: 0, mp: 0 })?.mp, 0);
});
