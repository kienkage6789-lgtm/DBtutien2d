export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  expiresAt: number | null;
  maxBots: number;
  mustChangePassword: boolean;
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
  lifecycle: string;
  connection: string;
  autoRequested: boolean;
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

export interface AccountRuntime {
  id: string;
  accountName: string;
  engine: 'vendor';
  vendor?: VendorRuntimeSnapshot;
  status: 'running' | 'stopped' | 'error';
  connection: string;
  authError: string | null;
  hasPassword: boolean;
  tokenExpiresAt: number | null;
  characterName: string;
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
  mapId: string;
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
