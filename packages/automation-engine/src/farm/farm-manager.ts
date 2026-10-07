import { TuTienClient } from '@tutien2d/core-client';

export class FarmCaretakerModule {
  private client: TuTienClient;
  private defaultSeed: string;
  private lastFarmPassTime: number = 0;
  private isProcessing: boolean = false;

  constructor(client: TuTienClient, defaultSeed: string = 'hat_linh_diep') {
    this.client = client;
    this.defaultSeed = defaultSeed;
  }

  public setSeed(seed: string): void {
    this.defaultSeed = seed;
  }

  /**
   * Run cycle over plots 1 to 5 (or configured plots)
   */
  public async executeFarmCycle(shouldContinue: () => boolean = () => true): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.lastFarmPassTime = Date.now();

    try {
      this.client.log('info', `[Dược Điền] Bắt đầu kiểm tra và chăm sóc dược điền...`);

      // Default 4 initial farm plots
      for (let plot = 1; plot <= 4; plot++) {
        if (!shouldContinue()) return;
        // Harvest any mature crop
        try {
          const harvestAck = await this.client.farmHarvest(plot);
          if (!shouldContinue()) return;
          if (harvestAck.ok) {
            this.client.log('success', `[Dược Điền] Thu hoạch thành công luống ${plot}!`);
          }
        } catch (_) {}

        // Check if we have seeds to sow
        const seedCount = this.client.state.getItemCount(this.defaultSeed);
        if (seedCount > 0) {
          if (!shouldContinue()) return;
          try {
            const sowAck = await this.client.farmSow(plot, this.defaultSeed);
            if (!shouldContinue()) return;
            if (sowAck.ok) {
              this.client.log('success', `[Dược Điền] Đã gieo ${this.defaultSeed} vào luống ${plot}`);
            }
          } catch (_) {}
        }

        // Water plot
        if (!shouldContinue()) return;
        try {
          const waterAck = await this.client.farmWater(plot);
          if (!shouldContinue()) return;
          if (waterAck.ok) {
            this.client.log('info', `[Dược Điền] Đã tưới nước cho luống ${plot}`);
          }
        } catch (_) {}
      }
    } finally {
      this.isProcessing = false;
    }
  }

  public canRunCycle(intervalMs: number = 60000): boolean {
    return Date.now() - this.lastFarmPassTime > intervalMs;
  }
}
