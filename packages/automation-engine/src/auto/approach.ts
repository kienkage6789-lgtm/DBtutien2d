import {
  inMeleeReach,
  PLAYER_REACH,
  TARGET_KEEP_PAD,
  TARGET_RANGE,
  TARGET_REACH_PAD,
  type MonsterRow,
} from './target-selection.js';

export type Point = { readonly x: number; readonly y: number };

export type ApproachGoalReason = 'direct' | 'ring' | 'snapped' | 'none';

export interface ApproachMonster extends MonsterRow {
  readonly bodyRadius?: number | null;
}

export interface ApproachGoalResult {
  readonly goal: Point | null;
  readonly reachLimit: number;
  readonly reason: ApproachGoalReason;
}

export interface ComputeApproachGoalInput {
  readonly self: Point;
  readonly monster: Pick<ApproachMonster, 'x' | 'y' | 'bodyRadius'>;
  readonly weaponReachBonus?: number;
  readonly margin?: number;
  /** Must include the 16x12 player hitbox and the point's map bounds. */
  readonly isWalkablePoint: (point: Point) => boolean;
  readonly nearestWalkable: (x: number, y: number, radiusTiles: number) => Point | null;
  /** A null result means the candidate cannot be reached from self. */
  readonly pathLength?: (from: Point, to: Point) => number | null;
}

export const APPROACH_RING_SAMPLES = 16;
export const APPROACH_SNAP_RADIUS_TILES = 4;
export const APPROACH_DEFAULT_MARGIN_PX = 8;
export const APPROACH_TIMEOUT_MS = 8_000;
export const REPLAN_INTERVAL_MS = 400;
export const REPLAN_MONSTER_MOVE_PX = 24;
/** The authoritative position is already fresh on every tick; no extra dwell is needed. */
export const ARRIVAL_CONFIRM_MS = 0;

const TWO_PI = Math.PI * 2;

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const distance = (from: Point, to: Point): number => Math.hypot(to.x - from.x, to.y - from.y);

function validPoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function candidatePathCost(
  input: ComputeApproachGoalInput,
  candidate: Point,
): number | null {
  if (!input.pathLength) return distance(input.self, candidate);
  const cost = input.pathLength(input.self, candidate);
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/**
 * Pick a collision-safe point from which the player is inside melee reach.
 * The order of the ring and all tie breaks are fixed so a replay gets the
 * same target without a random choice.
 */
export function computeApproachGoal(input: ComputeApproachGoalInput): ApproachGoalResult {
  const bodyRadius = finiteOr(input.monster.bodyRadius ?? undefined, 0);
  const weaponReachBonus = finiteOr(input.weaponReachBonus, 0);
  const reachLimit = PLAYER_REACH + weaponReachBonus + bodyRadius;
  const margin = finiteOr(input.margin, APPROACH_DEFAULT_MARGIN_PX);
  const ringRadius = reachLimit - margin < 1 ? reachLimit * 0.5 : reachLimit - margin;

  if (!validPoint(input.self) || !validPoint(input.monster) || !Number.isFinite(reachLimit)) {
    return { goal: null, reachLimit, reason: 'none' };
  }

  if (distance(input.self, input.monster) <= reachLimit && input.isWalkablePoint(input.self)) {
    return { goal: { x: input.self.x, y: input.self.y }, reachLimit, reason: 'direct' };
  }

  if (ringRadius > 0) {
    const startAngle = Math.atan2(input.self.y - input.monster.y, input.self.x - input.monster.x);
    let best: { point: Point; cost: number; order: number } | null = null;
    for (let order = 0; order < APPROACH_RING_SAMPLES; order += 1) {
      const angle = startAngle + order * TWO_PI / APPROACH_RING_SAMPLES;
      const candidate = {
        x: input.monster.x + Math.cos(angle) * ringRadius,
        y: input.monster.y + Math.sin(angle) * ringRadius,
      };
      if (!input.isWalkablePoint(candidate)) continue;
      const cost = candidatePathCost(input, candidate);
      if (cost === null) continue;
      if (!best || cost < best.cost) best = { point: candidate, cost, order };
    }
    if (best) return { goal: best.point, reachLimit, reason: 'ring' };
  }

  const snapped = input.nearestWalkable(input.monster.x, input.monster.y, APPROACH_SNAP_RADIUS_TILES);
  if (snapped && validPoint(snapped)
    && input.isWalkablePoint(snapped)
    && distance(snapped, input.monster) <= ringRadius
    && (!input.pathLength || candidatePathCost(input, snapped) !== null)) {
    return { goal: { x: snapped.x, y: snapped.y }, reachLimit, reason: 'snapped' };
  }

  return { goal: null, reachLimit, reason: 'none' };
}

export interface ApproachTrackerConfig {
  readonly weaponReachBonus?: number;
  readonly timeoutMs?: number;
  readonly replanIntervalMs?: number;
  readonly replanMonsterMovePx?: number;
  readonly arrivalConfirmMs?: number;
}

export interface ApproachTrackerInput {
  readonly now: number;
  readonly self: Point;
  readonly monster: (ApproachMonster & { readonly id?: string }) | null;
  readonly goalResult: ApproachGoalResult;
  readonly config?: ApproachTrackerConfig;
}

export type ApproachTrackerAction =
  | 'start'
  | 'continue'
  | 'replan'
  | 'arrived'
  | 'unreachable'
  | 'timeout'
  | 'target_lost';

export interface ApproachTrackerResult {
  readonly action: ApproachTrackerAction;
  readonly goal?: Point;
  readonly reason: string;
  readonly elapsedMs: number;
  readonly distance: number;
}

type TrackerState = {
  startedAt: number | null;
  targetKey: string | null;
  lastPlanAt: number | null;
  lastPlanMonster: Point | null;
  unreachableStreak: number;
  arrivalStartedAt: number | null;
};

const initialTrackerState = (): TrackerState => ({
  startedAt: null,
  targetKey: null,
  lastPlanAt: null,
  lastPlanMonster: null,
  unreachableStreak: 0,
  arrivalStartedAt: null,
});

function monsterKey(monster: ApproachTrackerInput['monster']): string | null {
  if (!monster) return null;
  if (typeof monster.id === 'string' && monster.id.length > 0) return `id:${monster.id}`;
  return 'anonymous-target';
}

function isTargetLost(monster: ApproachTrackerInput['monster'], self: Point): boolean {
  if (!monster || !validPoint(monster) || !validPoint(self)) return true;
  if (monster.d) return true;
  if (typeof monster.hp === 'number' && Number.isFinite(monster.hp) && monster.hp <= 0) return true;
  return distance(self, monster) > TARGET_RANGE + TARGET_REACH_PAD + TARGET_KEEP_PAD;
}

/**
 * Stateful but side-effect-free tick machine. The object stores only planning
 * memory; all time and observations arrive through tick().
 */
export class ApproachTracker {
  private state: TrackerState = initialTrackerState();

  public reset(): void {
    this.state = initialTrackerState();
  }

  public tick(input: ApproachTrackerInput): ApproachTrackerResult {
    const timeoutMs = finiteOr(input.config?.timeoutMs, APPROACH_TIMEOUT_MS);
    const replanIntervalMs = finiteOr(input.config?.replanIntervalMs, REPLAN_INTERVAL_MS);
    const replanMonsterMovePx = finiteOr(input.config?.replanMonsterMovePx, REPLAN_MONSTER_MOVE_PX);
    const arrivalConfirmMs = finiteOr(input.config?.arrivalConfirmMs, ARRIVAL_CONFIRM_MS);
    const key = monsterKey(input.monster);
    if (this.state.targetKey !== key) {
      this.state = {
        ...initialTrackerState(),
        targetKey: key,
        startedAt: input.monster ? input.now : null,
      };
    } else if (this.state.startedAt === null && input.monster) {
      this.state.startedAt = input.now;
    }

    const elapsedMs = this.state.startedAt === null ? 0 : Math.max(0, input.now - this.state.startedAt);
    const currentDistance = input.monster ? distance(input.self, input.monster) : Number.POSITIVE_INFINITY;

    if (isTargetLost(input.monster, input.self)) {
      return { action: 'target_lost', reason: 'target_lost', elapsedMs, distance: currentDistance };
    }

    const inReach = inMeleeReach(input.self, input.monster!, finiteOr(input.config?.weaponReachBonus, 0));
    if (inReach) {
      if (this.state.arrivalStartedAt === null) this.state.arrivalStartedAt = input.now;
      if (input.now - this.state.arrivalStartedAt >= arrivalConfirmMs) {
        return {
          action: 'arrived',
          goal: input.goalResult.goal ?? input.self,
          reason: 'in_melee_reach',
          elapsedMs,
          distance: currentDistance,
        };
      }
    } else {
      this.state.arrivalStartedAt = null;
    }

    if (elapsedMs >= timeoutMs) {
      return { action: 'timeout', goal: input.goalResult.goal ?? undefined, reason: 'approach_timeout', elapsedMs, distance: currentDistance };
    }

    if (input.goalResult.reason === 'none' || input.goalResult.goal === null) {
      this.state.unreachableStreak += 1;
      if (this.state.unreachableStreak >= 2) {
        return { action: 'unreachable', reason: 'no_walkable_goal_twice', elapsedMs, distance: currentDistance };
      }
      return { action: 'continue', reason: 'no_walkable_goal_yet', elapsedMs, distance: currentDistance };
    }
    this.state.unreachableStreak = 0;

    if (this.state.lastPlanAt === null || this.state.lastPlanMonster === null) {
      this.state.lastPlanAt = input.now;
      this.state.lastPlanMonster = { x: input.monster!.x, y: input.monster!.y };
      return { action: 'start', goal: input.goalResult.goal, reason: input.goalResult.reason, elapsedMs, distance: currentDistance };
    }

    const monsterMoved = distance(this.state.lastPlanMonster, input.monster!);
    if (input.now - this.state.lastPlanAt >= replanIntervalMs && monsterMoved >= replanMonsterMovePx) {
      this.state.lastPlanAt = input.now;
      this.state.lastPlanMonster = { x: input.monster!.x, y: input.monster!.y };
      return { action: 'replan', goal: input.goalResult.goal, reason: 'target_moved', elapsedMs, distance: currentDistance };
    }

    return { action: 'continue', goal: input.goalResult.goal, reason: 'approach_in_progress', elapsedMs, distance: currentDistance };
  }
}
