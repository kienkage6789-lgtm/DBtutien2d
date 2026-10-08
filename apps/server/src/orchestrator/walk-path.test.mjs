import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
const generatedSource = stripTypeScriptTypes(await readFile(new URL('../../../../packages/core-client/src/state/walk-grids.generated.ts', import.meta.url), 'utf8'));
const generatedUrl = dataModule(generatedSource);
const constantsSource = stripTypeScriptTypes(await readFile(new URL('../../../../packages/core-client/src/state/skill-defs.generated.ts', import.meta.url), 'utf8'));
const constantsUrl = dataModule(constantsSource);
const gridSource = stripTypeScriptTypes(await readFile(new URL('../config/walk-grid.ts', import.meta.url), 'utf8'))
  .replaceAll('@tutien2d/core-client', generatedUrl);
const gridUrl = dataModule(gridSource);

// Node's type-stripping loader does not apply TypeScript's .js-to-.ts source
// remapping, so load this source module with its sibling import redirected.
const source = await readFile(new URL('./walk-path.ts', import.meta.url), 'utf8');
const executableSource = stripTypeScriptTypes(source)
  .replace("'../config/walk-grid.js'", `'${gridUrl}'`)
  .replaceAll("'@tutien2d/core-client'", `'${constantsUrl}'`);
const { findWalkPath, findNearestWalkableTarget, isWalkSegmentClear } = await import(dataModule(executableSource));
const { isWalkableTile } = await import(gridUrl);

const mapId = 'tan_vien';
const path = findWalkPath(mapId, { x: 18 * 32 + 16, y: 11 * 32 + 16 }, { tx: 7, ty: 29 });

assert.ok(path, 'tan_vien route from tile 18,11 to portal 7,29 should exist');
assert.ok(path.length > 0, 'route should include at least one waypoint');
assert.deepEqual(path.at(-1), { x: 7 * 32 + 16, y: 29 * 32 + 16 }, 'last waypoint should be the portal tile center');

let previous = { tx: 18, ty: 11 };
for (const waypoint of path) {
  assert.equal(waypoint.x % 32, 16, 'waypoint x should be tile center');
  assert.equal(waypoint.y % 32, 16, 'waypoint y should be tile center');
  const current = { tx: Math.floor(waypoint.x / 32), ty: Math.floor(waypoint.y / 32) };
  assert.ok(isWalkableTile(mapId, current.tx, current.ty), `tile ${current.tx},${current.ty} must not be blocked`);
  assert.ok(Math.abs(current.tx - previous.tx) <= 1 && Math.abs(current.ty - previous.ty) <= 1, 'path steps must be adjacent');
  if (current.tx !== previous.tx && current.ty !== previous.ty) {
    assert.ok(isWalkableTile(mapId, current.tx, previous.ty), 'diagonal must not cut across blocked x-adjacent tile');
    assert.ok(isWalkableTile(mapId, previous.tx, current.ty), 'diagonal must not cut across blocked y-adjacent tile');
  }
  previous = current;
}

console.log(`walk-path test passed (${path.length} waypoints)`);

const blockedTarget = { x: 21 * 32 + 16, y: 3 * 32 + 16 };
assert.equal(isWalkableTile(mapId, 21, 3), false, 'fixture target must be blocked');
const suggestion = findNearestWalkableTarget(mapId, blockedTarget.x, blockedTarget.y);
assert.ok(suggestion, 'a nearby collision-safe walkable target should be suggested');
assert.ok(Math.abs(suggestion.tx - 21) <= 4 && Math.abs(suggestion.ty - 3) <= 4, 'suggestion stays within the finite search radius');
assert.ok(isWalkableTile(mapId, suggestion.tx, suggestion.ty));
assert.ok(isWalkSegmentClear(mapId, suggestion, suggestion), 'suggestion center must fit the player hitbox');
assert.deepEqual(findNearestWalkableTarget(mapId, blockedTarget.x, blockedTarget.y), suggestion, 'suggestion ordering is deterministic');
assert.equal(findNearestWalkableTarget(mapId, blockedTarget.x, blockedTarget.y, 0), null, 'zero-radius search never silently snaps');

assert.equal(findWalkPath(mapId, { x: 18 * 32 + 16, y: 11 * 32 + 16 }, { tx: 40, ty: 3 }), null, 'out-of-bounds targets are rejected');
assert.equal(findNearestWalkableTarget(mapId, -1, 3 * 32), null, 'out-of-bounds click is not offered a snap');
console.log('blocked, out-of-bounds, and deterministic snap checks passed');
