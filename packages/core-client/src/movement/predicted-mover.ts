import { AUTO_CONSTANTS } from '../state/auto-data.js';

export interface MovementPoint {
  readonly x: number;
  readonly y: number;
}

export interface SentMoveCommand {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

export interface PredictedMoverOptions {
  readonly position: MovementPoint;
  readonly speed?: number;
  readonly initialSequence?: number;
  readonly epoch?: number | null;
}

export interface PredictedStepInput {
  readonly waypoint: MovementPoint;
  readonly now: number;
  /** Use the transport's sequence when it owns sequence allocation. */
  readonly seq?: number;
}

export interface PredictedStep extends SentMoveCommand {
  readonly dtMs: number;
  readonly predicted: MovementPoint;
}

export interface AuthoritativeMovementUpdate {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly fix: boolean;
  readonly ep?: number | null;
  readonly now: number;
}

export type ReconciliationKind = 'ignored' | 'soft' | 'hard' | 'stale';

export interface ReconciliationResult {
  readonly kind: ReconciliationKind;
  readonly distance: number | null;
  readonly pendingCount: number;
  readonly reason?: 'small_error' | 'epoch_mismatch' | 'old_sequence' | 'invalid_position';
}

const MIN_STEP_MS = 20;
const MAX_STEP_MS = 200;
const FIRST_STEP_MS = 100;
const SMALL_ERROR_PX = 6;
const LARGE_ERROR_PX = 140;
const LARGE_ERROR_HARD_FIX_COUNT = 3;
const LARGE_ERROR_HARD_FIX_DELAY_MS = 1_500;
const MAX_PENDING_COMMANDS = 32;
const EPSILON = 1e-9;

const DEFAULT_WALK_SPEED = AUTO_CONSTANTS.player.speed * AUTO_CONSTANTS.player.walkMult;

function assertPoint(point: MovementPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('PredictedMover requires finite coordinates');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(a: MovementPoint, b: MovementPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roundTowardWaypoint(value: number, from: number, waypoint: number): number {
  const rounded = Math.round(value);
  if (waypoint > from) return Math.min(rounded, Math.floor(waypoint));
  if (waypoint < from) return Math.max(rounded, Math.ceil(waypoint));
  return Math.round(waypoint);
}

/**
 * `sendMove` rounds coordinates before putting them on the wire. Rounding a
 * diagonal float can add a little distance, so trim the integer point until
 * the actual wire-to-wire distance remains within the speed budget.
 */
function limitRoundedStep(from: MovementPoint, candidate: MovementPoint, maxDistance: number): MovementPoint {
  let x = Math.round(candidate.x);
  let y = Math.round(candidate.y);
  while (Math.hypot(x - from.x, y - from.y) > maxDistance + EPSILON
    && (x !== from.x || y !== from.y)) {
    const dx = x - from.x;
    const dy = y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      x -= Math.sign(dx);
    } else {
      y -= Math.sign(dy);
    }
  }
  return { x, y };
}

/**
 * Client-style local movement prediction and authoritative `you` reconciliation.
 * It has no transport or ambient clock: callers provide the timestamp and the
 * transport sequence used by each successful `sendMove`.
 */
export class PredictedMover {
  private predictedPosition: MovementPoint;
  private lastSentPosition: MovementPoint;
  private lastSentAtMs: number | null = null;
  private pending: SentMoveCommand[] = [];
  private nextSequence: number;
  private acknowledgedSequence: number;
  private resetSequence: number;
  private expectedEpoch: number | undefined;
  private largeFixStreak = 0;
  private hardFixNotBeforeMs: number | null = null;

  public readonly speed: number;

  public constructor(options: PredictedMoverOptions) {
    assertPoint(options.position);
    const speed = options.speed ?? DEFAULT_WALK_SPEED;
    if (!Number.isFinite(speed) || speed <= 0) throw new TypeError('PredictedMover speed must be positive');
    const initialSequence = options.initialSequence ?? 0;
    if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) {
      throw new TypeError('PredictedMover initialSequence must be a non-negative integer');
    }
    this.speed = speed;
    this.predictedPosition = { ...options.position };
    this.lastSentPosition = { ...options.position };
    this.nextSequence = initialSequence;
    this.acknowledgedSequence = initialSequence;
    this.resetSequence = initialSequence;
    this.expectedEpoch = options.epoch === null ? undefined : options.epoch;
  }

  public get position(): MovementPoint {
    return { ...this.predictedPosition };
  }

  public get pendingCommands(): readonly SentMoveCommand[] {
    return this.pending.map((command) => ({ ...command }));
  }

  public get lastSentAt(): number | null {
    return this.lastSentAtMs;
  }

  public reset(
    authoritativePosition: MovementPoint,
    options: { readonly now?: number; readonly seq?: number; readonly ep?: number | null } = {},
  ): void {
    assertPoint(authoritativePosition);
    const sequence = options.seq ?? this.acknowledgedSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('PredictedMover seq must be a non-negative integer');
    if (options.now !== undefined && !Number.isFinite(options.now)) throw new TypeError('PredictedMover now must be finite');
    this.predictedPosition = { ...authoritativePosition };
    this.lastSentPosition = { ...authoritativePosition };
    this.lastSentAtMs = null;
    this.pending = [];
    this.nextSequence = sequence;
    this.acknowledgedSequence = sequence;
    this.resetSequence = sequence;
    this.expectedEpoch = options.ep === null ? undefined : options.ep;
    this.largeFixStreak = 0;
    this.hardFixNotBeforeMs = options.now === undefined ? null : options.now + LARGE_ERROR_HARD_FIX_DELAY_MS;
  }

  public step(input: PredictedStepInput): PredictedStep {
    assertPoint(input.waypoint);
    if (!Number.isFinite(input.now)) throw new TypeError('PredictedMover now must be finite');
    if (input.seq !== undefined && (!Number.isSafeInteger(input.seq) || input.seq < 0)) {
      throw new TypeError('PredictedMover seq must be a non-negative integer');
    }

    const dtMs = this.lastSentAtMs === null
      ? FIRST_STEP_MS
      : clamp(input.now - this.lastSentAtMs, MIN_STEP_MS, MAX_STEP_MS);
    this.lastSentAtMs = input.now;

    const from = this.predictedPosition;
    const dx = input.waypoint.x - from.x;
    const dy = input.waypoint.y - from.y;
    const remaining = Math.hypot(dx, dy);
    const maxStep = this.speed * dtMs / 1000;
    const travel = Math.min(remaining, maxStep);
    const predicted = remaining <= EPSILON
      ? { ...input.waypoint }
      : {
        x: from.x + (dx / remaining) * travel,
        y: from.y + (dy / remaining) * travel,
      };
    this.predictedPosition = predicted;

    const rounded = {
      x: roundTowardWaypoint(predicted.x, from.x, input.waypoint.x),
      y: roundTowardWaypoint(predicted.y, from.y, input.waypoint.y),
    };
    const wirePosition = limitRoundedStep(this.lastSentPosition, rounded, maxStep);
    const seq = input.seq ?? this.nextSequence + 1;
    this.nextSequence = Math.max(this.nextSequence, seq);
    const command: SentMoveCommand = { seq, x: wirePosition.x, y: wirePosition.y, at: input.now };
    this.pending.push(command);
    if (this.pending.length > MAX_PENDING_COMMANDS) this.pending.splice(0, this.pending.length - MAX_PENDING_COMMANDS);
    this.lastSentPosition = wirePosition;
    return { ...command, dtMs, predicted: { ...predicted } };
  }

  public onAuthoritative(input: AuthoritativeMovementUpdate): ReconciliationResult {
    if (!Number.isSafeInteger(input.seq) || !Number.isFinite(input.x) || !Number.isFinite(input.y)) {
      return { kind: 'stale', distance: null, pendingCount: this.pending.length, reason: 'invalid_position' };
    }
    if (!Number.isFinite(input.now)) throw new TypeError('PredictedMover now must be finite');

    const acknowledged = this.pending.find((command) => command.seq === input.seq) ?? null;
    this.pending = this.pending.filter((command) => command.seq > input.seq);

    if (input.ep !== undefined && input.ep !== null) {
      if (this.expectedEpoch === undefined) this.expectedEpoch = input.ep;
      else if (input.ep !== this.expectedEpoch) {
        return { kind: 'stale', distance: null, pendingCount: this.pending.length, reason: 'epoch_mismatch' };
      }
    }
    if (input.fix && input.seq <= this.resetSequence) {
      return { kind: 'stale', distance: null, pendingCount: this.pending.length, reason: 'old_sequence' };
    }
    if (input.seq > this.acknowledgedSequence) this.acknowledgedSequence = input.seq;
    if (!input.fix) return { kind: 'ignored', distance: null, pendingCount: this.pending.length };

    const corrected = { x: input.x, y: input.y };
    if (acknowledged) {
      // The vendor client offsets the authoritative ack by the complete
      // locally predicted displacement since that ack. `pending` is retained
      // for queue length/diagnostics; summing every pending command would
      // compound the displacement and diverge from gateway.js.
      corrected.x += this.predictedPosition.x - acknowledged.x;
      corrected.y += this.predictedPosition.y - acknowledged.y;
    }
    const error = distance(corrected, this.predictedPosition);
    if (error <= SMALL_ERROR_PX) {
      this.largeFixStreak = 0;
      return { kind: 'ignored', distance: error, pendingCount: this.pending.length, reason: 'small_error' };
    }

    let kind: 'soft' | 'hard' = 'soft';
    if (error > LARGE_ERROR_PX) {
      this.largeFixStreak += 1;
      if (this.largeFixStreak >= LARGE_ERROR_HARD_FIX_COUNT
        && (this.hardFixNotBeforeMs === null || input.now > this.hardFixNotBeforeMs)) {
        kind = 'hard';
        this.largeFixStreak = 0;
      }
    } else {
      this.largeFixStreak = 0;
    }

    this.predictedPosition = corrected;
    this.lastSentPosition = corrected;
    this.pending = [];
    // gateway.js advances its stale-fix floor to its current outbound seq
    // whenever Z() accepts a correction; a plain you ACK does not advance it.
    this.resetSequence = this.nextSequence;
    return { kind, distance: error, pendingCount: 0 };
  }
}
