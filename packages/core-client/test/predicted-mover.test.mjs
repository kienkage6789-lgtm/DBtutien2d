import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_CONSTANTS } from '../dist/state/auto-data.js';
import { PredictedMover } from '../dist/movement/predicted-mover.js';

const WALK_SPEED = AUTO_CONSTANTS.player.speed * AUTO_CONSTANTS.player.walkMult;
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('accumulates prediction while authoritative position is quiet', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 }, speed: WALK_SPEED });
  const sent = [];
  for (let index = 1; index <= 10; index += 1) {
    sent.push(mover.step({ waypoint: { x: 500, y: 0 }, now: index * 100, seq: index }));
  }
  assert.ok(Math.abs(mover.position.x - WALK_SPEED) < 0.01);
  assert.ok(mover.position.x > 95, 'regression guard: prediction must not remain near one old 6.8px step');
  assert.equal(sent.length, 10);
});

test('never exceeds speed times the clamped dt after wire rounding', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 }, speed: WALK_SPEED });
  let previous = { x: 0, y: 0 };
  for (const [seq, now] of [[1, 100], [2, 101], [3, 1_100], [4, 1_120], [5, 1_320]]) {
    const next = mover.step({ waypoint: { x: 500, y: 500 }, now, seq });
    assert.ok(pointDistance(previous, next) <= WALK_SPEED * next.dtMs / 1000 + 1e-9);
    previous = next;
  }
});

test('default speed comes from AUTO_CONSTANTS, not a copied literal', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 } });
  assert.equal(mover.speed, WALK_SPEED);
  assert.equal(WALK_SPEED, 68 * 1.485);
});

test('does not pass the waypoint', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 }, speed: WALK_SPEED });
  for (let index = 1; index <= 20; index += 1) {
    const next = mover.step({ waypoint: { x: 23, y: 0 }, now: index * 100, seq: index });
    assert.ok(next.predicted.x <= 23);
    assert.ok(next.x <= 23);
  }
  assert.deepEqual(mover.position, { x: 23, y: 0 });
});

test('300px takes about three seconds at the generated walk speed', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 }, speed: WALK_SPEED });
  let reachedAt = null;
  for (let index = 1; index <= 50; index += 1) {
    mover.step({ waypoint: { x: 300, y: 0 }, now: index * 100, seq: index });
    if (mover.position.x === 300 && reachedAt === null) reachedAt = index * 100;
  }
  assert.ok(reachedAt !== null);
  assert.ok(reachedAt >= 2_900 && reachedAt <= 3_100);
});

test('reconciliation ignores small error and soft-fixes a medium error with pending commands', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 }, speed: WALK_SPEED, epoch: 7 });
  const first = mover.step({ waypoint: { x: 500, y: 0 }, now: 100, seq: 1 });
  const second = mover.step({ waypoint: { x: 500, y: 0 }, now: 200, seq: 2 });
  const small = mover.onAuthoritative({ seq: 1, x: first.predicted.x - 2, y: 0, fix: true, ep: 7, now: 250 });
  assert.equal(small.kind, 'ignored');
  assert.equal(mover.pendingCommands.length, 1);

  const soft = mover.onAuthoritative({ seq: 2, x: second.x - 10, y: 0, fix: true, ep: 7, now: 300 });
  assert.equal(soft.kind, 'soft');
  assert.equal(mover.pendingCommands.length, 0);
  assert.ok(Math.abs(mover.position.x - (second.x - 10 + (second.predicted.x - second.x))) < 0.01);

  const queued = new PredictedMover({ position: { x: 0, y: 0 }, speed: WALK_SPEED, epoch: 7 });
  queued.step({ waypoint: { x: 500, y: 0 }, now: 100, seq: 1 });
  queued.step({ waypoint: { x: 500, y: 0 }, now: 200, seq: 2 });
  const third = queued.step({ waypoint: { x: 500, y: 0 }, now: 300, seq: 3 });
  const queuedFix = queued.onAuthoritative({ seq: 1, x: 0, y: 0, fix: true, ep: 7, now: 400 });
  assert.equal(queuedFix.kind, 'soft');
  assert.ok(Math.abs(queued.position.x - (third.predicted.x - 10)) < 0.01);
  assert.equal(queued.pendingCommands.length, 0);
});

test('large corrections soft-fix twice and hard-fix on the third consecutive correction', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 }, epoch: 3 });
  mover.reset({ x: 0, y: 0 }, { now: 0, seq: 0, ep: 3 });
  assert.equal(mover.onAuthoritative({ seq: 1, x: 200, y: 0, fix: true, ep: 3, now: 100 }).kind, 'soft');
  assert.equal(mover.onAuthoritative({ seq: 2, x: 0, y: 0, fix: true, ep: 3, now: 200 }).kind, 'soft');
  assert.equal(mover.onAuthoritative({ seq: 3, x: 200, y: 0, fix: true, ep: 3, now: 1_500 }).kind, 'soft');
  assert.equal(mover.onAuthoritative({ seq: 4, x: 0, y: 0, fix: true, ep: 3, now: 1_600 }).kind, 'hard');
  assert.deepEqual(mover.position, { x: 0, y: 0 });
});

test('drops stale sequences and epoch-mismatched fixes', () => {
  const mover = new PredictedMover({ position: { x: 0, y: 0 }, epoch: 9 });
  mover.step({ waypoint: { x: 100, y: 0 }, now: 100, seq: 1 });
  assert.equal(mover.onAuthoritative({ seq: 1, x: 10, y: 0, fix: false, ep: 9, now: 200 }).kind, 'ignored');
  assert.equal(mover.onAuthoritative({ seq: 1, x: 10, y: 0, fix: true, ep: 9, now: 300 }).kind, 'ignored');
  mover.step({ waypoint: { x: 100, y: 0 }, now: 400, seq: 2 });
  assert.equal(mover.onAuthoritative({ seq: 2, x: 999, y: 0, fix: true, ep: 9, now: 500 }).kind, 'soft');
  assert.equal(mover.onAuthoritative({ seq: 2, x: 0, y: 0, fix: true, ep: 9, now: 600 }).kind, 'stale');
  assert.equal(mover.onAuthoritative({ seq: 2, x: 999, y: 0, fix: true, ep: 10, now: 400 }).kind, 'stale');
});

test('same input schedule produces the same output', () => {
  const a = new PredictedMover({ position: { x: 4, y: 7 }, speed: WALK_SPEED, epoch: 1 });
  const b = new PredictedMover({ position: { x: 4, y: 7 }, speed: WALK_SPEED, epoch: 1 });
  const inputs = [
    { waypoint: { x: 300, y: 40 }, now: 100, seq: 1 },
    { waypoint: { x: 300, y: 40 }, now: 200, seq: 2 },
    { waypoint: { x: 300, y: 40 }, now: 700, seq: 3 },
  ];
  assert.deepEqual(inputs.map((input) => a.step(input)), inputs.map((input) => b.step(input)));
  assert.deepEqual(
    a.onAuthoritative({ seq: 2, x: 20, y: 9, fix: true, ep: 1, now: 800 }),
    b.onAuthoritative({ seq: 2, x: 20, y: 9, fix: true, ep: 1, now: 800 }),
  );
  assert.deepEqual(a.position, b.position);
});
