export interface FrameMetricsSnapshot {
  frames: number;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  busyRatio: number | null;
  windowMs: number | null;
}

/** Fixed-size frame timing collector. It performs two clock reads per completed frame. */
export class FrameMetrics {
  private readonly durations: Float64Array;
  private readonly starts: Float64Array;
  private cursor = 0;
  private count = 0;
  private totalFrames = 0;
  private emaMs: number | null = null;
  private pendingStart: number | null = null;

  public constructor(
    private readonly now: () => number,
    private readonly capacity = 600,
    private readonly emaAlpha = 0.1,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('FRAME_METRICS_CAPACITY_INVALID');
    if (!(emaAlpha > 0 && emaAlpha <= 1)) throw new Error('FRAME_METRICS_ALPHA_INVALID');
    this.durations = new Float64Array(capacity);
    this.starts = new Float64Array(capacity);
  }

  public begin(): void {
    this.pendingStart = this.now();
  }

  public end(): void {
    if (this.pendingStart === null) return;
    const start = this.pendingStart;
    const endedAt = this.now();
    this.pendingStart = null;
    const duration = Math.max(0, endedAt - start);
    this.durations[this.cursor] = duration;
    this.starts[this.cursor] = start;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
    this.totalFrames += 1;
    this.emaMs = this.emaMs === null ? duration : this.emaAlpha * duration + (1 - this.emaAlpha) * this.emaMs;
  }

  public snapshot(): FrameMetricsSnapshot {
    if (this.count === 0) {
      return { frames: this.totalFrames, avgMs: null, p95Ms: null, maxMs: null, busyRatio: null, windowMs: null };
    }
    const values = new Array<number>(this.count);
    let totalMs = 0;
    let maxMs = 0;
    for (let index = 0; index < this.count; index += 1) {
      const value = this.durations[index];
      values[index] = value;
      totalMs += value;
      if (value > maxMs) maxMs = value;
    }
    values.sort((left, right) => left - right);
    const oldestIndex = this.count === this.capacity ? this.cursor : 0;
    const windowMs = Math.max(0, this.now() - this.starts[oldestIndex]);
    return {
      frames: this.totalFrames,
      avgMs: this.emaMs,
      p95Ms: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)],
      maxMs,
      busyRatio: windowMs === 0 ? null : Math.max(0, totalMs / windowMs),
      windowMs,
    };
  }

  public reset(): void {
    this.cursor = 0;
    this.count = 0;
    this.totalFrames = 0;
    this.emaMs = null;
    this.pendingStart = null;
  }
}
