/**
 * Read-only map catalog extracted from the vendored public client snapshot.
 *
 * This is display metadata only. It does not prove that the game server will
 * accept a direct `enter(mapId)` request for every entry; the runtime packet
 * remains the authority for the current map.
 */
export interface PublicClientMapCatalogEntry {
  mapId: string;
  name: string;
  scope: 'shared' | 'personal';
}

export const PUBLIC_CLIENT_MAP_CATALOG: readonly PublicClientMapCatalogEntry[] = [
  { mapId: 'mieu_hoang', name: 'Miếu Hoang', scope: 'shared' },
  { mapId: 'tan_vien', name: 'Chân Núi Tản Viên', scope: 'shared' },
  { mapId: 'thanh_truc_lam', name: 'Rừng Trúc', scope: 'shared' },
  { mapId: 'duoc_vien', name: 'Thảo Dược Cốc', scope: 'shared' },
  { mapId: 'vuon_ca_nhan', name: 'Vườn Cá Nhân', scope: 'personal' },
  { mapId: 'long_uyen', name: 'Long Uyên Cốc', scope: 'shared' },
  { mapId: 'hang_dong_co', name: 'Hang Động', scope: 'shared' },
  { mapId: 'bai_da_hang_gio', name: 'Bãi Đá', scope: 'shared' },
  { mapId: 'dong_mach_ngam', name: 'Miếu Ông Trường Con', scope: 'shared' },
  { mapId: 'mo_linh_thach', name: 'Mỏ Linh Thạch', scope: 'shared' },
  { mapId: 'thach_phong_thung_lung', name: 'Thung Lũng', scope: 'shared' },
  { mapId: 'bat_quai_thach_phan', name: 'Bát Quái Thạch Phàn', scope: 'shared' },
  { mapId: 'thien_dao_khuyet', name: 'Chính Đảo', scope: 'shared' },
  { mapId: 'u_uynh_vuc', name: 'Ma Động', scope: 'shared' },
  { mapId: 'hac_phong_linh', name: 'Hắc Phong Lĩnh', scope: 'shared' },
  { mapId: 'hac_thi', name: 'Hắc Thị', scope: 'shared' },
];
