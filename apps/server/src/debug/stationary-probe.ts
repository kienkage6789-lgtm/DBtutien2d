import type { Direction, MoveState } from '@tutien2d/core-client';

const WAIT_AFTER_BATCH_MS = 3_000;
const WAIT_BEFORE_SECOND_BATCH_MS = 15_000;
const MOVE_INTERVAL_MS = 100;
const PROBE_DELAY_AFTER_IN_GAME_MS = 20_000;
const MAX_MOVES_PER_BATCH = 10;

type Position = { x: number; y: number };

export interface StationaryProbeSnapshot {
  downed: boolean | null;
  monsters: ReadonlyArray<{ x: number; y: number }>;
  moveToStatus: string | null;
  navigationPhase: string;
  mapContextIsCurrent: boolean;
  position: Position | null;
  dir: number | null;
}

export type StationaryProbeGuardReason =
  | 'downed_true'
  | 'monster_within_300'
  | 'move_to_active'
  | 'navigation_active'
  | 'map_context_not_current'
  | 'position_missing'
  | 'direction_invalid'
  | 'monster_data_invalid';

export function stationaryProbeGuardReason(snapshot: StationaryProbeSnapshot): StationaryProbeGuardReason | null {
  if (snapshot.downed === true) return 'downed_true';
  if (!snapshot.mapContextIsCurrent) return 'map_context_not_current';
  if (!snapshot.position
    || !Number.isFinite(snapshot.position.x)
    || !Number.isFinite(snapshot.position.y)) return 'position_missing';
  const dir = snapshot.dir;
  if (typeof dir !== 'number' || !Number.isInteger(dir) || dir < 0 || dir > 3) return 'direction_invalid';
  if (snapshot.moveToStatus === 'accepted' || snapshot.moveToStatus === 'running') return 'move_to_active';
  if (['planning', 'moving_to_portal', 'waiting_map_confirmation'].includes(snapshot.navigationPhase)) {
    return 'navigation_active';
  }
  for (const monster of snapshot.monsters) {
    if (!Number.isFinite(monster.x) || !Number.isFinite(monster.y)) return 'monster_data_invalid';
    if (Math.hypot(monster.x - snapshot.position.x, monster.y - snapshot.position.y) <= 300) {
      return 'monster_within_300';
    }
  }
  return null;
}

interface StationaryProbeDependencies {
  getSnapshot: () => StationaryProbeSnapshot;
  isConnected: () => boolean;
  sendMove: (
    x: number,
    y: number,
    dir: Direction,
    st: MoveState,
    shouldSend: () => boolean,
  ) => Promise<boolean>;
  onYou: (listener: (packet: Record<string, unknown>) => void) => () => void;
  recordBatchStart?: (input: {
    label: string;
    st: MoveState;
    x: number;
    y: number;
    positionBefore: Position;
  }) => void;
  recordBatchEnd?: (input: {
    label: string;
    youCount: number;
    positionAfter: Position | null;
  }) => void;
  recordYou?: (label: string, packet: Record<string, unknown>) => void;
  recordCancellation?: (reason: string) => void;
}

export interface StationaryProbeOptions {
  enabled?: boolean;
  wait?: (ms: number) => Promise<void>;
}

export interface StationaryProbeResult {
  status: 'completed' | 'cancelled';
  batches: Array<{ label: 'A' | 'B'; st: MoveState; movesSent: number; youCount: number }>;
  reason?: StationaryProbeGuardReason | 'send_rejected' | 'probe_error';
}

const waitFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One-shot, opt-in diagnostic harness. It owns no gameplay state and only
 * sends the bounded stationary move stream through TuTienClient.sendMove.
 */
export class StationaryProbe {
  private readonly enabled: boolean;
  private readonly wait: (ms: number) => Promise<void>;
  private claimed = false;
  private runPromise: Promise<StationaryProbeResult | undefined> | null = null;

  public constructor(options: StationaryProbeOptions = {}) {
    this.enabled = options.enabled ?? process.env.TUTIEN_PROBE_STATIONARY === '1';
    this.wait = options.wait ?? waitFor;
  }

  /** Schedule the only allowed probe for this process when the account enters IN_GAME. */
  public schedule(factory: () => StationaryProbeDependencies): Promise<StationaryProbeResult | undefined> {
    if (!this.enabled || this.claimed) return Promise.resolve(undefined);
    this.claimed = true;
    this.runPromise = this.wait(PROBE_DELAY_AFTER_IN_GAME_MS)
      .then(() => this.execute(factory))
      .catch(() => {
        const deps = factory();
        return this.cancel(deps, 'probe_error');
      });
    return this.runPromise;
  }

  private cancel(
    deps: StationaryProbeDependencies,
    reason: StationaryProbeResult['reason'],
  ): StationaryProbeResult {
    const stableReason = reason ?? 'probe_error';
    deps.recordCancellation?.(stableReason);
    console.warn(`[StationaryProbe] cancelled: ${stableReason}`);
    return { status: 'cancelled', batches: [], reason: stableReason };
  }

  private async execute(factory: () => StationaryProbeDependencies): Promise<StationaryProbeResult> {
    const deps = factory();
    const initial = deps.getSnapshot();
    const initialReason = stationaryProbeGuardReason(initial);
    if (initialReason) return this.cancel(deps, initialReason);
    if (!deps.isConnected()) return this.cancel(deps, 'probe_error');

    let activeBatch: { label: 'A' | 'B'; youCount: number } | null = null;
    const unsubscribe = deps.onYou((packet) => {
      if (!activeBatch) return;
      activeBatch.youCount += 1;
      deps.recordYou?.(activeBatch.label, packet);
    });

    try {
      const results: StationaryProbeResult['batches'] = [];
      const first = await this.runBatch(deps, 'A', 'idle', (batch) => { activeBatch = batch; }, () => {
        activeBatch = null;
      });
      results.push(first.summary);
      if (first.cancelReason) {
        if (first.cancelReason !== 'send_rejected') {
          deps.recordCancellation?.(first.cancelReason);
          console.warn(`[StationaryProbe] cancelled: ${first.cancelReason}`);
        }
        return { status: 'cancelled', batches: results, reason: first.cancelReason };
      }
      if (first.summary.youCount > 0) return { status: 'completed', batches: results };

      await this.wait(WAIT_BEFORE_SECOND_BATCH_MS);
      const beforeSecond = stationaryProbeGuardReason(deps.getSnapshot());
      if (beforeSecond) {
        deps.recordCancellation?.(beforeSecond);
        console.warn(`[StationaryProbe] cancelled: ${beforeSecond}`);
        return { status: 'cancelled', batches: results, reason: beforeSecond };
      }
      if (!deps.isConnected()) return this.cancel(deps, 'probe_error');

      const second = await this.runBatch(deps, 'B', 'walk', (batch) => { activeBatch = batch; }, () => {
        activeBatch = null;
      });
      results.push(second.summary);
      if (second.cancelReason) {
        if (second.cancelReason !== 'send_rejected') {
          deps.recordCancellation?.(second.cancelReason);
          console.warn(`[StationaryProbe] cancelled: ${second.cancelReason}`);
        }
        return { status: 'cancelled', batches: results, reason: second.cancelReason };
      }
      return { status: 'completed', batches: results };
    } finally {
      activeBatch = null;
      unsubscribe();
    }
  }

  private async runBatch(
    deps: StationaryProbeDependencies,
    label: 'A' | 'B',
    st: MoveState,
    onStart: (batch: { label: 'A' | 'B'; youCount: number }) => void,
    onEnd: () => void,
  ): Promise<{
    summary: { label: 'A' | 'B'; st: MoveState; movesSent: number; youCount: number };
    cancelReason?: StationaryProbeResult['reason'];
  }> {
    const before = deps.getSnapshot();
    const guardReason = stationaryProbeGuardReason(before);
    if (guardReason) {
      deps.recordCancellation?.(guardReason);
      console.warn(`[StationaryProbe] cancelled: ${guardReason}`);
      return { summary: { label, st, movesSent: 0, youCount: 0 }, cancelReason: guardReason };
    }
    const position = before.position!;
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const dir = before.dir as Direction;
    const batch = { label, youCount: 0 };
    onStart(batch);
    deps.recordBatchStart?.({ label, st, x, y, positionBefore: { x: position.x, y: position.y } });

    let movesSent = 0;
    for (let index = 0; index < MAX_MOVES_PER_BATCH; index += 1) {
      const shouldSend = () => {
        const currentReason = stationaryProbeGuardReason(deps.getSnapshot());
        return deps.isConnected() && currentReason === null;
      };
      const sent = await deps.sendMove(x, y, dir, st, shouldSend);
      if (!sent) {
        onEnd();
        deps.recordBatchEnd?.({ label, youCount: batch.youCount, positionAfter: deps.getSnapshot().position });
        deps.recordCancellation?.('send_rejected');
        console.warn('[StationaryProbe] cancelled: send_rejected');
        return {
          summary: { label, st, movesSent, youCount: batch.youCount },
          cancelReason: 'send_rejected',
        };
      }
      movesSent += 1;
      if (index < MAX_MOVES_PER_BATCH - 1) await this.wait(MOVE_INTERVAL_MS);
    }

    await this.wait(WAIT_AFTER_BATCH_MS);
    onEnd();
    deps.recordBatchEnd?.({ label, youCount: batch.youCount, positionAfter: deps.getSnapshot().position });
    const afterReason = stationaryProbeGuardReason(deps.getSnapshot());
    return {
      summary: { label, st, movesSent, youCount: batch.youCount },
      ...(afterReason ? { cancelReason: afterReason } : {}),
    };
  }
}
