import { AUTO_CONSTANTS, ENEMY_DEFS } from '@tutien2d/core-client';

export type PriorityMode = 'auto' | 'boss' | 'quai' | 'mau';

export interface MonsterRow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly hp?: number;
  readonly hm?: number;
  readonly d?: number | boolean;
  readonly t?: string;
  readonly [key: string]: unknown;
}

export interface SelectInput {
  readonly self: { readonly x: number; readonly y: number };
  readonly monsters: ReadonlyArray<MonsterRow>;
  readonly priority: PriorityMode;
  readonly memory: { readonly targetId: string | null };
  readonly config?: {
    readonly range?: number;
    readonly reachPad?: number;
    readonly keepPad?: number;
    readonly excludeTypes?: ReadonlySet<string>;
    readonly sticky?: boolean;
  };
}

export interface SelectResult {
  readonly target: MonsterRow | null;
  readonly reason: string;
  readonly memory: { readonly targetId: string | null };
  readonly considered: number;
}

export interface SkillRangeLike {
  readonly range?: number | null;
  readonly shape?: string | null;
  readonly blastR?: number | null;
  readonly thunder?: boolean;
}

export const TARGET_RANGE = AUTO_CONSTANTS.target.range;
export const TARGET_REACH_PAD = AUTO_CONSTANTS.target.reachPad;
export const TARGET_KEEP_PAD = AUTO_CONSTANTS.target.keepPad;
export const PLAYER_REACH = AUTO_CONSTANTS.player.reach;
export const THUNDER_RANGE = AUTO_CONSTANTS.thunder.range;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function distance(self: { x: number; y: number }, monster: { x: number; y: number }): number {
  return Math.hypot(monster.x - self.x, monster.y - self.y);
}

function compareIds(left: MonsterRow, right: MonsterRow): number {
  const leftId = String(left.id);
  const rightId = String(right.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function enemyDef(type: unknown): (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS] | null {
  if (typeof type !== 'string') return null;
  return (ENEMY_DEFS as Record<string, (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS]>)[type] ?? null;
}

function isBoss(monster: MonsterRow, def: (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS]): boolean {
  return def.isBoss === true || /Yêu Thú Cấp/.test(def.name);
}

function isLiveKnownMonster(monster: MonsterRow, def: (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS]): boolean {
  if (monster.d) return false;
  if (finite(monster.hp) && monster.hp <= 0) return false;
  if (def.human || def.tuSi) return false;
  return true;
}

function sortByDistance(self: SelectInput['self'], candidates: readonly MonsterRow[]): MonsterRow | null {
  return [...candidates].sort((left, right) => {
    const distanceDelta = distance(self, left) - distance(self, right);
    return distanceDelta || compareIds(left, right);
  })[0] ?? null;
}

function hpRatio(monster: MonsterRow, def: (typeof ENEMY_DEFS)[keyof typeof ENEMY_DEFS]): number {
  const maxHp = finite(monster.hm) && monster.hm > 0 ? monster.hm : def.hpMax;
  return finite(monster.hp) && finite(maxHp) && maxHp > 0 ? monster.hp / maxHp : 1;
}

function selectLowHealth(self: SelectInput['self'], candidates: readonly MonsterRow[]): MonsterRow | null {
  return [...candidates].sort((left, right) => {
    const leftDef = enemyDef(left.t);
    const rightDef = enemyDef(right.t);
    if (!leftDef || !rightDef) return compareIds(left, right);
    const ratioDelta = hpRatio(left, leftDef) - hpRatio(right, rightDef);
    return ratioDelta || distance(self, left) - distance(self, right) || compareIds(left, right);
  })[0] ?? null;
}

/**
 * Returns whether the player center is inside the vendor's melee hit check.
 * `bodyRadius: null` and definitions without a radius contribute zero.
 */
export function inMeleeReach(
  self: { readonly x: number; readonly y: number },
  monster: MonsterRow,
  weaponReachBonus = 0,
): boolean {
  if (!finite(self.x) || !finite(self.y) || !finite(monster.x) || !finite(monster.y)) return false;
  const def = enemyDef(monster.t);
  const bodyRadius = def && finite(def.bodyRadius) ? def.bodyRadius : 0;
  const bonus = finite(weaponReachBonus) ? weaponReachBonus : 0;
  return distance(self, monster) <= PLAYER_REACH + bonus + bodyRadius;
}

/** Returns the exact auto-pick range for a generated/vendor skill definition. */
export function inSkillRange(
  self: { readonly x: number; readonly y: number },
  monster: MonsterRow,
  skill: SkillRangeLike,
): boolean {
  if (!finite(self.x) || !finite(self.y) || !finite(monster.x) || !finite(monster.y)) return false;
  if (skill.thunder) return distance(self, monster) <= THUNDER_RANGE;
  if (!finite(skill.range)) return false;
  const range = skill.shape === 'aura'
    ? Math.min(skill.range, finite(skill.blastR) ? 0.8 * skill.blastR : 0)
    : skill.range;
  return distance(self, monster) <= range;
}

export function selectTarget(input: SelectInput): SelectResult {
  const range = finite(input.config?.range) ? input.config.range : TARGET_RANGE;
  const reachPad = finite(input.config?.reachPad) ? input.config.reachPad : TARGET_REACH_PAD;
  const keepPad = finite(input.config?.keepPad) ? input.config.keepPad : TARGET_KEEP_PAD;
  const sticky = input.config?.sticky !== false;
  const excludeTypes = input.config?.excludeTypes;
  const eligible: MonsterRow[] = [];
  let sawUnknownType = false;

  // `considered` is deliberately the number of input rows inspected. Rows
  // with invalid coordinates are counted, then rejected without coercion.
  let considered = 0;
  for (const monster of input.monsters) {
    considered += 1;
    const def = enemyDef(monster.t);
    if (!def) {
      sawUnknownType = true;
      continue;
    }
    if (!finite(monster.x) || !finite(monster.y)) continue;
    if (excludeTypes?.has(monster.t ?? '')) continue;
    if (!isLiveKnownMonster(monster, def)) continue;
    eligible.push(monster);
  }

  const memoryId = input.memory.targetId;
  if (sticky && memoryId !== null) {
    const retained = eligible.find((monster) => monster.id === memoryId);
    if (retained && distance(input.self, retained) <= range + reachPad + keepPad) {
      return { target: retained, reason: 'sticky', memory: { targetId: retained.id }, considered };
    }
  }

  const autoTarget = () => sortByDistance(input.self, eligible);
  let selected: MonsterRow | null = null;
  let reason = 'selected_auto';

  if (input.priority === 'boss') {
    selected = sortByDistance(input.self, eligible.filter((monster) => isBoss(monster, enemyDef(monster.t)!)));
    reason = selected ? 'selected_boss' : 'fallback_auto';
  } else if (input.priority === 'quai') {
    selected = sortByDistance(input.self, eligible.filter((monster) => !isBoss(monster, enemyDef(monster.t)!)));
    reason = selected ? 'selected_quai' : 'fallback_auto';
  } else if (input.priority === 'mau') {
    selected = selectLowHealth(input.self, eligible.filter((monster) => distance(input.self, monster) <= range));
    reason = selected ? 'selected_mau' : 'fallback_auto';
  }

  if (!selected) selected = autoTarget();
  if (!selected) {
    return {
      target: null,
      reason: sawUnknownType ? 'unknown_type' : 'no_target',
      memory: { targetId: null },
      considered,
    };
  }
  return { target: selected, reason, memory: { targetId: selected.id }, considered };
}
