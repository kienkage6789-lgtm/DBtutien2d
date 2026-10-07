import { VERIFIED_PORTAL_EDGES, type PortalEdge } from '../config/portal-catalog.js';

export const TILE = 32;

export type NavigationPhase =
  | 'planning'
  | 'moving_to_portal'
  | 'waiting_map_confirmation'
  | 'arrived'
  | 'blocked'
  | 'failed';

export interface PortalCenter {
  x: number;
  y: number;
}

export interface NavigationRetryMetadata {
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  commandAt: number | null;
  deadlineAt: number | null;
  lastTimedOutAt: number | null;
}

export interface PortalNavigationState {
  phase: NavigationPhase;
  currentMapId: string;
  targetMapId: string;
  route: readonly PortalEdge[];
  routeIndex: number;
  retry: NavigationRetryMetadata;
  reason?: string;
}

export function portalCenter(edge: Pick<PortalEdge, 'tx' | 'ty'>): PortalCenter {
  return { x: (edge.tx + 0.5) * TILE, y: (edge.ty + 0.5) * TILE };
}

/** BFS over walk-activated, verified portal edges. */
export function findPortalRoute(
  fromMapId: string,
  toMapId: string,
  edges: readonly PortalEdge[] = VERIFIED_PORTAL_EDGES,
): PortalEdge[] | null {
  if (!fromMapId || !toMapId) return null;
  if (fromMapId === toMapId) return [];

  const outgoing = new Map<string, PortalEdge[]>();
  for (const edge of edges) {
    if (edge.byHand) continue;
    const list = outgoing.get(edge.fromMapId) ?? [];
    list.push(edge);
    outgoing.set(edge.fromMapId, list);
  }

  const queue: Array<{ mapId: string; route: PortalEdge[] }> = [{ mapId: fromMapId, route: [] }];
  const visited = new Set([fromMapId]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const entry = queue[cursor];
    for (const edge of outgoing.get(entry.mapId) ?? []) {
      if (visited.has(edge.toMapId)) continue;
      const route = [...entry.route, edge];
      if (edge.toMapId === toMapId) return route;
      visited.add(edge.toMapId);
      queue.push({ mapId: edge.toMapId, route });
    }
  }
  return null;
}

export function createNavigationState(
  currentMapId: string,
  targetMapId: string,
  options: { now: number; timeoutMs?: number; maxAttempts?: number },
): PortalNavigationState {
  return {
    phase: 'planning',
    currentMapId,
    targetMapId,
    route: [],
    routeIndex: 0,
    retry: {
      attempt: 0,
      maxAttempts: options.maxAttempts ?? 3,
      timeoutMs: options.timeoutMs ?? 10_000,
      commandAt: null,
      deadlineAt: null,
      lastTimedOutAt: null,
    },
  };
}

export function planNavigation(
  state: PortalNavigationState,
  edges: readonly PortalEdge[] = VERIFIED_PORTAL_EDGES,
): PortalNavigationState {
  if (state.phase !== 'planning') return state;
  if (state.currentMapId === state.targetMapId) return { ...state, phase: 'arrived', route: [] };
  const route = findPortalRoute(state.currentMapId, state.targetMapId, edges);
  if (!route) return { ...state, phase: 'blocked', reason: 'route_unavailable' };
  return { ...state, phase: 'moving_to_portal', route };
}

/** Call only after the portal enter command is sent; sending/transport ACK is not success. */
export function markWaitingForMapConfirmation(
  state: PortalNavigationState,
  commandAt: number,
): PortalNavigationState {
  if (state.phase !== 'moving_to_portal' || !state.route[state.routeIndex]) return state;
  return {
    ...state,
    phase: 'waiting_map_confirmation',
    retry: {
      ...state.retry,
      attempt: state.retry.attempt + 1,
      commandAt,
      deadlineAt: commandAt + state.retry.timeoutMs,
    },
  };
}

/** Only a fresh authoritative map observation can advance the route. */
export function confirmObservedMap(
  state: PortalNavigationState,
  observation: { mapId: string; observedAt: number },
): PortalNavigationState {
  if (state.phase !== 'waiting_map_confirmation' || state.retry.commandAt === null) return state;
  if (observation.observedAt <= state.retry.commandAt) return state;
  const edge = state.route[state.routeIndex];
  if (!edge || observation.mapId !== edge.toMapId) return state;
  const routeIndex = state.routeIndex + 1;
  return {
    ...state,
    currentMapId: observation.mapId,
    routeIndex,
    phase: observation.mapId === state.targetMapId ? 'arrived' : 'moving_to_portal',
    retry: { ...state.retry, attempt: 0, commandAt: null, deadlineAt: null },
    reason: undefined,
  };
}

/** Timeout retries are bounded. A retry returns to the same portal step for the caller to re-evaluate. */
export function expireMapConfirmation(
  state: PortalNavigationState,
  now: number,
): PortalNavigationState {
  if (state.phase !== 'waiting_map_confirmation' || state.retry.deadlineAt === null || now < state.retry.deadlineAt) return state;
  const retry = { ...state.retry, lastTimedOutAt: now, commandAt: null, deadlineAt: null };
  if (retry.attempt >= retry.maxAttempts) {
    return { ...state, phase: 'failed', retry, reason: 'map_confirmation_timeout' };
  }
  return { ...state, phase: 'moving_to_portal', retry, reason: 'map_confirmation_timeout_retry' };
}
