import type { VendorRunnerOptions, VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import type { FrameMetricsSnapshot } from '../headless/frame-metrics.js';
import type { RunnerHandleLog } from '../orchestrator/runner-handle.js';

export const SHARD_PROTOCOL_VERSION = 1;
export const SNAPSHOT_INTERVAL_MS = 500;
export const RUNNER_RPC_METHODS = [
  'startAuto', 'stopAuto', 'walkTo', 'cancelWalk', 'getKhuInfo', 'requestKhuList', 'changeKhu',
  'startDailyCheckin', 'startDailySeed', 'cancelDaily', 'questProbe', 'khuProbe', 'getInventory',
] as const;
export type RunnerRpcMethod = typeof RUNNER_RPC_METHODS[number];
export type SerializableRunnerOptions = Omit<VendorRunnerOptions,
  'credentials' | 'transport' | 'WebSocketImpl' | 'tokenManager' | 'envFactory' | 'onLog' | 'onSessionUpdated' | 'onSnapshotChanged' | 'reconnectRandom' | 'reconnectClock'>;

export type ParentMessage =
  | { v: number; type: 'start'; accountId: string; credentials: VendorRunnerOptions['credentials']; gameServerUrl: string; proxyUrl: string | null; options: SerializableRunnerOptions }
  | { v: number; type: 'stop'; accountId: string }
  | { v: number; type: 'call'; rid: string; accountId: string; method: string; args: unknown[] }
  | { v: number; type: 'shutdown' };
export type ChildMessage =
  | { v: number; type: 'ready' }
  | { v: number; type: 'reply'; rid: string; ok: true; result?: unknown }
  | { v: number; type: 'reply'; rid: string; ok: false; error: { code: string; message: string } }
  | { v: number; type: 'snapshot'; accountId: string; snapshot: VendorRunnerSnapshot; metrics: FrameMetricsSnapshot; reachableMaps: { currentMapId: string; maps: import('../headless/map-route.js').ReachableMap[] } | null; khuProbe: ReturnType<import('../headless/vendor-runner.js').VendorRunner['getKhuProbe']>; dailySnapshot: { status: import('../headless/daily-quests.js').DailyStatus | null; current: import('../headless/daily-quests.js').DailyOperation | null }; at: number }
  | { v: number; type: 'log'; accountId: string; event: RunnerHandleLog }
  | { v: number; type: 'session'; accountId: string; refreshToken: string }
  | { v: number; type: 'proc'; rssBytes: number; eventLoop: { p50Ms: number | null; p99Ms: number | null; maxMs: number | null }; runners: number; cpuUserMicros: number; cpuSystemMicros: number; ignoredPackets: number }
  | { v: number; type: 'fatal'; code: string };

export function isChildMessage(value: unknown): value is ChildMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.v !== SHARD_PROTOCOL_VERSION) return false;
  switch (message.type) {
    case 'ready': return true;
    case 'reply': return typeof message.rid === 'string' && typeof message.ok === 'boolean'
      && (message.ok || (!!message.error && typeof message.error === 'object'
        && typeof (message.error as Record<string, unknown>).code === 'string'
        && typeof (message.error as Record<string, unknown>).message === 'string'));
    case 'snapshot': {
      const snapshot = message.snapshot as Record<string, unknown> | null;
      const character = snapshot && snapshot.character;
      return typeof message.accountId === 'string' && typeof message.at === 'number'
        && !!snapshot && typeof snapshot === 'object'
        && (character === undefined || character === null || (typeof character === 'object' && !Array.isArray(character)))
        && !!message.metrics && typeof message.metrics === 'object';
    }
    case 'log': return typeof message.accountId === 'string' && !!message.event && typeof message.event === 'object';
    case 'session': return typeof message.accountId === 'string' && typeof message.refreshToken === 'string';
    case 'proc': return typeof message.rssBytes === 'number' && typeof message.runners === 'number';
    case 'fatal': return typeof message.code === 'string';
    default: return false;
  }
}
