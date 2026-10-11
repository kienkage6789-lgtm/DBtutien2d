export type InventoryGradeGroup = 'common' | 'fine' | 'spirit' | 'earth';

export interface InventoryGradeStyle {
  group: InventoryGradeGroup | 'unknown';
  border: string;
  surface: string;
  label: string;
}

const styles: Record<InventoryGradeGroup | 'unknown', InventoryGradeStyle> = {
  common: { group: 'common', border: '#8a6a45', surface: '#171b23', label: '#f1f5f9' },
  fine: { group: 'fine', border: '#79a477', surface: '#171b23', label: '#f1f5f9' },
  spirit: { group: 'spirit', border: '#5bb4bd', surface: '#171b23', label: '#f1f5f9' },
  earth: { group: 'earth', border: '#8b65b5', surface: '#171b23', label: '#f1f5f9' },
  unknown: { group: 'unknown', border: '#64748b', surface: '#171b23', label: '#f1f5f9' },
};

const knownGrades = new Set([
  'Phàm phẩm', 'Phàm phẩm thượng', 'Linh phẩm', 'Linh phẩm hạ', 'Linh phẩm trung', 'Linh phẩm thượng',
  'Địa phẩm', 'Địa phẩm hạ', 'Địa phẩm trung', 'Địa phẩm thượng', 'Thiên phẩm hạ', 'Thiên phẩm trung',
]);

/** Mirrors Loot.gradeKey in the reference client; unknown values retain a neutral fallback. */
export function inventoryGradeGroup(grade: string | number | null | undefined): InventoryGradeGroup | null {
  if (typeof grade !== 'string' || !knownGrades.has(grade)) return null;
  if (grade.includes('Địa')) return 'earth';
  if (grade.includes('Linh')) return 'spirit';
  if (grade.includes('thượng')) return 'fine';
  return 'common';
}

export function inventoryGradeStyle(grade: string | number | null | undefined): InventoryGradeStyle {
  const group = inventoryGradeGroup(grade);
  return group ? styles[group] : styles.unknown;
}

export function inventoryGradeLabel(grade: string | number | null): string {
  return grade === null ? 'Chưa rõ phẩm cấp' : `Phẩm cấp ${grade}`;
}
