/**
 * Pure routing helpers for the official client's MapData portal graph.
 *
 * The caller is responsible for supplying portals from `map.portals`.  This
 * module deliberately knows nothing about `warps` or the network protocol.
 */

export interface MapPortal {
  tx: number;
  ty: number;
  toMapId?: string;
  byHand?: boolean;
  cooldownSec?: number;
  cooldownGroup?: string;
}

export interface MapRouteLeg {
  fromMapId: string;
  toMapId: string;
  gate: { tx: number; ty: number };
}

export interface ReachableMap {
  mapId: string;
  hops: number;
  route: string[];
}

export type PortalsOf = (mapId: string) => readonly MapPortal[];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Return only automatic, structurally-known portal entries. */
export function usablePortals(portals: readonly MapPortal[] | null | undefined): MapPortal[] {
  if (!Array.isArray(portals)) return [];
  return portals.filter((portal) => typeof portal === 'object' && portal !== null
    && Number.isInteger(portal.tx) && Number.isInteger(portal.ty)
    && typeof portal.toMapId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(portal.toMapId)
    && portal.byHand !== true
    && !(finite(portal.cooldownSec) && portal.cooldownSec > 0)
    && typeof portal.cooldownGroup !== 'string');
}

function portalDistance(portal: MapPortal, start: { x: number; y: number }, tileSize: number): number {
  const x = portal.tx * tileSize + tileSize / 2;
  const y = portal.ty * tileSize + tileSize / 2;
  return Math.hypot(x - start.x, y - start.y);
}

/**
 * Find the shortest map route.  When a starting position is supplied, only
 * the first map's parallel gates are ordered by distance to that position;
 * later legs retain MapData order because the character's position is not
 * known to this pure graph function yet.
 */
export function planMapRoute(
  portalsOf: PortalsOf,
  fromMapId: string,
  toMapId: string,
  startPosition?: { x: number; y: number },
  tileSize = 32,
): MapRouteLeg[] | null {
  if (!fromMapId || !toMapId) return null;
  if (fromMapId === toMapId) return [];

  const queue = [fromMapId];
  const visited = new Set([fromMapId]);
  const parent = new Map<string, { fromMapId: string; gate: { tx: number; ty: number } }>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    let portals = usablePortals(portalsOf(current));
    if (current === fromMapId && startPosition && finite(startPosition.x) && finite(startPosition.y)) {
      portals = portals
        .map((portal, index) => ({ portal, index }))
        .sort((a, b) => portalDistance(a.portal, startPosition, tileSize) - portalDistance(b.portal, startPosition, tileSize)
          || a.index - b.index)
        .map(({ portal }) => portal);
    }
    for (const portal of portals) {
      const next = portal.toMapId!;
      if (visited.has(next)) continue;
      visited.add(next);
      parent.set(next, { fromMapId: current, gate: { tx: portal.tx, ty: portal.ty } });
      if (next === toMapId) {
        const reversed: MapRouteLeg[] = [];
        let cursor = toMapId;
        while (cursor !== fromMapId) {
          const edge = parent.get(cursor);
          if (!edge) return null;
          reversed.push({ fromMapId: edge.fromMapId, toMapId: cursor, gate: { ...edge.gate } });
          cursor = edge.fromMapId;
        }
        return reversed.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/** List the same BFS tree in a stable, dashboard-friendly shape. */
export function reachableMaps(
  portalsOf: PortalsOf,
  allMapIds: readonly string[],
  fromMapId: string,
): ReachableMap[] {
  const allowed = new Set(allMapIds.filter((mapId) => typeof mapId === 'string' && mapId.length > 0));
  if (!allowed.has(fromMapId)) return [];

  const result: ReachableMap[] = [{ mapId: fromMapId, hops: 0, route: [fromMapId] }];
  const queue = [fromMapId];
  const visited = new Set([fromMapId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentEntry = result.find((entry) => entry.mapId === current)!;
    for (const portal of usablePortals(portalsOf(current))) {
      const next = portal.toMapId!;
      if (!allowed.has(next) || visited.has(next)) continue;
      visited.add(next);
      result.push({ mapId: next, hops: currentEntry.hops + 1, route: [...currentEntry.route, next] });
      queue.push(next);
    }
  }
  return result;
}
