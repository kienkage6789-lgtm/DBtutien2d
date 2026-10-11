import { describe, expect, it } from 'vitest';
import { sanitizeInventory } from './api';
import { inventoryCaveStatusChips, inventoryEmptySlotCount, inventoryGridEmptySlotCount, inventoryKnowledgeLabel, inventoryTabCounts } from '../components/InventoryModal';
import { inventoryGradeGroup, inventoryGradeStyle } from '../components/inventory-grade';
import { DEFAULT_INVENTORY_SYMBOL, INVENTORY_SLOT_SYMBOLS, INVENTORY_TYPE_SYMBOLS, inventorySymbol } from '../components/inventory-symbol';

describe('inventory API data', () => {
  it('preserves unknown inventory instead of showing an empty bag', () => {
    const inventory = sanitizeInventory({ known: false, items: [{ id: 'bad' }], totalKinds: 0, totalCount: 0 });
    expect(inventory).toMatchObject({ known: false, items: [], totalKinds: null, totalCount: null, caveChest: null });
    expect(inventory && inventoryKnowledgeLabel(inventory)).toContain('Chưa biết');
  });

  it('drops malformed item rows while keeping valid inventory data', () => {
    expect(sanitizeInventory({ known: true, items: [
      { id: 'hop_van_bao', name: 'Hộp', count: 2, openable: true, type: 'hop', grade: 'future-grade', slot: null,
        icon: 12, desc: `abc${String.fromCharCode(0)} ${'x'.repeat(350)}`, group: 'bad-group' },
      { id: 'bad', name: 'Bad', count: '2', openable: false },
    ], caveChest: { keyCount: null, claimed: false, active: false } })).toMatchObject({
      known: true, items: [{ id: 'hop_van_bao', name: 'Hộp', count: 2, openable: true, type: 'hop', grade: 'future-grade', slot: null,
        icon: null, desc: `abc ${'x'.repeat(296)}`, group: null }], bag: null, equipment: null, caveChest: null, totalKinds: null, totalCount: null,
    });
    expect(sanitizeInventory({ known: true, items: 'missing' })).toBeUndefined();
  });

  it('sanitizes bag/equipment unknowns and counts each category without losing unknown groups', () => {
    const data = sanitizeInventory({ known: true, items: [
      { id: 'a', name: 'A', count: 1, openable: false, group: 'vat-pham' },
      { id: 'a2', name: 'A2', count: 1, openable: false, group: 'vat-pham' },
      { id: 'b', name: 'B', count: 1, openable: false, group: 'trang-bi' },
      { id: 'c', name: 'C', count: 1, openable: false, group: null },
    ], bag: { usedSlots: 'unknown', capacity: null, extraSlots: 2 }, equipment: [
      { slotId: 'hat', slotName: 'Mũ', item: { id: 'e', name: 'Nón', grade: {} } }, { slotId: 4, slotName: 'bad' },
    ] });
    expect(data?.bag).toEqual({ usedSlots: null, capacity: null, extraSlots: 2, maxExtraSlots: null, nextSlotPrice: null });
    expect(data?.equipment).toEqual([{ slotId: 'hat', slotName: 'Mũ', item: { id: 'e', name: 'Nón', grade: null } }]);
    expect(data && inventoryTabCounts(data.items)).toEqual({ 'vat-pham': 2, 'trang-bi': 1, 'dao-thuat': 0, khac: 1 });
  });

  it('renders the shared remaining slots in the item grid count, capped at 24', () => {
    expect(inventoryEmptySlotCount(40, 10)).toBe(24);
    expect(inventoryEmptySlotCount(12, 7)).toBe(5);
    expect(inventoryEmptySlotCount(5, 8)).toBe(0);
    expect(inventoryEmptySlotCount(null, 0)).toBeNull();
    expect(inventoryEmptySlotCount(8, null)).toBeNull();
    expect(inventoryEmptySlotCount(undefined, undefined)).toBeNull();
    expect(inventoryGridEmptySlotCount(40, 10)).toBe(24);
    expect(inventoryGridEmptySlotCount(null, 0)).toBe(0);
    expect(inventoryGridEmptySlotCount(8, null)).toBe(0);
  });

  it('reports each cave chip from its matching state', () => {
    expect(inventoryCaveStatusChips({ keyCount: 3, claimed: true, active: true })).toEqual([
      { key: 'key', label: 'Có chìa khóa ×3', active: true },
      { key: 'chest', label: 'Đã nhận rương', active: true },
      { key: 'activation', label: 'Đang kích hoạt', active: true },
    ]);
    expect(inventoryCaveStatusChips({ keyCount: 0, claimed: false, active: false })).toEqual([
      { key: 'key', label: 'Chưa có chìa khóa', active: false },
      { key: 'chest', label: 'Chưa nhận rương', active: false },
      { key: 'activation', label: 'Chưa kích hoạt', active: false },
    ]);
  });

  it('maps every real game grade to the Loot.gradeKey color group', () => {
    const expected: Array<[string, 'common' | 'fine' | 'spirit' | 'earth']> = [
      ['Phàm phẩm', 'common'], ['Phàm phẩm thượng', 'fine'],
      ['Linh phẩm', 'spirit'], ['Linh phẩm hạ', 'spirit'], ['Linh phẩm trung', 'spirit'], ['Linh phẩm thượng', 'spirit'],
      ['Địa phẩm', 'earth'], ['Địa phẩm hạ', 'earth'], ['Địa phẩm trung', 'earth'], ['Địa phẩm thượng', 'earth'],
      ['Thiên phẩm hạ', 'common'], ['Thiên phẩm trung', 'common'],
    ];
    for (const [grade, group] of expected) expect(inventoryGradeGroup(grade), grade).toBe(group);
    expect(new Set(expected.map(([grade]) => inventoryGradeGroup(grade))).size).toBe(4);
    expect(inventoryGradeStyle('Phàm phẩm thượng').border).toBe('#79a477');
    expect(inventoryGradeStyle('Linh phẩm').border).toBe('#5bb4bd');
    expect(inventoryGradeStyle('Địa phẩm').border).toBe('#8b65b5');
    expect(inventoryGradeStyle('Phàm phẩm').border).toBe('#8a6a45');
  });

  it('keeps null and unfamiliar grades on a neutral fallback without throwing', () => {
    expect(() => inventoryGradeStyle('future grade')).not.toThrow();
    expect(inventoryGradeGroup('future grade')).toBeNull();
    expect(inventoryGradeGroup(null)).toBeNull();
    expect(inventoryGradeStyle('future grade')).toEqual(inventoryGradeStyle(null));
    expect(inventoryGradeStyle(null).group).toBe('unknown');
  });

  it('has a labeled non-default symbol for every real type and equipment slot', () => {
    const realTypes = ['vat_pham', 'bi_tich', 'duoc_lieu', 'vu_khi', 'nguyen_lieu_ren_khi', 'hat_giong', 'dan_duoc', 'phu_chu',
      'vat_pham_nhiem_vu', 'nguyen_lieu', 'tran_ban', 'nhiem_vu', 'thuc_pham', 'tien_te', 'thuc_an_linh_thu', 'nguyen_lieu_nhiem_vu'];
    const realSlots = ['phap_boi', 'vu_khi', 'mu', 'giap', 'giay', 'nhan', 'ao', 'phi_hanh'];
    for (const type of realTypes) {
      const symbol = INVENTORY_TYPE_SYMBOLS[type]!;
      expect(symbol, type).toBeDefined();
      expect(symbol, type).not.toEqual(DEFAULT_INVENTORY_SYMBOL);
      expect(symbol.label.length, type).toBeGreaterThan(0);
      expect(inventorySymbol(null, type), type).toEqual(symbol);
    }
    for (const slot of realSlots) {
      const symbol = INVENTORY_SLOT_SYMBOLS[slot]!;
      expect(symbol, slot).toBeDefined();
      expect(symbol, slot).not.toEqual(DEFAULT_INVENTORY_SYMBOL);
      expect(symbol.label.length, slot).toBeGreaterThan(0);
      expect(inventorySymbol(slot, 'vat_pham'), slot).toEqual(symbol);
    }
    expect(inventorySymbol('unknown_slot', 'unknown_type', true)).toMatchObject({ mark: '🎁', label: 'Hộp mở được' });
    expect(inventorySymbol('unknown_slot', 'unknown_type', true).mark).not.toBe(DEFAULT_INVENTORY_SYMBOL.mark);
    expect(inventorySymbol(null, 'unknown_type')).toEqual(DEFAULT_INVENTORY_SYMBOL);
  });

  it('renders game supplied descriptions as text rather than HTML', () => {
    expect(sanitizeInventory({ known: true, items: [{ id: 'x', name: '<script>alert(1)</script>', count: 1, openable: false,
      desc: '<script>bad</script>', group: null }] })?.items[0]).toMatchObject({ name: '<script>alert(1)</script>', desc: '<script>bad</script>' });
  });
});
