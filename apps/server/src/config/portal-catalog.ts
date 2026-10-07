/**
 * Verified portal edges transcribed from the vendored public client snapshot
 * (vendor/tutien2d-public-client/2026-10-06/src/world/{mapdata.js,map_long_uyen.js}).
 * Coordinates are source-map tiles. `byHand` portals require an explicit
 * interaction in the client and are not treated as walk-triggered transitions.
 */
export interface PortalEdge {
  portalId: string;
  fromMapId: string;
  toMapId: string;
  tx: number;
  ty: number;
  targetSpawn?: { tx: number; ty: number };
  label?: string;
  byHand?: boolean;
  slack?: number;
}

export const VERIFIED_PORTAL_EDGES: readonly PortalEdge[] = [
  { portalId: 'tan-vien-to-truc-7-29', fromMapId: 'tan_vien', toMapId: 'thanh_truc_lam', tx: 7, ty: 29, targetSpawn: { tx: 7, ty: 1 } },
  { portalId: 'truc-to-tan-7-0', fromMapId: 'thanh_truc_lam', toMapId: 'tan_vien', tx: 7, ty: 0, targetSpawn: { tx: 7, ty: 28 } },
  { portalId: 'tan-vien-to-mieu-0-12', fromMapId: 'tan_vien', toMapId: 'mieu_hoang', tx: 0, ty: 12, targetSpawn: { tx: 18, ty: 6 } },
  { portalId: 'mieu-to-tan-19-6', fromMapId: 'mieu_hoang', toMapId: 'tan_vien', tx: 19, ty: 6, targetSpawn: { tx: 1, ty: 12 } },
  { portalId: 'tan-vien-to-dong-mach-22-4', fromMapId: 'tan_vien', toMapId: 'dong_mach_ngam', tx: 22, ty: 4, targetSpawn: { tx: 16, ty: 19 }, label: 'Vào Miếu Ông Trường Con' },
  { portalId: 'dong-mach-to-tan-18-22', fromMapId: 'dong_mach_ngam', toMapId: 'tan_vien', tx: 18, ty: 22, targetSpawn: { tx: 22, ty: 6 }, label: 'Ra Chân Núi' },
  { portalId: 'truc-to-duoc-12-29', fromMapId: 'thanh_truc_lam', toMapId: 'duoc_vien', tx: 12, ty: 29, targetSpawn: { tx: 12, ty: 2 } },
  { portalId: 'duoc-to-truc-12-0', fromMapId: 'duoc_vien', toMapId: 'thanh_truc_lam', tx: 12, ty: 0, targetSpawn: { tx: 12, ty: 28 } },
  { portalId: 'truc-to-long-uyen-39-13', fromMapId: 'thanh_truc_lam', toMapId: 'long_uyen', tx: 39, ty: 13, targetSpawn: { tx: 2, ty: 14 } },
  { portalId: 'long-uyen-to-truc-0-14', fromMapId: 'long_uyen', toMapId: 'thanh_truc_lam', tx: 0, ty: 14, targetSpawn: { tx: 38, ty: 13 } },
  { portalId: 'duoc-to-vuon-11-6', fromMapId: 'duoc_vien', toMapId: 'vuon_ca_nhan', tx: 11, ty: 6, targetSpawn: { tx: 8, ty: 10 } },
  { portalId: 'vuon-to-duoc-8-12', fromMapId: 'vuon_ca_nhan', toMapId: 'duoc_vien', tx: 8, ty: 12, targetSpawn: { tx: 12, ty: 10 } },
] as const;
