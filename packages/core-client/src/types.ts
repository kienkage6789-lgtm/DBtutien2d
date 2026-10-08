export type Direction = 0 | 1 | 2 | 3; // 0: Up, 1: Right, 2: Down, 3: Left
export type MoveState = 'idle' | 'walk' | 'sit' | 'cast' | 'attack';

export interface ClientHelloPacket {
  op: 'hello';
  proto: number;
  snap: number;
  name: string;
  token: string;
  features: {
    formation?: number;
    [key: string]: any;
  };
}

export interface PingPacket {
  op: 'ping';
  t: number;
  ns?: {
    v?: number;
    s?: number;
    u?: number;
    l?: number;
    d?: number;
    n?: number;
    q?: number;
  };
}

export interface PongPacket {
  op: 'pong';
  t: number;
  serverTime: number;
}

export interface Appearance {
  name?: string;
  gender?: string;
  outfit?: string;
  hair?: string;
  eyeColor?: string;
  [key: string]: any;
}

export interface WelcomePacket {
  op: 'welcome';
  selfId: string;
  name: string;
  tickHz?: number;
  serverTime?: number;
  hasChar?: boolean;
  snap?: number;
  appearance?: Appearance;
  /** Server map epoch used to reject stale movement packets. */
  ep?: number;
}

export interface QuestFlags {
  [flagName: string]: any;
}

export interface SeedQuestDailyTask {
  n: number;
  day: string;
}

export interface SeedQuest {
  task: string | null;
  daily?: Record<string, SeedQuestDailyTask>;
  round?: number;
  active?: boolean;
  collected?: Record<string, any>;
}

export interface QuestSave {
  questVersion?: number;
  stage?: number;
  flags?: QuestFlags;
  seedQuest?: SeedQuest;
  patrolKills?: number;
  kills?: number;
  /** Character snapshot fields sent inside state.save by the public client. */
  realm?: string;
  exp?: number;
  stones?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  bag?: Record<string, number>;
  equipment?: Record<string, string | null>;
  bound?: Record<string, number>;
}

export interface StatePacket {
  op: 'state';
  duocCong?: number;
  stones?: number;
  realm?: string;
  exp?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  /** Legacy status aliases sometimes included in a state packet. */
  ht?: number;
  hm?: number;
  sh?: number;
  slm?: number;
  mapId?: string;
  khu?: number;
  x?: number;
  y?: number;
  p?: MapPlayer[];
  e?: MapEnemy[];
  bag?: Record<string, number>;
  equipment?: Record<string, string | null>;
  save?: QuestSave;
  reason?: string;
  bound?: Record<string, number>;
  farm?: Record<string, any>;
  food?: Record<string, any>;
}

export interface MapPlayer {
  id: string;
  name?: string;
  x: number;
  y: number;
  dir?: number;
  hp?: number;
  realm?: string;
  [key: string]: any;
}

export interface MapEnemy {
  id: string;
  name?: string;
  x: number;
  y: number;
  hp?: number;
  maxHp?: number;
  [key: string]: any;
}

export interface MapPacket {
  op: 'map';
  mapId?: string;
  khu?: number;
  soKhu?: number;
  x?: number;
  y?: number;
  dir?: number;
  p?: MapPlayer[];
  e?: MapEnemy[];
  /** Current server map epoch; movement packets must echo it when present. */
  ep?: number;
}

export interface StatusPacket {
  op: 'status';
  /** Status-effect fields; ht/hm are haste timer/multiplier, not HP. */
  ht?: number;
  hm?: number;
  sh?: number;
  sl?: number;
  slm?: number;
  shT?: number;
  shL?: boolean;
  shB?: boolean;
  st?: number;
  rt?: number;
  fz?: number;
  la?: number;
  bn?: number;
  bd?: number;
  bm?: boolean;
  rk?: number;
  pn?: number;
  pd?: number;
  wn?: number;
  wd?: number;
  wh?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  [key: string]: any;
}

/** Formation balance packet used by the official client to refresh resources. */
export interface FormationPacket {
  op: 'formation';
  act?: string;
  stones?: number;
  mp?: number;
  item?: string;
  itemCount?: number;
  [key: string]: any;
}

export type VitalsStatus = 'unknown' | 'fresh' | 'stale' | 'invalid' | 'conflict';
export type VitalsSource = 'state' | 'status' | 'you' | 'hurt' | 'revived' | 'client' | null;

export type StonesStatus = 'unknown' | 'fresh' | 'stale' | 'invalid';
export type StonesSource = 'state' | 'formation' | null;

/** Canonical linh thạch value. `null` means no authoritative packet observed. */
export interface StonesSnapshot {
  value: number | null;
  status: StonesStatus;
  source: StonesSource;
  observedAt: number | null;
}

/** Canonical character vitals observed from a root state/status packet. */
export interface VitalSnapshot {
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  status: VitalsStatus;
  /** Stable diagnostic reason for invalid/conflicting snapshots. */
  reason?: string;
  source: VitalsSource;
  observedAt: number | null;
}

/** Maxima derived from the official realm/item tables, never a wire vital. */
export interface DerivedMaxSnapshot {
  maxHp: number | null;
  maxMp: number | null;
  complete: boolean;
  source: 'derived';
  observedAt: number | null;
}

export interface CmdPacket {
  op: 'cmd';
  cmd: string;
  rid: number;
  [key: string]: any;
}

export interface AckPacket {
  op: 'ack';
  rid: number;
  ok: boolean;
  why?: string;
  toast?: string;
  data?: any;
  [key: string]: any;
}

export interface MovePacket {
  op: 'move';
  seq: number;
  x: number;
  y: number;
  dir: Direction;
  st: MoveState;
  fly: number;
  fs: number;
  ep?: number;
}

/** Server correction/current self vitals packet used by the official client. */
export interface YouPacket {
  op: 'you';
  seq?: number;
  x?: number;
  y?: number;
  hp?: number;
  mp?: number;
  sp?: number;
  bp?: number;
  dn?: boolean | 0 | 1;
  fix?: boolean;
  ep?: number;
  [key: string]: any;
}

export interface WorldChatPacket {
  op: 'world_chat';
  id?: string;
  name?: string;
  text: string;
}

export interface LootItem {
  id: string;
  itemId: string;
  qty?: number;
  x: number;
  y: number;
}

export interface LootPacket {
  op: 'loot';
  l: LootItem[];
}

/** IDs in the combat protocol are opaque to the parser; no player identity is inferred. */
export type CombatWireId = string | number;

export interface KillPacket {
  op: 'kill';
  id: CombatWireId;
  exp?: number;
  by?: CombatWireId | null;
}

export interface SkillResultPacket {
  op: 'skill_res';
  n: number;
}

export interface DownPacket {
  op: 'down';
  left?: number;
  lostExp?: number;
}

export interface HurtPacket {
  op: 'hurt';
  hp: number;
  dmg: number;
  bp?: number;
  mp?: number;
  mpLoss?: number;
  byId?: CombatWireId | null;
}

export interface ActPacket {
  op: 'act';
  k: string;
  id?: CombatWireId;
  t?: CombatWireId;
  tx?: number;
  ty?: number;
  x?: number;
  y?: number;
  ax?: number;
  ay?: number;
  w?: number;
  r?: number;
  n?: number;
  dps?: number;
  ttl?: number;
  bay?: number;
  mau?: string;
  tu?: unknown;
  result?: string;
  flight?: boolean | 0 | 1;
  pts?: Array<{ x: number; y: number }>;
  /** Variant-specific source payload; the gateway forwards it without schema validation. */
  src?: unknown[];
  targets?: unknown[];
  [key: string]: unknown;
}

export interface CombatLootItem {
  id: CombatWireId;
  item: string;
  n?: number;
  owner?: CombatWireId | null;
  boss?: boolean | 0 | 1;
  bossName?: string | null;
  daily?: boolean | 0 | 1;
  khoa?: number;
  ht?: boolean | 0 | 1;
  vn?: number;
  age?: number;
  x: number;
  y: number;
  ox?: number;
  oy?: number;
  [key: string]: unknown;
}

export interface CombatLootPacket {
  op: 'loot';
  l?: CombatLootItem[];
}

export interface JoinPacket {
  op: 'join';
  id: CombatWireId;
  name?: string;
  cfg?: unknown;
  realm?: string;
  tong?: unknown;
  phanThan?: boolean | 0 | 1;
  pos?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LeavePacket {
  op: 'leave';
  id: CombatWireId;
}

export interface BossesPacket {
  op: 'bosses';
  boards: unknown[];
}

export interface RevivedPacket {
  op: 'revived';
  x?: number;
  y?: number;
  hp: number;
  mp: number;
  bp?: number;
  ep?: number;
}

export type GameInPacket =
  | WelcomePacket
  | PongPacket
  | StatePacket
  | MapPacket
  | StatusPacket
  | FormationPacket
  | AckPacket
  | WorldChatPacket
  | LootPacket
  | KillPacket
  | SkillResultPacket
  | DownPacket
  | HurtPacket
  | ActPacket
  | CombatLootPacket
  | JoinPacket
  | LeavePacket
  | BossesPacket
  | RevivedPacket
  | YouPacket
  | { op: string; [key: string]: any };

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  HANDSHAKING = 'HANDSHAKING',
  IN_GAME = 'IN_GAME',
  RECONNECTING = 'RECONNECTING',
}

export interface ClientConfig {
  serverUrl?: string;
  accountName: string;
  /**
   * Legacy: fixed JWT. Optional — prefer `password` so the client can log in and
   * refresh tokens by itself.
   */
  token?: string;
  /** Account password (đạo hiệu login). Kept in memory only. */
  password?: string;
  /** Previously persisted Supabase refresh token (skips a password login on restart). */
  refreshToken?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  proxyUrl?: string;
  pingIntervalMs?: number;
  reconnectMaxRetries?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  /** Injected by TuTienClient; supplies a valid token for every (re)connect. */
  tokenProvider?: import('./auth/token-manager.js').TokenProvider;
}


export interface CharacterOverview {
  selfId?: string;
  name: string;
  realm: string;
  exp: number;
  /** Legacy compatibility value; consumers requiring authority must use stonesSnapshot. */
  stones: number;
  stonesSnapshot?: StonesSnapshot;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** Canonical vitals including validity and freshness metadata. */
  vitals?: VitalSnapshot;
  /** Separately derived maxima; never treated as server-authoritative vitals. */
  derivedMax?: DerivedMaxSnapshot;
  /** Knockdown state from you/down/revived packets; null means unknown. */
  downed?: boolean | null;
  mapId: string;
  /** True after a valid mapId has been observed in a state/map packet. */
  mapKnown?: boolean;
  khu: number;
  /** True after a valid khu has been observed in a state/map packet. */
  khuKnown?: boolean;
  soKhu: number;
  x: number;
  y: number;
  /** True after valid x and y have been observed for the current map/khu. */
  positionKnown?: boolean;
  /** Incremented whenever the observed world context is invalidated or changes. */
  contextEpoch?: number;
  bagCount: number;
  bagItems: Record<string, number>;
  stage: number;
  latencyMs: number;
  connectionStatus: ConnectionStatus;
  lastUpdated: number;
}
