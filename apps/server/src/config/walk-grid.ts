/**
 * Static walk collision grids copied from the 2026-10-06 public-client snapshot.
 * Source: vendor/tutien2d-public-client/2026-10-06/src/world map data and
 * TileMap.load() blocked-tile rules. Rows encode blocked x ranges as `a-b,c`.
 * This module has no vendor/runtime file dependency. TILE is 32px.
 */

export const WALK_TILE_SIZE = 32;

export interface WalkGrid {
  readonly mapId: string;
  readonly width: number;
  readonly height: number;
  /** One comma-separated list of blocked x coordinates/ranges per y row. */
  readonly blockedRows: readonly string[];
}

export const WALK_GRIDS: Readonly<Record<string, WalkGrid>> = {
  tan_vien: {
    mapId: 'tan_vien', width: 40, height: 30,
    blockedRows: [
      '0-39', '0-39', '0-31,33-39', '0-18,21-30,33-39', '0-4,8-18,20,25-27,29,34-39',
      '0-2,7,10-17,26-27,35-39', '0-2,11-12,15,25-26,35-39', '0-3,25-26,35-39',
      '0-5,9-11,15-17,19-21,25-27,34-39', '0-5,9-11,15-17,19-21,24-26,33-39',
      '0-5,7,9,24-26,29,32-39', '0-2,4-5,16,20,24-25,32-39', '5-6,11,18,24-25,33-39',
      '6-11,24-25,36-39', '0-1', '0-1', '0-3,5-7,24-25,33,37-39', '0-2,5-7,24-25,38-39',
      '0-2,8,15,23-25,33,38-39', '0-2,22-24,35,38-39', '0-6,21-24,39',
      '0-4,6,10,13,17-19,21-24,29,39', '0-4,12,16-23,32-33,35-36,39',
      '0-3,15-22,28,32-39', '0-2,14-22,28-31,33-39', '0-4,6,10,14-21,27-28,30,34-39',
      '0-6,10-11,14-21,33-39', '0-6,9-12,14-21,30-39', '0-6,9-24,30-39', '0-6,9-39',
    ],
  },
  thanh_truc_lam: {
    mapId: 'thanh_truc_lam', width: 40, height: 30,
    blockedRows: [
      '0-1,3-6,9-12,15-34,36-39', '0-2,4-6,9,11-22,25-27,30-32,34-39',
      '0-3,5-6,11-17,19,21-22,26-34,36-37', '0-6,12-15,21-22,29-33,35-38',
      '0-6,12-16,21-22,28-38', '0-6,12,14,18,21-22,29-32,34-37,39',
      '0-4,12,21-22,29-32,34-39', '2-4,6,32,34-39', '0-1,3-7,31,34,36,39', '1-4,17,21-22,36,39',
      '0-4,17,20-23,26-27', '0-3,20-23,31,38-39', '0-1,16,19-25,27,30-31,37', '0-2,12,18-24',
      '0-2,10,17-25', '0-1,17-25,37-39', '0,18-28,35-38', '0,4,7,20-28,35-37',
      '0,6-7,20-27,35,37-39', '0,6-7,20-23,35-39', '0,6,10,20-23,31-32,35-36,38-39',
      '0,21-23,25,35-39', '0,7,21-23,26,36-37,39', '0-1,3-4,21-22,24-25,37-39',
      '1-3,33-34,37-39', '0,2,4,6,31-35,38-39', '0-1,3-6,8-10,18,20-23,25-28,32-33,35-39',
      '0-2,5-6,8,10,18-24,27,32-35,37-39', '0-4,6-10,15,17-19,21-29,32-39',
      '0-10,14,16,18-25,27-39',
    ],
  },
  duoc_vien: {
    mapId: 'duoc_vien', width: 40, height: 30,
    blockedRows: [
      '0-11,14-39', '0-11,14-39', '0-2,4-5,7,11,14-15,17-18,21-24,26,33-39',
      '0-11,14,17,27-28,33-34,36-39', '0-6,11,16,31,33-34,36-39', '0-6,11,19,33-34,37-39',
      '0-3,16,26,33-34,36-39', '0-3,20,33-34,36-39', '0-3,11,14-15,24,28,33-34,36-39',
      '0-3,11,19,33-34,36-39', '0-3,6-8,11,37-39', '0-3,6-9,11,33-35,37-39',
      '0-3,7-8,11,17,22,29,33-34,37-39', '0-11,28,32-33,36-39', '0-3,21,31-32,37-39',
      '0-3,6,30-31,37-39', '0-2,6,20-25,29-30,36-39', '0-3,7,16-30,33,36-39',
      '0-2,4,8,16-29,37-39', '0-3,10,15-30,33,36-39', '0-5,15-30,33-34,37-39',
      '0-2,8,12,15-30,37-39', '0-2,7-8,15-30,36-39', '0-2,16-29,37-39',
      '0-2,9,14,18-27,35-39', '0-3,5,13-14,20-25,30,34,37-39',
      '0-5,7,10,12,18,24-25,28-31,33-39', '0-39', '0-39', '0-39',
    ],
  },
  vuon_ca_nhan: {
    mapId: 'vuon_ca_nhan', width: 18, height: 13,
    blockedRows: ['0-17', '0-1,16-17', '0-2,16-17', '0-7,12-17', '0-2,13-14,16-17', '0-2,12-14,16-17', '0-2,16-17', '0-1,16-17', '0-1,16-17', '0-1,3,10,16-17', '0-1,16-17', '0-1,16-17', '0-7,10-17'],
  },
  mieu_hoang: {
    mapId: 'mieu_hoang', width: 20, height: 14,
    blockedRows: ['0-19', '0-1,18-19', '0,15,19', '0,3-10,19', '0,3,10,14,19', '0,3,19', '0,3,7,12', '0,3', '0,3,10,19', '0,3-10,19', '0,19', '0-1,8,16,18-19', '0-1,15,18-19', '0-19'],
  },
  dong_mach_ngam: {
    mapId: 'dong_mach_ngam', width: 30, height: 26,
    blockedRows: ['0-29', '0-29', '0,2-3,10-20,26-27,29', '0,3-4,10-20,25-26,29', '0,3-4,6,10-20,23,25-26,29', '0,3-4,10-20,25-26,29', '0,2-4,10-20,25-26,29', '0,3-4,10-20,25-27,29', '0,4,7,10-20,23,25,29', '0,4,9,21,25,29', '0,4,12,18,25,29', '0,4-5,9,21,24-25,29', '0,4-5,15,24-25,29', '0,3-7,22-26,29', '0,3-9,21-27,29', '0,3-7,22-26,29', '0,3-7,23-25,29', '0,6-7,13,17,23-24,29', '0,2,7-8,22-24,27,29', '0,8-13,17-22,29', '0,8-13,17-22,29', '0,3,17-18,27,29', '0,29', '0,2,27,29', '0,11,13,17,19,29', '0-13,17-29'],
  },
};

const decoded = new WeakMap<WalkGrid, readonly Uint8Array[]>();

function blockedRows(grid: WalkGrid): readonly Uint8Array[] {
  const cached = decoded.get(grid);
  if (cached) return cached;
  const rows = grid.blockedRows.map((encoded) => {
    const blocked = new Uint8Array(grid.width);
    for (const range of encoded.split(',').filter(Boolean)) {
      const [startText, endText = startText] = range.split('-');
      const start = Number(startText);
      const end = Number(endText);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= grid.width) {
        throw new Error(`Invalid blocked range in ${grid.mapId}: ${range}`);
      }
      blocked.fill(1, start, end + 1);
    }
    return blocked;
  });
  if (rows.length !== grid.height) throw new Error(`Invalid blocked row count in ${grid.mapId}`);
  decoded.set(grid, rows);
  return rows;
}

export function getWalkGrid(mapId: string): WalkGrid | undefined {
  return WALK_GRIDS[mapId];
}

export function isWalkableTile(mapId: string, tx: number, ty: number): boolean {
  const grid = getWalkGrid(mapId);
  if (!grid || !Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return false;
  return blockedRows(grid)[ty][tx] === 0;
}
