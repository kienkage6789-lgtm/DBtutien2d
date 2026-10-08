import {
  computeApproachGoal,
  selectTarget,
  type ApproachMonster,
  type Point,
} from '@tutien2d/automation-engine';
import { ENEMY_DEFS, VITALS_ATTACK_MAX_AGE_MS } from '@tutien2d/core-client';
import {
  runApproach,
  type ApproachPlanRecord,
  type ApproachRunResult,
  type ApproachSnapshot,
  type ApproachMoveStartInput,
  type ApproachMoveStartResult,
} from '../orchestrator/approach-runner.js';

export const APPROACH_PROBE_DELAY_MS = 20_000;
export const APPROACH_PROBE_STAND_STILL_MS = 3_000;
/** Cửa sổ chờ điều kiện an toàn đạt sau độ trễ ban đầu; hết cửa sổ thì hủy (không chạy muộn). */
export const APPROACH_PROBE_WINDOW_MS = 240_000;
export const APPROACH_PROBE_POLL_MS = 1_000;
/** Lý do dứt khoát: không chờ. Các lý do khác (chưa có quái, đang điều hướng, vitals cũ...) là tạm thời. */
const APPROACH_PROBE_TERMINAL_REASONS: ReadonlySet<string> = new Set(['downed_true', 'not_in_game']);
export const APPROACH_PROBE_MIN_DISTANCE_PX = 120;
export const APPROACH_PROBE_MAX_DISTANCE_PX = 450;
export const APPROACH_PROBE_MAX_PATH_PX = 480;
export const APPROACH_PROBE_CONTACT_DAMAGE_FACTOR = 10;
export const APPROACH_PROBE_MONSTER_CONTEXT_TTL_MS = 5_000;

export type ApproachProbeStatus = 'completed' | 'cancelled';

export interface ApproachProbePathDependencies {
  readonly isWalkablePoint: (mapId: string, point: Point) => boolean;
  readonly nearestWalkable: (mapId: string, x: number, y: number, radiusTiles: number) => Point | null;
  readonly pathLength: (mapId: string, from: Point, to: Point) => number | null;
}

export interface ApproachProbeDependencies extends ApproachProbePathDependencies {
  readonly getSnapshot: () => ApproachSnapshot;
  readonly isConnected: () => boolean;
  readonly startMoveTo: (input: ApproachMoveStartInput) => ApproachMoveStartResult;
  readonly cancelMoveTo: (operationId: string, reason: string) => void | Promise<void>;
  readonly onHurt?: (listener: () => void) => () => void;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
  readonly recordPlan?: (record: ApproachPlanRecord) => void;
  readonly recordResult?: (input: {
    readonly status: ApproachRunResult['status'] | 'cancelled';
    readonly reason: string;
    readonly elapsedMs: number;
    readonly replans: number;
    readonly finalDistance: number;
  }) => void;
  readonly recordCancellation?: (reason: string) => void;
}

export interface ApproachProbeResult {
  readonly status: ApproachProbeStatus;
  readonly reason?: string;
  readonly approach?: ApproachRunResult;
}

type EnemyDef = (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS];

let processClaimed = false;

const waitFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function enemyDef(monster: ApproachMonster): EnemyDef | null {
  if (typeof monster.t !== 'string') return null;
  return (ENEMY_DEFS as Record<string, EnemyDef>)[monster.t] ?? null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function freshVitals(snapshot: ApproachSnapshot, now: number): boolean {
  return snapshot.vitals.status === 'fresh'
    && snapshot.vitals.observedAt !== null
    && Math.max(0, now - snapshot.vitals.observedAt) <= VITALS_ATTACK_MAX_AGE_MS;
}

function freshMonsters(snapshot: ApproachSnapshot, now: number): boolean {
  return snapshot.monstersFresh
    && snapshot.monstersObservedAt !== null
    && Math.max(0, now - snapshot.monstersObservedAt) <= APPROACH_PROBE_MONSTER_CONTEXT_TTL_MS;
}

function safeContactDamage(monster: ApproachMonster, def: EnemyDef): boolean {
  const knownHp = finite(monster.hp) && monster.hp > 0
    ? monster.hp
    : null;
  return knownHp !== null
    && finite(def.contactDmg)
    && def.contactDmg * APPROACH_PROBE_CONTACT_DAMAGE_FACTOR < knownHp;
}

function pathToGoal(deps: ApproachProbePathDependencies, mapId: string, from: Point, to: Point): number | null {
  return deps.pathLength(mapId, from, to);
}

/**
 * Select and validate one low-risk target. This function has no side effects;
 * it is also used by the probe tests to cover every live safety gate.
 */
export function chooseApproachTarget(
  snapshot: ApproachSnapshot,
  deps: ApproachProbePathDependencies,
  now: number,
): { target: ApproachMonster; goal: Point; pathLength: number } | { target: null; reason: string } {
  if (!snapshot.inGame) return { target: null, reason: 'not_in_game' };
  if (!snapshot.mapContextIsCurrent) return { target: null, reason: 'map_context_not_current' };
  if (!snapshot.position || !finite(snapshot.position.x) || !finite(snapshot.position.y)) return { target: null, reason: 'position_missing' };
  if (snapshot.downed === true) return { target: null, reason: 'downed_true' };
  if (snapshot.moveToStatus === 'accepted' || snapshot.moveToStatus === 'running') return { target: null, reason: 'move_to_active' };
  if (snapshot.navigationActive) return { target: null, reason: 'navigation_active' };
  if (!freshVitals(snapshot, now)) return { target: null, reason: 'vitals_stale_or_unknown' };
  if (!freshMonsters(snapshot, now)) return { target: null, reason: 'monsters_stale_or_unknown' };
  if (!snapshot.mapId || snapshot.khu === null) return { target: null, reason: 'map_context_missing' };

  const candidates = snapshot.monsters.filter((monster) => {
    const def = enemyDef(monster);
    if (!def || !finite(monster.x) || !finite(monster.y) || monster.d) return false;
    if (def.isBoss) return false;
    if (def.human || def.tuSi) return false;
    if (!safeContactDamage(monster, def)) return false;
    const initialDistance = distance(snapshot.position!, monster);
    return initialDistance >= APPROACH_PROBE_MIN_DISTANCE_PX
      && initialDistance <= APPROACH_PROBE_MAX_DISTANCE_PX;
  });
  if (candidates.length === 0) {
    const knownSafe = snapshot.monsters.filter((monster) => {
      const def = enemyDef(monster);
      return !!def && !def.isBoss && !def.human && !def.tuSi && safeContactDamage(monster, def)
        && finite(monster.x) && finite(monster.y);
    });
    if (knownSafe.length > 0 && knownSafe.every((monster) => distance(snapshot.position!, monster) > APPROACH_PROBE_MAX_DISTANCE_PX)) {
      return { target: null, reason: 'target_too_far' };
    }
  }
  const selected = selectTarget({
    self: snapshot.position,
    monsters: candidates,
    priority: 'auto',
    memory: { targetId: null },
  });
  if (!selected.target) {
    const rejected = snapshot.monsters.find((monster) => {
      const def = enemyDef(monster);
      return !!def && !def.isBoss && !def.human && !def.tuSi && safeContactDamage(monster, def)
        && distance(snapshot.position!, monster) < APPROACH_PROBE_MIN_DISTANCE_PX;
    });
    return { target: null, reason: rejected ? 'target_too_near' : 'no_safe_target' };
  }

  const target = selected.target as ApproachMonster;
  const def = enemyDef(target)!;
  const goalResult = computeApproachGoal({
    self: snapshot.position,
    monster: { x: target.x, y: target.y, bodyRadius: def.bodyRadius },
    isWalkablePoint: (point) => deps.isWalkablePoint(snapshot.mapId!, point),
    nearestWalkable: (x, y, radiusTiles) => deps.nearestWalkable(snapshot.mapId!, x, y, radiusTiles),
    pathLength: (from, to) => pathToGoal(deps, snapshot.mapId!, from, to),
  });
  if (!goalResult.goal) return { target: null, reason: 'no_walk_path' };
  const pathLength = pathToGoal(deps, snapshot.mapId, snapshot.position, goalResult.goal);
  if (pathLength === null) return { target: null, reason: 'no_walk_path' };
  if (pathLength > APPROACH_PROBE_MAX_PATH_PX) return { target: null, reason: 'path_too_long' };

  const aggro = finite(def.aggro) ? def.aggro : 0;
  if (aggro > 0 && snapshot.monsters.some((other) => other.id !== target.id
    && finite(other.x) && finite(other.y)
    && distance(goalResult.goal!, other) <= aggro)) {
    return { target: null, reason: 'other_monster_in_aggro' };
  }
  return { target, goal: goalResult.goal, pathLength };
}

/** Opt-in, one-shot live harness. The default constructor is disabled. */
export class ApproachProbe {
  private readonly enabled: boolean;
  private readonly wait: (ms: number) => Promise<void>;
  private claimed = false;
  private runPromise: Promise<ApproachProbeResult | undefined> | null = null;

  public constructor(options: { enabled?: boolean; wait?: (ms: number) => Promise<void> } = {}) {
    this.enabled = options.enabled === true
      || (options.enabled !== false && process.env.TUTIEN_PROBE_APPROACH === '1');
    this.wait = options.wait ?? waitFor;
  }

  public schedule(factory: () => ApproachProbeDependencies): Promise<ApproachProbeResult | undefined> {
    if (!this.enabled || this.claimed || processClaimed) return Promise.resolve(undefined);
    this.claimed = true;
    processClaimed = true;
    this.runPromise = this.wait(APPROACH_PROBE_DELAY_MS)
      .then(() => this.execute(factory))
      .catch(() => {
        const deps = factory();
        return this.cancel(deps, 'probe_error');
      });
    return this.runPromise;
  }

  private cancel(deps: ApproachProbeDependencies, reason: string): ApproachProbeResult {
    deps.recordCancellation?.(reason);
    deps.recordResult?.({ status: 'cancelled', reason, elapsedMs: 0, replans: 0, finalDistance: Number.POSITIVE_INFINITY });
    console.warn(`[ApproachProbe] cancelled: ${reason}`);
    return { status: 'cancelled', reason };
  }

  private async execute(factory: () => ApproachProbeDependencies): Promise<ApproachProbeResult> {
    const deps = factory();
    const clock = deps.now ?? Date.now;
    const pause = deps.wait ?? waitFor;
    const windowEndsAt = clock() + APPROACH_PROBE_WINDOW_MS;
    // Harness chỉ chạy một lần, nhưng điều kiện (đã sang map có quái, hết điều hướng,
    // vitals mới) thường chưa đạt ở thời điểm bắt đầu. Chờ có hạn thay vì tiêu mất lượt.
    let chosen = chooseApproachTarget(deps.getSnapshot(), deps, clock());
    while (!chosen.target) {
      if (!deps.isConnected()) return this.cancel(deps, 'disconnected');
      if (APPROACH_PROBE_TERMINAL_REASONS.has(chosen.reason)) return this.cancel(deps, chosen.reason);
      if (clock() >= windowEndsAt) return this.cancel(deps, `window_expired:${chosen.reason}`);
      await pause(APPROACH_PROBE_POLL_MS);
      chosen = chooseApproachTarget(deps.getSnapshot(), deps, clock());
    }
    if (!deps.isConnected()) return this.cancel(deps, 'disconnected');

    const approach = await runApproach({
      accountId: `approach-probe`,
      getSnapshot: deps.getSnapshot,
      isConnected: deps.isConnected,
      startMoveTo: deps.startMoveTo,
      cancelMoveTo: deps.cancelMoveTo,
      isWalkablePoint: deps.isWalkablePoint,
      nearestWalkable: deps.nearestWalkable,
      pathLength: deps.pathLength,
      targetId: chosen.target.id,
      onHurt: deps.onHurt,
      now: deps.now,
      wait: deps.wait,
      onPlan: deps.recordPlan,
    });
    deps.recordResult?.(approach);
    if (approach.status === 'arrived') {
      await (deps.wait ?? waitFor)(APPROACH_PROBE_STAND_STILL_MS);
      return { status: 'completed', approach };
    }
    return { status: 'cancelled', reason: approach.reason, approach };
  }
}

/** Test-only reset hook; production process state must remain one-shot. */
export function resetApproachProbeStateForTests(): void {
  processClaimed = false;
}
