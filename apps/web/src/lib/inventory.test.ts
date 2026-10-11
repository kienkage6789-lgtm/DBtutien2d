import { describe, expect, it } from 'vitest';
import { sanitizeInventory } from './api';
import { inventoryKnowledgeLabel } from '../components/InventoryModal';

describe('inventory API data', () => {
  it('preserves unknown inventory instead of showing an empty bag', () => {
    const inventory = sanitizeInventory({ known: false, items: [{ id: 'bad' }], totalKinds: 0, totalCount: 0 });
    expect(inventory).toMatchObject({ known: false, items: [], totalKinds: null, totalCount: null, caveChest: null });
    expect(inventory && inventoryKnowledgeLabel(inventory)).toContain('Chưa biết');
  });

  it('drops malformed item rows while keeping valid inventory data', () => {
    expect(sanitizeInventory({ known: true, items: [
      { id: 'hop_van_bao', name: 'Hộp', count: 2, openable: true },
      { id: 'bad', name: 'Bad', count: '2', openable: false },
    ], caveChest: { keyCount: null, claimed: false, active: false } })).toMatchObject({
      known: true, items: [{ id: 'hop_van_bao', name: 'Hộp', count: 2, openable: true }], caveChest: null, totalKinds: null, totalCount: null,
    });
    expect(sanitizeInventory({ known: true, items: 'missing' })).toBeUndefined();
  });
});
