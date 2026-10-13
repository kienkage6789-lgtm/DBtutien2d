export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  expiresAt: number | null;
  maxBots: number;
  mustChangePassword: boolean;
  entitlement: {
    state: 'admin' | 'active' | 'expired' | 'none' | 'disabled';
    expiresAt: number | null;
    remainingMs: number | null;
  };
  usage?: { accounts: number; running: number; maxBots: number };
  serverClockOffsetMs?: number;
}

export interface AdminUsage {
  accounts: number;
  running: number;
  maxBots: number;
}

export interface AdminUser extends AuthUser {
  createdAt: string;
  lastLoginAt: string | null;
  createdBy: string | null;
  usage: AdminUsage;
  activeSessions: number;
}

export interface AuditLogEntry {
  id: string;
  at: number;
  action: string;
  actor: { id: string; username: string } | null;
  targetType: string;
  targetId: string | null;
  targetName?: string;
  detail: string;
}

export type MoveToStatus = 'accepted' | 'running' | 'arrived' | 'blocked' | 'failed' | 'cancelled';
export type MoveToLegPhase = 'walking_to_gate' | 'on_gate' | 'waiting_map' | 'walking_to_target';

export interface MoveToOperation {
  operationId: string;
  target: { x: number; y: number } | null;
  resolvedTarget: { x: number; y: number } | null;
  status: MoveToStatus;
  reason?: string;
  requester: string;
  startedAt: number;
  updatedAt: number;
  route?: string[];
  leg?: {
    index: number;
    fromMapId: string;
    toMapId: string | null;
    phase: MoveToLegPhase;
  };
}

export type DailyOperationStatus = 'accepted' | 'running' | 'done' | 'failed' | 'cancelled';
export type DailyOperationKind = 'checkin' | 'seed';

export interface DailyOperation {
  operationId: string;
  kind: DailyOperationKind;
  taskId?: string;
  status: DailyOperationStatus;
  step: string;
  runIndex: number;
  runsTotal: number;
  reason?: string;
  why?: string;
  rewards?: { stones: number; duocCong: number };
  progress?: { itemId: string; collected: number; required: number };
  startedAt: number;
  updatedAt: number;
}

export interface DailySeedTask {
  id: string;
  name: string;
  kind: string;
  limit: number | null;
  runsToday: number | null;
  runsLeft: number | null;
  supported: boolean;
  active: boolean;
}

export interface DailyStatus {
  today: string | null;
  stage: number | null;
  checkin: { done: boolean; total: number | null };
  seedTasks: DailySeedTask[];
  activeSeedTask: string | null;
  stones: number | null;
  duocCong: number | null;
  canhKho: number | null;
  namLinhChi: number | null;
  fishInBag: number | null;
}

export interface ReachableMap {
  mapId: string;
  name?: string;
  hops: number;
  route: string[];
}

export interface VendorRuntimeSnapshot {
  dataStale?: boolean;
  lifecycle: string;
  connection: string;
  reconnectAttempts?: number;
  autoRequested: boolean;
  autoResume?: { pending: boolean; since: number | null; expiresAt: number | null } | null;
  supervisor: {
    phase: string;
    anchor: { mapId: string; khu?: number | null; x: number; y: number } | null;
    reasonCode: string | null;
    stats: { deaths: number; revives: number; trips: number; resumed: number };
  };
  hurtCount: number;
  lastHurtAt: number | null;
  killsBySelf: number;
  packetErrors: number;
  updateErrors: number;
  frames: number;
  fps: number;
  uptimeMs: number;
  memory: { rssBytes: number; rssGrowthBytes: number };
  tokenExpiresAt: number | null;
  mapId: string | null;
  khu: number | null;
  soKhu: number | null;
  x: number | null;
  y: number | null;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  downed: boolean | null;
  consoleErrors: string[];
  moveTo: MoveToOperation | null;
  daily: DailyOperation | null;
  dailyStatus: DailyStatus | null;
  khuList: KhuList | null;
}

export interface KhuList {
  mapId: string;
  khu: number;
  dem: number[];
  toiDa: number;
  tran: number[];
  observedAt: number;
}

export interface KhuInfo {
  mapId: string | null;
  khu: number | null;
  soKhu: number | null;
  list: KhuList | null;
}

export interface GardenOperation { id: string; kind: 'buy-pack' | 'sow' | 'harvest'; status: 'running' | 'done' | 'failed' | 'cancelled'; progress: { current: number; total: number }; results: Array<{ target: string; ok: boolean; code?: string }>; error?: string; errorReason?: string; startedAt: number; updatedAt: number }
export interface GardenSnapshot { known: boolean; mapId: string | null; inGarden: boolean; unlocked: boolean | null; duocCong: number | null; at: number | null; operation: GardenOperation | null;
  plots: Array<{ id: string; index: number; state: 'empty' | 'growing' | 'ready' | 'unknown'; seedId: string | null; seedName: string | null; cropId: string | null; cropName: string | null; watered: boolean | null; remainSec: number | null; readyAt: number | null }>;
  seeds: Array<{ seedId: string; name: string; count: number | null; growSec: number | null; wetSec: number | null; tier: string | null }>;
  packs: Array<{ id: string; name: string; cost: number | null; realm: string | null; unlocked: boolean | null; affordable: boolean | null; give: Array<{ itemId: string; name: string; qty: number | null }> }> }

export interface InventoryItem {
  id: string;
  name: string;
  count: number;
  openable: boolean;
  type: string | null;
  grade: string | number | null;
  slot: string | null;
  icon: string | null;
  desc: string | null;
  group: 'vat-pham' | 'trang-bi' | 'dao-thuat' | null;
}

export interface InventoryEquipmentItem { id: string; name: string; grade: string | number | null }
export interface InventoryEquipmentSlot { slotId: string; slotName: string; item: InventoryEquipmentItem | null }

export interface InventorySnapshot {
  known: boolean;
  items: InventoryItem[];
  bag: { usedSlots: number | null; capacity: number | null; extraSlots: number | null; maxExtraSlots: number | null; nextSlotPrice: number | null } | null;
  equipment: InventoryEquipmentSlot[] | null;
  totalKinds: number | null;
  totalCount: number | null;
  caveChest: { keyCount: number; claimed: boolean; active: boolean } | null;
  at: number | null;
}

export interface FrameMetricsSnapshot {
  frames: number;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  busyRatio: number | null;
  windowMs: number | null;
}

export interface AccountRuntime {
  id: string;
  ownerId: string | null;
  ownerUsername: string | null;
  accountName: string;
  engine: 'vendor';
  vendor?: VendorRuntimeSnapshot;
  metrics?: FrameMetricsSnapshot | null;
  status: 'running' | 'stopped' | 'error';
  dataStale: boolean;
  connection: string;
  authError: string | null;
  hasProxy: boolean;
  proxy?: { id: string; label: string; status: 'unknown' | 'ok' | 'down'; endpoint: string; hasAuth: boolean } | null;
  hasPassword: boolean;
  tokenExpiresAt: number | null;
  characterName: string;
  character?: { realmId?: string | null; realmName: string | null; sp: number | null; spMax: number | null; bp: number | null; bpMax: number | null; exp: number | null; expMax: number | null; stones: number | null; stonesToday: number | null; stonesCap: number | null; stonesSessionNet: number | null; fresh?: boolean; observedAt?: number | null } | null;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  vitals: {
    hp: number | null;
    maxHp: number | null;
    mp: number | null;
    maxMp: number | null;
    status: 'unknown' | 'fresh' | 'stale' | 'invalid' | 'conflict';
    source: 'client' | null;
    observedAt: number | null;
  };
  vitalsAgeMs: number | null;
  vitalsReceivedAt?: number;
  derivedMax: {
    maxHp: number | null;
    maxMp: number | null;
    complete: boolean;
    source: 'derived';
    observedAt: number | null;
  };
  downed: boolean | null;
  mapId: string | null;
  khu: number | null;
  x: number | null;
  y: number | null;
  moveTo: MoveToOperation | null;
  daily: DailyOperation | null;
  dailyStatus: DailyStatus | null;
  latencyMs: number;
  activity: string;
  soKhu: number | null;
  khuList: KhuList | null;
  mapContext: MapDataContext;
  mapContextAgeMs: number | null;
  mapContextIsCurrent: boolean;
  mapContextEpoch?: number | null;
  mapContextReceivedAt?: number;
  playersContext: MapEntityContext;
  monstersContext: MapEntityContext;
  dataStatus: {
    hp: boolean;
    maxHp: boolean;
    mp: boolean;
    maxMp: boolean;
    location: boolean;
    monsters: boolean;
    players: boolean;
  };
  monsters: Array<{ id: string; name?: string; x: number; y: number; hp?: number; maxHp?: number }>;
  players: Array<{ id: string; name?: string; x: number; y: number; realm?: string; hp?: number }>;
}

export type ProxyStatus = 'unknown' | 'ok' | 'down';

export interface AdminProxy {
  id: string;
  label: string;
  scheme: 'http' | 'socks5';
  endpoint: string;
  hasAuth: boolean;
  maxAccounts: number;
  enabled: boolean;
  status: ProxyStatus;
  lastCheckAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  assigned: number;
  accounts: Array<{ id: string; accountName: string; ownerUsername: string; running: boolean }>;
  createdAt: string;
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

export interface LogEntry {
  id: string;
  accountId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  module: string;
  message: string;
}
