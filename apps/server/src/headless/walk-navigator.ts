import { VENDOR_TILE_SIZE } from './auto-supervisor.js';
import { planMapRoute, type MapPortal, type MapRouteLeg } from './map-route.js';

export interface WalkRequest {
  /** Required for same-map movement; omitted means the destination map spawn. */
  target?: { x: number; y: number };
  targetMapId?: string;
  arrivalRadius?: number;
  timeoutMs?: number;
  abortOnHurt?: boolean;
  maxHurt?: number;
  requester: 'user' | 'supervisor' | 'auto' | string;
}

export type WalkStatus = 'accepted' | 'running' | 'arrived' | 'blocked' | 'failed' | 'cancelled';
export type WalkLegPhase = 'walking_to_gate' | 'on_gate' | 'waiting_map' | 'walking_to_target';

export interface WalkLegInfo {
  index: number;
  fromMapId: string;
  toMapId: string | null;
  phase: WalkLegPhase;
}

export interface WalkOperation {
  operationId: string;
  target: { x: number; y: number } | null;
  resolvedTarget: { x: number; y: number } | null;
  status: WalkStatus;
  reason?: string;
  requester: string;
  startedAt: number;
  updatedAt: number;
  route?: string[];
  leg?: WalkLegInfo;
}

export type WalkErrorCode =
  | 'NOT_IN_GAME'
  | 'VENDOR_MAP_NOT_READY'
  | 'CHARACTER_DOWN'
  | 'AUTO_ACTIVE'
  | 'OPERATION_IN_PROGRESS'
  | 'TARGET_INVALID'
  | 'TARGET_UNREACHABLE'
  | 'TARGET_ON_PORTAL'
  | 'ROUTE_UNAVAILABLE'
  | 'PATH_CROSSES_PORTAL';

export class WalkError extends Error {
  public readonly code: WalkErrorCode;

  public constructor(code: WalkErrorCode, message = code) {
    super(message);
    this.name = 'WalkError';
    this.code = code;
  }
}

export interface WalkPlayer {
  x: number;
  y: number;
  path?: unknown[];
  state?: string;
  downed?: boolean;
  setPath(route: unknown[]): void;
  stop(): void;
}

export interface WalkMap {
  width: number;
  height: number;
  pxWidth?: number;
  pxHeight?: number;
}

export type WalkPortal = MapPortal;

export interface WalkPathfinder {
  route(
    map: WalkMap,
    x: number,
    y: number,
    targetX: number,
    targetY: number,
    hitboxHalfWidth: number,
    hitboxHeight: number,
  ): unknown[];
}

export interface WalkNavigatorClient {
  nowMs(): number;
  isInGame(): boolean;
  isMapReady(): boolean;
  isTransitioning(): boolean;
  getMapId(): string | null;
  getMap(): WalkMap | null;
  getPlayer(): WalkPlayer | null;
  isDown(player: WalkPlayer): boolean;
  isAutoRequested(): boolean;
  getSupervisorPhase(): string;
  getPathfinder(): WalkPathfinder | null;
  getHitbox(): { width: number; height: number };
  getPortals(mapId: string): readonly WalkPortal[];
  getMapIds?(): readonly string[];
  getHurtCount?(): number;
  recordLog(event: { code: string; reasonCode?: string; at: number }): void;
}

export interface WalkNavigatorOptions {
  arrivalRadius?: number;
  speedPxPerSecond?: number;
  tileSize?: number;
  stuckDistancePx?: number;
  stuckTimeoutMs?: number;
  maxTimeoutMs?: number;
  minTimeoutMs?: number;
  portalWaitTimeoutMs?: number;
  maxTotalTimeoutMs?: number;
  createOperationId?: (now: number) => string;
}

const DEFAULT_ARRIVAL_RADIUS = 20;
const DEFAULT_SPEED_PX_PER_SECOND = 101;
const DEFAULT_STUCK_DISTANCE_PX = 5;
const DEFAULT_STUCK_TIMEOUT_MS = 5_000;
const DEFAULT_MIN_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TIMEOUT_MS = 120_000;
const DEFAULT_PORTAL_WAIT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_TOTAL_TIMEOUT_MS = 10 * 60_000;

let operationSequence = 0;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const active = (status: WalkStatus): boolean => status === 'accepted' || status === 'running';

function copyPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x, y: point.y };
}

function copyOperation(operation: WalkOperation | null): WalkOperation | null {
  return operation ? {
    ...operation,
    target: operation.target ? copyPoint(operation.target) : null,
    resolvedTarget: operation.resolvedTarget ? copyPoint(operation.resolvedTarget) : null,
    ...(operation.route ? { route: [...operation.route] } : {}),
    ...(operation.leg ? { leg: { ...operation.leg } } : {}),
  } : null;
}

function routePoint(route: unknown[], tileSize: number): { x: number; y: number } | null {
  const last = route[route.length - 1];
  if (!last || typeof last !== 'object' || Array.isArray(last)) return null;
  const point = last as Record<string, unknown>;
  if (finite(point.x) && finite(point.y)) return { x: point.x, y: point.y };
  if (Number.isInteger(point.tx) && Number.isInteger(point.ty)) {
    return { x: Number(point.tx) * tileSize + tileSize / 2, y: Number(point.ty) * tileSize + tileSize / 2 };
  }
  return null;
}

function routePoints(start: { x: number; y: number }, route: unknown[], tileSize: number): Array<{ x: number; y: number }> {
  return [start, ...route.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const point = item as Record<string, unknown>;
    if (finite(point.x) && finite(point.y)) return { x: point.x, y: point.y };
    if (Number.isInteger(point.tx) && Number.isInteger(point.ty)) {
      return { x: Number(point.tx) * tileSize + tileSize / 2, y: Number(point.ty) * tileSize + tileSize / 2 };
    }
    return null;
  }).filter((point): point is { x: number; y: number } => point !== null)];
}

function distance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.hypot(from.x - to.x, from.y - to.y);
}

function routeDistance(start: { x: number; y: number }, route: unknown[], tileSize: number, fallback: number): number {
  const points = routePoints(start, route, tileSize);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
  return points.length > 1 && total > 0 ? total : fallback;
}

function segmentIntersectsRect(
  from: { x: number; y: number },
  to: { x: number; y: number },
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (const [start, delta, min, max] of [[from.x, dx, minX, maxX], [from.y, dy, minY, maxY]] as const) {
    if (Math.abs(delta) < 0.0001) {
      if (start < min || start > max) return false;
      continue;
    }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }
  return true;
}

function isPortalTile(point: { x: number; y: number }, portal: WalkPortal, tileSize: number): boolean {
  return Math.floor(point.x / tileSize) === portal.tx && Math.floor(point.y / tileSize) === portal.ty;
}

function routeCrossesPortal(
  start: { x: number; y: number },
  route: unknown[],
  portals: readonly WalkPortal[],
  tileSize: number,
  allowedPortal?: { tx: number; ty: number },
): boolean {
  const points = routePoints(start, route, tileSize);
  for (const portal of portals) {
    if (portal.byHand === true || !Number.isInteger(portal.tx) || !Number.isInteger(portal.ty)) continue;
    if (allowedPortal && portal.tx === allowedPortal.tx && portal.ty === allowedPortal.ty) continue;
    const minX = portal.tx * tileSize;
    const minY = portal.ty * tileSize;
    const maxX = minX + tileSize;
    const maxY = minY + tileSize;
    if (points.some((point) => isPortalTile(point, portal, tileSize))) return true;
    for (let index = 1; index < points.length; index += 1) {
      if (segmentIntersectsRect(points[index - 1], points[index], minX, minY, maxX, maxY)) return true;
    }
  }
  return false;
}

function isMapId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

export class WalkNavigator {
  private readonly cfg: Required<Omit<WalkNavigatorOptions, 'createOperationId'>> & {
    createOperationId: (now: number) => string;
  };
  private operation: WalkOperation | null = null;
  private mapId: string | null = null;
  private lastProgressAt = 0;
  private lastProgressPosition: { x: number; y: number } | null = null;
  private deadlineAt = 0;
  private totalDeadlineAt = 0;
  private waitStartedAt = 0;
  private transitionObserved = false;
  private currentArrivalRadius = DEFAULT_ARRIVAL_RADIUS;
  private plannedLegs: MapRouteLeg[] = [];
  private hurtAtStart = 0;
  private abortOnHurt = false;
  private maxHurt = 1;
  private requestTimeoutMs: number | undefined;

  public constructor(private readonly client: WalkNavigatorClient, options: WalkNavigatorOptions = {}) {
    this.cfg = {
      arrivalRadius: options.arrivalRadius ?? DEFAULT_ARRIVAL_RADIUS,
      speedPxPerSecond: options.speedPxPerSecond ?? DEFAULT_SPEED_PX_PER_SECOND,
      tileSize: options.tileSize ?? VENDOR_TILE_SIZE,
      stuckDistancePx: options.stuckDistancePx ?? DEFAULT_STUCK_DISTANCE_PX,
      stuckTimeoutMs: options.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS,
      maxTimeoutMs: options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
      minTimeoutMs: options.minTimeoutMs ?? DEFAULT_MIN_TIMEOUT_MS,
      portalWaitTimeoutMs: options.portalWaitTimeoutMs ?? DEFAULT_PORTAL_WAIT_TIMEOUT_MS,
      maxTotalTimeoutMs: options.maxTotalTimeoutMs ?? DEFAULT_MAX_TOTAL_TIMEOUT_MS,
      createOperationId: options.createOperationId ?? ((now) => `move-${now}-${++operationSequence}`),
    };
  }

  public getOperation(): WalkOperation | null { return copyOperation(this.operation); }

  public walkTo(request: WalkRequest): WalkOperation {
    const now = this.client.nowMs();
    if (!this.client.isInGame()) throw new WalkError('NOT_IN_GAME');
    if (!this.client.isMapReady() || this.client.isTransitioning()) throw new WalkError('VENDOR_MAP_NOT_READY');
    const player = this.client.getPlayer();
    const map = this.client.getMap();
    const mapId = this.client.getMapId();
    if (!player) throw new WalkError('NOT_IN_GAME');
    if (!map || !mapId) throw new WalkError('VENDOR_MAP_NOT_READY');
    if (this.client.isDown(player)) throw new WalkError('CHARACTER_DOWN');
    if (this.client.isAutoRequested() || this.client.getSupervisorPhase() !== 'idle') throw new WalkError('AUTO_ACTIVE');
    if (this.operation && active(this.operation.status)) throw new WalkError('OPERATION_IN_PROGRESS');

    const targetMapId = request.targetMapId ?? mapId;
    if (!isMapId(targetMapId)) throw new WalkError('TARGET_INVALID');
    const arrivalRadius = request.arrivalRadius ?? this.cfg.arrivalRadius;
    if (!finite(arrivalRadius) || arrivalRadius <= 0
      || (request.timeoutMs !== undefined && (!finite(request.timeoutMs) || request.timeoutMs <= 0))
      || (request.maxHurt !== undefined && (!Number.isInteger(request.maxHurt) || request.maxHurt < 1))) {
      throw new WalkError('TARGET_INVALID');
    }
    const target = request.target;
    const multiMap = targetMapId !== mapId;
    if (!multiMap && (!target || !finite(target.x) || !finite(target.y))) throw new WalkError('TARGET_INVALID');
    if (multiMap && this.client.getMapIds && !this.client.getMapIds().includes(targetMapId)) throw new WalkError('TARGET_INVALID');

    const pathfinder = this.client.getPathfinder();
    if (!pathfinder) throw new WalkError('VENDOR_MAP_NOT_READY');
    const hitbox = this.client.getHitbox();
    const portals = this.client.getPortals(mapId);
    let legs: MapRouteLeg[] = [];
    if (multiMap) {
      legs = planMapRoute(
        (candidate) => this.client.getPortals(candidate),
        mapId,
        targetMapId,
        { x: player.x, y: player.y },
        this.cfg.tileSize,
      ) ?? [];
      if (legs.length === 0) throw new WalkError('ROUTE_UNAVAILABLE');
    }

    let resolvedTarget: { x: number; y: number } | null;
    let initialRoute: unknown[];
    if (multiMap) {
      const first = legs[0];
      resolvedTarget = this.portalCenter(first.gate);
      initialRoute = this.safeRoute(pathfinder, map, player, resolvedTarget, portals, first.gate);
    } else {
      const requestedTarget = target!;
      const maxX = finite(map.pxWidth) ? map.pxWidth : map.width * this.cfg.tileSize;
      const maxY = finite(map.pxHeight) ? map.pxHeight : map.height * this.cfg.tileSize;
      if (!finite(maxX) || !finite(maxY) || !finite(map.width) || !finite(map.height)
        || requestedTarget.x < 0 || requestedTarget.y < 0 || requestedTarget.x >= maxX || requestedTarget.y >= maxY) {
        throw new WalkError('TARGET_INVALID');
      }
      const rawRoute = pathfinder.route(map, player.x, player.y, requestedTarget.x, requestedTarget.y, hitbox.width / 2, hitbox.height);
      if (!Array.isArray(rawRoute) || rawRoute.length === 0) throw new WalkError('TARGET_UNREACHABLE');
      resolvedTarget = routePoint(rawRoute, this.cfg.tileSize);
      if (!resolvedTarget || !finite(resolvedTarget.x) || !finite(resolvedTarget.y)) throw new WalkError('TARGET_UNREACHABLE');
      const targetTileX = Math.floor(resolvedTarget.x / this.cfg.tileSize);
      const targetTileY = Math.floor(resolvedTarget.y / this.cfg.tileSize);
      if (portals.some((portal) => portal.tx === targetTileX && portal.ty === targetTileY)) throw new WalkError('TARGET_ON_PORTAL');
      initialRoute = this.safeRoute(pathfinder, map, player, resolvedTarget, portals);
    }

    try {
      player.setPath(initialRoute);
    } catch {
      throw new WalkError('TARGET_UNREACHABLE');
    }

    this.operation = {
      operationId: this.cfg.createOperationId(now),
      target: target ? copyPoint(target) : null,
      resolvedTarget: copyPoint(resolvedTarget),
      status: 'accepted',
      requester: request.requester,
      startedAt: now,
      updatedAt: now,
      ...(multiMap ? { route: [mapId, ...legs.map((leg) => leg.toMapId)] } : {}),
      ...(multiMap ? { leg: { index: 0, fromMapId: mapId, toMapId: legs[0].toMapId, phase: 'walking_to_gate' as const } } : {}),
    };
    this.mapId = mapId;
    this.plannedLegs = legs;
    this.currentArrivalRadius = arrivalRadius;
    this.requestTimeoutMs = request.timeoutMs;
    this.abortOnHurt = multiMap && request.abortOnHurt !== false;
    this.maxHurt = request.maxHurt ?? 1;
    this.hurtAtStart = this.client.getHurtCount?.() ?? 0;
    this.lastProgressAt = now;
    this.lastProgressPosition = { x: player.x, y: player.y };
    this.deadlineAt = now + this.timeoutForRoute({ x: player.x, y: player.y }, initialRoute, resolvedTarget);
    this.totalDeadlineAt = now + (multiMap ? this.cfg.maxTotalTimeoutMs : Math.min(this.cfg.maxTotalTimeoutMs, this.deadlineAt - now));
    this.waitStartedAt = 0;
    this.transitionObserved = false;
    this.client.recordLog({ code: 'move_to_accepted', at: now });
    return copyOperation(this.operation)!;
  }

  public cancel(operationId: string, reason: string): boolean {
    if (!this.operation || this.operation.operationId !== operationId || !active(this.operation.status)) return false;
    this.finish('cancelled', reason, 'move_to_cancelled');
    return true;
  }

  public tick(): void {
    const operation = this.operation;
    if (!operation || !active(operation.status)) return;
    const now = this.client.nowMs();
    const player = this.client.getPlayer();
    if (this.abortOnHurt && (this.client.getHurtCount?.() ?? this.hurtAtStart) - this.hurtAtStart >= this.maxHurt) {
      this.finish('cancelled', 'hurt_abort', 'move_to_cancelled', player);
      return;
    }
    if (!this.client.isInGame()) { this.finish('cancelled', 'reconnecting', 'move_to_cancelled', player); return; }
    if (!player) { this.finish('cancelled', 'runner_stopped', 'move_to_cancelled'); return; }
    if (this.client.isDown(player)) { this.finish('cancelled', 'character_down', 'move_to_cancelled', player); return; }
    if (this.client.isAutoRequested() || this.client.getSupervisorPhase() !== 'idle') {
      this.finish('cancelled', 'auto_started', 'move_to_cancelled', player);
      return;
    }
    if (this.plannedLegs.length > 0 && operation.leg?.phase === 'waiting_map') {
      this.tickWaitingMap(now, player);
      return;
    }
    const leg = operation.leg;
    if (this.plannedLegs.length > 0 && leg) {
      const currentMap = this.client.getMapId();
      if (leg.phase === 'on_gate') {
        if (currentMap !== leg.fromMapId && !this.client.isTransitioning()) {
          this.finish('failed', 'unexpected_map', 'move_to_failed', player);
          return;
        }
        this.enterWaitingMap(now, player);
        this.tickWaitingMap(now, player);
        return;
      }
      if (this.client.isTransitioning()) {
        const goal = operation.resolvedTarget;
        if (leg.phase === 'walking_to_gate' && goal && (Array.isArray(player.path) && player.path.length === 0
          || distance({ x: player.x, y: player.y }, goal) <= this.cfg.tileSize)) {
          this.enterWaitingMap(now, player);
          this.transitionObserved = true;
          this.tickWaitingMap(now, player);
          return;
        }
        this.finish('failed', 'unexpected_map', 'move_to_failed', player);
        return;
      }
      if (!this.client.isMapReady() || currentMap !== leg.fromMapId) {
        this.finish('failed', 'unexpected_map', 'move_to_failed', player);
        return;
      }
      if (leg.phase === 'walking_to_gate') this.tickWalking(now, player, operation.resolvedTarget);
      return;
    }
    if (!this.client.isMapReady() || this.client.isTransitioning() || this.client.getMapId() !== this.mapId) {
      this.finish('cancelled', this.client.getMapId() === this.mapId ? 'map_not_ready' : 'map_changed', 'move_to_cancelled', player);
      return;
    }
    this.tickWalking(now, player, operation.resolvedTarget);
  }

  private tickWalking(now: number, player: WalkPlayer, goal: { x: number; y: number } | null): void {
    if (!this.operation || !goal || !finite(player.x) || !finite(player.y)) {
      this.finish('failed', 'position_unknown', 'move_to_failed', player);
      return;
    }
    this.operation.status = this.operation.status === 'accepted' ? 'running' : this.operation.status;
    this.operation.updatedAt = now;
    const currentPosition = { x: player.x, y: player.y };
    const remaining = distance(currentPosition, goal);
    const pathEmpty = Array.isArray(player.path) && player.path.length === 0;
    const walkingToGate = this.plannedLegs.length > 0 && this.operation.leg?.phase === 'walking_to_gate';
    // The official client can trigger a portal while entering the tile. Do not
    // stop at the ordinary arrival radius just before the gate, or the client
    // never gets the chance to send its enter request.
    const arrivalThreshold = walkingToGate ? Math.min(this.currentArrivalRadius, 2) : this.currentArrivalRadius;
    if (remaining <= arrivalThreshold || (!walkingToGate && pathEmpty && remaining <= this.cfg.tileSize)) {
      if (walkingToGate) {
        if (this.operation.leg) this.operation.leg.phase = 'on_gate';
        this.operation.updatedAt = now;
        player.stop();
        this.client.recordLog({ code: 'move_to_on_gate', at: now });
        return;
      }
      this.finish('arrived', undefined, 'move_to_arrived', player);
      return;
    }
    if (this.lastProgressPosition && distance(this.lastProgressPosition, currentPosition) >= this.cfg.stuckDistancePx) {
      this.lastProgressPosition = currentPosition;
      this.lastProgressAt = now;
    }
    if (now >= this.deadlineAt || now >= this.totalDeadlineAt) { this.finish('failed', 'timeout', 'move_to_failed', player); return; }
    if (now - this.lastProgressAt >= this.cfg.stuckTimeoutMs) this.finish('blocked', 'stuck', 'move_to_blocked', player);
  }

  private enterWaitingMap(now: number, player: WalkPlayer): void {
    if (!this.operation?.leg) return;
    this.operation.status = this.operation.status === 'accepted' ? 'running' : this.operation.status;
    this.operation.leg.phase = 'waiting_map';
    this.operation.updatedAt = now;
    this.waitStartedAt = now;
    this.transitionObserved = this.client.isTransitioning();
    player.stop();
    this.client.recordLog({ code: 'move_to_waiting_map', at: now });
  }

  private tickWaitingMap(now: number, player: WalkPlayer): void {
    const leg = this.operation?.leg;
    if (!leg || this.plannedLegs.length === 0) return;
    if (this.client.isTransitioning()) this.transitionObserved = true;
    const observedMap = this.client.getMapId();
    if (observedMap && observedMap !== leg.fromMapId && observedMap !== leg.toMapId) {
      this.finish('failed', 'unexpected_map', 'move_to_failed', player);
      return;
    }
    const arrivedAtExpectedMap = observedMap === leg.toMapId && !this.client.isTransitioning()
      && (this.transitionObserved || observedMap !== leg.fromMapId);
    if (arrivedAtExpectedMap) { this.advanceAfterMap(now, player); return; }
    if (now - this.waitStartedAt >= this.cfg.portalWaitTimeoutMs || now >= this.totalDeadlineAt) {
      this.finish('failed', 'portal_no_transition', 'move_to_failed', player);
    }
  }

  private advanceAfterMap(now: number, player: WalkPlayer): void {
    const nextIndex = (this.operation?.leg?.index ?? 0) + 1;
    if (nextIndex >= this.plannedLegs.length) {
      if (this.operation && finite(player.x) && finite(player.y)) {
        // Map-only requests finish at the observed spawn point of the target
        // map, not at the previous portal center.
        this.operation.resolvedTarget = { x: player.x, y: player.y };
      }
      if (this.operation?.leg) {
        this.operation.leg = {
          index: this.operation.route ? this.operation.route.length - 1 : nextIndex,
          fromMapId: this.operation.leg.toMapId ?? this.client.getMapId() ?? '',
          toMapId: null,
          phase: 'walking_to_target',
        };
      }
      this.finish('arrived', undefined, 'move_to_arrived', player);
      return;
    }
    const expected = this.plannedLegs[nextIndex].fromMapId;
    if (this.client.getMapId() !== expected || !this.client.isMapReady()) {
      this.finish('failed', 'unexpected_map', 'move_to_failed', player);
      return;
    }
    this.beginLeg(nextIndex, now, player);
  }

  private beginLeg(index: number, now: number, player: WalkPlayer): void {
    const nextLeg = this.plannedLegs[index];
    const map = this.client.getMap();
    const pathfinder = this.client.getPathfinder();
    if (!map || !pathfinder || !this.operation) { this.finish('failed', 'position_unknown', 'move_to_failed', player); return; }
    const goal = this.portalCenter(nextLeg.gate);
    const route = this.safeRoute(pathfinder, map, player, goal, this.client.getPortals(nextLeg.fromMapId), nextLeg.gate);
    try { player.setPath(route); } catch { this.finish('failed', 'target_unreachable', 'move_to_failed', player); return; }
    this.operation.resolvedTarget = goal;
    this.operation.leg = { index, fromMapId: nextLeg.fromMapId, toMapId: nextLeg.toMapId, phase: 'walking_to_gate' };
    this.operation.status = 'running';
    this.operation.updatedAt = now;
    this.lastProgressAt = now;
    this.lastProgressPosition = { x: player.x, y: player.y };
    this.deadlineAt = now + this.timeoutForRoute({ x: player.x, y: player.y }, route, goal);
    this.waitStartedAt = 0;
    this.transitionObserved = false;
  }

  private safeRoute(
    pathfinder: WalkPathfinder,
    map: WalkMap,
    player: WalkPlayer,
    goal: { x: number; y: number },
    portals: readonly WalkPortal[],
    allowedPortal?: { tx: number; ty: number },
  ): unknown[] {
    const hitbox = this.client.getHitbox();
    const direct = pathfinder.route(map, player.x, player.y, goal.x, goal.y, hitbox.width / 2, hitbox.height);
    if (!Array.isArray(direct) || direct.length === 0) throw new WalkError('TARGET_UNREACHABLE');
    if (!routeCrossesPortal({ x: player.x, y: player.y }, direct, portals, this.cfg.tileSize, allowedPortal)) return direct;
    const blocked = portals.filter((portal) => portal.byHand !== true
      && (!allowedPortal || portal.tx !== allowedPortal.tx || portal.ty !== allowedPortal.ty));
    const candidateOffsets = [[-2, -2], [0, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [0, 2], [2, 2], [-3, 0], [3, 0]] as const;
    for (const portal of blocked) {
      for (const [dx, dy] of candidateOffsets) {
        const tx = portal.tx + dx;
        const ty = portal.ty + dy;
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        const waypoint = this.portalCenter({ tx, ty });
        const first = pathfinder.route(map, player.x, player.y, waypoint.x, waypoint.y, hitbox.width / 2, hitbox.height);
        const second = pathfinder.route(map, waypoint.x, waypoint.y, goal.x, goal.y, hitbox.width / 2, hitbox.height);
        if (!Array.isArray(first) || first.length === 0 || !Array.isArray(second) || second.length === 0) continue;
        const combined = [...first, ...second];
        if (!routeCrossesPortal({ x: player.x, y: player.y }, combined, portals, this.cfg.tileSize, allowedPortal)) return combined;
      }
    }
    throw new WalkError('PATH_CROSSES_PORTAL');
  }

  private portalCenter(gate: { tx: number; ty: number }): { x: number; y: number } {
    return { x: gate.tx * this.cfg.tileSize + this.cfg.tileSize / 2, y: gate.ty * this.cfg.tileSize + this.cfg.tileSize / 2 };
  }

  private timeoutForRoute(start: { x: number; y: number }, route: unknown[], goal: { x: number; y: number }): number {
    const routeLength = routeDistance(start, route, this.cfg.tileSize, distance(start, goal));
    const calculated = Math.min(this.cfg.maxTimeoutMs, Math.max(this.cfg.minTimeoutMs, routeLength / this.cfg.speedPxPerSecond * 1_500 + 10_000));
    return Math.min(this.cfg.maxTimeoutMs, this.requestTimeoutMs ?? calculated);
  }

  private finish(
    status: Exclude<WalkStatus, 'accepted' | 'running'>,
    reason: string | undefined,
    logCode: string,
    player = this.client.getPlayer(),
  ): void {
    if (!this.operation || !active(this.operation.status)) return;
    const now = this.client.nowMs();
    this.operation.status = status;
    this.operation.updatedAt = now;
    if (reason) this.operation.reason = reason;
    else delete this.operation.reason;
    player?.stop();
    this.client.recordLog({ code: logCode, ...(reason ? { reasonCode: reason } : {}), at: now });
  }
}
