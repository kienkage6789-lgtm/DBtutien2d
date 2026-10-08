import type { Direction, MoveState, OperationLedger } from '@tutien2d/core-client';
import { VITALS_REFRESH_MIN_INTERVAL_MS } from '@tutien2d/core-client';
import {
  stationaryProbeGuardReason,
  type StationaryProbeGuardReason,
  type StationaryProbeSnapshot,
} from '../debug/stationary-probe.js';

const MOVE_INTERVAL_MS = 100;
const MAX_MOVES = 10;
const ACK_WAIT_AFTER_LAST_MOVE_MS = 1_500;

export type VitalsRefreshResult = {
  status: 'refreshed' | 'skipped' | 'no_ack';
  reason?: string;
  movesSent: number;
  ackLatencyMs?: number;
};

export type VitalsRefreshSkipReason =
  | 'disconnected'
  | StationaryProbeGuardReason
  | 'attack_or_skill_pending'
  | 'refresh_rate_limited'
  | 'refresh_in_progress';

export interface VitalsRefreshDependencies {
  accountId: string;
  getSnapshot: () => StationaryProbeSnapshot;
  isConnected: () => boolean;
  operationLedger?: Pick<OperationLedger, 'hasPendingCombat'>;
  /** Fallback only for an integration that cannot reach OperationLedger. */
  trainingPhase?: string;
  sendMove: (
    x: number,
    y: number,
    dir: Direction,
    st: MoveState,
    shouldSend: () => boolean,
  ) => Promise<boolean>;
  onYou: (listener: (packet: Record<string, unknown>) => void) => () => void;
  allowNearMonsters?: boolean;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

const lastRefreshAtByAccount = new Map<string, number>();
const runningAccounts = new Set<string>();

const waitFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function skipped(reason: VitalsRefreshSkipReason): VitalsRefreshResult {
  return { status: 'skipped', reason, movesSent: 0 };
}

function combatPending(deps: VitalsRefreshDependencies, now: number): boolean {
  if (deps.operationLedger) return deps.operationLedger.hasPendingCombat(now);
  return deps.trainingPhase === 'ATTACKING';
}

/**
 * Bounded, one-shot vitals refresh. The account lock and rate limit are kept
 * here, rather than in HTTP, so REST, UI and training share the same policy.
 */
export async function refreshVitals(deps: VitalsRefreshDependencies): Promise<VitalsRefreshResult> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? waitFor;

  if (!deps.isConnected()) return skipped('disconnected');
  if (runningAccounts.has(deps.accountId)) return skipped('refresh_in_progress');

  const currentNow = now();
  const lastRefreshAt = lastRefreshAtByAccount.get(deps.accountId);
  if (lastRefreshAt !== undefined && currentNow - lastRefreshAt < VITALS_REFRESH_MIN_INTERVAL_MS) {
    return skipped('refresh_rate_limited');
  }

  const initial = deps.getSnapshot();
  const guard = stationaryProbeGuardReason(initial, { allowNearMonsters: deps.allowNearMonsters === true });
  if (guard) return skipped(guard);
  if (combatPending(deps, currentNow)) return skipped('attack_or_skill_pending');

  runningAccounts.add(deps.accountId);
  lastRefreshAtByAccount.set(deps.accountId, currentNow);

  const startedAt = currentNow;
  let movesSent = 0;
  let ackAt: number | null = null;
  let resolveAck: ((at: number) => void) | undefined;
  const ack = new Promise<number>((resolve) => { resolveAck = resolve; });
  const unsubscribe = deps.onYou(() => {
    if (ackAt !== null) return;
    ackAt = now();
    resolveAck?.(ackAt);
  });

  try {
    const position = initial.position!;
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const dir = initial.dir as Direction;
    const shouldSend = () => {
      if (!deps.isConnected() || ackAt !== null) return false;
      const snapshot = deps.getSnapshot();
      return stationaryProbeGuardReason(snapshot, { allowNearMonsters: deps.allowNearMonsters === true }) === null
        && !combatPending(deps, now());
    };

    for (let index = 0; index < MAX_MOVES && ackAt === null; index += 1) {
      const sent = await deps.sendMove(x, y, dir, 'idle', shouldSend);
      if (!sent) break;
      movesSent += 1;
      if (ackAt !== null) break;
      if (index < MAX_MOVES - 1) {
        await Promise.race([ack, wait(MOVE_INTERVAL_MS)]);
      }
    }

    if (ackAt === null && movesSent > 0) {
      await Promise.race([ack, wait(ACK_WAIT_AFTER_LAST_MOVE_MS)]);
    }
    if (ackAt !== null) {
      return {
        status: 'refreshed',
        movesSent,
        ackLatencyMs: Math.max(0, ackAt - startedAt),
      };
    }
    return { status: 'no_ack', movesSent };
  } finally {
    unsubscribe();
    runningAccounts.delete(deps.accountId);
  }
}

/** Test-only reset hook; production callers should never clear account state. */
export function resetVitalsRefreshStateForTests(): void {
  lastRefreshAtByAccount.clear();
  runningAccounts.clear();
}

