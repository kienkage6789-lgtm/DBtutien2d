import { EventEmitter } from 'events';
import {
  CharacterOverview,
  ConnectionStatus,
  MapEnemy,
  MapPlayer,
  QuestSave,
  StatePacket,
  StatusPacket,
  FormationPacket,
  StonesSnapshot,
  VitalSnapshot,
  VitalsSource,
  YouPacket,
  WelcomePacket,
  MapPacket,
  DerivedMaxSnapshot,
} from '../types.js';
import { deriveMaxima } from './derived-vitals.js';

export interface SelfPresence {
  hpPercent: number | null;
  observedAt: number;
}

function readFiniteNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

type VitalField = 'hp' | 'maxHp' | 'mp' | 'maxMp';
const VITAL_ALIASES: Record<VitalField, string> = {
  hp: 'ht', maxHp: 'hm', mp: 'sh', maxMp: 'slm',
};

/** Normalize documented root fields from state/status packets into one snapshot. */
export function normalizeVitals(
  packet: Partial<StatePacket | StatusPacket>,
  source: Exclude<VitalsSource, null>,
  observedAt: number = Date.now(),
  previous?: VitalSnapshot,
  allowLegacyStateAliases: boolean = true
): VitalSnapshot {
  const values: Record<VitalField, number | null> = {
    hp: null, maxHp: null, mp: null, maxMp: null,
  };
  let present = false;
  let invalid = false;
  let conflict = false;

  for (const field of Object.keys(VITAL_ALIASES) as VitalField[]) {
    const standard = (packet as Record<string, unknown>)[field];
    // Official `status` packets use ht/hm/sh/slm for combat effects, not
    // character vitals. Legacy aliases are accepted only on state packets.
    const alias = source === 'state' && allowLegacyStateAliases
      ? (packet as Record<string, unknown>)[VITAL_ALIASES[field]]
      : undefined;
    const hasStandard = standard !== undefined;
    const hasAlias = alias !== undefined;
    if (!hasStandard && !hasAlias) {
      values[field] = previous?.status === 'fresh' ? previous[field] : null;
      continue;
    }
    present = true;
    const standardValid = !hasStandard || (typeof standard === 'number' && Number.isFinite(standard));
    const aliasValid = !hasAlias || (typeof alias === 'number' && Number.isFinite(alias));
    if (!standardValid || !aliasValid) invalid = true;
    if (hasStandard && hasAlias && standardValid && aliasValid && standard !== alias) conflict = true;
    const preferred = hasStandard ? standard : alias;
    if (typeof preferred === 'number' && Number.isFinite(preferred)) values[field] = preferred;
  }

  if ((values.hp !== null && values.hp < 0)
    || (values.maxHp !== null && values.maxHp <= 0)
    || (values.hp !== null && values.maxHp !== null && values.hp > values.maxHp)
    || (values.mp !== null && values.mp < 0)
    || (values.maxMp !== null && values.maxMp <= 0)
    || (values.mp !== null && values.maxMp !== null && values.mp > values.maxMp)) invalid = true;

  const status = conflict ? 'conflict' : invalid ? 'invalid' : present ? 'fresh' : 'unknown';
  return {
    ...values,
    status,
    ...(conflict ? { reason: 'ALIAS_CONFLICT' } : invalid ? { reason: 'INVALID_VITALS' } : {}),
    source: present ? source : (previous?.source ?? null),
    observedAt: present ? observedAt : (previous?.observedAt ?? null),
  };
}

export function normalizeStones(
  packet: Partial<StatePacket | FormationPacket>,
  observedAt: number = Date.now(),
  previous?: StonesSnapshot,
  source: Exclude<StonesSnapshot['source'], null> = 'state'
): StonesSnapshot {
  if (source === 'formation' && (packet as Partial<FormationPacket>).act !== 'balance') {
    return previous ?? { value: null, status: 'unknown', source: null, observedAt: null };
  }
  if (packet.stones === undefined) {
    return previous ?? { value: null, status: 'unknown', source: null, observedAt: null };
  }
  if (typeof packet.stones !== 'number' || !Number.isFinite(packet.stones) || packet.stones < 0) {
    return { value: null, status: 'invalid', source, observedAt };
  }
  return { value: packet.stones, status: 'fresh', source, observedAt };
}

function readPositiveFiniteNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  );
}

export class GameStateStore extends EventEmitter {
  /** Authoritative knockdown signal; null means the server has not told us. */
  public downed: boolean | null = null;
  public selfPresence: SelfPresence | null = null;
  public selfId: string = '';
  public name: string = '';
  public realm: string = 'Phàm Nhân';
  public exp: number = 0;
  public duocCong: number = 0;
  /** Legacy numeric field retained for existing modules; authority is stonesSnapshot. */
  public stones: number = 0;
  public stonesSnapshot: StonesSnapshot = {
    value: null, status: 'unknown', source: null, observedAt: null,
  };
  public hp: number = 100;
  public maxHp: number = 100;
  public mp: number = 0;
  public maxMp: number = 100;
  public vitals: VitalSnapshot = {
    hp: null, maxHp: null, mp: null, maxMp: null,
    status: 'unknown', source: null, observedAt: null,
  };
  public derivedMax: DerivedMaxSnapshot = {
    maxHp: null, maxMp: null, complete: false, source: 'derived', observedAt: null,
  };
  private derivedMaxConflictLogged = false;
  public mapId: string = 'tan_vien';
  public mapKnown: boolean = false;
  public khu: number = 1;
  public khuKnown: boolean = false;
  public soKhu: number = 0;
  public x: number = 0;
  public y: number = 0;
  public positionKnown: boolean = false;
  public contextEpoch: number = 0;
  public dir: number = 2;
  public bag: Record<string, number> = {};
  public equipment: Record<string, string | null> = {};
  public boundItems: Record<string, number> = {};
  public questSave: QuestSave = { stage: 0, flags: {} };
  public players: MapPlayer[] = [];
  public enemies: MapEnemy[] = [];
  public herbs: Array<{ id: string; con: number; tx: number; ty: number; off?: number }> = [];
  public latencyMs: number = 0;
  public status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  public lastUpdated: number = Date.now();
  /** Timestamp of the latest packet carrying authoritative map/world data. */
  public worldUpdatedAt: number = 0;
  private xKnown: boolean = false;
  private yKnown: boolean = false;

  constructor(name: string) {
    super();
    this.name = name;
  }

  public updateWelcome(welcome: WelcomePacket): void {
    this.selfPresence = null;
    this.downed = null;
    this.derivedMax = { maxHp: null, maxMp: null, complete: false, source: 'derived', observedAt: null };
    this.derivedMaxConflictLogged = false;
    this.selfId = welcome.selfId;
    this.name = welcome.name || this.name;
    this.lastUpdated = Date.now();
    this.emit('welcome', welcome);
    this.emit('change');
  }

  public updateState(state: StatePacket): void {
    const previousRealm = this.realm;
    const previousEquipmentKey = JSON.stringify(Object.entries(this.equipment).sort(([a], [b]) => a.localeCompare(b)));
    const save = state.save;
    const saveRealm = typeof save?.realm === 'string' && save.realm.length > 0 ? save.realm : undefined;
    if (typeof state.realm === 'string' && state.realm.length > 0) this.realm = state.realm;
    else if (saveRealm) this.realm = saveRealm;
    const exp = readFiniteNumber(state.exp, save?.exp);
    const duocCong = readFiniteNumber(state.duocCong);
    // The official client receives the character save as state.save. Older
    // server revisions put resource fields at the root, while newer ones can
    // keep them nested under save. Normalize both shapes without treating the
    // quest-only save as a vitals packet.
    const saveVitals = save ? {
      hp: save.hp,
      maxHp: save.maxHp,
      mp: save.mp,
      maxMp: save.maxMp,
    } : {};
    this.updateVitals({ ...saveVitals, ...state }, 'state');
    const stonesPacket = state.stones !== undefined
      ? state
      : save?.stones !== undefined
        ? { stones: save.stones }
        : undefined;
    if (stonesPacket !== undefined) {
      this.stonesSnapshot = normalizeStones(stonesPacket, Date.now(), this.stonesSnapshot, 'state');
      if (this.stonesSnapshot.status === 'fresh' && this.stonesSnapshot.value !== null) {
        this.stones = this.stonesSnapshot.value;
      }
      this.emit('stones', { ...this.stonesSnapshot });
    }
    const x = readFiniteNumber(state.x);
    const y = readFiniteNumber(state.y);
    if (exp !== undefined) this.exp = exp;
    if (duocCong !== undefined) this.duocCong = duocCong;
    const contextChanged = this.updateMapContext(state.mapId, state.khu);
    this.updatePosition(x, y);
    if (!contextChanged && Array.isArray(state.p)) this.players = state.p;
    if (!contextChanged && Array.isArray(state.e)) this.enemies = state.e;
    const worldUpdatedAt = Date.now();
    if (this.hasWorldData(state.mapId, state.khu, x, y, state.p, state.e)) this.worldUpdatedAt = worldUpdatedAt;
    if (state.bag) this.bag = { ...state.bag };
    const equipment = state.equipment ?? save?.equipment;
    if (equipment && typeof equipment === 'object' && !Array.isArray(equipment)) {
      const equipmentEntries = Object.entries(equipment);
      if (equipmentEntries.every(([, item]) => item === null || typeof item === 'string')) {
        this.equipment = Object.fromEntries(equipmentEntries);
      }
    }
    if (state.bound) this.boundItems = { ...state.bound };
    if (state.save) this.questSave = { ...state.save };
    const nextEquipmentKey = JSON.stringify(Object.entries(this.equipment).sort(([a], [b]) => a.localeCompare(b)));
    if (this.derivedMax.observedAt === null || previousRealm !== this.realm || previousEquipmentKey !== nextEquipmentKey) {
      this.recomputeDerivedMax();
    }
    this.lastUpdated = Date.now();
    this.emit('state', state);
    this.emit('change');
  }

  public updateFormation(formation: FormationPacket): void {
    if (formation.act === 'balance' && formation.stones !== undefined) {
      this.stonesSnapshot = normalizeStones(formation, Date.now(), this.stonesSnapshot, 'formation');
      if (this.stonesSnapshot.status === 'fresh' && this.stonesSnapshot.value !== null) {
        this.stones = this.stonesSnapshot.value;
      }
      this.emit('stones', { ...this.stonesSnapshot });
    }
    this.lastUpdated = Date.now();
    this.emit('formation', formation);
    this.emit('change');
  }

  public updateMap(map: MapPacket): void {
    const contextChanged = this.updateMapContext(map.mapId, map.khu);
    const soKhu = readPositiveFiniteNumber(map.soKhu);
    const x = readFiniteNumber(map.x);
    const y = readFiniteNumber(map.y);
    const dir = readFiniteNumber(map.dir);
    if (soKhu !== undefined) this.soKhu = soKhu;
    this.updatePosition(x, y);
    if (dir !== undefined) this.dir = dir;
    if (!contextChanged && Array.isArray(map.p)) this.players = map.p;
    if (!contextChanged && Array.isArray(map.e)) this.enemies = map.e;
    const worldUpdatedAt = Date.now();
    if (this.hasWorldData(map.mapId, map.khu, x, y, map.p, map.e)) this.worldUpdatedAt = worldUpdatedAt;
    this.lastUpdated = Date.now();
    this.emit('map', map);
    this.emit('change');
  }

  public updateStatus(status: StatusPacket): void {
    this.updateVitals(status, 'status');
    this.lastUpdated = Date.now();
    this.emit('status', status);
    this.emit('change');
  }

  public updateSelfVitals(
    packet: Partial<StatePacket>,
    source: Exclude<VitalsSource, null>
  ): void {
    if (source === 'revived') this.downed = false;
    this.updateVitals(packet, source);
    this.checkDerivedMaxAgainstVitals(packet);
    const x = readFiniteNumber(packet.x);
    const y = readFiniteNumber(packet.y);
    this.updatePosition(x, y);
    if (x !== undefined || y !== undefined) this.worldUpdatedAt = Date.now();
    this.lastUpdated = Date.now();
    this.emit('selfVitals', packet);
    this.emit('change');
  }

  public updateYou(packet: Omit<Partial<YouPacket>, 'op'>): void {
    if (typeof packet.dn === 'boolean') this.downed = packet.dn;
    this.updateSelfVitals(packet, 'you');
  }

  public updateDown(): void {
    this.downed = true;
    this.lastUpdated = Date.now();
    this.emit('change');
  }

  /**
   * Apply only canonical HP/MP fields from a state/you packet. This deliberately
   * ignores all world fields and legacy aliases so callers can safely retain
   * vitals when a world-packet guard rejects map/position data.
   * Returns true only when a valid canonical vitals snapshot was applied.
   */
  public updateVitalsOnly(
    packet: Partial<StatePacket> | Omit<Partial<YouPacket>, 'op'>,
    source: 'state' | 'you'
  ): boolean {
    const sourcePacket = source === 'state'
      ? { ...(packet as Partial<StatePacket>).save, ...packet }
      : packet;
    this.checkDerivedMaxAgainstVitals(sourcePacket);
    const snapshot = normalizeVitals(
      sourcePacket as Partial<StatePacket>,
      source,
      Date.now(),
      this.vitals,
      false
    );
    if (snapshot.status !== 'fresh') return false;

    this.vitals = snapshot;
    if (snapshot.hp !== null) this.hp = snapshot.hp;
    if (snapshot.maxHp !== null) this.maxHp = snapshot.maxHp;
    if (snapshot.mp !== null) this.mp = snapshot.mp;
    if (snapshot.maxMp !== null) this.maxMp = snapshot.maxMp;
    this.lastUpdated = Date.now();
    this.emit('vitals', { ...snapshot });
    this.emit('change');
    return true;
  }

  private updateVitals(packet: Partial<StatePacket | StatusPacket>, source: Exclude<VitalsSource, null>): void {
    const snapshot = normalizeVitals(packet, source, Date.now(), this.vitals);
    if (snapshot.status !== 'unknown') {
      this.vitals = snapshot;
      if (snapshot.status === 'fresh') {
        if (snapshot.hp !== null) this.hp = snapshot.hp;
        if (snapshot.maxHp !== null) this.maxHp = snapshot.maxHp;
        if (snapshot.mp !== null) this.mp = snapshot.mp;
        if (snapshot.maxMp !== null) this.maxMp = snapshot.maxMp;
      }
    }
  }

  private recomputeDerivedMax(): void {
    const derived = deriveMaxima(this.realm, this.equipment);
    this.derivedMax = derived
      ? { maxHp: derived.maxHp, maxMp: derived.maxMp, complete: derived.complete, source: 'derived', observedAt: Date.now() }
      : { maxHp: null, maxMp: null, complete: false, source: 'derived', observedAt: Date.now() };
    this.derivedMaxConflictLogged = false;
  }

  private checkDerivedMaxAgainstVitals(packet: Partial<StatePacket | YouPacket>): void {
    if (!this.derivedMax.complete || this.derivedMax.maxHp === null || this.derivedMax.maxMp === null) return;
    const hp = packet.hp;
    const mp = packet.mp;
    if ((typeof hp === 'number' && hp > this.derivedMax.maxHp)
      || (typeof mp === 'number' && mp > this.derivedMax.maxMp)) {
      this.derivedMax = { ...this.derivedMax, complete: false, observedAt: Date.now() };
      if (!this.derivedMaxConflictLogged) {
        this.derivedMaxConflictLogged = true;
        this.emit('log', { level: 'warn', message: 'Max HP/MP suy ra thấp hơn vitals quan sát được; có thể có buff, thức ăn hoặc trận pháp.' });
      }
    }
  }

  private updateMapContext(mapId?: string, khu?: number): boolean {
    const nextMapId = typeof mapId === 'string' && mapId.length > 0 ? mapId : undefined;
    const nextKhu = readPositiveFiniteNumber(khu);
    const mapChanged = nextMapId !== undefined && nextMapId !== this.mapId;
    const khuChanged = nextKhu !== undefined && nextKhu !== this.khu;

    if (nextMapId !== undefined) this.mapKnown = true;
    if (nextKhu !== undefined) this.khuKnown = true;

    if (mapChanged || khuChanged) {
      this.downed = null;
      this.selfPresence = null;
      this.contextEpoch++;
      this.players = [];
      this.enemies = [];
      this.soKhu = 0;
      this.xKnown = false;
      this.yKnown = false;
      this.positionKnown = false;
      if (mapChanged) {
        this.mapId = nextMapId;
        if (nextKhu === undefined) {
          this.khu = 0;
          this.khuKnown = false;
        }
      }
      if (nextKhu !== undefined) this.khu = nextKhu;
    }
    return mapChanged || khuChanged;
  }

  /** Stores the uniquely matched self row as weak presence only; never updates vitals. */
  public applySelfEntry(players: ReadonlyArray<{ id?: unknown; hp?: unknown }>, observedAt: number = Date.now()): void {
    if (!this.selfId || !Number.isFinite(observedAt) || observedAt < 0) { this.selfPresence = null; return; }
    const matches = players.filter((row) => row && row.id === this.selfId);
    if (matches.length !== 1) { this.selfPresence = null; return; }
    const raw = matches[0].hp;
    const hpPercent = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
    this.selfPresence = { hpPercent, observedAt };
  }

  private hasWorldData(
    mapId?: unknown,
    khu?: unknown,
    x?: unknown,
    y?: unknown,
    players?: unknown,
    enemies?: unknown
  ): boolean {
    return (typeof mapId === 'string' && mapId.length > 0)
      || readPositiveFiniteNumber(khu) !== undefined
      || readFiniteNumber(x) !== undefined
      || readFiniteNumber(y) !== undefined
      || Array.isArray(players)
      || Array.isArray(enemies);
  }

  private updatePosition(x?: number, y?: number): void {
    if (x !== undefined) {
      this.x = x;
      this.xKnown = true;
    }
    if (y !== undefined) {
      this.y = y;
      this.yKnown = true;
    }
    this.positionKnown = this.xKnown && this.yKnown;
  }

  public updateHerbs(machList: Array<{ id: string; con: number; tx: number; ty: number; off?: number }>): void {
    this.herbs = machList;
    this.emit('herbs', machList);
  }

  public setLatency(latencyMs: number): void {
    this.latencyMs = latencyMs;
    this.emit('latency', latencyMs);
  }

  public setConnectionStatus(status: ConnectionStatus): void {
    const reconnecting = status === ConnectionStatus.IN_GAME && this.status !== ConnectionStatus.IN_GAME;
    if (status !== this.status && status !== ConnectionStatus.IN_GAME) {
      this.invalidateWorldContext();
    }
    if (reconnecting) this.invalidateWorldContext();
    if (status !== this.status && status !== ConnectionStatus.IN_GAME) this.invalidateVitals();
    if (reconnecting) this.invalidateVitals();
    if (status !== this.status && status !== ConnectionStatus.IN_GAME) this.invalidateStones();
    if (reconnecting) this.invalidateStones();
    this.status = status;
    this.emit('connectionStatus', status);
    this.emit('change');
  }

  private invalidateVitals(): void {
    if (this.vitals.status !== 'unknown') {
      this.vitals = { ...this.vitals, status: 'stale' };
    }
  }

  private invalidateStones(): void {
    if (this.stonesSnapshot.status !== 'unknown') {
      this.stonesSnapshot = { ...this.stonesSnapshot, status: 'stale' };
    }
  }

  private invalidateWorldContext(): void {
    this.contextEpoch++;
    this.worldUpdatedAt = 0;
    this.mapKnown = false;
    this.khuKnown = false;
    this.positionKnown = false;
    this.xKnown = false;
    this.yKnown = false;
    this.players = [];
    this.enemies = [];
    this.soKhu = 0;
  }

  public getItemCount(itemId: string): number {
    return this.bag[itemId] || 0;
  }

  public hasItem(itemId: string, minQty: number = 1): boolean {
    return (this.bag[itemId] || 0) >= minQty;
  }

  public getTotalItemTypes(): number {
    return Object.keys(this.bag).filter((k) => (this.bag[k] || 0) > 0).length;
  }

  public getTotalItemCount(): number {
    return Object.values(this.bag).reduce((sum, count) => sum + count, 0);
  }

  public getHpPercentage(): number {
    if (this.maxHp <= 0) return 100;
    return Math.round((this.hp / this.maxHp) * 100);
  }

  public getMpPercentage(): number {
    if (this.maxMp <= 0) return 100;
    return Math.round((this.mp / this.maxMp) * 100);
  }

  public toOverview(): CharacterOverview {
    return {
      selfId: this.selfId,
      name: this.name,
      realm: this.realm,
      exp: this.exp,
      stones: this.stones,
      stonesSnapshot: { ...this.stonesSnapshot },
      hp: this.hp,
      maxHp: this.maxHp,
      mp: this.mp,
      maxMp: this.maxMp,
      vitals: { ...this.vitals },
      derivedMax: { ...this.derivedMax },
      downed: this.downed,
      mapId: this.mapId,
      mapKnown: this.mapKnown,
      khu: this.khu,
      khuKnown: this.khuKnown,
      soKhu: this.soKhu,
      x: this.x,
      y: this.y,
      positionKnown: this.positionKnown,
      contextEpoch: this.contextEpoch,
      bagCount: this.getTotalItemTypes(),
      bagItems: { ...this.bag },
      stage: this.questSave?.stage || 0,
      latencyMs: this.latencyMs,
      connectionStatus: this.status,
      lastUpdated: this.lastUpdated,
    };
  }
}
