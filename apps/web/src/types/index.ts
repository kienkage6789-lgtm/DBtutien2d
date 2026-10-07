export interface AccountRuntime {
  id: string;
  accountName: string;
  status: 'running' | 'stopped' | 'error';
  connection?: string;
  authError?: string | null;
  hasPassword?: boolean;
  tokenExpiresAt?: number | null;
  characterName: string;
  realm: string;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  vitals?: {
    hp: number | null;
    maxHp: number | null;
    mp: number | null;
    maxMp: number | null;
    status: 'unknown' | 'fresh' | 'stale' | 'invalid' | 'conflict';
    reason?: string;
    source: 'state' | 'status' | 'you' | 'hurt' | 'revived' | null;
    observedAt: number | null;
  };
  derivedMax?: {
    maxHp: number | null;
    maxMp: number | null;
    complete: boolean;
    source: 'derived';
    observedAt: number | null;
  };
  downed?: boolean | null;
  /** Weak self-row presence signal; its hp is a percentage estimate only. */
  selfPresence?: { hpPercent: number | null; observedAt: number } | null;
  stones: number | null;
  stonesSnapshot?: {
    value: number | null;
    status: 'unknown' | 'fresh' | 'stale' | 'invalid';
    source: 'state' | 'formation' | null;
    observedAt: number | null;
  };
  mapId: string;
  khu: number;
  x: number;
  y: number;
  bagCount: number;
  latencyMs: number;
  activity: string;
  navigation?: {
    operationId: string | null;
    phase: 'idle' | 'planning' | 'moving_to_portal' | 'waiting_map_confirmation' | 'arrived' | 'blocked' | 'failed';
    currentMapId: string | null;
    targetMapId: string | null;
    route: Array<{ portalId: string; fromMapId: string; toMapId: string; tx: number; ty: number; label?: string }>;
    routeIndex: number;
    attempt: number;
    maxAttempts: number;
    commandAt: number | null;
    deadlineAt: number | null;
    updatedAt: number | null;
    reason: string | null;
  };
  moveTo?: {
    requestId: string;
    operationId: string;
    status: 'accepted' | 'running' | 'arrived' | 'blocked' | 'failed' | 'cancelled';
    mapId: string;
    khu: number;
    x: number;
    y: number;
    updatedAt: number;
    reason: string | null;
  } | null;
  bag: Record<string, number>;
  farmMapId: string;
  farmKhu: number;
  farmX: number;
  farmY: number;
  training?: {
    enabled: boolean;
    phase: string;
    sessionId: string | null;
    reason?: string;
    pending?: { type: string; operationId: string; targetId?: string; mapId?: string; x?: number; y?: number } | null;
    target: { mapId: string; khu: number; x: number | null; y: number | null; radius: number; attackIntervalMs: number; monsterType: string | null };
    protocol: { khuSelectionSupported: boolean; respawnSupported: boolean };
  };
  /** Authoritative khu count from the current map packet. */
  soKhu?: number | null;
  mapContext?: MapDataContext | null;
  /** Context age computed by backend at frame send time. */
  mapContextAgeMs?: number | null;
  /** Whether backend confirms context matches current client state. */
  mapContextIsCurrent?: boolean;
  /** Optional backend epoch for rejecting pre-transition frames. */
  mapContextEpoch?: number | null;
  /** Client receipt time for the frame carrying mapContext. */
  mapContextReceivedAt?: number;
  playersContext?: MapEntityContext | null;
  monstersContext?: MapEntityContext | null;
  worldSync?: {
    received: number;
    accepted: number;
    resyncs: number;
    legacyReceived: number;
    fullReceived: number;
    fullRejected: number;
    lastSequence: number | null;
    lastReceivedAt: number | null;
    lastAcceptedAt: number | null;
    lastLegacyReceivedAt: number | null;
    lastPacketFull: boolean | number | string | null;
    lastPacketKeys: string[];
    lastFullSequence: number | string | null;
    lastFullEpoch: number | string | null;
    lastFullShape: {
      players: number;
      monsters: number;
      playerIdType: string | null;
      monsterIdType: string | null;
      playerKeys: string[];
      monsterKeys: string[];
    } | null;
    lastFullRejectReason: string | null;
    lastRejectReason: string | null;
    monsterRowsSeen?: number;
    monsterPatchRowsSeen?: number;
    lastMonsterRowsAt?: number | null;
  };
  /** False means the backend has not received an authoritative packet for this data yet. */
  dataStatus: {
    realm: boolean;
    hp: boolean;
    maxHp: boolean;
    mp: boolean;
    maxMp: boolean;
    stones?: boolean;
    location: boolean;
    monsters: boolean;
    players: boolean;
  };
  monsters: Array<{
    id: string;
    name?: string;
    x: number;
    y: number;
    hp?: number;
    maxHp?: number;
  }>;
  players: Array<{
    id: string;
    name?: string;
    x: number;
    y: number;
    realm?: string;
    hp?: number;
  }>;
}

export interface MapDataContext {
  mapId: string | null;
  khu: number | null;
  soKhu: number | null;
  observedAt: number | null;
  fresh: boolean;
}

export interface MapEntityContext {
  mapId: string | null;
  khu: number | null;
  observedAt: number | null;
  fresh: boolean;
}

export interface DiscoveredMap {
  id: string;
  name: string;
  scope: 'shared' | 'personal' | null;
  soKhu: number | null;
  lastSeenAt: number | null;
  observed: boolean;
  catalogSource: 'public_client' | 'observed_packet';
}

export interface MapCatalog {
  status: 'available' | 'empty' | 'unavailable';
  source: 'public_client_catalog' | 'unavailable';
  maps: DiscoveredMap[];
}

export interface MapRequestReceipt {
  status: 'navigation_started' | 'already_at_destination';
  mapId: string;
  operationId: string | null;
  route: Array<{ portalId: string; fromMapId: string; toMapId: string; tx: number; ty: number; label?: string }>;
}

export interface BotConfig {
  autoSell: boolean;
  sellRules: {
    whitelist: string[];
    blacklist: string[];
    minRetain?: Record<string, number>;
    maxSlotsThreshold?: number;
  };
  autoBuyHpMp: boolean;
  minHpPotion: number;
  hpRestockItem: string;
  autoEatHp: boolean;
  minHpPercent: number;
  autoFarm: boolean;
  farmSeed?: string;
  autoDaily: boolean;
  autoCave: boolean;
  autoMainQuest?: boolean;
  autoDailyQuest?: boolean;
  autoCaveQuest?: boolean;
  autoTravelToFarm?: boolean;
  farmMapId?: string;
  farmKhu?: number;
  farmX?: number;
  farmY?: number;
  autoTraining?: boolean;
  trainingRadius?: number;
  trainingAttackIntervalMs?: number;
  trainingMonsterType?: string;
  delayRangeMs: {
    min: number;
    max: number;
  };
  tickIntervalSec: number;
}

export interface LogEntry {
  id: string;
  accountId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  module: string;
  message: string;
}
