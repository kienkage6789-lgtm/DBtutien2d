import {
  APPROACH_TIMEOUT_MS,
  ApproachTracker,
  computeApproachGoal,
  selectTarget,
  type ApproachGoalResult,
  type ApproachMonster,
  type ApproachTrackerResult,
  type Point,
} from '@tutien2d/automation-engine';
import { ENEMY_DEFS, VITALS_ATTACK_MAX_AGE_MS } from '@tutien2d/core-client';

const APPROACH_TICK_MS = 100;
const APPROACH_ARRIVAL_RADIUS_PX = 6;
const MONSTER_CONTEXT_TTL_MS = 5_000;

export type ApproachRunStatus = 'arrived' | 'unreachable' | 'timeout' | 'target_lost' | 'aborted' | 'skipped';

export interface ApproachVitalsSnapshot {
  readonly status: string;
  readonly observedAt: number | null;
  readonly hp: number | null;
}

export interface ApproachSnapshot {
  readonly inGame: boolean;
  readonly mapContextIsCurrent: boolean;
  readonly mapId: string | null;
  readonly khu: number | null;
  readonly position: Point | null;
  readonly downed: boolean | null;
  readonly moveToStatus: string | null;
  readonly moveToOperationId?: string | null;
  readonly navigationActive: boolean;
  readonly botRunning: boolean;
  readonly vitals: ApproachVitalsSnapshot;
  readonly monsters: ReadonlyArray<ApproachMonster>;
  readonly monstersFresh: boolean;
  readonly monstersObservedAt: number | null;
}

export interface ApproachMoveStartInput {
  readonly requestId: string;
  readonly mapId: string;
  readonly khu: number;
  readonly goal: Point;
  readonly arrivalRadius: number;
  readonly shouldContinue: () => boolean;
}

export interface ApproachMoveStartResult {
  readonly operationId: string;
  readonly promise?: Promise<unknown>;
}

export interface ApproachPlanRecord {
  readonly atMs: number;
  readonly monsterType: string | null;
  readonly distance: number;
  readonly pathLength: number | null;
  readonly replans: number;
  readonly action: ApproachTrackerResult['action'];
  readonly goal: Point;
  readonly goalReason: ApproachGoalResult['reason'];
}

export interface ApproachRunnerDependencies {
  readonly accountId: string;
  readonly getSnapshot: () => ApproachSnapshot;
  readonly isConnected: () => boolean;
  readonly startMoveTo: (input: ApproachMoveStartInput) => ApproachMoveStartResult;
  /** Must mark the current operation cancelled and wait for its loop to exit. */
  readonly cancelMoveTo: (operationId: string, reason: string) => void | Promise<void>;
  readonly isWalkablePoint: (mapId: string, point: Point) => boolean;
  readonly nearestWalkable: (mapId: string, x: number, y: number, radiusTiles: number) => Point | null;
  readonly pathLength?: (mapId: string, from: Point, to: Point) => number | null;
  readonly targetId?: string;
  readonly weaponReachBonus?: number;
  readonly margin?: number;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
  readonly onHurt?: (listener: () => void) => () => void;
  readonly onPlan?: (record: ApproachPlanRecord) => void;
}

export interface ApproachRunResult {
  readonly status: ApproachRunStatus;
  readonly reason: string;
  readonly elapsedMs: number;
  readonly replans: number;
  readonly finalDistance: number;
  readonly movesSent?: number;
}

type ActiveOperation = { operationId: string; promise?: Promise<unknown> };

const runningAccounts = new Set<string>();

const waitFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function activeMove(status: string | null): boolean {
  return status === 'accepted' || status === 'running';
}

function validPosition(position: Point | null): position is Point {
  return !!position && Number.isFinite(position.x) && Number.isFinite(position.y);
}

function validVitals(snapshot: ApproachSnapshot, now: number): boolean {
  if (snapshot.vitals.status !== 'fresh' || snapshot.vitals.observedAt === null) return false;
  return Math.max(0, now - snapshot.vitals.observedAt) <= VITALS_ATTACK_MAX_AGE_MS;
}

function monstersFresh(snapshot: ApproachSnapshot, now: number): boolean {
  return snapshot.monstersFresh
    && snapshot.monstersObservedAt !== null
    && Math.max(0, now - snapshot.monstersObservedAt) <= MONSTER_CONTEXT_TTL_MS;
}

function findTarget(snapshot: ApproachSnapshot, targetId: string | undefined): ApproachMonster | null {
  if (!validPosition(snapshot.position)) return null;
  if (targetId !== undefined) return snapshot.monsters.find((monster) => monster.id === targetId) ?? null;
  const selected = selectTarget({
    self: snapshot.position!,
    monsters: snapshot.monsters,
    priority: 'auto',
    memory: { targetId: null },
  });
  return selected.target as ApproachMonster | null;
}

function enemyBodyRadius(monster: ApproachMonster): number {
  const value = monster.bodyRadius;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const def = typeof monster.t === 'string'
    ? (ENEMY_DEFS as Record<string, (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS]>)[monster.t]
    : undefined;
  return def && typeof def.bodyRadius === 'number' && Number.isFinite(def.bodyRadius) ? def.bodyRadius : 0;
}

function result(
  status: ApproachRunStatus,
  reason: string,
  startedAt: number,
  now: number,
  replans: number,
  finalDistance: number,
): ApproachRunResult {
  return {
    status,
    reason,
    elapsedMs: Math.max(0, now - startedAt),
    replans,
    finalDistance,
  };
}

function finalDistance(snapshot: ApproachSnapshot, targetId: string | undefined, fallback: number): number {
  if (!validPosition(snapshot.position)) return fallback;
  const target = findTarget(snapshot, targetId);
  return target ? Math.hypot(target.x - snapshot.position.x, target.y - snapshot.position.y) : fallback;
}

/**
 * Run one bounded approach. Transport, map collision, clock and cancellation
 * are injected so this function can be replayed without a live client.
 */
export async function runApproach(deps: ApproachRunnerDependencies): Promise<ApproachRunResult> {
  if (runningAccounts.has(deps.accountId)) {
    return { status: 'skipped', reason: 'approach_in_progress', elapsedMs: 0, replans: 0, finalDistance: Number.POSITIVE_INFINITY };
  }
  runningAccounts.add(deps.accountId);
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? waitFor;
  let operation: ActiveOperation | null = null;
  let hurtObserved = false;
  let unsubscribeHurt: (() => void) | undefined;
  let tracker = new ApproachTracker();
  let targetId = deps.targetId;
  let startedAt = 0;
  let replans = 0;
  let lastDistance = Number.POSITIVE_INFINITY;
  let startHp: number | null = null;

  let initialNow: number;
  let snapshot: ApproachSnapshot;
  let connected: boolean;
  try {
    initialNow = now();
    snapshot = deps.getSnapshot();
    connected = deps.isConnected();
  } catch (error) {
    runningAccounts.delete(deps.accountId);
    throw error;
  }
  startedAt = initialNow;
  const skip = (reason: string): ApproachRunResult => result('skipped', reason, initialNow, now(), 0, Number.POSITIVE_INFINITY);
  if (!snapshot.inGame) { runningAccounts.delete(deps.accountId); return skip('not_in_game'); }
  if (!snapshot.mapContextIsCurrent) { runningAccounts.delete(deps.accountId); return skip('map_context_not_current'); }
  if (!validPosition(snapshot.position)) { runningAccounts.delete(deps.accountId); return skip('position_missing'); }
  if (snapshot.downed === true) { runningAccounts.delete(deps.accountId); return skip('downed_true'); }
  if (activeMove(snapshot.moveToStatus)) { runningAccounts.delete(deps.accountId); return skip('move_to_active'); }
  if (snapshot.navigationActive) { runningAccounts.delete(deps.accountId); return skip('navigation_active'); }
  if (!validVitals(snapshot, initialNow)) { runningAccounts.delete(deps.accountId); return skip('vitals_stale_or_unknown'); }
  if (!monstersFresh(snapshot, initialNow)) { runningAccounts.delete(deps.accountId); return skip('monsters_stale_or_unknown'); }
  if (!connected || !snapshot.botRunning) {
    runningAccounts.delete(deps.accountId);
    return skip(!connected ? 'disconnected' : 'bot_stopped');
  }

  const selected = findTarget(snapshot, targetId);
  if (!selected) { runningAccounts.delete(deps.accountId); return skip('no_target'); }
  targetId = selected.id;
  startHp = typeof snapshot.vitals.hp === 'number' && Number.isFinite(snapshot.vitals.hp) ? snapshot.vitals.hp : null;
  startedAt = initialNow;

  const shouldContinue = (): boolean => {
    const current = deps.getSnapshot();
    return !hurtObserved
      && deps.isConnected()
      && current.botRunning
      && current.inGame
      && current.mapContextIsCurrent
      && current.downed !== true;
  };

  try {
    unsubscribeHurt = deps.onHurt?.(() => { hurtObserved = true; });
    while (true) {
      const current = deps.getSnapshot();
      const currentNow = now();
      const currentTarget = findTarget(current, targetId);
      const currentDistance = finalDistance(current, targetId, lastDistance);
      lastDistance = currentDistance;

      let terminal: ApproachRunResult | null = null;
      if (hurtObserved) terminal = result('aborted', 'hurt_received', startedAt, currentNow, replans, currentDistance);
      else if (!deps.isConnected() || !current.inGame) terminal = result('aborted', 'disconnected', startedAt, currentNow, replans, currentDistance);
      else if (!current.botRunning) terminal = result('aborted', 'bot_stopped', startedAt, currentNow, replans, currentDistance);
      else if (!current.mapContextIsCurrent) terminal = result('aborted', 'map_context_not_current', startedAt, currentNow, replans, currentDistance);
      else if (current.downed === true) terminal = result('aborted', 'downed_true', startedAt, currentNow, replans, currentDistance);
      else if (startHp !== null && current.vitals.hp !== null && current.vitals.hp < startHp) {
        terminal = result('aborted', 'hp_decreased', startedAt, currentNow, replans, currentDistance);
      }
      if (terminal) {
        await cancelActive(deps, operation, 'approach_aborted');
        operation = null;
        return terminal;
      }

      if (!validPosition(current.position) || current.mapId === null || current.khu === null) {
        await cancelActive(deps, operation, 'approach_aborted');
        operation = null;
        return result('aborted', 'position_or_context_missing', startedAt, currentNow, replans, currentDistance);
      }

      const goalResult = computeApproachGoal({
        self: current.position,
        monster: { x: currentTarget?.x ?? Number.NaN, y: currentTarget?.y ?? Number.NaN, bodyRadius: currentTarget ? enemyBodyRadius(currentTarget) : 0 },
        weaponReachBonus: deps.weaponReachBonus,
        margin: deps.margin,
        isWalkablePoint: (point) => deps.isWalkablePoint(current.mapId!, point),
        nearestWalkable: (x, y, radiusTiles) => deps.nearestWalkable(current.mapId!, x, y, radiusTiles),
        pathLength: deps.pathLength
          ? (from, to) => deps.pathLength!(current.mapId!, from, to)
          : undefined,
      });
      const trackerResult = tracker.tick({
        now: currentNow,
        self: current.position,
        monster: currentTarget,
        goalResult,
        config: { weaponReachBonus: deps.weaponReachBonus },
      });
      lastDistance = trackerResult.distance;

      if (trackerResult.action === 'arrived'
        || trackerResult.action === 'unreachable'
        || trackerResult.action === 'timeout'
        || trackerResult.action === 'target_lost') {
        await cancelActive(deps, operation, 'approach_finished');
        operation = null;
        const status = trackerResult.action === 'target_lost'
          ? 'target_lost'
          : trackerResult.action;
        return result(status, trackerResult.reason, startedAt, currentNow, replans, trackerResult.distance);
      }

      if ((trackerResult.action === 'start' || trackerResult.action === 'replan') && trackerResult.goal) {
        await cancelActive(deps, operation, 'approach_replan');
        operation = null;
        if (trackerResult.action === 'replan') replans += 1;
        const target = currentTarget!;
        const pathLength = deps.pathLength
          ? deps.pathLength(current.mapId, current.position, trackerResult.goal)
          : null;
        deps.onPlan?.({
          atMs: Math.max(0, currentNow - startedAt),
          monsterType: typeof target.t === 'string' ? target.t : null,
          distance: trackerResult.distance,
          pathLength,
          replans,
          action: trackerResult.action,
          goal: trackerResult.goal,
          goalReason: goalResult.reason,
        });
        try {
          operation = deps.startMoveTo({
            requestId: `approach:${startedAt}:${replans}`,
            mapId: current.mapId,
            khu: current.khu,
            goal: trackerResult.goal,
            arrivalRadius: APPROACH_ARRIVAL_RADIUS_PX,
            shouldContinue,
          });
          if (operation.promise) void operation.promise.catch(() => { /* the next tick observes the authoritative snapshot */ });
        } catch {
          await cancelActive(deps, operation, 'move_to_start_failed');
          operation = null;
          return result('aborted', 'move_to_start_failed', startedAt, now(), replans, trackerResult.distance);
        }
      }

      await wait(APPROACH_TICK_MS);
    }
  } finally {
    try {
      unsubscribeHurt?.();
    } finally {
      try {
        await cancelActive(deps, operation, 'approach_cleanup');
      } finally {
        runningAccounts.delete(deps.accountId);
      }
    }
  }
}

async function cancelActive(
  deps: ApproachRunnerDependencies,
  operation: ActiveOperation | null,
  reason: string,
): Promise<void> {
  if (!operation) return;
  await deps.cancelMoveTo(operation.operationId, reason);
}

/** Test-only lock reset; production never clears a live operation this way. */
export function resetApproachRunnerStateForTests(): void {
  runningAccounts.clear();
}
