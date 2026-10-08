import {
  AUTO_CONSTANTS,
  SKILL_DEFS,
  SKILL_SLOT_IDS,
  THUNDER_DEF,
  deriveLearnedSkills,
} from '@tutien2d/core-client';
import type { SkillSaveLike } from '@tutien2d/core-client';

export const SPELL_GAP = AUTO_CONSTANTS.player.spellGap;

export type SkillDefinition = (typeof SKILL_DEFS)[keyof typeof SKILL_DEFS] | typeof THUNDER_DEF;

export interface SkillCooldowns {
  readonly spellUntil: number;
  readonly skillUntil: Readonly<Record<string, number>>;
  readonly thunderUntil: number;
}

export interface SkillPlayerState {
  readonly mp: number;
  readonly mpMax: number;
  readonly sp: number;
  readonly transformed?: boolean;
  readonly weaponId?: string | null;
}

export interface PickAutoSkillInput {
  readonly distance: number;
  readonly rotationIndex: number;
  readonly player: SkillPlayerState;
  readonly cooldowns: SkillCooldowns;
  readonly now: number;
  readonly learnedSkills?: ReadonlyArray<string>;
  readonly save?: SkillSaveLike | null;
}

export interface PickAutoSkillResult {
  readonly skill: SkillDefinition;
  readonly index: number;
  readonly nextIndex: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function resolveSkill(skillId: string): SkillDefinition | null {
  if (skillId === THUNDER_DEF.id) return THUNDER_DEF;
  return (SKILL_DEFS as Record<string, SkillDefinition>)[skillId] ?? null;
}

function effectiveRange(skill: SkillDefinition): number {
  if (skill.thunder) return AUTO_CONSTANTS.thunder.range;
  if (!finite(skill.range)) return Number.NEGATIVE_INFINITY;
  if (skill.shape === 'aura') return Math.min(skill.range, finite(skill.blastR) ? 0.8 * skill.blastR : 0);
  return skill.range;
}

function cooldownUntil(cooldowns: SkillCooldowns, skill: SkillDefinition): number {
  return skill.thunder ? cooldowns.thunderUntil : (cooldowns.skillUntil[skill.id] ?? 0);
}

export function createSkillCooldowns(): SkillCooldowns {
  return { spellUntil: 0, skillUntil: {}, thunderUntil: 0 };
}

export function isSkillReady(
  player: SkillPlayerState,
  skill: SkillDefinition,
  cooldowns: SkillCooldowns,
  now: number,
): boolean {
  if (!finite(now) || !finite(player.mp) || !finite(player.mpMax) || !finite(player.sp) || player.mpMax <= 0) return false;
  if (player.transformed || skill.bienHinh) return false;
  // Dữ liệu hiện tại luôn là null, nhưng vendor cho phép danh sách vũ khí nên khai báo kiểu rộng.
  const allowedWeapons = skill.allowedWeapons as readonly string[] | null | undefined;
  if (Array.isArray(allowedWeapons) && !allowedWeapons.includes(player.weaponId ?? '')) return false;
  if (now < cooldowns.spellUntil || now < cooldownUntil(cooldowns, skill)) return false;
  const mpCost = finite(skill.mp) ? skill.mp : Number.POSITIVE_INFINITY;
  const spCost = finite(skill.sp) ? skill.sp : Number.POSITIVE_INFINITY;
  return player.mp >= mpCost && player.sp >= spCost;
}

/** Purely records the local client-side cooldowns after an accepted cast. */
export function recordSkillCast(
  cooldowns: SkillCooldowns,
  skill: SkillDefinition,
  now: number,
): SkillCooldowns {
  if (!finite(now)) return cooldowns;
  const skillUntil = { ...cooldowns.skillUntil };
  const localCooldown = finite(skill.cooldown) ? skill.cooldown : 0;
  skillUntil[skill.id] = now + localCooldown;
  return {
    spellUntil: now + SPELL_GAP,
    skillUntil,
    thunderUntil: skill.thunder ? now + localCooldown : cooldowns.thunderUntil,
  };
}

export function pickAutoSkill(input: PickAutoSkillInput): PickAutoSkillResult | null {
  if (!finite(input.distance) || input.distance < 0) return null;
  const learned = input.learnedSkills ?? deriveLearnedSkills(input.save);
  const rotation = SKILL_SLOT_IDS
    .filter((skillId) => learned.includes(skillId))
    .map(resolveSkill)
    .filter((skill): skill is SkillDefinition => !!skill && !skill.playerTargetOnly && !skill.bienHinh);
  if (!rotation.length) return null;
  const start = ((Math.trunc(input.rotationIndex) % rotation.length) + rotation.length) % rotation.length;
  for (let offset = 0; offset < rotation.length; offset += 1) {
    const index = (start + offset) % rotation.length;
    const skill = rotation[index];
    if (input.distance <= effectiveRange(skill)
      && isSkillReady(input.player, skill, input.cooldowns, input.now)) {
      return { skill, index, nextIndex: (index + 1) % rotation.length };
    }
  }
  return null;
}
