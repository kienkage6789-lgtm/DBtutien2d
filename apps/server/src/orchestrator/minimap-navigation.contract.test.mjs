import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

// Contract fixture for the minimap navigation API. Projection is duplicated
// here as a protocol-level fixture so it can run without a browser DOM; the
// production browser helper is covered by the same cases during web build.
const walkPathSource = await readFile(new URL('./walk-path.ts', import.meta.url), 'utf8');
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
const generatedSource = stripTypeScriptTypes(await readFile(new URL('../../../../packages/core-client/src/state/walk-grids.generated.ts', import.meta.url), 'utf8'));
const generatedUrl = dataModule(generatedSource);
const gridSource = stripTypeScriptTypes(await readFile(new URL('../config/walk-grid.ts', import.meta.url), 'utf8'))
  .replaceAll('@tutien2d/core-client', generatedUrl);
const gridUrl = dataModule(gridSource);
const constantsSource = stripTypeScriptTypes(await readFile(new URL('../../../../packages/core-client/src/state/skill-defs.generated.ts', import.meta.url), 'utf8'));
const constantsUrl = dataModule(constantsSource);
const executableWalkPath = stripTypeScriptTypes(walkPathSource)
  .replace("'../config/walk-grid.js'", `'${gridUrl}'`)
  .replaceAll("'@tutien2d/core-client'", `'${constantsUrl}'`);
const { findWalkPath } = await import(`data:text/javascript,${encodeURIComponent(executableWalkPath)}`);
const { isWalkableTile } = await import(gridUrl);

function projection(world, rect) {
  if (![world.width, world.height, rect.width, rect.height].every(Number.isFinite)
    || world.width <= 0 || world.height <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / world.width, rect.height / world.height);
  const drawWidth = world.width * scale;
  const drawHeight = world.height * scale;
  return {
    scale,
    left: rect.left + (rect.width - drawWidth) / 2,
    top: rect.top + (rect.height - drawHeight) / 2,
    right: rect.left + (rect.width + drawWidth) / 2,
    bottom: rect.top + (rect.height + drawHeight) / 2,
    world,
  };
}

function canvasToWorld(point, view) {
  if (!view || point.x < view.left || point.x >= view.right || point.y < view.top || point.y >= view.bottom) return null;
  return { x: (point.x - view.left) / view.scale, y: (point.y - view.top) / view.scale };
}

function validateClick({ point, view, current, expected, mapId }) {
  if (!current?.fresh || current.mapId !== expected.mapId || current.khu !== expected.khu) return null;
  const worldPoint = canvasToWorld(point, view);
  if (!worldPoint || worldPoint.x < 0 || worldPoint.y < 0
    || worldPoint.x >= view.world.width || worldPoint.y >= view.world.height) return null;
  const tx = Math.floor(worldPoint.x / 32);
  const ty = Math.floor(worldPoint.y / 32);
  if (!isWalkableTile(mapId, tx, ty)) return null;
  return { x: worldPoint.x, y: worldPoint.y, tx, ty, mapId, khu: current.khu };
}

// Minimal lifecycle model used only to pin expected semantics for review.
class OperationFixture {
  active = null;
  nextId = 1;

  begin(target) {
    if (this.active) {
      if (this.active.target !== target) return { status: 'conflict' };
      return { status: 'duplicate', operationId: this.active.id };
    }
    this.active = { id: `fixture-${this.nextId++}`, target, cancelled: false };
    return { status: 'started', operationId: this.active.id };
  }

  invalidate(reason) {
    if (this.active) this.active = { ...this.active, cancelled: true, reason };
  }

  maySend(operationId, context) {
    return !!this.active && this.active.id === operationId && !this.active.cancelled
      && context.connected && context.alive && context.fresh
      && context.mapId === this.active.sourceMapId
      && context.epoch === this.active.epoch;
  }
}

test('projection fits world inside a letterboxed canvas and round-trips coordinates', () => {
  const view = projection({ width: 1280, height: 960 }, { left: 100, top: 50, width: 400, height: 400 });
  assert.equal(view.scale, 400 / 1280);
  assert.equal(view.left, 100);
  assert.equal(view.top, 100);
  assert.deepEqual(canvasToWorld({ x: 200, y: 200 }, view), { x: 320, y: 320 });
  assert.equal(canvasToWorld({ x: 200, y: 99.99 }, view), null, 'letterbox pixels are not world clicks');
});

test('projection uses the new rect after resize and rejects empty geometry', () => {
  const resized = projection({ width: 1280, height: 960 }, { left: 20, top: 30, width: 800, height: 400 });
  assert.equal(resized.scale, 400 / 960);
  assert.ok(Math.abs(resized.left - 153.33333333333333) < 1e-10);
  assert.equal(resized.top, 30);
  assert.equal(projection({ width: 1280, height: 960 }, { left: 0, top: 0, width: 0, height: 400 }), null);
});

test('click accepts only a fresh matching map/khu and a walkable in-bounds tile', () => {
  const view = projection({ width: 1280, height: 960 }, { left: 0, top: 0, width: 1280, height: 960 });
  const base = {
    point: { x: 18 * 32 + 16, y: 11 * 32 + 16 }, view, mapId: 'tan_vien',
    expected: { mapId: 'tan_vien', khu: 2 },
    current: { mapId: 'tan_vien', khu: 2, fresh: true },
  };
  assert.deepEqual(validateClick(base), { x: 592, y: 368, tx: 18, ty: 11, mapId: 'tan_vien', khu: 2 });
  assert.equal(validateClick({ ...base, current: { ...base.current, fresh: false } }), null, 'stale context');
  assert.equal(validateClick({ ...base, current: { ...base.current, mapId: 'thanh_truc_lam' } }), null, 'wrong map');
  assert.equal(validateClick({ ...base, current: { ...base.current, khu: 1 } }), null, 'wrong khu');
  assert.equal(validateClick({ ...base, point: { x: 16, y: 16 } }), null, 'blocked tile');
  assert.equal(validateClick({ ...base, point: { x: 1280, y: 100 } }), null, 'outside right/bottom-exclusive bounds');
});

test('path is deterministic and never traverses a blocked tile', () => {
  const start = { x: 18 * 32 + 16, y: 11 * 32 + 16 };
  const target = { tx: 7, ty: 29 };
  const first = findWalkPath('tan_vien', start, target);
  const second = findWalkPath('tan_vien', start, target);
  assert.ok(first?.length);
  assert.deepEqual(first, second);
  for (const point of first) {
    assert.equal(point.x % 32, 16);
    assert.equal(point.y % 32, 16);
    assert.ok(isWalkableTile('tan_vien', Math.floor(point.x / 32), Math.floor(point.y / 32)));
  }
  assert.equal(findWalkPath('tan_vien', start, { tx: 21, ty: 3 }), null, 'blocked target cannot be routed to');
});

test('operation fixture rejects stale context, cancellation and duplicate/conflicting operations', () => {
  const op = new OperationFixture();
  const started = op.begin('destination');
  assert.equal(op.begin('destination').status, 'duplicate');
  assert.equal(op.begin('other').status, 'conflict');
  op.active = { ...op.active, sourceMapId: 'tan_vien' };
  const context = { connected: true, alive: true, fresh: true, mapId: 'tan_vien' };
  assert.equal(op.maySend(started.operationId, context), true);
  for (const changed of [
    { ...context, fresh: false }, { ...context, mapId: 'thanh_truc_lam' },
    { ...context, alive: false }, { ...context, connected: false },
  ]) assert.equal(op.maySend(started.operationId, changed), false);
  op.invalidate('cancelled');
  assert.equal(op.maySend(started.operationId, context), false, 'cancelled op cannot send later packets');
});

test('map change, death and disconnect invalidate the current operation in the fixture', () => {
  for (const [event, reason] of [['map-change', 'map_changed'], ['death', 'death'], ['disconnect', 'disconnect']]) {
    const op = new OperationFixture();
    op.begin('destination');
    op.invalidate(reason);
    assert.equal(op.active.cancelled, true, event);
    assert.equal(op.active.reason, reason, event);
  }
});
