export interface JitterOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  maxOpsPerSecond?: number;
}

export class AntiDetectionManager {
  private minDelayMs: number;
  private maxDelayMs: number;
  private maxOpsPerSecond: number;
  private lastActionTime: number = 0;
  private actionQueue: Promise<void> = Promise.resolve();

  constructor(options?: JitterOptions) {
    this.minDelayMs = options?.minDelayMs ?? 300;
    this.maxDelayMs = options?.maxDelayMs ?? 700;
    this.maxOpsPerSecond = options?.maxOpsPerSecond ?? 5;
  }

  public setDelayRange(min: number, max: number): void {
    this.minDelayMs = Math.max(50, min);
    this.maxDelayMs = Math.max(this.minDelayMs, max);
  }

  /**
   * Generates a random delay simulating human interaction timing
   */
  public getRandomDelay(): number {
    const range = this.maxDelayMs - this.minDelayMs;
    // Box-Muller or triangular distribution around median for more natural human delay
    const skew = (Math.random() + Math.random()) / 2;
    return Math.floor(this.minDelayMs + skew * range);
  }

  /**
   * Sleep for randomized human-like jitter duration
   */
  public async humanDelay(extraFactor: number = 1.0): Promise<void> {
    const delay = Math.round(this.getRandomDelay() * extraFactor);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Enqueue an operation ensuring strict rate limiting and human jitter spacing
   */
  public enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.actionQueue = this.actionQueue.then(async () => {
        const now = Date.now();
        const minSpacingMs = 1000 / this.maxOpsPerSecond;
        const elapsedSinceLast = now - this.lastActionTime;

        if (elapsedSinceLast < minSpacingMs) {
          const waitMs = minSpacingMs - elapsedSinceLast;
          await new Promise((r) => setTimeout(r, waitMs));
        }

        const jitterWait = this.getRandomDelay();
        await new Promise((r) => setTimeout(r, jitterWait));

        try {
          const result = await operation();
          this.lastActionTime = Date.now();
          resolve(result);
        } catch (err) {
          this.lastActionTime = Date.now();
          reject(err);
        }
      });
    });
  }
}
