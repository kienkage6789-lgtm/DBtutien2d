import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameMetrics } from './frame-metrics.js';

test('frame metrics calculate EMA, p95, max and busy ratio from an injected clock', () => {
  let now = 0;
  const metrics = new FrameMetrics(() => now, 10, 0.5);
  for (const duration of [2, 4]) {
    metrics.begin();
    now += duration;
    metrics.end();
    now += 3;
  }
  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot, { frames: 2, avgMs: 3, p95Ms: 4, maxMs: 4, busyRatio: 0.5, windowMs: 12 });
});

test('frame metrics use a fixed sliding window and tolerate end without begin', () => {
  let now = 0;
  const metrics = new FrameMetrics(() => now, 3, 1);
  metrics.end();
  assert.equal(metrics.snapshot().avgMs, null);
  for (const duration of [100, 2, 3, 4]) {
    metrics.begin();
    now += duration;
    metrics.end();
  }
  assert.deepEqual(metrics.snapshot(), { frames: 4, avgMs: 4, p95Ms: 4, maxMs: 4, busyRatio: 1, windowMs: 9 });
});

test('frame metrics return null before samples and after reset', () => {
  let now = 0;
  const metrics = new FrameMetrics(() => now);
  assert.deepEqual(metrics.snapshot(), { frames: 0, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null });
  metrics.begin();
  now += 1;
  metrics.end();
  metrics.reset();
  assert.deepEqual(metrics.snapshot(), { frames: 0, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null });
});

test('zero elapsed window reports unknown busy ratio', () => {
  const metrics = new FrameMetrics(() => 0);
  metrics.begin();
  metrics.end();
  assert.equal(metrics.snapshot().busyRatio, null);
});
