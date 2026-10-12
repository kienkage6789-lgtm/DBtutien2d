export const VENDOR_TILE_SIZE = 32;

export type AutoSupervisorPhase =
  | 'idle'
  | 'farming'
  | 'down_wait'
  | 'reviving'
  | 'recovering'
  | 'traveling'
  | 'resuming'
  | 'halted';

export type AutoReviveMode = 'home' | 'spot';
export type AutoHaltMode = 'disconnect' | 'stay';

export interface AutoAnchor {
  mapId: string;
  khu?: number | null;
  x: number;
  y: number;
}

export interface AutoSupervisorConfig {
  reviveMode: AutoReviveMode;
  recoverRatio: number;
  arrivalRadius: number;
  maxDeaths: number;
  deathWindowSec: number;
  reviveDelaySec: number;
  reviveTimeoutSec: number;
  recoverTimeoutSec: number;
  travelTimeoutSec: number;
  portalWaitSec: number;
  hurtAbortRatio: number;
  haltMode: AutoHaltMode;
}

/** Đọc chế độ dừng an toàn từ cấu hình: chỉ đúng 'stay' mới giữ kết nối; mọi giá trị khác dùng 'disconnect' (mặc định an toàn). */
export function parseHaltMode(value: unknown): AutoHaltMode {
  return typeof value === 'string' && value.trim().toLowerCase() === 'stay' ? 'stay' : 'disconnect';
}

export const DEFAULT_AUTO_SUPERVISOR_CONFIG: AutoSupervisorConfig = {
  reviveMode: 'home',
  recoverRatio: 0.9,
  arrivalRadius: 16,
  maxDeaths: 3,
  deathWindowSec: 600,
  reviveDelaySec: 1.5,
  reviveTimeoutSec: 20,
  recoverTimeoutSec: 180,
  travelTimeoutSec: 240,
  portalWaitSec: 8,
  hurtAbortRatio: 0.35,
  haltMode: 'disconnect',
};

export interface AutoPlayerPort {
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  downed?: boolean;
  state?: string;
  path?: unknown[];
  stop(): void;
  setPath(path: unknown[]): void;
}

export interface AutoPortal {
  tx: number;
  ty: number;
  toMapId: string;
}

export interface AutoClientPort {
  nowSec(): number;
  getPlayer(): AutoPlayerPort | null;
  getMapId(): string | null;
  getKhu(): number | null;
  isTransitioning(): boolean;
  getAutoOn(): boolean;
  isAutoToggleQueued(): boolean;
  pressAutoToggle(): void;
  reviveAtHome(): boolean;
  reviveOnSpot(): boolean;
  pressMeditate(): void;
  stand(): void;
  cancelApproach(): void;
  portalsOf(mapId: string): AutoPortal[];
  walkTo(x: number, y: number): boolean;
}

export type AutoSupervisorEvent =
  | { type: 'phase_changed'; from: AutoSupervisorPhase; to: AutoSupervisorPhase; reasonCode: string | null }
  | { type: 'death'; deathsInWindow: number; totalDeaths: number }
  | { type: 'revive_requested'; mode: AutoReviveMode }
  | { type: 'anchor_reached'; distance: number; mapId: string }
  | { type: 'auto_command'; desired: boolean }
  | { type: 'halted'; reasonCode: string; haltMode: AutoHaltMode };

export interface AutoSupervisorStats {
  deaths: number;
  revives: number;
  trips: number;
  resumed: number;
}

export interface AutoSupervisorSnapshot {
  phase: AutoSupervisorPhase;
  anchor: AutoAnchor | null;
  reasonCode: string | null;
  phaseSince: number;
  deathTimes: number[];
  stats: AutoSupervisorStats;
  noPath: number;
  autoRequested: boolean;
}

export type AutoSupervisorListener = (event: AutoSupervisorEvent) => void;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function cloneAnchor(anchor: AutoAnchor | null): AutoAnchor | null {
  return anchor ? { ...anchor } : null;
}

export class AutoSupervisor {
  private readonly cfg: AutoSupervisorConfig;
  private readonly listeners = new Set<AutoSupervisorListener>();
  private phase: AutoSupervisorPhase = 'idle';
  private anchor: AutoAnchor | null = null;
  private deathTimes: number[] = [];
  private phaseSince = 0;
  private reasonCode: string | null = null;
  private stats: AutoSupervisorStats = { deaths: 0, revives: 0, trips: 0, resumed: 0 };
  private lastAutoCommandAt = -Infinity;
  private portalStandSince: number | null = null;
  private travelStartHp: number | null = null;
  private noPath = 0;
  private autoRequested = false;

  public constructor(
    private readonly client: AutoClientPort,
    config: Partial<AutoSupervisorConfig> = {},
    private readonly onHalt?: (event: Extract<AutoSupervisorEvent, { type: 'halted' }>) => void,
  ) {
    this.cfg = { ...DEFAULT_AUTO_SUPERVISOR_CONFIG, ...config };
    if (!(this.cfg.recoverRatio > 0 && this.cfg.recoverRatio <= 1)) throw new Error('AUTO_CONFIG_INVALID: recoverRatio');
    if (!(this.cfg.arrivalRadius > 0) || !finite(this.cfg.arrivalRadius)) throw new Error('AUTO_CONFIG_INVALID: arrivalRadius');
    if (!(this.cfg.maxDeaths >= 0) || !Number.isInteger(this.cfg.maxDeaths)) throw new Error('AUTO_CONFIG_INVALID: maxDeaths');
    if (!(this.cfg.deathWindowSec > 0) || !finite(this.cfg.deathWindowSec)) throw new Error('AUTO_CONFIG_INVALID: deathWindowSec');
  }

  public on(listener: AutoSupervisorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): AutoSupervisorSnapshot {
    return {
      phase: this.phase,
      anchor: cloneAnchor(this.anchor),
      reasonCode: this.reasonCode,
      phaseSince: this.phaseSince,
      deathTimes: [...this.deathTimes],
      stats: { ...this.stats },
      noPath: this.noPath,
      autoRequested: this.autoRequested,
    };
  }

  public getPhase(): AutoSupervisorPhase { return this.phase; }

  public start(anchor?: AutoAnchor, resume = false): void {
    const player = this.client.getPlayer();
    if (!player) throw new Error('AUTO_NOT_IN_GAME: player is unavailable');
    const currentMap = this.client.getMapId();
    if (!currentMap) throw new Error('AUTO_MAP_UNKNOWN: current map is unavailable');
    const nextAnchor = anchor ? { ...anchor } : { mapId: currentMap, khu: this.client.getKhu(), x: player.x, y: player.y };
    if (!nextAnchor.mapId || !finite(nextAnchor.x) || !finite(nextAnchor.y)) throw new Error('AUTO_ANCHOR_INVALID');
    this.anchor = nextAnchor;
    this.reasonCode = null;
    this.autoRequested = true;
    // An explicit anchor may be on another map or away from the current
    // position. Auto must remain off until the runner reaches that anchor;
    // reconnect and first-start therefore share the same safety gate.
    const needsTravel = currentMap !== nextAnchor.mapId || this.distanceToAnchor(player) > this.cfg.arrivalRadius;
    if (needsTravel) {
      this.setPhase('traveling', resume ? 'reconnect_rehome' : 'anchor_rehome');
      this.forceAutoOff();
    } else {
      this.setAuto(true);
      this.setPhase('farming', 'auto_started');
    }
  }

  public stop(reasonCode = 'manual_stop'): void {
    this.autoRequested = false;
    this.forceAutoOff();
    const player = this.client.getPlayer();
    player?.stop();
    this.client.cancelApproach();
    this.setPhase('idle', reasonCode);
    this.anchor = null;
  }

  public halt(reasonCode: string): void {
    this.autoRequested = false;
    this.forceAutoOff();
    const player = this.client.getPlayer();
    player?.stop();
    this.client.cancelApproach();
    this.setPhase('halted', reasonCode);
    const event: Extract<AutoSupervisorEvent, { type: 'halted' }> = {
      type: 'halted',
      reasonCode,
      haltMode: this.cfg.haltMode,
    };
    this.emit(event);
    this.onHalt?.(event);
  }

  public tick(): void {
    if (!this.anchor || this.phase === 'idle' || this.phase === 'halted') return;
    const player = this.client.getPlayer();
    if (!player) {
      this.halt('player_missing');
      return;
    }
    const now = this.client.nowSec();
    const elapsed = Math.max(0, now - this.phaseSince);

    if (this.isDown(player) && !['down_wait', 'reviving'].includes(this.phase)) {
      this.forceAutoOff();
      const deathsInWindow = this.recordDeath(now);
      this.emit({ type: 'death', deathsInWindow, totalDeaths: this.stats.deaths });
      if (deathsInWindow > this.cfg.maxDeaths) {
        this.halt('death_limit');
        return;
      }
      this.setPhase('down_wait', 'player_downed');
    }

    if (['down_wait', 'reviving', 'recovering', 'traveling'].includes(this.phase)) this.forceAutoOff();

    switch (this.phase) {
      case 'farming':
        return;
      case 'down_wait': {
        if (elapsed < this.cfg.reviveDelaySec) return;
        let requested = false;
        if (this.cfg.reviveMode === 'spot') requested = this.client.reviveOnSpot();
        if (!requested) requested = this.client.reviveAtHome();
        this.stats.revives += 1;
        this.emit({ type: 'revive_requested', mode: this.cfg.reviveMode });
        this.setPhase('reviving', requested ? 'revive_requested' : 'revive_rejected');
        return;
      }
      case 'reviving':
        if (!this.isDown(player) && !this.client.isTransitioning()) {
          this.setPhase('recovering', 'revive_confirmed');
          return;
        }
        if (elapsed > this.cfg.reviveTimeoutSec) this.halt('revive_timeout');
        return;
      case 'recovering': {
        const ratio = this.hpRatio(player);
        if (ratio === null) {
          if (elapsed > this.cfg.recoverTimeoutSec) this.halt('recover_vitals_unknown');
          return;
        }
        if (ratio >= this.cfg.recoverRatio) {
          this.client.stand();
          this.setPhase('traveling', 'recovered');
          return;
        }
        if (elapsed > this.cfg.recoverTimeoutSec) {
          this.halt('recover_timeout');
          return;
        }
        if (player.state !== 'sit' && player.state !== 'pose' && now - this.lastAutoCommandAt > 2) {
          this.lastAutoCommandAt = now;
          this.client.pressMeditate();
        }
        return;
      }
      case 'traveling': {
        if (this.client.isTransitioning()) {
          this.portalStandSince = null;
          return;
        }
        if (elapsed > this.cfg.travelTimeoutSec) {
          this.halt('travel_timeout');
          return;
        }
        const ratio = this.hpRatio(player);
        if (ratio !== null && ratio < this.cfg.hurtAbortRatio) {
          this.halt('travel_hp_low');
          return;
        }
        const currentMap = this.client.getMapId();
        if (!currentMap) {
          this.halt('travel_map_unknown');
          return;
        }
        if (currentMap === this.anchor.mapId) {
          const distance = this.distanceToAnchor(player);
          if (distance <= this.cfg.arrivalRadius) {
            this.emit({ type: 'anchor_reached', distance, mapId: currentMap });
            this.setPhase('resuming', 'anchor_reached');
            return;
          }
          if (!player.path || player.path.length === 0) {
            if (!this.client.walkTo(this.anchor.x, this.anchor.y)) {
              // Pathfinder.route intentionally has no route for sub-tile gaps.
              if (distance <= VENDOR_TILE_SIZE) {
                this.emit({ type: 'anchor_reached', distance, mapId: currentMap });
                this.setPhase('resuming', 'anchor_within_tile');
                return;
              }
              this.noPath += 1;
              if (this.noPath >= 8) this.halt('anchor_unreachable');
            }
          }
          return;
        }
        const route = this.mapRoute(currentMap, this.anchor.mapId);
        if (!route) {
          this.halt('map_route_unavailable');
          return;
        }
        const nextMap = route[1];
        const portals = this.client.portalsOf(currentMap).filter((portal) => portal.toMapId === nextMap);
        if (portals.length === 0) {
          this.halt('portal_unavailable');
          return;
        }
        portals.sort((a, b) => this.distance(player, a.tx * VENDOR_TILE_SIZE + VENDOR_TILE_SIZE / 2, a.ty * VENDOR_TILE_SIZE + VENDOR_TILE_SIZE / 2)
          - this.distance(player, b.tx * VENDOR_TILE_SIZE + VENDOR_TILE_SIZE / 2, b.ty * VENDOR_TILE_SIZE + VENDOR_TILE_SIZE / 2));
        const gate = portals[0];
        const gateX = gate.tx * VENDOR_TILE_SIZE + VENDOR_TILE_SIZE / 2;
        const gateY = gate.ty * VENDOR_TILE_SIZE + VENDOR_TILE_SIZE / 2;
        if (!player.path || player.path.length === 0) {
          if (this.distance(player, gateX, gateY) <= VENDOR_TILE_SIZE) {
            this.portalStandSince ??= now;
            if (now - this.portalStandSince > this.cfg.portalWaitSec) this.halt('portal_timeout');
          } else if (!this.client.walkTo(gateX, gateY)) {
            this.noPath += 1;
            if (this.noPath >= 8) this.halt('portal_unreachable');
          }
        }
        return;
      }
      case 'resuming':
        if (this.client.isTransitioning()) return;
        this.setAuto(true);
        this.stats.resumed += 1;
        this.noPath = 0;
        this.portalStandSince = null;
        this.travelStartHp = null;
        this.setPhase('farming', 'auto_resumed');
        return;
      default:
        return;
    }
  }

  private emit(event: AutoSupervisorEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setPhase(next: AutoSupervisorPhase, reasonCode: string | null): void {
    if (next === 'traveling' && this.phase !== 'traveling') {
      this.noPath = 0;
      this.travelStartHp = null;
      this.portalStandSince = null;
      this.stats.trips += 1;
    }
    const previous = this.phase;
    this.phase = next;
    this.phaseSince = this.client.nowSec();
    this.reasonCode = reasonCode;
    if (previous !== next) this.emit({ type: 'phase_changed', from: previous, to: next, reasonCode });
  }

  private setAuto(desired: boolean): void {
    if (this.client.isAutoToggleQueued()) return;
    if (this.client.getAutoOn() !== desired) {
      this.lastAutoCommandAt = this.client.nowSec();
      this.client.pressAutoToggle();
      this.emit({ type: 'auto_command', desired });
    }
  }

  private forceAutoOff(): void { this.setAuto(false); }

  private recordDeath(now: number): number {
    this.deathTimes = this.deathTimes.filter((time) => now - time <= this.cfg.deathWindowSec);
    this.deathTimes.push(now);
    this.stats.deaths += 1;
    return this.deathTimes.length;
  }

  private isDown(player: AutoPlayerPort): boolean {
    return player.downed === true || player.state === 'down';
  }

  private hpRatio(player: AutoPlayerPort): number | null {
    if (!finite(player.hp) || !finite(player.hpMax) || player.hpMax <= 0) return null;
    return Math.max(0, Math.min(1, player.hp / player.hpMax));
  }

  private distance(player: AutoPlayerPort, x: number, y: number): number {
    return Math.hypot(player.x - x, player.y - y);
  }

  private distanceToAnchor(player: AutoPlayerPort): number {
    return this.anchor ? this.distance(player, this.anchor.x, this.anchor.y) : Number.POSITIVE_INFINITY;
  }

  private mapRoute(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const previous = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const portal of this.client.portalsOf(current)) {
        if (previous.has(portal.toMapId)) continue;
        previous.set(portal.toMapId, current);
        if (portal.toMapId === to) {
          const route = [to];
          for (let at: string | null = current; at !== null; at = previous.get(at) ?? null) route.unshift(at);
          return route;
        }
        queue.push(portal.toMapId);
      }
    }
    return null;
  }
}
