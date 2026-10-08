import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../../../../', import.meta.url);
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
const enemySource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/enemy-defs.generated.ts', root), 'utf8'));
const skillSource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/skill-defs.generated.ts', root), 'utf8'));
const enemyUrl = dataModule(enemySource);
const skillUrl = dataModule(skillSource);
let coreSource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/auto-data.ts', root), 'utf8'));
coreSource = coreSource.replaceAll('./enemy-defs.generated.js', enemyUrl).replaceAll('./skill-defs.generated.js', skillUrl);
const coreUrl = dataModule(coreSource);
let source = stripTypeScriptTypes(await readFile(new URL('packages/automation-engine/src/auto/skill-rotation.ts', root), 'utf8'));
source = source.replaceAll('@tutien2d/core-client', coreUrl);
const rotation = await import(dataModule(source));

const books = (...ids) => Object.fromEntries(ids.map((id) => [
  id === 'loi_chuong' ? 'bi_tich_loi_chuong' : `bi_tich_${id}`,
  1,
]));
const player = { mp: 100, mpMax: 100, sp: 100 };
const known = books('loi_chuong', 'hoa_cau', 'phong_nhan');
const learned = (await import(coreUrl)).deriveLearnedSkills({ bag: known });
assert.deepEqual(learned.slice(0, 3), ['loi_chuong', 'hoa_cau', 'phong_nhan']);

const zero = rotation.createSkillCooldowns();
const first = rotation.pickAutoSkill({ distance: 100, rotationIndex: 0, player, cooldowns: zero, now: 0, learnedSkills: learned });
assert.equal(first.skill.id, 'hoa_cau', 'thunder is outside 96px at this query');
assert.equal(first.nextIndex, 2);
const second = rotation.pickAutoSkill({ distance: 100, rotationIndex: first.nextIndex, player, cooldowns: zero, now: 0, learnedSkills: learned });
assert.equal(second.skill.id, 'phong_nhan');
const wrapped = rotation.pickAutoSkill({ distance: 100, rotationIndex: 3, player, cooldowns: zero, now: 0, learnedSkills: learned });
assert.equal(wrapped.skill.id, 'hoa_cau');

const hoa = (await import(coreUrl)).SKILL_DEFS.hoa_cau;
const afterHoa = rotation.recordSkillCast(zero, hoa, 10);
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 1, player, cooldowns: afterHoa, now: 10, learnedSkills: learned }), null, 'individual and common cooldowns both apply');
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 1, player, cooldowns: afterHoa, now: 11.2, learnedSkills: ['hoa_cau'] }), null, 'individual cooldown remains after SPELL_GAP');
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 1, player, cooldowns: afterHoa, now: 11.2, learnedSkills: ['hoa_cau'] }), null);
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 1, player, cooldowns: afterHoa, now: 16, learnedSkills: ['hoa_cau'] }).skill.id, 'hoa_cau');

const outside = rotation.pickAutoSkill({ distance: 500, rotationIndex: 0, player, cooldowns: zero, now: 0, learnedSkills: learned });
assert.equal(outside, null);
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 0, player: { ...player, mp: 0 }, cooldowns: zero, now: 0, learnedSkills: learned }), null);
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 0, player: { ...player, sp: 0 }, cooldowns: zero, now: 0, learnedSkills: learned }), null);
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 0, player: { ...player, transformed: true }, cooldowns: zero, now: 0, learnedSkills: learned }), null);

const learnedWithForm = (await import(coreUrl)).deriveLearnedSkills({ bag: books('hoa_cau', 'xich_ma_hoa_than') });
const formPick = rotation.pickAutoSkill({ distance: 100, rotationIndex: 0, player, cooldowns: zero, now: 0, learnedSkills: learnedWithForm });
assert.equal(formPick.skill.id, 'hoa_cau', 'bienHinh is excluded from bot rotation');
assert.equal(rotation.pickAutoSkill({ distance: 100, rotationIndex: 0, player, cooldowns: zero, now: 0, learnedSkills: ['xich_chan'] }), null, 'playerTargetOnly is excluded too');

const thunder = (await import(coreUrl)).THUNDER_DEF;
const afterThunder = rotation.recordSkillCast(zero, thunder, 20);
assert.equal(afterThunder.thunderUntil, 25);
assert.equal(afterThunder.spellUntil, 20 + rotation.SPELL_GAP);
assert.equal(rotation.isSkillReady(player, thunder, afterThunder, 20), false);
assert.equal(rotation.isSkillReady(player, thunder, afterThunder, 25), true);

console.log('skill-rotation tests passed (circular order, range/readiness, resources, individual/common cooldowns, bienHinh)');
