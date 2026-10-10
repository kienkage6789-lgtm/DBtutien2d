import assert from 'node:assert/strict';
import test from 'node:test';
import { ProcessMetrics, type EventLoopHistogramLike } from './process-metrics.js';

class FakeHistogram implements EventLoopHistogramLike {
  public enabled = false;
  public count = 3;
  public max = 44_000_000;
  public enable(): void { this.enabled = true; }
  public disable(): void { this.enabled = false; }
  public percentile(percentile: number): number { return percentile === 50 ? 25_000_000 : 44_000_000; }
}

test('process metrics subtract sampling resolution and convert histogram nanoseconds to milliseconds', () => {
  const histogram = new FakeHistogram();
  const metrics = new ProcessMetrics({
    createHistogram: () => histogram,
    memoryUsage: () => ({ rss: 1234, heapUsed: 567 }),
  });
  assert.equal(histogram.enabled, false);
  metrics.start();
  assert.equal(histogram.enabled, true);
  assert.deepEqual(metrics.snapshot(2), {
    eventLoopDelay: { p50Ms: 5, p99Ms: 24, maxMs: 24 },
    rssBytes: 1234,
    heapUsedBytes: 567,
    runningRunners: 2,
  });
  metrics.stop();
  assert.equal(histogram.enabled, false);
  assert.deepEqual(metrics.snapshot(0).eventLoopDelay, { p50Ms: null, p99Ms: null, maxMs: null });
});

test('process metrics clamp raw values below sampling resolution to zero', () => {
  const histogram = new FakeHistogram();
  histogram.max = 19_000_000;
  histogram.percentile = (percentile: number): number => percentile === 50 ? 19_000_000 : 20_000_000;
  const metrics = new ProcessMetrics({ createHistogram: () => histogram, memoryUsage: () => ({ rss: 1, heapUsed: 1 }) });
  metrics.start();
  assert.deepEqual(metrics.snapshot(0).eventLoopDelay, { p50Ms: 0, p99Ms: 0, maxMs: 0 });
});

test('process metrics report delay as unknown until histogram has samples', () => {
  const histogram = new FakeHistogram();
  histogram.count = 0;
  const metrics = new ProcessMetrics({ createHistogram: () => histogram, memoryUsage: () => ({ rss: 1, heapUsed: 1 }) });
  metrics.start();
  assert.deepEqual(metrics.snapshot(0).eventLoopDelay, { p50Ms: null, p99Ms: null, maxMs: null });
});
