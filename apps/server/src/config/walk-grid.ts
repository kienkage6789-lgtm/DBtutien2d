/**
 * Backward-compatible server facade for the vendor-derived collision grids.
 * The source of truth is generated in core-client; keep this module's public
 * API stable for portal navigation and move-to callers.
 */
import {
  WALK_GRIDS as GENERATED_WALK_GRIDS,
  WALK_TILE_SIZE,
} from '@tutien2d/core-client';
import type { GeneratedWalkGrid } from '@tutien2d/core-client';

export { WALK_TILE_SIZE };
export type WalkGrid = GeneratedWalkGrid;
export const WALK_GRIDS: Readonly<Record<string, WalkGrid>> = GENERATED_WALK_GRIDS;

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
