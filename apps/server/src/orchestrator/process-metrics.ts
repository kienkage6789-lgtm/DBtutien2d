import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

const EVENT_LOOP_RESOLUTION_MS = 20;

export interface ProcessMetricsSnapshot {
  eventLoopDelay: { p50Ms: number | null; p99Ms: number | null; maxMs: number | null };
  rssBytes: number;
  heapUsedBytes: number;
  runningRunners: number;
}

export interface EventLoopHistogramLike {
  enable(): unknown;
  disable(): unknown;
  percentile(percentile: number): number;
  readonly max: number;
  readonly count: number;
}

export interface ProcessMetricsHooks {
  createHistogram(): EventLoopHistogramLike;
  memoryUsage(): { rss: number; heapUsed: number };
}

const defaultHooks: ProcessMetricsHooks = {
  createHistogram: () => monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS }) as IntervalHistogram,
  memoryUsage: () => process.memoryUsage(),
};

export class ProcessMetrics {
  private histogram: EventLoopHistogramLike | null = null;

  public constructor(private readonly hooks: ProcessMetricsHooks = defaultHooks) {}

  public start(): void {
    if (this.histogram) return;
    this.histogram = this.hooks.createHistogram();
    this.histogram.enable();
  }

  public stop(): void {
    this.histogram?.disable();
    this.histogram = null;
  }

  public snapshot(runningRunners: number): ProcessMetricsSnapshot {
    const histogram = this.histogram;
    const hasSamples = !!histogram && histogram.count > 0;
    // The measured floor also includes the OS timer resolution (about 15.6 ms on Windows),
    // so an idle process may still report a few milliseconds; do not guess an extra correction.
    const ms = (value: number): number | null => hasSamples && Number.isFinite(value)
      ? Math.max(0, value / 1_000_000 - EVENT_LOOP_RESOLUTION_MS)
      : null;
    const memory = this.hooks.memoryUsage();
    return {
      eventLoopDelay: {
        p50Ms: hasSamples ? ms(histogram!.percentile(50)) : null,
        p99Ms: hasSamples ? ms(histogram!.percentile(99)) : null,
        maxMs: hasSamples ? ms(histogram!.max) : null,
      },
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      runningRunners: Number.isFinite(runningRunners) ? Math.max(0, Math.floor(runningRunners)) : 0,
    };
  }
}

export const processMetrics = new ProcessMetrics();
