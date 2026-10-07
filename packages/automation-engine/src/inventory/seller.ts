import { TuTienClient } from '@tutien2d/core-client';
import { ItemSellRules } from '../types.js';

export class InventorySellerModule {
  private client: TuTienClient;
  private rules: ItemSellRules;

  constructor(client: TuTienClient, rules: ItemSellRules) {
    this.client = client;
    this.rules = rules;
  }

  public updateRules(rules: ItemSellRules): void {
    this.rules = rules;
  }

  private isWhitelisted(itemId: string): boolean {
    for (const pattern of this.rules.whitelist) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (itemId.startsWith(prefix)) return true;
      } else if (pattern === itemId) {
        return true;
      }
    }
    return false;
  }

  private isBlacklisted(itemId: string): boolean {
    return this.rules.blacklist.includes(itemId);
  }

  /**
   * Determine whether an item should be sold based on whitelist, blacklist, and retained quantity
   */
  public shouldSellItem(itemId: string, currentCount: number): boolean {
    if (this.isWhitelisted(itemId)) {
      return false;
    }

    if (this.isBlacklisted(itemId)) {
      return true;
    }

    // Check minRetain rule
    const minRetain = this.rules.minRetain?.[itemId];
    if (typeof minRetain === 'number') {
      return currentCount > minRetain;
    }

    return false;
  }

  /**
   * Run a pass over the inventory and sell eligible items
   */
  public async executeSellPass(): Promise<{ soldItems: string[]; totalSold: number }> {
    const bag = this.client.state.bag;
    const initialStones = this.client.state.stones;
    const soldItems: string[] = [];

    const itemKeys = Object.keys(bag);
    for (const itemId of itemKeys) {
      const count = bag[itemId] || 0;
      if (count <= 0) continue;

      if (this.shouldSellItem(itemId, count)) {
        try {
          const ack = await this.client.sellItem(itemId);
          if (ack.ok) {
            soldItems.push(itemId);
          }
        } catch (err: any) {
          this.client.log('warn', `Lỗi khi bán ${itemId}: ${err.message}`);
        }
      }
    }

    const earnedStones = Math.max(0, this.client.state.stones - initialStones);
    if (soldItems.length > 0) {
      this.client.log(
        'success',
        `[Bán Đồ] Hoàn tất bán ${soldItems.length} loại vật phẩm (${soldItems.join(', ')}). Thu về ~${earnedStones} Linh Thạch.`
      );
    }

    return {
      soldItems,
      totalSold: soldItems.length,
    };
  }
}
