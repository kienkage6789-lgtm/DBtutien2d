import type { DailyClient } from '../headless/daily-quests.js';
import type { WalkOperation, WalkRequest } from '../headless/walk-navigator.js';
import type { AutoAnchor, AutoSupervisorSnapshot } from '../headless/auto-supervisor.js';
import type { FrameMetricsSnapshot } from '../headless/frame-metrics.js';
import type { KhuChangeResult, KhuInfo, KhuList } from '../headless/khu-change.js';

export type GatewayLifecycle =
  | 'starting' | 'connecting' | 'in_game' | 'farming' | 'recovering'
  | 'traveling' | 'halted' | 'stopped' | 'error';

export interface GatewayState {
  lifecycle: GatewayLifecycle;
  connection: 'DISCONNECTED' | 'CONNECTING' | 'IN_GAME' | 'RECONNECTING';
  mapId: string | null;
  khu: number | null;
  x: number | null;
  y: number | null;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  isDown: boolean | null;
  hurtCount: number;
  autoActive: boolean;
  soKhu: number | null;
  reachableMaps: string[];
  walkOperation: WalkOperation | null;
}

export interface GameGateway {
  /** Starts the single account session; duplicate starts retain the implementation's idempotency. */
  start(): Promise<void>;
  /** Stops the session and clears active operations; safe to call repeatedly. */
  stop(): Promise<void>;
  /** Returns current lifecycle without changing it. */
  getLifecycle(): GatewayLifecycle;
  /** Subscribes to an unexpected socket disconnect; returns an unsubscribe function. */
  onDisconnect(listener: () => void): () => void;
  /** Returns observed state; unknown location and vitals remain null. */
  getState(): GatewayState;
  /** Returns frame metrics, or null when this implementation cannot provide them. */
  getFrameMetrics(): FrameMetricsSnapshot | null;
  /** Starts a walk; the movement gate does not require fresh vitals and still rejects a downed character. */
  walkTo(request: WalkRequest): WalkOperation;
  /** Cancels the matching active walk and its waiters. */
  cancelWalk(operationId: string, reason?: string): boolean;
  /** Starts Auto using the existing VendorRunner safety checks. */
  startAuto(anchor?: AutoAnchor): Promise<AutoSupervisorSnapshot>;
  /** Stops Auto and leaves it off. */
  stopAuto(): AutoSupervisorSnapshot;
  /** Reads observed map and khu without requesting data. */
  getKhuInfo(): KhuInfo;
  /** Requests the current map's khu list; does not choose a khu. */
  requestKhuList(): Promise<KhuList>;
  /** Changes khu under the existing strict down/Auto/operation safety gates. */
  changeKhu(khu: number): Promise<KhuChangeResult>;
  /** Daily task operations are isolated behind the existing interface. */
  readonly daily: DailyClient;
}
