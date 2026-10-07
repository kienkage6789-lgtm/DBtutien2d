import { getWalkGrid, isWalkableTile, WALK_TILE_SIZE } from '../config/walk-grid.js';

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface TilePoint {
  readonly tx: number;
  readonly ty: number;
}

export interface WalkableTargetSuggestion extends PixelPoint, TilePoint {}

interface SearchNode {
  readonly tx: number;
  readonly ty: number;
  readonly g: number;
  readonly f: number;
}

const DIRECTIONS: readonly TilePoint[] = [
  { tx: -1, ty: -1 }, { tx: 0, ty: -1 }, { tx: 1, ty: -1 },
  { tx: -1, ty: 0 },                         { tx: 1, ty: 0 },
  { tx: -1, ty: 1 },  { tx: 0, ty: 1 },  { tx: 1, ty: 1 },
];

const keyOf = (tx: number, ty: number): string => `${tx},${ty}`;
const heuristic = (x: number, y: number, tx: number, ty: number): number => {
  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
};

// Match the public client's collision rectangle (PLAYER.HITBOX_W/H = 16/12)
// and line sampling (TileMap.lineClear samples every <=6px). A tile-center
// graph alone is insufficient around corners because the character occupies a
// rectangle, not a point.
const PLAYER_HALF_WIDTH = 8;
const PLAYER_HEIGHT = 12;

function rectBlocked(mapId: string, left: number, top: number, right: number, bottom: number): boolean {
  const firstTx = Math.floor(left / WALK_TILE_SIZE);
  const lastTx = Math.floor((right - 0.001) / WALK_TILE_SIZE);
  const firstTy = Math.floor(top / WALK_TILE_SIZE);
  const lastTy = Math.floor((bottom - 0.001) / WALK_TILE_SIZE);
  for (let ty = firstTy; ty <= lastTy; ty += 1) {
    for (let tx = firstTx; tx <= lastTx; tx += 1) {
      if (!isWalkableTile(mapId, tx, ty)) return true;
    }
  }
  return false;
}

function lineClear(mapId: string, from: PixelPoint, to: PixelPoint): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(2, Math.ceil(distance / 6));
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const x = from.x + (to.x - from.x) * ratio;
    const y = from.y + (to.y - from.y) * ratio;
    if (rectBlocked(mapId, x - PLAYER_HALF_WIDTH, y - PLAYER_HEIGHT, x + PLAYER_HALF_WIDTH, y)) return false;
  }
  return true;
}

/** Apply the same player-hitbox collision sampling used by A* to a final pixel segment. */
export function isWalkSegmentClear(mapId: string, from: PixelPoint, to: PixelPoint): boolean {
  return Number.isFinite(from.x) && Number.isFinite(from.y)
    && Number.isFinite(to.x) && Number.isFinite(to.y)
    && lineClear(mapId, from, to);
}

/** Find the nearest collision-safe tile center within a fixed, deterministic radius. */
export function findNearestWalkableTarget(
  mapId: string,
  x: number,
  y: number,
  maxRadiusTiles = 4,
): WalkableTargetSuggestion | null {
  const grid = getWalkGrid(mapId);
  if (!grid || !Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x >= grid.width * WALK_TILE_SIZE || y >= grid.height * WALK_TILE_SIZE
    || !Number.isInteger(maxRadiusTiles) || maxRadiusTiles < 0) return null;
  const originTx = Math.floor(x / WALK_TILE_SIZE);
  const originTy = Math.floor(y / WALK_TILE_SIZE);
  const candidates: WalkableTargetSuggestion[] = [];
  for (let ty = Math.max(0, originTy - maxRadiusTiles); ty <= Math.min(grid.height - 1, originTy + maxRadiusTiles); ty += 1) {
    for (let tx = Math.max(0, originTx - maxRadiusTiles); tx <= Math.min(grid.width - 1, originTx + maxRadiusTiles); tx += 1) {
      if (!isWalkableTile(mapId, tx, ty)) continue;
      const point = { x: tx * WALK_TILE_SIZE + WALK_TILE_SIZE / 2, y: ty * WALK_TILE_SIZE + WALK_TILE_SIZE / 2 };
      if (!isWalkSegmentClear(mapId, point, point)) continue;
      candidates.push({ ...point, tx, ty });
    }
  }
  candidates.sort((a, b) => {
    const distanceA = (a.x - x) ** 2 + (a.y - y) ** 2;
    const distanceB = (b.x - x) ** 2 + (b.y - y) ** 2;
    return distanceA - distanceB || a.ty - b.ty || a.tx - b.tx;
  });
  return candidates[0] ?? null;
}

/**
 * A* path from a pixel position to a target portal tile. Diagonal steps are
 * accepted only when both adjacent orthogonal tiles are walkable. Returns
 * pixel-center waypoints for each tile after the start, including the target;
 * returns null when the map, coordinates, or route is invalid.
 */
export function findWalkPath(
  mapId: string,
  from: PixelPoint,
  target: TilePoint,
): PixelPoint[] | null {
  const grid = getWalkGrid(mapId);
  if (!grid || !Number.isFinite(from.x) || !Number.isFinite(from.y)) return null;
  const start = { tx: Math.floor(from.x / WALK_TILE_SIZE), ty: Math.floor(from.y / WALK_TILE_SIZE) };
  if (!isWalkableTile(mapId, start.tx, start.ty) || !isWalkableTile(mapId, target.tx, target.ty)) return null;
  if (start.tx === target.tx && start.ty === target.ty) return [];

  const open: SearchNode[] = [{ ...start, g: 0, f: heuristic(start.tx, start.ty, target.tx, target.ty) }];
  const best = new Map<string, number>([[keyOf(start.tx, start.ty), 0]]);
  const previous = new Map<string, string>();
  const closed = new Set<string>();

  while (open.length) {
    // The maps are small; deterministic linear selection keeps this module dependency-free.
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIndex].f || (open[i].f === open[bestIndex].f && open[i].g > open[bestIndex].g)) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = keyOf(current.tx, current.ty);
    if (closed.has(currentKey)) continue;
    if (current.tx === target.tx && current.ty === target.ty) {
      const tiles: TilePoint[] = [];
      let key = currentKey;
      while (key !== keyOf(start.tx, start.ty)) {
        const [tx, ty] = key.split(',').map(Number);
        tiles.push({ tx, ty });
        const parent = previous.get(key);
        if (!parent) return null;
        key = parent;
      }
      tiles.reverse();
      return tiles.map(({ tx, ty }) => ({ x: tx * WALK_TILE_SIZE + WALK_TILE_SIZE / 2, y: ty * WALK_TILE_SIZE + WALK_TILE_SIZE / 2 }));
    }
    closed.add(currentKey);

    for (const direction of DIRECTIONS) {
      const tx = current.tx + direction.tx;
      const ty = current.ty + direction.ty;
      if (!isWalkableTile(mapId, tx, ty)) continue;
      if (direction.tx !== 0 && direction.ty !== 0) {
        if (!isWalkableTile(mapId, current.tx + direction.tx, current.ty)
          || !isWalkableTile(mapId, current.tx, current.ty + direction.ty)) continue;
      }
      const currentCenter = {
        x: current.tx * WALK_TILE_SIZE + WALK_TILE_SIZE / 2,
        y: current.ty * WALK_TILE_SIZE + WALK_TILE_SIZE / 2,
      };
      const nextCenter = {
        x: tx * WALK_TILE_SIZE + WALK_TILE_SIZE / 2,
        y: ty * WALK_TILE_SIZE + WALK_TILE_SIZE / 2,
      };
      if (!lineClear(mapId, currentCenter, nextCenter)) continue;
      const nextKey = keyOf(tx, ty);
      if (closed.has(nextKey)) continue;
      const step = direction.tx !== 0 && direction.ty !== 0 ? Math.SQRT2 : 1;
      const g = current.g + step;
      if (g >= (best.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(nextKey, g);
      previous.set(nextKey, currentKey);
      open.push({ tx, ty, g, f: g + heuristic(tx, ty, target.tx, target.ty) });
    }
  }
  return null;
}
