import { TuTienClient } from '@tutien2d/core-client';

export interface RestockerOptions {
  autoBuyHpMp: boolean;
  minHpPotion: number;
  hpRestockItem: string;
  autoEatHp: boolean;
  minHpPercent: number;
}

export class RestockerModule {
  private client: TuTienClient;
  private options: RestockerOptions;
  private lastEatTime: number = 0;
  private lastBuyTime: number = 0;

  constructor(client: TuTienClient, options: RestockerOptions) {
    this.client = client;
    this.options = options;
  }

  public updateOptions(options: Partial<RestockerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Check HP and use potion if wounded
   */
  public async checkHealthAndHeal(): Promise<boolean> {
    if (!this.options.autoEatHp) return false;

    // Throttle eating to avoid spamming potions
    if (Date.now() - this.lastEatTime < 3000) return false;

    const derivedMax = this.client.state.derivedMax;
    const hp = this.client.state.vitals.hp;
    if (this.client.state.vitals.status !== 'fresh' || hp === null || !derivedMax.complete || derivedMax.maxHp === null || derivedMax.maxHp <= 0) return false;
    const hpPercent = Math.round((hp / derivedMax.maxHp) * 100);
    if (hpPercent <= this.options.minHpPercent) {
      const potionId = this.options.hpRestockItem;
      const count = this.client.state.getItemCount(potionId);

      if (count > 0) {
        this.client.log('info', `[Tự Dùng Đan] HP chỉ còn ${hpPercent}%, đang dùng ${potionId}...`);
        try {
          const ack = await this.client.eatFood(potionId);
          this.lastEatTime = Date.now();
          return ack.ok;
        } catch (err: any) {
          this.client.log('warn', `Dùng dược phẩm lỗi: ${err.message}`);
        }
      } else {
        this.client.log('warn', `[Cảnh Báo] HP thấp (${hpPercent}%) nhưng túi đồ đã hết ${potionId}!`);
      }
    }
    return false;
  }

  /**
   * Check potion stockpile and buy more if below threshold
   */
  public async checkStockAndBuy(): Promise<boolean> {
    if (!this.options.autoBuyHpMp) return false;

    // Throttle buying attempts
    if (Date.now() - this.lastBuyTime < 15000) return false;

    const potionId = this.options.hpRestockItem;
    const currentCount = this.client.state.getItemCount(potionId);

    if (currentCount < this.options.minHpPotion) {
      const needed = Math.max(1, this.options.minHpPotion * 2 - currentCount);
      this.client.log(
        'info',
        `[Tiệm Thuốc] Số lượng ${potionId} trong túi (${currentCount}) < định mức (${this.options.minHpPotion}). Đang mua thêm ${needed}...`
      );

      try {
        const ack = await this.client.buyFood(potionId, needed);
        this.lastBuyTime = Date.now();
        return ack.ok;
      } catch (err: any) {
        this.client.log('warn', `Mua bổ sung đan dược lỗi: ${err.message}`);
      }
    }
    return false;
  }
}
