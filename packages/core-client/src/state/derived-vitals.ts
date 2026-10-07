import { ITEM_BONUS, KNOWN_ITEM_IDS, REALM_MAX } from './derived-vitals.generated.js';

export type DerivedVitals = {
  maxHp: number;
  maxMp: number;
  complete: boolean;
  source: 'derived';
};

const knownItems = new Set<string>(KNOWN_ITEM_IDS);

function itemIds(equipment: Record<string, string | null> | readonly (string | null | undefined)[]): readonly (string | null | undefined)[] {
  return Array.isArray(equipment) ? equipment : Object.values(equipment);
}

export function deriveMaxima(
  realmId: string,
  equipment: Record<string, string | null> | readonly (string | null | undefined)[],
): DerivedVitals | null {
  if (!Object.hasOwn(REALM_MAX, realmId)) return null;
  const realm = REALM_MAX[realmId as keyof typeof REALM_MAX];
  const result: DerivedVitals = { maxHp: realm.hpMax, maxMp: realm.mpMax, complete: true, source: 'derived' };
  for (const itemId of itemIds(equipment)) {
    if (itemId == null) continue;
    if (!knownItems.has(itemId)) {
      result.complete = false;
      continue;
    }
    const bonus = Object.hasOwn(ITEM_BONUS, itemId)
      ? ITEM_BONUS[itemId as keyof typeof ITEM_BONUS] as { hpBonus?: number; mpBonus?: number }
      : undefined;
    result.maxHp += bonus?.hpBonus ?? 0;
    result.maxMp += bonus?.mpBonus ?? 0;
  }
  return result;
}
