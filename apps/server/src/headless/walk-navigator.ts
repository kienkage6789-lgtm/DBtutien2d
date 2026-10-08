import { VENDOR_TILE_SIZE } from './auto-supervisor.js';

export interface WalkRequest {
  target: { x: number; y: number };
  arrivalRadius?: number;
  timeoutMs?: number;
  requester: 'user' | 'supervisor' | 'auto' | string;
}

export type WalkStatus = 'accepted' | 'running' | 'arrived' | 'blocked' | 'failed' | 'cancelled';

export interface WalkOperation {
  operationId: string;
  target: { x: number; y: number };
  resolvedTarget: { x: number; y: number } | null;
  status: WalkStatus;
  reason?: string;
  requester: string;
  startedAt: number;
  updatedAt: number;
}

export type WalkErrorCode =
  | 'NOT_IN_GAME'
  | 'VENDOR_MAP_NOT_READY'
  | 'CHARACTER_DOWN'
  | 'AUTO_ACTIVE'
  | 'OPERATION_IN_PROGRESS'
  | 'TARGET_INVALID'
  | 'TARGET_UNREACHABLE'
  | 'TARGET_ON_PORTAL';

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

export interface WalkPortal {
  tx: number;
  ty: number;
}

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
  getPortals(mapId: string): WalkPortal[];
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
  createOperationId?: (now: number) => string;
}

const DEFAULT_ARRIVAL_RADIUS = 20;
const DEFAULT_SPEED_PX_PER_SECOND = 101;
const DEFAULT_STUCK_DISTANCE_PX = 5;
const DEFAULT_STUCK_TIMEOUT_MS = 5_000;
const DEFAULT_MIN_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TIMEOUT_MS = 120_000;

let operationSequence = 0;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const active = (status: WalkStatus): boolean => status === 'accepted' || status === 'running';

function copyPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x, y: point.y };
}

function copyOperation(operation: WalkOperation | null): WalkOperation | null {
  return operation ? {
    ...operation,
    target: copyPoint(operation.target),
    resolvedTarget: operation.resolvedTarget ? copyPoint(operation.resolvedTarget) : null,
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

function distance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.hypot(from.x - to.x, from.y - to.y);
}

function routeDistance(start: { x: number; y: number }, route: unknown[], fallback: number): number {
  let total = 0;
  let previous = start;
  let usable = false;
  for (const item of route) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const point = item as Record<string, unknown>;
    if (!finite(point.x) || !finite(point.y)) continue;
    const next = { x: point.x, y: point.y };
    total += distance(previous, next);
    previous = next;
    usable = true;
  }
  return usable && total > 0 ? total : fallback;
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
  private currentArrivalRadius = DEFAULT_ARRIVAL_RADIUS;

  public constructor(
    private readonly client: WalkNavigatorClient,
    options: WalkNavigatorOptions = {},
  ) {
    this.cfg = {
      arrivalRadius: options.arrivalRadius ?? DEFAULT_ARRIVAL_RADIUS,
      speedPxPerSecond: options.speedPxPerSecond ?? DEFAULT_SPEED_PX_PER_SECOND,
      tileSize: options.tileSize ?? VENDOR_TILE_SIZE,
      stuckDistancePx: options.stuckDistancePx ?? DEFAULT_STUCK_DISTANCE_PX,
      stuckTimeoutMs: options.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS,
      maxTimeoutMs: options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
      minTimeoutMs: options.minTimeoutMs ?? DEFAULT_MIN_TIMEOUT_MS,
      createOperationId: options.createOperationId ?? ((now) => `move-${now}-${++operationSequence}`),
    };
  }

  public getOperation(): WalkOperation | null {
    return copyOperation(this.operation);
  }

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

    const target = request.target;
    const arrivalRadius = request.arrivalRadius ?? this.cfg.arrivalRadius;
    if (!finite(target?.x) || !finite(target?.y) || !finite(arrivalRadius) || arrivalRadius <= 0
      || (request.timeoutMs !== undefined && (!finite(request.timeoutMs) || request.timeoutMs <= 0))) {
      throw new WalkError('TARGET_INVALID');
    }

    const maxX = finite(map.pxWidth) ? map.pxWidth : map.width * this.cfg.tileSize;
    const maxY = finite(map.pxHeight) ? map.pxHeight : map.height * this.cfg.tileSize;
    if (!finite(maxX) || !finite(maxY) || !finite(map.width) || !finite(map.height)
      || target.x < 0 || target.y < 0 || target.x >= maxX || target.y >= maxY) {
      throw new WalkError('TARGET_INVALID');
    }

    const pathfinder = this.client.getPathfinder();
    if (!pathfinder) throw new WalkError('VENDOR_MAP_NOT_READY');
    const hitbox = this.client.getHitbox();
    const route = pathfinder.route(map, player.x, player.y, target.x, target.y, hitbox.width / 2, hitbox.height);
    if (!Array.isArray(route) || route.length === 0) throw new WalkError('TARGET_UNREACHABLE');

    const resolvedTarget = routePoint(route, this.cfg.tileSize);
    if (!resolvedTarget || !finite(resolvedTarget.x) || !finite(resolvedTarget.y)) {
      throw new WalkError('TARGET_UNREACHABLE');
    }
    const targetTileX = Math.floor(resolvedTarget.x / this.cfg.tileSize);
    const targetTileY = Math.floor(resolvedTarget.y / this.cfg.tileSize);
    if (this.client.getPortals(mapId).some((portal) => portal.tx === targetTileX && portal.ty === targetTileY)) {
      throw new WalkError('TARGET_ON_PORTAL');
    }

    try {
      player.setPath(route);
    } catch {
      throw new WalkError('TARGET_UNREACHABLE');
    }

    const routeLength = routeDistance({ x: player.x, y: player.y }, route, distance({ x: player.x, y: player.y }, resolvedTarget));
    const calculatedTimeout = Math.min(
      this.cfg.maxTimeoutMs,
      Math.max(this.cfg.minTimeoutMs, routeLength / this.cfg.speedPxPerSecond * 1_500 + 10_000),
    );
    const timeoutMs = Math.min(this.cfg.maxTimeoutMs, request.timeoutMs ?? calculatedTimeout);
    this.operation = {
      operationId: this.cfg.createOperationId(now),
      target: copyPoint(target),
      resolvedTarget: copyPoint(resolvedTarget),
      status: 'accepted',
      requester: request.requester,
      startedAt: now,
      updatedAt: now,
    };
    this.mapId = mapId;
    this.currentArrivalRadius = arrivalRadius;
    this.lastProgressAt = now;
    this.lastProgressPosition = { x: player.x, y: player.y };
    this.deadlineAt = now + timeoutMs;
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

    if (!this.client.isInGame()) {
      this.finish('cancelled', 'reconnecting', 'move_to_cancelled', player);
      return;
    }
    if (this.client.isTransitioning()) {
      this.finish('cancelled', 'transitioning', 'move_to_cancelled', player);
      return;
    }
    if (!this.client.isMapReady() || this.client.getMapId() !== this.mapId) {
      this.finish('cancelled', this.client.getMapId() === this.mapId ? 'map_not_ready' : 'map_changed', 'move_to_cancelled', player);
      return;
    }
    if (!player) {
      this.finish('cancelled', 'runner_stopped', 'move_to_cancelled');
      return;
    }
    if (this.client.isDown(player)) {
      this.finish('cancelled', 'character_down', 'move_to_cancelled', player);
      return;
    }
    if (this.client.isAutoRequested() || this.client.getSupervisorPhase() !== 'idle') {
      this.finish('cancelled', 'auto_started', 'move_to_cancelled', player);
      return;
    }

    operation.status = operation.status === 'accepted' ? 'running' : operation.status;
    operation.updatedAt = now;
    const resolvedTarget = operation.resolvedTarget;
    if (!resolvedTarget || !finite(player.x) || !finite(player.y)) {
      this.finish('failed', 'position_unknown', 'move_to_failed', player);
      return;
    }
    const currentPosition = { x: player.x, y: player.y };
    const remaining = distance(currentPosition, resolvedTarget);
    const pathEmpty = Array.isArray(player.path) && player.path.length === 0;
    if (remaining <= this.currentArrivalRadius || (pathEmpty && remaining <= this.cfg.tileSize)) {
      this.finish('arrived', undefined, 'move_to_arrived', player);
      return;
    }
    if (this.lastProgressPosition && distance(this.lastProgressPosition, currentPosition) >= this.cfg.stuckDistancePx) {
      this.lastProgressPosition = currentPosition;
      this.lastProgressAt = now;
    }
    if (now >= this.deadlineAt) {
      this.finish('failed', 'timeout', 'move_to_failed', player);
      return;
    }
    if (now - this.lastProgressAt >= this.cfg.stuckTimeoutMs) {
      this.finish('blocked', 'stuck', 'move_to_blocked', player);
    }
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
