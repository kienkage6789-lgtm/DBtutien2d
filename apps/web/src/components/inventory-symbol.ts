export interface InventorySymbol { mark: string; label: string }

export const DEFAULT_INVENTORY_SYMBOL: InventorySymbol = { mark: '✦', label: 'Vật phẩm khác' };

const slotSymbols: Record<string, InventorySymbol> = {
  phap_boi: { mark: '📿', label: 'Pháp bội' },
  vu_khi: { mark: '⚔️', label: 'Vũ khí' },
  mu: { mark: '🪖', label: 'Mũ' },
  giap: { mark: '🛡️', label: 'Giáp' },
  giay: { mark: '🥾', label: 'Giày' },
  nhan: { mark: '💍', label: 'Nhẫn' },
  ao: { mark: '👘', label: 'Áo' },
  phi_hanh: { mark: '🪽', label: 'Phi hành' },
};

const typeSymbols: Record<string, InventorySymbol> = {
  vat_pham: { mark: '🎒', label: 'Vật phẩm' },
  bi_tich: { mark: '📜', label: 'Bí tịch' },
  duoc_lieu: { mark: '🌿', label: 'Dược liệu' },
  vu_khi: { mark: '⚔️', label: 'Vũ khí' },
  nguyen_lieu_ren_khi: { mark: '🔩', label: 'Nguyên liệu rèn khí' },
  hat_giong: { mark: '🌱', label: 'Hạt giống' },
  dan_duoc: { mark: '🧪', label: 'Đan dược' },
  phu_chu: { mark: '🔮', label: 'Phù chú' },
  vat_pham_nhiem_vu: { mark: '📋', label: 'Vật phẩm nhiệm vụ' },
  nguyen_lieu: { mark: '🪨', label: 'Nguyên liệu' },
  tran_ban: { mark: '🧭', label: 'Trận bàn' },
  nhiem_vu: { mark: '📌', label: 'Nhiệm vụ' },
  thuc_pham: { mark: '🍲', label: 'Thực phẩm' },
  tien_te: { mark: '🪙', label: 'Tiền tệ' },
  thuc_an_linh_thu: { mark: '🍖', label: 'Thức ăn linh thú' },
  nguyen_lieu_nhiem_vu: { mark: '🧾', label: 'Nguyên liệu nhiệm vụ' },
};

export const INVENTORY_SLOT_SYMBOLS = slotSymbols;
export const INVENTORY_TYPE_SYMBOLS = typeSymbols;

/** Equipment slot takes precedence, then item type, then the openable marker. */
export function inventorySymbol(slot: string | null, type: string | null, openable = false): InventorySymbol {
  if (slot && slotSymbols[slot]) return slotSymbols[slot];
  if (type && typeSymbols[type]) return typeSymbols[type];
  return openable ? { mark: '🎁', label: 'Hộp mở được' } : DEFAULT_INVENTORY_SYMBOL;
}
