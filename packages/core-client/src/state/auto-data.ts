import {
  SKILL_BOOK_IDS,
  SKILL_DEFS,
  SKILL_SLOT_IDS,
  THUNDER_DEF,
  AUTO_CONSTANTS,
} from './skill-defs.generated.js';

export { ENEMY_DEFS } from './enemy-defs.generated.js';
export { SKILL_DEFS, SKILL_BOOK_IDS, SKILL_SLOT_IDS, THUNDER_DEF, AUTO_CONSTANTS } from './skill-defs.generated.js';

export interface SkillSaveLike {
  bag?: Record<string, unknown>;
  bound?: Record<string, unknown>;
  equipment?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  realm?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function ownsBook(bag: Record<string, unknown>, book: string): boolean {
  const count = bag[book];
  return typeof count === 'number' && Number.isFinite(count) && count >= 1;
}

/**
 * Returns skill IDs whose book ownership is provable from state.save.bag.
 *
 * This intentionally follows Inventory.owns for the official client: books
 * are normal bag items, while bound is ownership metadata and flags/preferences
 * do not prove that a book is owned. The official Skills.known/slotKnown calls
 * still apply runtime lockReason (realm, weapon/dao and other client state), so
 * this result is "book-known" and must not be presented as a fully verified
 * runtime hotbar/auto rotation without those additional inputs.
 */
export function deriveLearnedSkills(save: SkillSaveLike | null | undefined): string[] {
  if (!isRecord(save) || !isRecord(save.bag)) return [];
  const bag = save.bag;
  return SKILL_SLOT_IDS.filter((id) => {
    const def = id === THUNDER_DEF.id ? THUNDER_DEF : SKILL_DEFS[id as keyof typeof SKILL_DEFS];
    if (!def) return false;
    if (ownsBook(bag, def.book)) return true;
    const legacyBook = 'legacyBook' in def && typeof def.legacyBook === 'string' ? def.legacyBook : null;
    return legacyBook ? ownsBook(bag, legacyBook) : false;
  });
}

export const SKILL_BOOK_SET = new Set<string>(SKILL_BOOK_IDS);
