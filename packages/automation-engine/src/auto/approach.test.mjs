import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../../../../', import.meta.url);
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
const readSource = async (relativePath) => stripTypeScriptTypes(
  await readFile(new URL(relativePath, root), 'utf8'),
);

const enemyUrl = dataModule(await readSource('packages/core-client/src/state/enemy-defs.generated.ts'));
const skillUrl = dataModule(await readSource('packages/core-client/src/state/skill-defs.generated.ts'));
let autoData = await readSource('packages/core-client/src/state/auto-data.ts');
autoData = autoData.replaceAll('./enemy-defs.generated.js', enemyUrl).replaceAll('./skill-defs.generated.js', skillUrl);
const coreAutoUrl = dataModule(autoData);
let targetSource = await readSource('packages/automation-engine/src/auto/target-selection.ts');
targetSource = targetSource.replaceAll('@tutien2d/core-client', coreAutoUrl);
const targetUrl = dataModule(targetSource);
let approachSource = await readSource('packages/automation-engine/src/auto/approach.ts');
approachSource = approachSource.replaceAll("'./target-selection.js'", `'${targetUrl}'`);
const approach = await import(dataModule(approachSource));
const core = await import(coreAutoUrl);

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const monster = (id, x, y, extra = {}) => ({ id, x, y, t: 'sau_truc', ...extra });
const alwaysWalkable = () => true;

const direct = approach.computeApproachGoal({
  self: { x: 20, y: 0 },
  monster: monster('direct', 0, 0),
  isWalkablePoint: alwaysWalkable,
  nearestWalkable: () => null,
});
assert.equal(direct.reason, 'direct');
assert.deepEqual(direct.goal, { x: 20, y: 0 });

const snapped = approach.computeApproachGoal({
  self: { x: 100, y: 0 },
  monster: monster('blocked', 0, 0),
  isWalkablePoint: (point) => Math.abs(point.x - 10) < 0.000001 && Math.abs(point.y) < 0.000001,
  nearestWalkable: () => ({ x: 10, y: 0 }),
});
assert.equal(snapped.reason, 'snapped');
assert.ok(snapped.goal && pointDistance(snapped.goal, { x: 0, y: 0 }) <= snapped.reachLimit - 8);

const none = approach.computeApproachGoal({
  self: { x: 100, y: 0 },
  monster: monster('walled', 0, 0),
  isWalkablePoint: () => false,
  nearestWalkable: () => ({ x: 0, y: 0 }),
});
assert.equal(none.reason, 'none');
assert.equal(none.goal, null);

const nullRadius = approach.computeApproachGoal({
  self: { x: 20, y: 0 },
  monster: monster('null-radius', 0, 0, { bodyRadius: null }),
  isWalkablePoint: alwaysWalkable,
  nearestWalkable: () => null,
});
assert.equal(nullRadius.reachLimit, 26);

const largeMargin = approach.computeApproachGoal({
  self: { x: 100, y: 0 },
  monster: monster('large-margin', 0, 0),
  margin: 100,
  isWalkablePoint: alwaysWalkable,
  nearestWalkable: () => null,
});
assert.ok(largeMargin.goal);
assert.ok(pointDistance(largeMargin.goal, { x: 0, y: 0 }) <= largeMargin.reachLimit * 0.5 + 0.000001);

const preferredByPath = approach.computeApproachGoal({
  self: { x: 100, y: 0 },
  monster: monster('path-choice', 0, 0),
  isWalkablePoint: alwaysWalkable,
  nearestWalkable: () => null,
  pathLength: (_from, to) => Math.abs(to.x + 18) < 0.000001 ? 1 : 100,
});
assert.equal(preferredByPath.reason, 'ring');
assert.ok(preferredByPath.goal && preferredByPath.goal.x < -17, 'path length must beat Euclidean order');

const stableInput = {
  self: { x: 100, y: 0 },
  monster: monster('stable', 0, 0),
  isWalkablePoint: alwaysWalkable,
  nearestWalkable: () => null,
};
assert.deepEqual(
  approach.computeApproachGoal(stableInput),
  approach.computeApproachGoal(stableInput),
  'same input must choose the same point',
);

// A deterministic pseudo-random sweep catches accidental use of Math.random
// and verifies that a returned goal is always accepted by the collision gate.
let seed = 0x12345678;
for (let index = 0; index < 100; index += 1) {
  seed = (1664525 * seed + 1013904223) >>> 0;
  const sx = (seed % 600) - 300;
  seed = (1664525 * seed + 1013904223) >>> 0;
  const sy = (seed % 400) - 200;
  const result = approach.computeApproachGoal({
    self: { x: sx, y: sy },
    monster: monster(`seed-${index}`, 0, 0),
    isWalkablePoint: (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 1000 && Math.abs(point.y) < 1000,
    nearestWalkable: () => ({ x: 0, y: 0 }),
  });
  if (result.goal) assert.ok(Math.abs(result.goal.x) < 1000 && Math.abs(result.goal.y) < 1000);
}

const goalResult = (goal = { x: 50, y: 0 }, reason = 'ring') => ({ goal, reachLimit: 26, reason });
const tracker = new approach.ApproachTracker();
assert.equal(tracker.tick({ now: 0, self: { x: 0, y: 0 }, monster: monster('track', 100, 0), goalResult: goalResult() }).action, 'start');
assert.equal(tracker.tick({ now: 100, self: { x: 10, y: 0 }, monster: monster('track', 100, 0), goalResult: goalResult() }).action, 'continue');
assert.equal(tracker.tick({ now: 399, self: { x: 10, y: 0 }, monster: monster('track', 125, 0), goalResult: goalResult() }).action, 'continue');
assert.equal(tracker.tick({ now: 400, self: { x: 10, y: 0 }, monster: monster('track', 125, 0), goalResult: goalResult() }).action, 'replan');
assert.equal(tracker.tick({ now: 800, self: { x: 10, y: 0 }, monster: monster('track', 135, 0), goalResult: goalResult() }).action, 'continue');

const timeoutTracker = new approach.ApproachTracker();
timeoutTracker.tick({ now: 0, self: { x: 0, y: 0 }, monster: monster('timeout', 100, 0), goalResult: goalResult() });
assert.equal(timeoutTracker.tick({ now: approach.APPROACH_TIMEOUT_MS, self: { x: 0, y: 0 }, monster: monster('timeout', 100, 0), goalResult: goalResult() }).action, 'timeout');

const lostTracker = new approach.ApproachTracker();
lostTracker.tick({ now: 0, self: { x: 0, y: 0 }, monster: monster('lost', 100, 0), goalResult: goalResult() });
assert.equal(lostTracker.tick({ now: 100, self: { x: 0, y: 0 }, monster: monster('lost', 100, 0, { d: 1 }), goalResult: goalResult() }).action, 'target_lost');

const keepRangeTracker = new approach.ApproachTracker();
keepRangeTracker.tick({ now: 0, self: { x: 0, y: 0 }, monster: monster('range', 100, 0), goalResult: goalResult() });
assert.equal(keepRangeTracker.tick({ now: 100, self: { x: 0, y: 0 }, monster: monster('range', 311, 0), goalResult: goalResult() }).action, 'target_lost');

const arrivalTracker = new approach.ApproachTracker();
assert.equal(arrivalTracker.tick({ now: 0, self: { x: 0, y: 0 }, monster: monster('edge', 26, 0), goalResult: goalResult() }).action, 'arrived');

const unreachableTracker = new approach.ApproachTracker();
assert.equal(unreachableTracker.tick({ now: 0, self: { x: 0, y: 0 }, monster: monster('unreachable', 100, 0), goalResult: goalResult(null, 'none') }).action, 'continue');
assert.equal(unreachableTracker.tick({ now: 100, self: { x: 0, y: 0 }, monster: monster('unreachable', 100, 0), goalResult: goalResult(null, 'none') }).action, 'unreachable');

// Real thanh_truc_lam grid/spawn fixture: every non-none result must retain a
// walkable goal and a project path, never a vendor-snapped blocked target.
const generatedGridUrl = dataModule(await readSource('packages/core-client/src/state/walk-grids.generated.ts'));
let walkGridSource = await readSource('apps/server/src/config/walk-grid.ts');
walkGridSource = walkGridSource.replaceAll('@tutien2d/core-client', generatedGridUrl);
const walkGridUrl = dataModule(walkGridSource);
let walkPathSource = await readSource('apps/server/src/orchestrator/walk-path.ts');
walkPathSource = walkPathSource.replaceAll("'../config/walk-grid.js'", `'${walkGridUrl}'`).replaceAll("'@tutien2d/core-client'", `'${skillUrl}'`);
const walkPath = await import(dataModule(walkPathSource));
const { isWalkableTile } = await import(walkGridUrl);
const spawnSource = await readSource('packages/core-client/src/state/map-spawns.generated.ts');
const { MAP_SPAWNS } = await import(dataModule(spawnSource));
const grid = (await import(walkGridUrl)).getWalkGrid('thanh_truc_lam');
let fixtureStart = null;
for (let ty = 0; ty < grid.height && !fixtureStart; ty += 1) {
  for (let tx = 0; tx < grid.width; tx += 1) {
    const candidate = { x: tx * 32 + 16, y: ty * 32 + 16 };
    if (isWalkableTile('thanh_truc_lam', tx, ty) && walkPath.isWalkSegmentClear('thanh_truc_lam', candidate, candidate)) {
      fixtureStart = candidate;
      break;
    }
  }
}
assert.ok(fixtureStart, 'fixture needs one walkable start');
const rows = MAP_SPAWNS.filter((row) => row.mapId === 'thanh_truc_lam');
let fixtureCount = 0;
for (const row of rows) {
  const def = core.ENEMY_DEFS[row.enemyType];
  for (const spawn of row.spawns) {
    fixtureCount += 1;
    const fixtureGoal = approach.computeApproachGoal({
      self: fixtureStart,
      monster: { x: spawn.x, y: spawn.y, bodyRadius: def?.bodyRadius ?? null },
      isWalkablePoint: (point) => walkPath.isWalkSegmentClear('thanh_truc_lam', point, point),
      nearestWalkable: (x, y, radiusTiles) => {
        const suggestion = walkPath.findNearestWalkableTarget('thanh_truc_lam', x, y, radiusTiles);
        return suggestion ? { x: suggestion.x, y: suggestion.y } : null;
      },
      pathLength: (from, to) => {
        const path = walkPath.findWalkPath('thanh_truc_lam', from, { tx: Math.floor(to.x / 32), ty: Math.floor(to.y / 32) });
        if (!path) return null;
        let total = 0;
        let previous = from;
        for (const waypoint of path) {
          total += pointDistance(previous, waypoint);
          previous = waypoint;
        }
        return total + pointDistance(previous, to);
      },
    });
    if (fixtureGoal.reason !== 'none') {
      assert.ok(fixtureGoal.goal, `${row.enemyType}/${spawn.id} must have a goal`);
      assert.ok(walkPath.isWalkSegmentClear('thanh_truc_lam', fixtureGoal.goal, fixtureGoal.goal));
      assert.ok(fixtureGoal.goal && walkPath.findWalkPath('thanh_truc_lam', fixtureStart, {
        tx: Math.floor(fixtureGoal.goal.x / 32),
        ty: Math.floor(fixtureGoal.goal.y / 32),
      }));
    }
  }
}
assert.ok(fixtureCount > 0, 'thanh_truc_lam must have spawn fixture rows');

console.log(`approach tests passed (pure goal/tracker + ${fixtureCount} thanh_truc_lam spawns)`);
