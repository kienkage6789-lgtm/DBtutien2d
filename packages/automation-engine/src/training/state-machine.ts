import { VITALS_ATTACK_MAX_AGE_MS } from '@tutien2d/core-client';

/** Pure training navigation/combat policy. The caller owns transport and persistence. */
export type TrainingPhase =
  | 'SYNCING' | 'ENTERING_MAP' | 'WAITING_MAP_CONFIRM' | 'WAITING_KHU'
  | 'MOVING_TO_AREA' | 'TRAINING' | 'RECOVERING' | 'BLOCKED' | 'STOPPED';

export interface TrainingConfig {
  enabled: boolean;
  /** Exact name or ID match; empty means no monster filter. */
  monsterType: string;
  mapId: string;
  khu: number;
  area: { x: number; y: number; radius: number };
  attackIntervalMs: number;
  snapshotMaxAgeMs: number;
  /** False until the game protocol has an observed, supported operation. */
  canSelectKhu: boolean;
  canRespawn: boolean;
}

export interface TrainingSnapshot {
  observedAt: number;
  mapId?: string;
  khu?: number;
  x?: number;
  y?: number;
  hp?: number;
  maxHp?: number;
  vitalObservedAt?: number | null;
  /** Backend/client-computed age when available; never negative. */
  vitalsAgeMs?: number | null;
  /** True when an absolute snapshot was observed before it became stale. */
  vitalsKnown?: boolean;
  selfPresence?: { hpPercent: number | null; observedAt: number } | null;
  vitalStatus: 'unknown' | 'fresh' | 'stale' | 'invalid' | 'conflict';
  vitalReason?: string;
  /** Derived only from fresh, validated vitals. */
  dead?: boolean;
  /** Self-row percentage may be used only when derived maxima are complete. */
  derivedMaxComplete?: boolean;
  monsters: ReadonlyArray<{ id: string; name?: string; x: number; y: number; alive: boolean }>;
}

export type TrainingAction =
  | { type: 'ENTER_MAP'; mapId: string; operationId: string }
  | { type: 'SELECT_KHU'; khu: number; operationId: string }
  | { type: 'MOVE_TO_AREA'; x: number; y: number; operationId: string }
  | { type: 'ATTACK'; targetId: string; operationId: string };

export interface TrainingMachineState {
  phase: TrainingPhase;
  sessionId: string;
  sequence: number;
  pending?: TrainingAction;
  lastAttackAt?: number;
  lastIntentAt?: number;
  lastCompletedAction?: TrainingAction['type'];
  resumePhase?: TrainingPhase;
  reason?: string;
}

export interface TrainingInput {
  now: number;
  config: TrainingConfig;
  snapshot?: TrainingSnapshot;
  actionResult?: { operationId: string; ok: boolean; error?: string };
  /** Result of the controller-owned refresh attempt, if one was made this step. */
  vitalsRefreshResult?: TrainingVitalsRefreshResult;
}

export type TrainingVitalsRefreshResult = {
  status: 'refreshed' | 'skipped' | 'no_ack';
};

export interface TrainingDecision {
  state: TrainingMachineState;
  action?: TrainingAction;
  accepted: boolean;
  reason?: string;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export type Liveness = 'alive' | 'dead' | 'unknown';

export function resolveLiveness(input: {
  vitals: { hp: number | null; status: string; observedAt: number | null };
  selfPresence: { hpPercent: number | null; observedAt: number } | null;
  derivedMaxComplete?: boolean;
  now: number;
  maxAgeMs: number;
}): Liveness {
  const { vitals, selfPresence, derivedMaxComplete = true, now, maxAgeMs } = input;
  const freshAbsolute = vitals.status === 'fresh' && finite(vitals.hp) && vitals.hp >= 0
    && finite(vitals.observedAt) && now >= vitals.observedAt && now - vitals.observedAt <= maxAgeMs;
  if (freshAbsolute) return vitals.hp! > 0 ? 'alive' : 'dead';
  if (derivedMaxComplete && selfPresence && finite(selfPresence.hpPercent) && selfPresence.hpPercent >= 0 && selfPresence.hpPercent <= 100
    && finite(selfPresence.observedAt) && now >= selfPresence.observedAt && now - selfPresence.observedAt <= maxAgeMs) {
    return selfPresence.hpPercent > 0 ? 'alive' : 'unknown';
  }
  return 'unknown';
}

export function validateTrainingConfig(c: TrainingConfig): string | undefined {
  if (!c || typeof c.enabled !== 'boolean' || typeof c.canSelectKhu !== 'boolean' || typeof c.canRespawn !== 'boolean') return 'INVALID_BOOLEAN_CONFIG';
  if (typeof c.monsterType !== 'string' || c.monsterType.length > 128 || c.monsterType.trim().length > 128) return 'INVALID_MONSTER_TYPE';
  if (typeof c.mapId !== 'string' || !c.mapId.trim() || c.mapId.length > 128) return 'INVALID_MAP';
  if (!Number.isInteger(c.khu) || c.khu < 1 || c.khu > 10000) return 'INVALID_KHU';
  if (!c.area || !finite(c.area.x) || !finite(c.area.y) || Math.abs(c.area.x) > 1000000 || Math.abs(c.area.y) > 1000000 || !finite(c.area.radius) || c.area.radius <= 0 || c.area.radius > 100000) return 'INVALID_AREA';
  if (!Number.isInteger(c.attackIntervalMs) || c.attackIntervalMs < 100 || c.attackIntervalMs > 3600000) return 'INVALID_ATTACK_INTERVAL';
  if (!Number.isInteger(c.snapshotMaxAgeMs) || c.snapshotMaxAgeMs < 100 || c.snapshotMaxAgeMs > 300000) return 'INVALID_SNAPSHOT_AGE';
  return undefined;
}

export function createTrainingState(sessionId: string): TrainingMachineState {
  if (!sessionId.trim()) throw new Error('sessionId is required');
  return { phase: 'SYNCING', sessionId, sequence: 0 };
}

const inArea = (x: number, y: number, c: TrainingConfig) =>
  Math.hypot(x - c.area.x, y - c.area.y) <= c.area.radius;

/** One call consumes one authoritative observation/result and may emit at most one intent. */
export function stepTraining(state: TrainingMachineState, input: TrainingInput): TrainingDecision {
  const invalid = validateTrainingConfig(input.config);
  if (invalid) return { state: { ...state, phase: 'BLOCKED', pending: undefined, reason: invalid }, accepted: false, reason: invalid };
  if (!finite(input.now)) return { state, accepted: false, reason: 'INVALID_CLOCK' };
  if (!input.config.enabled) return { state: { ...state, phase: 'STOPPED', pending: undefined }, accepted: true };

  const snap = input.snapshot;
  if (!snap || !finite(snap.observedAt) || snap.observedAt < 0 || input.now < snap.observedAt || input.now - snap.observedAt > input.config.snapshotMaxAgeMs) {
    return { state: { ...state, phase: 'RECOVERING', resumePhase: state.phase === 'RECOVERING' ? state.resumePhase : state.phase, reason: 'STALE_OR_MISSING_SNAPSHOT' }, accepted: false, reason: 'STALE_OR_MISSING_SNAPSHOT' };
  }
  if (snap.mapId !== undefined && (typeof snap.mapId !== 'string' || snap.mapId.length > 128) || snap.khu !== undefined && (!Number.isInteger(snap.khu) || snap.khu < 0))
    return { state, accepted: false, reason: 'MALFORMED_SNAPSHOT' };
  if (snap.dead !== undefined && typeof snap.dead !== 'boolean' || !Array.isArray(snap.monsters) || (snap.x !== undefined && (!finite(snap.x) || Math.abs(snap.x) > 1000000)) || (snap.y !== undefined && (!finite(snap.y) || Math.abs(snap.y) > 1000000)))
    return { state, accepted: false, reason: 'MALFORMED_SNAPSHOT' };
  if (!['unknown', 'fresh', 'stale', 'invalid', 'conflict'].includes(snap.vitalStatus)
    || snap.vitalReason !== undefined && (typeof snap.vitalReason !== 'string' || snap.vitalReason.length > 256)
    || snap.hp !== undefined && (!finite(snap.hp) || snap.hp < 0)
    || snap.maxHp !== undefined && (!finite(snap.maxHp) || snap.maxHp <= 0))
    return { state, accepted: false, reason: 'MALFORMED_VITALS' };
  const validVitals = snap.vitalStatus === 'fresh' && finite(snap.hp) && snap.hp >= 0
    && (snap.maxHp === undefined || snap.maxHp > 0 && snap.hp <= snap.maxHp);
  if (snap.selfPresence !== undefined && snap.selfPresence !== null
    && (snap.selfPresence.hpPercent !== null && (!finite(snap.selfPresence.hpPercent) || snap.selfPresence.hpPercent < 0 || snap.selfPresence.hpPercent > 100)
      || !finite(snap.selfPresence.observedAt))) return { state, accepted: false, reason: 'MALFORMED_SELF_PRESENCE' };
  const observedLiveness = resolveLiveness({
    vitals: { hp: validVitals ? snap.hp! : null, status: validVitals ? snap.vitalStatus : 'unknown', observedAt: snap.vitalObservedAt ?? null },
    selfPresence: snap.selfPresence ?? null, derivedMaxComplete: snap.derivedMaxComplete !== false,
    now: input.now, maxAgeMs: VITALS_ATTACK_MAX_AGE_MS,
  });
  // Only the snapshot's explicit dead flag represents authoritative downed evidence.
  // A zero in a generic state packet is insufficient and must not block navigation.
  const liveness = observedLiveness === 'dead' && snap.dead !== true ? 'unknown' : observedLiveness;
  if (snap.monsters.some(m => !m || typeof m.id !== 'string' || !m.id || m.id.length > 128 || m.name !== undefined && (typeof m.name !== 'string' || m.name.length > 128 || m.name.trim().length > 128) || !finite(m.x) || Math.abs(m.x) > 1000000 || !finite(m.y) || Math.abs(m.y) > 1000000 || typeof m.alive !== 'boolean'))
    return { state, accepted: false, reason: 'MALFORMED_MONSTER' };

  const issue = (phase: TrainingPhase, make: (operationId: string) => TrainingAction): TrainingDecision => {
    const sequence = state.sequence + 1;
    const operationId = `${state.sessionId}:${sequence}`;
    const action = make(operationId);
    return { state: { ...state, phase, sequence, pending: action, lastIntentAt: input.now, reason: undefined }, action, accepted: true };
  };
  // Death remains fail-safe until the game's respawn protocol is implemented.
  // Keep canRespawn for config compatibility, but never emit a RESPAWN action.
  if (liveness === 'dead') {
    return { state: { ...state, phase: 'BLOCKED', pending: undefined, lastCompletedAction: undefined,
      resumePhase: undefined, reason: 'RESPAWN_PROTOCOL_UNAVAILABLE' }, accepted: true, reason: 'RESPAWN_PROTOCOL_UNAVAILABLE' };
  }
  if (state.pending) {
    const result = input.actionResult;
    if (!result || result.operationId !== state.pending.operationId) return { state, accepted: true, reason: 'WAITING_FOR_OPERATION_RESULT' };
    if (!result.ok) return { state: { ...state, phase: 'BLOCKED', pending: undefined, reason: result.error ?? 'ACTION_FAILED' }, accepted: true, reason: result.error ?? 'ACTION_FAILED' };
    const completed = state.pending.type;
    if (snap.observedAt <= (state.lastIntentAt ?? -Infinity)) return { state, accepted: true, reason: 'WAITING_FOR_NEWER_SNAPSHOT' };
    const confirmed = completed === 'ENTER_MAP' ? snap.mapId === input.config.mapId
      : completed === 'SELECT_KHU' ? snap.mapId === input.config.mapId && snap.khu === input.config.khu
      : completed === 'MOVE_TO_AREA' ? snap.mapId === input.config.mapId && snap.khu === input.config.khu && finite(snap.x) && finite(snap.y) && inArea(snap.x, snap.y, input.config)
      : true;
    if (!confirmed) return { state: { ...state, phase: 'BLOCKED', pending: undefined, lastCompletedAction: completed, reason: `${completed}_NOT_CONFIRMED` }, accepted: true, reason: `${completed}_NOT_CONFIRMED` };
    state = { ...state, pending: undefined, lastCompletedAction: completed,
      phase: completed === 'ENTER_MAP' ? 'WAITING_MAP_CONFIRM' : completed === 'SELECT_KHU' ? 'WAITING_KHU' : completed === 'MOVE_TO_AREA' ? 'MOVING_TO_AREA' : state.phase };
  }
  const hasPosition = finite(snap.x) && finite(snap.y);
  if (!snap.mapId || snap.khu === undefined || !hasPosition)
    return { state: { ...state, phase: 'RECOVERING', resumePhase: state.phase, reason: 'AUTHORITATIVE_LOCATION_UNKNOWN' }, accepted: false, reason: 'AUTHORITATIVE_LOCATION_UNKNOWN' };

  if (state.phase === 'RECOVERING') state = { ...state, phase: state.resumePhase ?? 'SYNCING', resumePhase: undefined, lastCompletedAction: undefined, reason: undefined };
  if (state.phase === 'WAITING_MAP_CONFIRM' && snap.mapId !== input.config.mapId) return { state, accepted: true, reason: 'WAITING_MAP_CONFIRMATION' };
  if (state.phase === 'WAITING_KHU' && snap.khu !== input.config.khu) return { state, accepted: true, reason: 'WAITING_KHU_CONFIRMATION' };
  if (snap.mapId !== input.config.mapId) {
    return issue('ENTERING_MAP', operationId => ({ type: 'ENTER_MAP', mapId: input.config.mapId, operationId }));
  }
  if (snap.khu !== input.config.khu) {
    if (!input.config.canSelectKhu) return { state: { ...state, phase: 'BLOCKED', reason: 'KHU_PROTOCOL_UNAVAILABLE' }, accepted: true, reason: 'KHU_PROTOCOL_UNAVAILABLE' };
    return issue('WAITING_KHU', operationId => ({ type: 'SELECT_KHU', khu: input.config.khu, operationId }));
  }
  if (state.phase === 'WAITING_MAP_CONFIRM' || state.phase === 'WAITING_KHU') state = { ...state, phase: 'MOVING_TO_AREA' };
  if (!inArea(snap.x!, snap.y!, input.config)) {
    return issue('MOVING_TO_AREA', operationId => ({ type: 'MOVE_TO_AREA', x: input.config.area.x, y: input.config.area.y, operationId }));
  }
  const target = snap.monsters.filter(m => m && typeof m.id === 'string' && m.id.length > 0 && finite(m.x) && finite(m.y) && m.alive && inArea(m.x, m.y, input.config)
      && (!input.config.monsterType || m.name === input.config.monsterType || m.id === input.config.monsterType))
    .sort((a, b) => Math.hypot(a.x - snap.x!, a.y - snap.y!) - Math.hypot(b.x - snap.x!, b.y - snap.y!) || a.id.localeCompare(b.id))[0];
  if (!target) return { state: { ...state, phase: 'TRAINING', reason: undefined }, accepted: true };
  const vitalsObservedAt = snap.vitalObservedAt ?? null;
  const vitalsAgeMs = snap.vitalsAgeMs
    ?? (finite(vitalsObservedAt) ? Math.max(0, input.now - vitalsObservedAt) : null);
  const vitalsFreshEnough = snap.vitalStatus === 'fresh'
    && finite(snap.hp)
    && vitalsAgeMs !== null
    && Number.isFinite(vitalsAgeMs)
    && vitalsAgeMs >= 0
    && vitalsAgeMs <= VITALS_ATTACK_MAX_AGE_MS;
  const vitalsKnown = snap.vitalsKnown === true || finite(vitalsObservedAt) || finite(snap.hp);
  const refreshDidNotAck = input.vitalsRefreshResult?.status === 'skipped'
    || input.vitalsRefreshResult?.status === 'no_ack';
  if (!vitalsFreshEnough || liveness === 'unknown' || refreshDidNotAck) {
    const reason = liveness === 'unknown' && snap.hp === 0
      ? 'VITALS_UNKNOWN'
      : vitalsKnown ? 'VITALS_STALE' : 'VITALS_UNKNOWN';
    return { state: { ...state, phase: 'TRAINING', reason }, accepted: true, reason };
  }
  if (state.lastAttackAt !== undefined && input.now - state.lastAttackAt < input.config.attackIntervalMs)
    return { state: { ...state, phase: 'TRAINING' }, accepted: true, reason: 'ATTACK_COOLDOWN' };
  const decision = issue('TRAINING', operationId => ({ type: 'ATTACK', targetId: target.id, operationId }));
  return { ...decision, state: { ...decision.state, lastAttackAt: input.now } };
}
