export interface ItemSellRules {
  whitelist: string[]; // Items NEVER to sell (e.g., skill books, high-tier gear, potions)
  blacklist: string[]; // Items to sell automatically (e.g., trash loot, basic mob drops)
  minRetain?: Record<string, number>; // Minimum quantity to retain before selling the rest
  maxSlotsThreshold?: number; // Trigger auto-sell when bag distinct item count exceeds this (e.g. 15)
}

export interface BotConfig {
  /** Master kill switch for legacy quest, inventory, and potion automation. */
  legacyAutomationEnabled?: boolean;
  autoSell: boolean;
  sellRules: ItemSellRules;
  autoBuyHpMp: boolean;
  minHpPotion: number;
  hpRestockItem: string;
  autoEatHp: boolean;
  minHpPercent: number;
  autoFarm: boolean;
  /** Opt-in basic map travel and monster training controller. */
  autoTraining?: boolean;
  /** Exact monster name or ID filter; empty means any monster. */
  trainingMonsterType?: string;
  trainingRadius?: number;
  trainingAttackIntervalMs?: number;
  farmSeed?: string;
  autoDaily: boolean;
  autoCave: boolean;
  /** Explicit quest switches; legacy autoDaily/autoCave remain readable during migration. */
  autoMainQuest?: boolean;
  autoDailyQuest?: boolean;
  autoCaveQuest?: boolean;
  autoTravelToFarm?: boolean;
  farmMapId?: string;
  farmKhu?: number;
  farmX?: number;
  farmY?: number;
  delayRangeMs: {
    min: number;
    max: number;
  };
  tickIntervalSec: number;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  legacyAutomationEnabled: false,
  autoSell: false,
  sellRules: {
    whitelist: [
      'bi_tich_*',
      'thiet_kiem',
      'bach_y',
      'phi_diep',
      'duoc_y_boi',
      'truc_kiem',
      'truc_diep_boi',
      'tu_khi_duoc',
      'phu_thanh_tam',
      'phu_hoa',
      'phu_kim_giap'
    ],
    blacklist: [
      'ca_song',
      'doc_dang_doc_dich',
      'yeu_cot',
      'thanh_tam_hoa'
    ],
    minRetain: {
      'linh_diep': 5,
      'huyet_thao': 5,
      'hat_linh_diep': 3,
      'hat_huyet_thao': 2,
    },
    maxSlotsThreshold: 12
  },
  autoBuyHpMp: false,
  minHpPotion: 5,
  hpRestockItem: 'tu_khi_duoc',
  autoEatHp: false,
  minHpPercent: 50,
  autoFarm: false,
  autoTraining: false,
  trainingMonsterType: '',
  trainingRadius: 80,
  trainingAttackIntervalMs: 1000,
  farmSeed: 'hat_linh_diep',
  autoDaily: false,
  autoCave: false,
  autoMainQuest: false,
  autoDailyQuest: false,
  autoCaveQuest: false,
  autoTravelToFarm: false,
  farmMapId: '',
  farmKhu: 1,
  delayRangeMs: {
    min: 300,
    max: 700,
  },
  tickIntervalSec: 10,
};

export type BotActivityStatus =
  | 'idle'
  | 'selling'
  | 'restocking'
  | 'healing'
  | 'farming'
  | 'training'
  | 'questing'
  | 'daily'
  | 'cave'
  | 'paused'
  | 'error';

export interface BotLogMessage {
  id?: string;
  accountId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  module: string;
  message: string;
}
