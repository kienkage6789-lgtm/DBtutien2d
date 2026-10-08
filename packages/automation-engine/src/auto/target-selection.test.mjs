import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../../../../', import.meta.url);
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
const sourceModule = async (relativePath, replacements = []) => {
  let source = await readFile(new URL(relativePath, root), 'utf8');
  source = stripTypeScriptTypes(source);
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  return import(dataModule(source));
};

const enemySource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/enemy-defs.generated.ts', root), 'utf8'));
const skillSource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/skill-defs.generated.ts', root), 'utf8'));
const enemyUrl = dataModule(enemySource);
const skillUrl = dataModule(skillSource);
let coreSource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/auto-data.ts', root), 'utf8'));
coreSource = coreSource.replaceAll('./enemy-defs.generated.js', enemyUrl).replaceAll('./skill-defs.generated.js', skillUrl);
const coreUrl = dataModule(coreSource);
const target = await sourceModule('packages/automation-engine/src/auto/target-selection.ts', [['@tutien2d/core-client', coreUrl]]);

const defs = await import(coreUrl);
const regularType = 'sau_truc';
const otherRegularType = 'son_chuot';
const bossType = Object.keys(defs.ENEMY_DEFS).find((id) => defs.ENEMY_DEFS[id].isBoss);
const humanType = Object.keys(defs.ENEMY_DEFS).find((id) => defs.ENEMY_DEFS[id].human);
const tuSiType = Object.keys(defs.ENEMY_DEFS).find((id) => defs.ENEMY_DEFS[id].tuSi);
assert.ok(bossType && humanType && tuSiType, 'fixture must contain boss, human, and tuSi definitions');

const monster = (id, x, y, t = regularType, extra = {}) => ({ id, x, y, t, ...extra });
const base = { self: { x: 0, y: 0 }, memory: { targetId: null }, priority: 'auto', monsters: [] };

assert.equal(target.selectTarget({ ...base, monsters: [monster('far', 100, 0), monster('near', 20, 0)] }).target.id, 'near');
assert.equal(target.selectTarget({ ...base, priority: 'boss', monsters: [monster('regular', 1, 0), monster('boss', 200, 0, bossType)] }).target.id, 'boss');
assert.equal(target.selectTarget({ ...base, priority: 'quai', monsters: [monster('boss', 1, 0, bossType), monster('regular', 200, 0)] }).target.id, 'regular');
assert.equal(target.selectTarget({ ...base, priority: 'mau', monsters: [monster('full', 10, 0, regularType, { hp: 10, hm: 10 }), monster('low', 20, 0, otherRegularType, { hp: 1, hm: 10 })] }).target.id, 'low');
assert.equal(target.selectTarget({ ...base, priority: 'mau', monsters: [monster('far-low', 200, 0, regularType, { hp: 0.1, hm: 10 }), monster('near', 20, 0)] }).target.id, 'near', 'mau falls back to auto when its range branch is empty');

const filtered = target.selectTarget({
  ...base,
  monsters: [
    monster('dead', 1, 0, regularType, { d: 1 }),
    monster('zero', 2, 0, regularType, { hp: 0 }),
    monster('human', 3, 0, humanType),
    monster('tusi', 4, 0, tuSiType),
    monster('excluded', 5, 0, regularType),
    monster('unknown', 6, 0, 'not_in_enemy_defs'),
    monster('valid', 7, 0),
  ],
  config: { excludeTypes: new Set([regularType]) },
});
assert.equal(filtered.target, null);
assert.equal(filtered.reason, 'unknown_type');
assert.equal(filtered.considered, 7);

const invalid = target.selectTarget({ ...base, monsters: [monster('nan', Number.NaN, 0), { id: 'missing-y', x: 2, y: Number.NaN, t: regularType }] });
assert.equal(invalid.target, null);
assert.equal(invalid.considered, 2, 'invalid coordinates are rejected but counted');
assert.deepEqual(target.selectTarget({ ...base, monsters: [] }), { target: null, reason: 'no_target', memory: { targetId: null }, considered: 0 });

const stickyFirst = target.selectTarget({ ...base, monsters: [monster('held', 10, 0), monster('other', 20, 0)] });
const stickySecond = target.selectTarget({ ...base, memory: stickyFirst.memory, monsters: [monster('held', 200, 0), monster('new-near', 1, 0)] });
assert.equal(stickySecond.target.id, 'held');
const released = target.selectTarget({ ...base, memory: stickySecond.memory, monsters: [monster('held', 311, 0), monster('new-near', 1, 0)] });
assert.equal(released.target.id, 'new-near');
assert.equal(target.selectTarget({ ...base, memory: stickyFirst.memory, config: { sticky: false }, monsters: [monster('held', 10, 0), monster('new-near', 1, 0)] }).target.id, 'new-near');

const tie = target.selectTarget({ ...base, monsters: [monster('z', 30, 40), monster('a', 40, 30)] });
assert.equal(tie.target.id, 'a');

const before = JSON.stringify({ base, defs: Object.keys(defs.ENEMY_DEFS) });
target.selectTarget({ ...base, monsters: [monster('a', 3, 4), monster('b', 4, 3)] });
assert.equal(JSON.stringify({ base, defs: Object.keys(defs.ENEMY_DEFS) }), before, 'selection does not mutate input or definitions');

const radiusType = Object.keys(defs.ENEMY_DEFS).find((id) => Number.isFinite(defs.ENEMY_DEFS[id].bodyRadius)) ?? regularType;
const radius = Number.isFinite(defs.ENEMY_DEFS[radiusType].bodyRadius) ? defs.ENEMY_DEFS[radiusType].bodyRadius : 0;
assert.equal(target.inMeleeReach({ x: 0, y: 0 }, monster('edge', target.PLAYER_REACH + radius, 0, radiusType), 0), true);
assert.equal(target.inMeleeReach({ x: 0, y: 0 }, monster('outside', target.PLAYER_REACH + radius + 0.001, 0, radiusType), 0), false);
assert.equal(target.inMeleeReach({ x: 0, y: 0 }, monster('bonus', target.PLAYER_REACH + 5, 0), 5), true);

const bolt = defs.SKILL_DEFS.hoa_cau;
const aura = defs.SKILL_DEFS.bang_kiem_luan;
assert.equal(target.inSkillRange({ x: 0, y: 0 }, monster('bolt-edge', bolt.range, 0), bolt), true);
assert.equal(target.inSkillRange({ x: 0, y: 0 }, monster('bolt-out', bolt.range + 0.001, 0), bolt), false);
const auraRange = Math.min(aura.range, 0.8 * aura.blastR);
assert.equal(target.inSkillRange({ x: 0, y: 0 }, monster('aura-edge', auraRange, 0), aura), true);
assert.equal(target.inSkillRange({ x: 0, y: 0 }, monster('aura-out', auraRange + 0.001, 0), aura), false);
assert.equal(target.inSkillRange({ x: 0, y: 0 }, monster('thunder-edge', target.THUNDER_RANGE, 0), { thunder: true, range: 1 }), true);

console.log('target-selection tests passed (priority, fallback, filtering, sticky, ties, immutable, range boundaries)');
