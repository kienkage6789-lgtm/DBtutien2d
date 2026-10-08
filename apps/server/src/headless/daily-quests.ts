import type { WalkOperation, WalkRequest } from './walk-navigator.js';

export type DailyOperationKind = 'checkin' | 'seed';
export type DailyOperationStatus = 'accepted' | 'running' | 'done' | 'failed' | 'cancelled';

export interface DailySeedTask {
  id: string;
  name: string;
  kind: string;
  limit: number | null;
  runsToday: number | null;
  runsLeft: number | null;
  supported: boolean;
  active: boolean;
}

export interface DailyStatus {
  today: string | null;
  stage: number | null;
  checkin: { done: boolean; total: number | null };
  seedTasks: DailySeedTask[];
  activeSeedTask: string | null;
  stones: number | null;
  duocCong: number | null;
  canhKho: number | null;
}

export interface DailyOperation {
  operationId: string;
  kind: DailyOperationKind;
  taskId?: string;
  status: DailyOperationStatus;
  step: string;
  runIndex: number;
  runsTotal: number;
  reason?: string;
  why?: string;
  rewards?: { stones: number; duocCong: number };
  startedAt: number;
  updatedAt: number;
}

export type DailyStep =
  | 'checkin_walk'
  | 'checkin_ack'
  | 'seed_walk_npc'
  | 'seed_start'
  | 'seed_walk_tree'
  | 'seed_chop'
  | 'seed_wait_drop'
  | 'seed_walk_drop'
  | 'seed_collect'
  | 'seed_collect_wait'
  | 'seed_walk_complete'
  | 'seed_complete'
  | 'seed_wait_reset'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface DailyAck {
  cmd?: string;
  rid?: string | number;
  ok: boolean;
  why?: string;
  toast?: string;
  stones?: number;
  duocCong?: number;
}

export interface DailyProp {
  id: string;
  x: number;
  y: number;
  r?: number;
  chopTask?: string;
}

export interface DailyDrop {
  task?: string;
  materialId?: string;
  state?: string;
  x: number;
  y: number;
}

export interface DailyClientState extends DailyStatus {
  activeCollected: number | null;
  activeRequired: number | null;
  drops: DailyDrop[];
}

export interface DailyClient {
  nowMs(): number;
  isInGame(): boolean;
  isMapReady(): boolean;
  isDown(): boolean;
  isAutoActive(): boolean;
  getSupervisorPhase(): string;
  getHurtCount(): number;
  getWalkOperation(): WalkOperation | null;
  walkTo(request: WalkRequest): WalkOperation;
  cancelWalk?(operationId: string, reason: string): void;
  readDailyState(): DailyClientState;
  getProp(mapId: string, propId: string): DailyProp | null;
  startChopping(prop: DailyProp): boolean;
  invokeCheckin(): unknown;
  startSeedQuest(taskId: string): unknown;
  completeSeedQuest(): unknown;
  issueCommand(command: string, action: () => unknown): Promise<DailyAck>;
  watchCommand(command: string): Promise<DailyAck>;
  cancelPendingCommand?(command: string): void;
  collectSeedMaterial(taskId: string, propId: string): unknown;
  cancelSeedQuest(): unknown;
  recordLog(event: { code: string; reasonCode?: string; detail?: string; at: number }): void;
}

export type DailyErrorCode =
  | 'NOT_IN_GAME'
  | 'VENDOR_MAP_NOT_READY'
  | 'CHARACTER_DOWN'
  | 'AUTO_ACTIVE'
  | 'OPERATION_IN_PROGRESS'
  | 'OTHER_SEED_TASK_ACTIVE'
  | 'ALREADY_DONE'
  | 'STAGE_TOO_LOW'
  | 'NO_RUNS_LEFT'
  | 'TASK_NOT_SUPPORTED'
  | 'INVALID_REQUEST'
  | 'TARGET_INVALID'
  | 'OPERATION_NOT_FOUND';

export class DailyError extends Error {
  public readonly code: DailyErrorCode;

  public constructor(code: DailyErrorCode, message = code) {
    super(message);
    this.name = 'DailyError';
    this.code = code;
  }
}

const ACTIVE_WALK = new Set<WalkOperation['status']>(['accepted', 'running']);
const ACTIVE_DAILY = new Set<DailyOperationStatus>(['accepted', 'running']);
const SUPPORTED_TASK = 'duoc_moc';
const NPC_CHECKIN = 'manh_shopt1';
const NPC_SEED = 'dai_phu';
const TREE_SEED = 'co_thu_linh_moc';
const TREE_TILE_SIZE = 32;
const REQUIRED_BRANCHES = 5;
const MAX_CHOP_ATTEMPTS = 3;
const ACK_TIMEOUT_MS = 5_000;
const STEP_TIMEOUT_MS = 30_000;
const CHOP_WAIT_MS = 5_000;
const TOTAL_RUN_TIMEOUT_MS = 4 * 60_000;

let operationSequence = 0;

const active = (status: DailyOperationStatus): boolean => ACTIVE_DAILY.has(status);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function copyOperation(operation: DailyOperation | null): DailyOperation | null {
  return operation ? {
    ...operation,
    ...(operation.rewards ? { rewards: { ...operation.rewards } } : {}),
  } : null;
}

function formatProgress(state: DailyClientState, target: string): string {
  const map = state.activeSeedTask ?? 'unknown';
  const collected = state.activeCollected ?? state.canhKho ?? 0;
  return `${target} map=${map} canh=${collected}/${REQUIRED_BRANCHES}`;
}

export class DailyQuests {
  private operation: DailyOperation | null = null;
  private pendingWalk: { operationId: string; step: DailyStep; deadlineAt: number } | null = null;
  private pendingAck: {
    command: string;
    step: DailyStep;
    deadlineAt: number;
    result: DailyAck | null;
  } | null = null;
  private pendingDrop: DailyDrop | null = null;
  private chopStartedAt = 0;
  private chopAttempts = 0;
  private collectedBefore = 0;
  private baselineStones: number | null = null;
  private baselineDuocCong: number | null = null;
  private earnedStones = 0;
  private earnedDuocCong = 0;
  private hurtAtStart = 0;
  private abortOnHurt = false;
  private maxHurt = 1;
  private totalDeadlineAt = 0;
  private pendingCollectAck: { deadlineAt: number; result: DailyAck | null } | null = null;

  public constructor(private readonly client: DailyClient) {}

  public getOperation(): DailyOperation | null { return copyOperation(this.operation); }

  public getStatus(): DailyStatus {
    const state = this.client.readDailyState();
    return {
      today: state.today,
      stage: state.stage,
      checkin: { ...state.checkin },
      seedTasks: state.seedTasks.map((task) => ({ ...task })),
      activeSeedTask: state.activeSeedTask,
      stones: state.stones,
      duocCong: state.duocCong,
      canhKho: state.canhKho,
    };
  }

  public isActive(): boolean { return this.operation !== null && active(this.operation.status); }

  public startCheckin(): DailyOperation {
    this.assertStartAllowed();
    const state = this.client.readDailyState();
    if (state.checkin.done) throw new DailyError('ALREADY_DONE');
    this.abortOnHurt = false;
    this.maxHurt = 1;
    this.createOperation('checkin', undefined, 1, state);
    this.setStep('checkin_walk');
    this.client.recordLog({ code: 'daily_started', detail: 'checkin', at: this.client.nowMs() });
    return copyOperation(this.operation)!;
  }

  public startSeedTask(taskId: string, runs = 1, options: { abortOnHurt?: boolean; maxHurt?: number } = {}): DailyOperation {
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(taskId)) throw new DailyError('INVALID_REQUEST');
    if (!Number.isInteger(runs) || runs < 1 || runs > 3) throw new DailyError('INVALID_REQUEST');
    this.assertStartAllowed();
    const state = this.client.readDailyState();
    if (state.stage === null || state.stage < 8) throw new DailyError('STAGE_TOO_LOW');
    const task = state.seedTasks.find((candidate) => candidate.id === taskId);
    if (!task || !task.supported) throw new DailyError('TASK_NOT_SUPPORTED');
    if (task.runsLeft === null || task.runsLeft < runs) throw new DailyError('NO_RUNS_LEFT');
    if (state.activeSeedTask !== null && state.activeSeedTask !== SUPPORTED_TASK) {
      throw new DailyError('OTHER_SEED_TASK_ACTIVE');
    }
    this.abortOnHurt = options.abortOnHurt === true;
    this.maxHurt = options.maxHurt ?? 1;
    if (!Number.isInteger(this.maxHurt) || this.maxHurt < 1 || this.maxHurt > 50) throw new DailyError('INVALID_REQUEST');
    this.createOperation('seed', taskId, runs, state);
    this.setStep(state.activeSeedTask === SUPPORTED_TASK ? 'seed_walk_tree' : 'seed_walk_npc');
    this.client.recordLog({ code: 'daily_started', detail: `seed=${taskId} runs=${runs}`, at: this.client.nowMs() });
    return copyOperation(this.operation)!;
  }

  public cancel(operationId: string, reason: string): boolean {
    if (!this.operation || this.operation.operationId !== operationId || !active(this.operation.status)) return false;
    const now = this.client.nowMs();
    if (this.pendingAck) this.client.cancelPendingCommand?.(this.pendingAck.command);
    if (this.pendingWalk) this.client.cancelWalk?.(this.pendingWalk.operationId, reason);
    if (this.pendingCollectAck) this.client.cancelPendingCommand?.('seed.collect');
    if (this.operation.kind === 'seed' && this.client.isInGame()) {
      try { this.client.cancelSeedQuest(); } catch { /* local cancellation is best effort during stop/reconnect */ }
    }
    this.pendingAck = null;
    this.pendingWalk = null;
    this.pendingCollectAck = null;
    this.operation.status = 'cancelled';
    this.operation.reason = reason;
    this.operation.step = 'cancelled';
    this.operation.updatedAt = now;
    this.client.recordLog({ code: 'daily_cancelled', reasonCode: reason, at: now });
    return true;
  }

  public tick(): void {
    const operation = this.operation;
    if (!operation || !active(operation.status)) return;
    const now = this.client.nowMs();
    operation.status = 'running';
    operation.updatedAt = now;
    if (!this.client.isInGame()) { this.cancel(operation.operationId, 'reconnecting'); return; }
    if (this.client.isDown()) { this.cancel(operation.operationId, 'character_down'); return; }
    if (this.client.isAutoActive() || this.client.getSupervisorPhase() !== 'idle') { this.cancel(operation.operationId, 'auto_started'); return; }
    if (this.abortOnHurt && this.client.getHurtCount() - this.hurtAtStart >= this.maxHurt) {
      this.cancel(operation.operationId, 'hurt_abort');
      return;
    }
    if (now >= this.totalDeadlineAt) { this.fail('DAILY_TIMEOUT'); return; }
    if (this.pendingAck) {
      if (this.pendingAck.result) {
        const pending = this.pendingAck;
        this.pendingAck = null;
        const result = pending.result;
        if (result) this.handleAck(pending.command, pending.step, result);
      } else if (now >= this.pendingAck.deadlineAt) {
        this.client.cancelPendingCommand?.(this.pendingAck.command);
        this.pendingAck = null;
        this.fail('ACK_TIMEOUT');
      }
      return;
    }
    if (this.pendingWalk) {
      this.pollWalk(now);
      return;
    }
    if (this.pendingCollectAck?.result) {
      const result = this.pendingCollectAck.result;
      this.pendingCollectAck = null;
      if (!result.ok) { this.fail('ACK_REFUSED', result.why ?? result.toast ?? 'server_refused'); return; }
      this.setStep('seed_collect_wait');
      return;
    }
    if (this.pendingCollectAck && this.pendingCollectAck.deadlineAt > 0 && now >= this.pendingCollectAck.deadlineAt) {
      this.client.cancelPendingCommand?.('seed.collect');
      this.pendingCollectAck = null;
      this.fail('ACK_TIMEOUT');
      return;
    }
    if (this.stepExpired(now)) {
      this.fail('STEP_TIMEOUT');
      return;
    }
    switch (operation.step as DailyStep) {
      case 'checkin_walk': this.walkToNpc(NPC_CHECKIN, 'tan_vien', 'checkin_ack'); break;
      case 'checkin_ack': this.beginAck('diemdanh', 'checkin_ack', () => this.client.issueCommand('diemdanh', () => this.client.invokeCheckin())); break;
      case 'seed_walk_npc': this.walkToNpc(NPC_SEED, 'duoc_vien', 'seed_start'); break;
      case 'seed_start': this.beginAck('seed.start', 'seed_start', () => this.client.issueCommand('seed.start', () => this.client.startSeedQuest(SUPPORTED_TASK))); break;
      case 'seed_walk_tree': this.walkToTree(); break;
      case 'seed_chop': this.beginChop(); break;
      case 'seed_wait_drop': this.waitForDrop(now); break;
      case 'seed_walk_drop': this.walkToDrop(); break;
      case 'seed_collect': this.prepareCollectWait(); break;
      case 'seed_collect_wait': this.waitForCollected(now); break;
      case 'seed_walk_complete': this.walkToNpc(NPC_SEED, 'duoc_vien', 'seed_complete'); break;
      case 'seed_complete': this.beginAck('seed.complete', 'seed_complete', () => this.client.issueCommand('seed.complete', () => this.client.completeSeedQuest())); break;
      case 'seed_wait_reset': this.waitForReset(now); break;
      default: this.fail('INVALID_STEP');
    }
  }

  private assertStartAllowed(): void {
    if (!this.client.isInGame()) throw new DailyError('NOT_IN_GAME');
    if (!this.client.isMapReady()) throw new DailyError('VENDOR_MAP_NOT_READY');
    if (this.client.isDown()) throw new DailyError('CHARACTER_DOWN');
    if (this.client.isAutoActive() || this.client.getSupervisorPhase() !== 'idle') throw new DailyError('AUTO_ACTIVE');
    if (this.isActive()) throw new DailyError('OPERATION_IN_PROGRESS');
    const walk = this.client.getWalkOperation();
    if (walk && ACTIVE_WALK.has(walk.status)) throw new DailyError('OPERATION_IN_PROGRESS');
  }

  private createOperation(kind: DailyOperationKind, taskId: string | undefined, runs: number, state: DailyClientState): void {
    const now = this.client.nowMs();
    this.operation = {
      operationId: `daily-${now}-${++operationSequence}`,
      kind,
      ...(taskId ? { taskId } : {}),
      status: 'accepted',
      step: kind === 'checkin' ? 'checkin_walk' : 'seed_walk_npc',
      runIndex: 1,
      runsTotal: runs,
      startedAt: now,
      updatedAt: now,
    };
    this.pendingWalk = null;
    this.pendingAck = null;
    this.pendingCollectAck = null;
    this.pendingDrop = null;
    this.chopStartedAt = 0;
    this.chopAttempts = 0;
    this.collectedBefore = state.activeCollected ?? 0;
    this.baselineStones = state.stones;
    this.baselineDuocCong = state.duocCong;
    this.earnedStones = 0;
    this.earnedDuocCong = 0;
    this.hurtAtStart = this.client.getHurtCount();
    this.totalDeadlineAt = now + TOTAL_RUN_TIMEOUT_MS * runs;
  }

  private setStep(step: DailyStep): void {
    if (!this.operation) return;
    const now = this.client.nowMs();
    this.operation.step = step;
    this.operation.updatedAt = now;
    if (step !== 'done' && step !== 'failed' && step !== 'cancelled') this.stepDeadlineAt = now + STEP_TIMEOUT_MS;
    this.client.recordLog({ code: 'daily_step', detail: `${step} run=${this.operation.runIndex}/${this.operation.runsTotal}`, at: now });
  }

  private stepDeadlineAt = 0;

  private stepExpired(now: number): boolean {
    return this.stepDeadlineAt > 0 && now >= this.stepDeadlineAt;
  }

  private walkToNpc(propId: string, mapId: string, nextStep: DailyStep): void {
    const prop = this.client.getProp(mapId, propId);
    if (!prop) { this.fail('TARGET_INVALID'); return; }
    this.beginWalk({
      targetMapId: mapId,
      target: { x: prop.x, y: prop.y + 40 },
      arrivalRadius: 16,
      abortOnHurt: this.abortOnHurt,
      maxHurt: this.maxHurt,
      requester: 'daily',
    }, nextStep);
  }

  private walkToTree(): void {
    const prop = this.client.getProp('duoc_vien', TREE_SEED);
    if (!prop) { this.fail('TARGET_INVALID'); return; }
    const state = this.client.readDailyState();
    if ((state.activeCollected ?? 0) >= REQUIRED_BRANCHES) {
      this.setStep('seed_walk_complete');
      return;
    }
    this.beginWalk({
      targetMapId: 'duoc_vien',
      target: { x: prop.x, y: prop.y - TREE_TILE_SIZE / 2 },
      arrivalRadius: 10,
      abortOnHurt: this.abortOnHurt,
      maxHurt: this.maxHurt,
      requester: 'daily',
    }, 'seed_chop');
  }

  private walkToDrop(): void {
    const drop = this.findGroundDrop();
    if (!drop) { this.pendingDrop = null; this.setStep('seed_walk_tree'); return; }
    this.pendingDrop = drop;
    this.armCollectAck();
    this.beginWalk({
      target: { x: drop.x, y: drop.y },
      arrivalRadius: 18,
      abortOnHurt: this.abortOnHurt,
      maxHurt: this.maxHurt,
      requester: 'daily',
    }, 'seed_collect');
  }

  private beginWalk(request: WalkRequest, nextStep: DailyStep): void {
    if (this.pendingWalk) return;
    const now = this.client.nowMs();
    try {
      const walk = this.client.walkTo(request);
      if (!walk || !walk.operationId) { this.fail('WALK_FAILED'); return; }
      this.pendingWalk = { operationId: walk.operationId, step: nextStep, deadlineAt: now + STEP_TIMEOUT_MS };
      this.stepDeadlineAt = this.pendingWalk.deadlineAt;
      this.operation!.updatedAt = now;
      this.client.recordLog({ code: 'daily_step', detail: `walk=${nextStep}`, at: now });
    } catch (error) {
      this.fail(error instanceof DailyError ? error.code : 'WALK_FAILED');
    }
  }

  private pollWalk(now: number): void {
    const pending = this.pendingWalk;
    const operation = this.operation;
    if (!pending || !operation) return;
    const walk = this.client.getWalkOperation();
    if (!walk || walk.operationId !== pending.operationId) {
      if (now >= pending.deadlineAt) this.fail('WALK_LOST');
      return;
    }
    if (walk.status === 'arrived') {
      this.pendingWalk = null;
      if (this.pendingCollectAck && this.pendingCollectAck.deadlineAt === 0) this.pendingCollectAck.deadlineAt = now + ACK_TIMEOUT_MS;
      this.setStep(pending.step);
      return;
    }
    if (walk.status === 'failed' || walk.status === 'blocked' || walk.status === 'cancelled') {
      this.pendingWalk = null;
      this.fail(`WALK_${walk.reason ?? walk.status}`);
      return;
    }
    if (now >= pending.deadlineAt) {
      this.pendingWalk = null;
      this.fail('STEP_TIMEOUT');
    }
  }

  private beginAck(command: string, step: DailyStep, issue: () => Promise<DailyAck>): void {
    if (this.pendingAck) return;
    const now = this.client.nowMs();
    this.pendingAck = { command, step, deadlineAt: now + ACK_TIMEOUT_MS, result: null };
    this.stepDeadlineAt = now + ACK_TIMEOUT_MS + 250;
    issue().then((ack) => {
      if (this.pendingAck?.command === command && this.pendingAck.step === step) this.pendingAck.result = ack;
    }, () => {
      if (this.pendingAck?.command === command && this.pendingAck.step === step) this.pendingAck.result = { cmd: command, ok: false, why: 'COMMAND_FAILED' };
    });
  }

  private handleAck(command: string, _step: DailyStep, ack: DailyAck): void {
    if (!ack.ok) {
      this.fail('ACK_REFUSED', ack.why ?? ack.toast ?? 'server_refused');
      return;
    }
    if (command === 'diemdanh') {
      this.earnedStones += ack.stones ?? 10;
      this.finishDone();
    } else if (command === 'seed.start') {
      this.chopAttempts = 0;
      this.setStep('seed_walk_tree');
    } else if (command === 'seed.collect') {
      this.setStep('seed_collect_wait');
    } else if (command === 'seed.complete') {
      this.earnedStones += ack.stones ?? 20;
      this.earnedDuocCong += ack.duocCong ?? 3;
      if (this.operation && this.operation.runIndex < this.operation.runsTotal) {
        this.setStep('seed_wait_reset');
      } else {
        this.finishDone();
      }
    } else {
      this.fail('UNKNOWN_ACK_COMMAND');
    }
  }

  private beginChop(): void {
    const prop = this.client.getProp('duoc_vien', TREE_SEED);
    if (!prop) { this.fail('TARGET_INVALID'); return; }
    if (this.chopAttempts >= MAX_CHOP_ATTEMPTS) { this.fail('CHOP_NO_DROP'); return; }
    if (!this.client.startChopping(prop)) { this.fail('CHOP_UNAVAILABLE'); return; }
    this.chopAttempts += 1;
    this.chopStartedAt = this.client.nowMs();
    this.setStep('seed_wait_drop');
  }

  private waitForDrop(now: number): void {
    const state = this.client.readDailyState();
    if ((state.activeCollected ?? 0) >= REQUIRED_BRANCHES) { this.setStep('seed_walk_complete'); return; }
    if (this.findGroundDrop()) { this.setStep('seed_walk_drop'); return; }
    if (this.chopStartedAt > 0 && now - this.chopStartedAt >= CHOP_WAIT_MS) {
      if (this.chopAttempts >= MAX_CHOP_ATTEMPTS) this.fail('CHOP_NO_DROP');
      else this.setStep('seed_walk_tree');
    }
  }

  private armCollectAck(): void {
    if (this.pendingCollectAck) return;
    const state = this.client.readDailyState();
    this.collectedBefore = state.activeCollected ?? 0;
    const pending = { deadlineAt: 0, result: null as DailyAck | null };
    this.pendingCollectAck = pending;
    this.client.watchCommand('seed.collect').then((ack) => {
      if (this.pendingCollectAck === pending) pending.result = ack;
    }, () => {
      if (this.pendingCollectAck === pending) pending.result = { cmd: 'seed.collect', ok: false, why: 'COMMAND_FAILED' };
    });
  }

  private prepareCollectWait(): void {
    if (!this.pendingCollectAck) { this.fail('COLLECT_ACK_NOT_ARMED'); return; }
    if (this.pendingCollectAck.result) return;
    this.stepDeadlineAt = this.client.nowMs() + ACK_TIMEOUT_MS;
    this.setStep('seed_collect_wait');
    this.stepDeadlineAt = this.client.nowMs() + ACK_TIMEOUT_MS;
  }

  private waitForCollected(now: number): void {
    const state = this.client.readDailyState();
    const collected = state.activeCollected ?? 0;
    if (collected > this.collectedBefore) {
      this.pendingDrop = null;
      this.pendingCollectAck = null;
      this.chopAttempts = 0;
      if (collected >= REQUIRED_BRANCHES) this.setStep('seed_walk_complete');
      else this.setStep('seed_walk_tree');
      return;
    }
    if (now >= this.stepDeadlineAt) this.fail('COLLECT_STATE_TIMEOUT');
  }

  private waitForReset(now: number): void {
    const state = this.client.readDailyState();
    if (state.activeSeedTask !== SUPPORTED_TASK || (state.activeCollected ?? 0) === 0) {
      if (this.operation) this.operation.runIndex += 1;
      this.chopAttempts = 0;
      this.setStep('seed_walk_npc');
      return;
    }
    if (now >= this.stepDeadlineAt) this.fail('STATE_SYNC_TIMEOUT');
  }

  private findGroundDrop(): DailyDrop | null {
    const state = this.client.readDailyState();
    return state.drops.find((drop) => drop.task === SUPPORTED_TASK
      && drop.state === 'ground' && typeof drop.materialId === 'string'
      && finite(drop.x) && finite(drop.y)) ?? null;
  }

  private finishDone(): void {
    if (!this.operation) return;
    const state = this.client.readDailyState();
    const stones = this.baselineStones !== null && state.stones !== null
      ? Math.max(this.earnedStones, state.stones - this.baselineStones) : this.earnedStones;
    const duocCong = this.baselineDuocCong !== null && state.duocCong !== null
      ? Math.max(this.earnedDuocCong, state.duocCong - this.baselineDuocCong) : this.earnedDuocCong;
    const now = this.client.nowMs();
    this.operation.status = 'done';
    this.operation.step = 'done';
    this.operation.rewards = { stones, duocCong };
    this.operation.updatedAt = now;
    this.pendingAck = null;
    this.pendingWalk = null;
    this.pendingCollectAck = null;
    this.client.recordLog({ code: 'daily_done', detail: `${this.operation.kind} stones=${stones} duoc=${duocCong}`, at: now });
  }

  private fail(reason: string, why?: string): void {
    if (!this.operation || !active(this.operation.status)) return;
    const now = this.client.nowMs();
    this.operation.status = 'failed';
    this.operation.step = 'failed';
    this.operation.reason = reason;
    if (why) this.operation.why = why;
    this.operation.updatedAt = now;
    this.pendingWalk = null;
    if (this.pendingCollectAck) this.client.cancelPendingCommand?.('seed.collect');
    this.pendingAck = null;
    this.pendingCollectAck = null;
    this.client.recordLog({ code: 'daily_failed', reasonCode: reason, detail: why ?? formatProgress(this.client.readDailyState(), reason), at: now });
  }
}
