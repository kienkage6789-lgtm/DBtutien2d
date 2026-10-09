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
  namLinhChi: number | null;
  fishInBag: number | null;
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
  progress?: { itemId: string; collected: number; required: number };
  startedAt: number;
  updatedAt: number;
}

export type DailyStep =
  | 'checkin_walk'
  | 'checkin_ack'
  | 'seed_walk_npc'
  | 'seed_start'
  | 'seed_walk_escort'
  | 'seed_escort_complete'
  | 'seed_walk_tree'
  | 'seed_walk_resource'
  | 'seed_harvest'
  | 'seed_wait_harvest'
  | 'seed_walk_fishing'
  | 'seed_fishing'
  | 'seed_fishing_wait'
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
  du?: boolean;
  retryAfter?: number;
  regrowAfter?: number;
  itemId?: string;
  propId?: string;
  missed?: boolean;
}

export interface DailyProp {
  id: string;
  x: number;
  y: number;
  r?: number;
  chopTask?: string;
  seedTask?: string;
  type?: string;
  hidden?: boolean;
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
  activeCollectedIds: string[];
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
  listProps?(mapId: string, type: string): DailyProp[];
  getPosition?(): { mapId: string; x: number; y: number } | null;
  startChopping(prop: DailyProp, mapId?: string): boolean;
  startFishing(propId: string): unknown;
  isFishing(): boolean;
  fishInBag(): number | null;
  getFishingApproach?(prop: DailyProp): { x: number; y: number } | null;
  stopFishing?(): void;
  invokeCheckin(): unknown;
  startSeedQuest(taskId: string): unknown;
  completeSeedQuest(): unknown;
  completeEscortSeedQuest(): unknown;
  issueCommand(command: string, action: () => unknown): Promise<DailyAck>;
  harvestResource?(propId: string): unknown;
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
const DUOC_MOC_TASK = 'duoc_moc';
const LINH_CHI_TASK = 'linh_chi';
const TRUC_GIA_TASK = 'truc_gia';
const CAU_CA_TASK = 'cau_ca';
const HO_TONG_CHAU_TASK = 'ho_tong_chau';
const SUPPORTED_TASKS = new Set([DUOC_MOC_TASK, LINH_CHI_TASK, TRUC_GIA_TASK, CAU_CA_TASK, HO_TONG_CHAU_TASK]);
const NPC_CHECKIN = 'manh_shopt1';
const NPC_SEED = 'dai_phu';
const NPC_ESCORT = 'su_phu';
const ESCORT_MAP = 'tan_vien';
const TREE_SEED = 'co_thu_linh_moc';
const BAMBOO_MAP = 'thanh_truc_lam';
const BAMBOO_PROP_TYPE = 'seed_bamboo_prop';
const TREE_TILE_SIZE = 32;
const REQUIRED_BRANCHES = 5;
const REQUIRED_LINH_CHI = 3;
const REQUIRED_BAMBOO = 4;
const REQUIRED_FISH = 3;
const FISHING_PROP = 'ho_bich_thuy_cong';
const MAX_FISHING_ATTEMPTS = 20;
const FISHING_RESULT_GRACE_MS = 6_000;
const FISHING_TOTAL_TIMEOUT_MS = 150_000;
const FISHING_APPROACH_RADIUS = 4;
const MAX_CHOP_ATTEMPTS = 3;
const ACK_TIMEOUT_MS = 5_000;
const STEP_TIMEOUT_MS = 30_000;
const CHOP_WAIT_MS = 6_000;
const TOTAL_RUN_TIMEOUT_MS = 6 * 60_000;
const ESCORT_RUN_TIMEOUT_MS = 3 * 60_000;
const RESOURCE_APPROACH_OFFSET = 30;
const RESOURCE_CLOSE_OFFSET = 12;
const RESOURCE_WAIT_CAP_MS = 15_000;
const MAX_RESOURCE_WAIT_ROUNDS = 3;

let operationSequence = 0;

const active = (status: DailyOperationStatus): boolean => ACTIVE_DAILY.has(status);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function cleanServerText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || fallback;
}

function copyOperation(operation: DailyOperation | null): DailyOperation | null {
  return operation ? {
    ...operation,
    ...(operation.rewards ? { rewards: { ...operation.rewards } } : {}),
    ...(operation.progress ? { progress: { ...operation.progress } } : {}),
  } : null;
}

function formatProgress(state: DailyClientState, target: string): string {
  const map = state.activeSeedTask ?? 'unknown';
  if (map === LINH_CHI_TASK) return `${target} map=${map} nam=${state.namLinhChi ?? 'unknown'}/${REQUIRED_LINH_CHI}`;
  if (map === TRUC_GIA_TASK) return `${target} map=${map} truc=${state.activeCollectedIds.length}/${REQUIRED_BAMBOO}`;
  if (map === CAU_CA_TASK) return `${target} map=${map} ca=${state.fishInBag ?? 'unknown'}/${REQUIRED_FISH}`;
  if (map === HO_TONG_CHAU_TASK) return `${target} map=${map} escort=1`;
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
  private pendingCollectAck: {
    deadlineAt: number;
    result: DailyAck | null;
    mode: 'drop' | 'bamboo';
    propId?: string;
    beforeCollectedIds: Set<string>;
    beforeCollected: number;
  } | null = null;
  private pendingHarvestPropId: string | null = null;
  private collectedIds = new Set<string>();
  private chopPropId: string | null = null;
  private chopMapId: string | null = null;
  private resourceTried = new Set<string>();
  private resourceCoolingUntil = new Map<string, number>();
  private resourceWaitUntil = 0;
  private resourceWaitRounds = 0;
  private resourceCloseAttempted = false;
  private fishingPropId: string | null = null;
  private fishingAttempts = 0;
  private fishingCaught = 0;
  private fishingBagBaseline: number | null = null;
  private fishingActiveRun = false;
  private fishingDeadlineAt = 0;
  private fishingCloseAttempted = false;
  private escortCloseAttempted = false;

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
      namLinhChi: state.namLinhChi,
      fishInBag: state.fishInBag,
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
    if (!task || !task.supported || !SUPPORTED_TASKS.has(taskId)) throw new DailyError('TASK_NOT_SUPPORTED');
    if (task.runsLeft === null || task.runsLeft < runs) throw new DailyError('NO_RUNS_LEFT');
    if (state.activeSeedTask !== null && state.activeSeedTask !== taskId) {
      throw new DailyError('OTHER_SEED_TASK_ACTIVE');
    }
    this.abortOnHurt = options.abortOnHurt === true;
    this.maxHurt = options.maxHurt ?? 1;
    if (!Number.isInteger(this.maxHurt) || this.maxHurt < 1 || this.maxHurt > 50) throw new DailyError('INVALID_REQUEST');
    this.createOperation('seed', taskId, runs, state);
    const continuing = state.activeSeedTask === taskId;
    const enough = taskId === LINH_CHI_TASK
      ? (state.namLinhChi ?? 0) >= REQUIRED_LINH_CHI
      : taskId === TRUC_GIA_TASK
        ? state.activeCollectedIds.length >= REQUIRED_BAMBOO
        : taskId === CAU_CA_TASK
          ? (() => {
            const fish = state.fishInBag ?? this.client.fishInBag();
            return fish !== null && fish >= REQUIRED_FISH;
          })()
          : false;
    this.setStep(continuing
      ? taskId === HO_TONG_CHAU_TASK ? 'seed_walk_escort'
        : enough ? 'seed_walk_complete'
        : taskId === LINH_CHI_TASK ? 'seed_walk_resource'
          : taskId === CAU_CA_TASK ? 'seed_walk_fishing' : 'seed_walk_tree'
      : 'seed_walk_npc');
    this.client.recordLog({ code: 'daily_started', detail: `seed=${taskId} runs=${runs}`, at: this.client.nowMs() });
    return copyOperation(this.operation)!;
  }

  public cancel(operationId: string, reason: string): boolean {
    if (!this.operation || this.operation.operationId !== operationId || !active(this.operation.status)) return false;
    const now = this.client.nowMs();
    if (this.pendingAck) this.client.cancelPendingCommand?.(this.pendingAck.command);
    if (this.pendingWalk) this.client.cancelWalk?.(this.pendingWalk.operationId, reason);
    if (this.pendingCollectAck) this.client.cancelPendingCommand?.('seed.collect');
    if (this.pendingHarvestPropId) this.client.cancelPendingCommand?.('resource.harvest');
    if (this.pendingAck?.command === 'fishing.catch') this.client.cancelPendingCommand?.('fishing.catch');
    this.client.stopFishing?.();
    // Keep the server-side seed active for an explicit later continuation;
    // cancellation stops local movement/waiters but never sends seed.cancel automatically.
    this.pendingAck = null;
    this.pendingWalk = null;
    this.pendingCollectAck = null;
    this.pendingHarvestPropId = null;
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
    if (this.pendingCollectAck?.mode === 'bamboo') {
      const pending = this.pendingCollectAck;
      if (pending.result) {
        this.pendingCollectAck = null;
        if (!pending.result.ok) {
          this.retryBambooChop(`ack=${cleanServerText(pending.result.why ?? pending.result.toast, 'server_refused')}`);
        } else {
          this.finishBambooChop(pending.propId ?? this.chopPropId ?? 'unknown', now);
        }
        return;
      }
      if (this.bambooChopProgressed(pending)) {
        this.pendingCollectAck = null;
        this.client.cancelPendingCommand?.('seed.collect');
        this.finishBambooChop(pending.propId ?? this.chopPropId ?? 'unknown', now);
        return;
      }
      if (pending.deadlineAt > 0 && now >= pending.deadlineAt) {
        this.pendingCollectAck = null;
        this.client.cancelPendingCommand?.('seed.collect');
        this.retryBambooChop('progress_timeout');
      }
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
      case 'seed_start': this.beginAck('seed.start', 'seed_start', () => this.client.issueCommand('seed.start', () => this.client.startSeedQuest(this.operation?.taskId ?? ''))); break;
      case 'seed_walk_escort': this.walkToNpc(NPC_ESCORT, ESCORT_MAP, 'seed_escort_complete'); break;
      case 'seed_escort_complete': this.beginAck('seed.escortComplete', 'seed_escort_complete', () => this.client.issueCommand('seed.escortComplete', () => this.client.completeEscortSeedQuest())); break;
      case 'seed_walk_tree': this.walkToTree(); break;
      case 'seed_walk_resource': this.walkToResource(); break;
      case 'seed_walk_fishing': this.walkToFishing(); break;
      case 'seed_fishing': this.beginFishing(); break;
      case 'seed_fishing_wait': break;
      case 'seed_harvest': this.beginHarvest(); break;
      case 'seed_wait_harvest': this.waitForHarvest(now); break;
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
    this.pendingHarvestPropId = null;
    this.resourceTried.clear();
    this.resourceCoolingUntil.clear();
    this.resourceWaitUntil = 0;
    this.resourceWaitRounds = 0;
    this.resourceCloseAttempted = false;
    this.fishingPropId = null;
    this.fishingAttempts = 0;
    this.fishingCaught = 0;
    this.fishingBagBaseline = this.readFishCount(state);
    this.fishingActiveRun = false;
    this.fishingDeadlineAt = 0;
    this.fishingCloseAttempted = false;
    this.escortCloseAttempted = false;
    this.pendingDrop = null;
    this.chopStartedAt = 0;
    this.chopAttempts = 0;
    this.collectedIds = new Set(state.activeCollectedIds);
    this.chopPropId = null;
    this.chopMapId = null;
    this.collectedBefore = state.activeCollected ?? 0;
    this.baselineStones = state.stones;
    this.baselineDuocCong = state.duocCong;
    this.earnedStones = 0;
    this.earnedDuocCong = 0;
    this.hurtAtStart = this.client.getHurtCount();
    const perRunTimeout = taskId === HO_TONG_CHAU_TASK ? ESCORT_RUN_TIMEOUT_MS : TOTAL_RUN_TIMEOUT_MS;
    this.totalDeadlineAt = now + perRunTimeout * runs;
    this.updateProgress(state);
  }

  private setStep(step: DailyStep): void {
    if (!this.operation) return;
    const now = this.client.nowMs();
    this.operation.step = step;
    this.operation.updatedAt = now;
    this.updateProgress(this.client.readDailyState());
    if (step !== 'done' && step !== 'failed' && step !== 'cancelled') this.stepDeadlineAt = now + STEP_TIMEOUT_MS;
    this.client.recordLog({ code: 'daily_step', detail: `${step} run=${this.operation.runIndex}/${this.operation.runsTotal}`, at: now });
  }

  private stepDeadlineAt = 0;

  private stepExpired(now: number): boolean {
    return this.stepDeadlineAt > 0 && now >= this.stepDeadlineAt;
  }

  /**
   * `walkTo` nhiều map chỉ đưa nhân vật tới điểm xuất hiện của map đích (không đi tiếp tới `target`), nên mọi bước "đi tới
   * NPC/cây/cây thuốc ở một map" phải đi theo map trước rồi quay lại chính bước đó để đi bộ trong map đã tải (server ép
   * đứng cạnh NPC/tài nguyên; vị trí cây Linh Chi cũng chỉ đúng trên map đã tải). Trả true khi đã bắt đầu đi theo map.
   */
  private beginWalkToMapIfNeeded(mapId: string): boolean {
    const where = this.client.getPosition?.();
    if (!where || where.mapId === mapId) return false;
    this.client.recordLog({ code: 'daily_step', detail: `walk_to_map=${mapId} from=${where.mapId}`, at: this.client.nowMs() });
    this.beginWalk({
      targetMapId: mapId,
      abortOnHurt: this.abortOnHurt,
      maxHurt: this.maxHurt,
      requester: 'daily',
    }, (this.operation?.step ?? 'failed') as DailyStep);
    return true;
  }

  private walkToNpc(propId: string, mapId: string, nextStep: DailyStep): void {
    if (this.beginWalkToMapIfNeeded(mapId)) return;
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
    if (this.isTrucGia()) {
      this.walkToBamboo();
      return;
    }
    if (this.beginWalkToMapIfNeeded('duoc_vien')) return;
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

  private isLinhChi(): boolean { return this.operation?.taskId === LINH_CHI_TASK; }

  private isTrucGia(): boolean { return this.operation?.taskId === TRUC_GIA_TASK; }

  private isCauCa(): boolean { return this.operation?.taskId === CAU_CA_TASK; }

  private isHoTongChau(): boolean { return this.operation?.taskId === HO_TONG_CHAU_TASK; }

  private readFishCount(state: DailyClientState = this.client.readDailyState()): number | null {
    const direct = this.client.fishInBag();
    const value = direct ?? state.fishInBag;
    return finite(value) ? Math.max(0, Math.floor(value)) : null;
  }

  private currentFishCount(): number | null {
    const observed = this.readFishCount();
    if (!this.fishingActiveRun || this.fishingBagBaseline === null) return observed;
    const minimum = this.fishingBagBaseline + this.fishingCaught;
    return observed === null ? minimum : Math.max(observed, minimum);
  }

  private currentBambooCount(state: DailyClientState = this.client.readDailyState()): number {
    for (const id of state.activeCollectedIds) this.collectedIds.add(id);
    return this.collectedIds.size;
  }

  private walkToBamboo(): void {
    if (!this.isTrucGia()) { this.fail('INVALID_STEP'); return; }
    const state = this.client.readDailyState();
    const collected = this.currentBambooCount(state);
    if (collected >= REQUIRED_BAMBOO) {
      this.setStep('seed_walk_complete');
      return;
    }
    if (this.beginWalkToMapIfNeeded(BAMBOO_MAP)) return;
    const now = this.client.nowMs();
    const props = (this.client.listProps?.(BAMBOO_MAP, BAMBOO_PROP_TYPE) ?? [])
      .filter((prop) => prop.type === BAMBOO_PROP_TYPE
        && prop.seedTask === TRUC_GIA_TASK
        && prop.hidden !== true
        && finite(prop.x) && finite(prop.y)
        && !this.collectedIds.has(prop.id));
    if (props.length === 0) { this.fail('NO_HARVESTABLE_PROP'); return; }
    const position = this.client.getPosition?.();
    props.sort((a, b) => {
      if (position && position.mapId === BAMBOO_MAP) {
        const da = (a.x - position.x) ** 2 + (a.y - position.y) ** 2;
        const db = (b.x - position.x) ** 2 + (b.y - position.y) ** 2;
        if (da !== db) return da - db;
      }
      return a.id.localeCompare(b.id);
    });
    const prop = props.find((candidate) => candidate.id === this.chopPropId) ?? props[0];
    this.chopPropId = prop.id;
    this.chopMapId = BAMBOO_MAP;
    this.beginWalk({
      targetMapId: BAMBOO_MAP,
      target: { x: prop.x, y: prop.y + 16 },
      arrivalRadius: 10,
      abortOnHurt: this.abortOnHurt,
      maxHurt: this.maxHurt,
      requester: 'daily',
    }, 'seed_chop');
    this.client.recordLog({ code: 'daily_step', detail: `bamboo_prop=${prop.id} collected=${collected}/${REQUIRED_BAMBOO}`, at: now });
  }

  private currentLinhChi(): number | null { return this.client.readDailyState().namLinhChi; }

  private walkToResource(): void {
    if (!this.isLinhChi()) { this.fail('INVALID_STEP'); return; }
    const state = this.client.readDailyState();
    if (state.namLinhChi !== null && state.namLinhChi >= REQUIRED_LINH_CHI) {
      this.setStep('seed_walk_complete');
      return;
    }
    const now = this.client.nowMs();
    if (this.resourceWaitUntil > now) return;
    // Cây Linh Chi chỉ đọc được từ map đã tải: chưa ở tan_vien thì đi tới đó trước (đi theo map, tới điểm xuất hiện
    // sau cổng), rồi quay lại bước này để chọn cây từ dữ liệu đã tải của ngày hôm nay.
    if (this.beginWalkToMapIfNeeded('tan_vien')) return;
    const props = (this.client.listProps?.('tan_vien', 'ling_chi_prop') ?? [])
      .filter((prop) => prop.type === undefined || prop.type === 'ling_chi_prop')
      .filter((prop) => prop.hidden !== true && finite(prop.x) && finite(prop.y))
      .filter((prop) => !this.resourceTried.has(prop.id) && (this.resourceCoolingUntil.get(prop.id) ?? 0) <= now);
    if (props.length === 0) {
      this.waitForResourceRetry(now);
      return;
    }
    const position = this.client.getPosition?.();
    props.sort((a, b) => {
      if (position && position.mapId === 'tan_vien') {
        const da = (a.x - position.x) ** 2 + (a.y - position.y) ** 2;
        const db = (b.x - position.x) ** 2 + (b.y - position.y) ** 2;
        if (da !== db) return da - db;
      }
      return a.id.localeCompare(b.id);
    });
    const prop = props[0];
    this.pendingHarvestPropId = prop.id;
    this.resourceCloseAttempted = false;
    this.beginWalk({
      targetMapId: 'tan_vien',
      target: { x: prop.x, y: prop.y + RESOURCE_APPROACH_OFFSET },
      arrivalRadius: 10,
      abortOnHurt: this.abortOnHurt,
      maxHurt: this.maxHurt,
      requester: 'daily',
    }, 'seed_harvest');
  }

  private walkToFishing(): void {
    if (!this.isCauCa()) { this.fail('INVALID_STEP'); return; }
    const fish = this.currentFishCount();
    if (fish !== null && fish >= REQUIRED_FISH) {
      this.setStep('seed_walk_complete');
      return;
    }
    const now = this.client.nowMs();
    if (this.fishingDeadlineAt === 0) this.fishingDeadlineAt = now + FISHING_TOTAL_TIMEOUT_MS;
    if (now >= this.fishingDeadlineAt) { this.fail('FISHING_NO_CATCH'); return; }
    if (this.beginWalkToMapIfNeeded('duoc_vien')) return;
    const prop = this.client.getProp('duoc_vien', FISHING_PROP);
    if (!prop) { this.fail('TARGET_INVALID'); return; }
    this.fishingPropId = prop.id;
    this.beginWalk({
      targetMapId: 'duoc_vien',
      target: { x: prop.x, y: prop.y },
      arrivalRadius: this.fishingCloseAttempted ? FISHING_APPROACH_RADIUS : 12,
      abortOnHurt: this.abortOnHurt,
      maxHurt: this.maxHurt,
      requester: 'daily',
    }, 'seed_fishing');
  }

  private beginFishing(): void {
    if (!this.isCauCa()) { this.fail('INVALID_STEP'); return; }
    const fish = this.currentFishCount();
    if (fish !== null && fish >= REQUIRED_FISH) {
      this.setStep('seed_walk_complete');
      return;
    }
    const now = this.client.nowMs();
    if (this.fishingAttempts >= MAX_FISHING_ATTEMPTS || now >= this.fishingDeadlineAt) {
      this.fail('FISHING_NO_CATCH');
      return;
    }
    const propId = this.fishingPropId ?? FISHING_PROP;
    const prop = this.client.getProp('duoc_vien', propId);
    if (!prop) { this.fail('TARGET_INVALID'); return; }
    this.fishingActiveRun = true;
    const pending = { command: 'fishing.catch', step: 'seed_fishing_wait' as DailyStep, deadlineAt: now + FISHING_RESULT_GRACE_MS, result: null as DailyAck | null };
    this.pendingAck = pending;
    this.stepDeadlineAt = pending.deadlineAt;
    this.client.watchCommand('fishing.catch').then((ack) => {
      if (this.pendingAck === pending) pending.result = ack;
    }, () => {
      if (this.pendingAck === pending) pending.result = { cmd: 'fishing.catch', ok: false, why: 'COMMAND_FAILED' };
    });
    try {
      const started = this.client.isFishing() ? { started: true } : this.client.startFishing(prop.id);
      const startInfo = started && typeof started === 'object' && !Array.isArray(started) ? started as Record<string, unknown> : null;
      const isStarted = started !== false && startInfo?.started !== false;
      if (!isStarted) {
        this.client.cancelPendingCommand?.('fishing.catch');
        this.pendingAck = null;
        this.fail('FISHING_UNAVAILABLE');
        return;
      }
      if (startInfo && finite(startInfo.durationMs)) {
        pending.deadlineAt = now + Math.max(0, startInfo.durationMs) + FISHING_RESULT_GRACE_MS;
        this.stepDeadlineAt = pending.deadlineAt;
      }
      this.client.recordLog({ code: 'daily_step', detail: `fishing_start=1 attempts=${this.fishingAttempts}/${MAX_FISHING_ATTEMPTS} fish=${this.currentFishCount() ?? 'unknown'}`, at: now });
    } catch {
      this.client.cancelPendingCommand?.('fishing.catch');
      this.pendingAck = null;
      this.fail('FISHING_UNAVAILABLE');
    }
  }

  private beginHarvest(): void {
    const propId = this.pendingHarvestPropId;
    if (!this.isLinhChi() || !propId || !this.client.harvestResource) { this.fail('HARVEST_UNAVAILABLE'); return; }
    this.resourceTried.add(propId);
    this.client.recordLog({ code: 'daily_step', detail: `harvest_prop=${propId} nam=${this.currentLinhChi() ?? 'unknown'}`, at: this.client.nowMs() });
    this.beginAck('resource.harvest', 'seed_wait_harvest', () => this.client.issueCommand('resource.harvest', () => this.client.harvestResource!(propId)));
  }

  private waitForHarvest(now: number): void {
    if (this.resourceWaitUntil > now) return;
    this.resourceWaitUntil = 0;
    this.resourceTried.clear();
    this.setStep('seed_walk_resource');
  }

  private waitForResourceRetry(now: number): void {
    const props = (this.client.listProps?.('tan_vien', 'ling_chi_prop') ?? [])
      .filter((prop) => prop.hidden !== true && finite(prop.x) && finite(prop.y));
    const retryTimes = props.map((prop) => this.resourceCoolingUntil.get(prop.id) ?? 0).filter((until) => until > now);
    if (retryTimes.length === 0) {
      const hasExpiredCooling = props.some((prop) => {
        const until = this.resourceCoolingUntil.get(prop.id) ?? 0;
        return until > 0 && until <= now;
      });
      if (hasExpiredCooling && this.resourceWaitRounds < MAX_RESOURCE_WAIT_ROUNDS) {
        this.resourceTried.clear();
        this.resourceWaitRounds += 1;
        this.setStep('seed_walk_resource');
        return;
      }
      this.fail('NO_HARVESTABLE_PROP');
      return;
    }
    if (this.resourceWaitRounds >= MAX_RESOURCE_WAIT_ROUNDS) { this.fail('NO_HARVESTABLE_PROP'); return; }
    const waitMs = Math.min(RESOURCE_WAIT_CAP_MS, Math.max(250, Math.min(...retryTimes) - now));
    this.resourceWaitUntil = now + waitMs;
    this.resourceWaitRounds += 1;
    this.setStep('seed_wait_harvest');
    this.client.recordLog({ code: 'daily_step', detail: `harvest_wait=${waitMs}ms`, at: now });
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
    if (command === 'resource.harvest') {
      this.handleHarvestAck(ack);
      return;
    }
    if (command === 'fishing.catch') {
      this.handleFishingAck(ack);
      return;
    }
    if (!ack.ok && command !== 'seed.escortComplete') {
      this.fail('ACK_REFUSED', cleanServerText(ack.why ?? ack.toast, 'server_refused'));
      return;
    }
    if (command === 'diemdanh') {
      this.earnedStones += ack.stones ?? 10;
      this.finishDone();
    } else if (command === 'seed.start') {
      this.chopAttempts = 0;
      if (this.isHoTongChau()) {
        this.setStep('seed_walk_escort');
      } else if (this.isLinhChi()) {
        this.resourceTried.clear();
        this.resourceCoolingUntil.clear();
        this.resourceWaitRounds = 0;
        this.setStep((this.currentLinhChi() ?? 0) >= REQUIRED_LINH_CHI ? 'seed_walk_complete' : 'seed_walk_resource');
      } else if (this.isCauCa()) {
        this.fishingAttempts = 0;
        this.fishingCaught = 0;
        this.fishingBagBaseline = this.readFishCount();
        this.fishingActiveRun = false;
        this.fishingDeadlineAt = this.client.nowMs() + FISHING_TOTAL_TIMEOUT_MS;
        this.fishingCloseAttempted = false;
        const fish = this.currentFishCount();
        this.setStep(fish !== null && fish >= REQUIRED_FISH ? 'seed_walk_complete' : 'seed_walk_fishing');
      } else {
        this.setStep('seed_walk_tree');
      }
    } else if (command === 'seed.collect') {
      this.setStep('seed_collect_wait');
    } else if (command === 'seed.complete') {
      this.earnedStones += ack.stones ?? (this.isLinhChi() ? 10 : this.isTrucGia() ? 15 : this.isCauCa() ? 30 : 20);
      this.earnedDuocCong += ack.duocCong ?? (this.isLinhChi() || this.isTrucGia() ? 1 : this.isCauCa() ? 4 : 3);
      this.fishingActiveRun = false;
      if (this.operation && this.operation.runIndex < this.operation.runsTotal) {
        this.setStep('seed_wait_reset');
      } else {
        this.finishDone();
      }
    } else if (command === 'seed.escortComplete') {
      const why = cleanServerText(ack.why ?? ack.toast, 'server_refused');
      const position = this.client.getPosition?.();
      const prop = this.client.getProp(ESCORT_MAP, NPC_ESCORT);
      const distance = prop && position?.mapId === ESCORT_MAP
        ? Math.round(Math.hypot(position.x - prop.x, position.y - prop.y)) : 'unknown';
      this.client.recordLog({ code: 'daily_step', detail: `escort_result=${ack.ok ? 'ok' : 'refused'} map=${position?.mapId ?? 'unknown'} distance=${distance}`, at: this.client.nowMs() });
      if (!ack.ok) {
        if (!this.escortCloseAttempted && why.toLocaleLowerCase().includes('không đứng cạnh')) {
          this.escortCloseAttempted = true;
          this.setStep('seed_walk_escort');
          return;
        }
        this.fail('ACK_REFUSED', why);
        return;
      }
      this.earnedStones += ack.stones ?? 25;
      this.earnedDuocCong += ack.duocCong ?? 2;
      if (this.operation && this.operation.runIndex < this.operation.runsTotal) this.setStep('seed_wait_reset');
      else this.finishDone();
    } else {
      this.fail('UNKNOWN_ACK_COMMAND');
    }
  }

  private handleFishingAck(ack: DailyAck): void {
    const now = this.client.nowMs();
    this.fishingAttempts += 1;
    const caught = typeof ack.itemId === 'string' && ack.itemId.length > 0;
    if (caught) this.fishingCaught += 1;
    const fish = this.currentFishCount();
    const result = caught ? `caught:${cleanServerText(ack.itemId, 'item')}` : ack.missed === true ? 'missed' : 'no_item';
    const prop = this.fishingPropId ? this.client.getProp('duoc_vien', this.fishingPropId) : null;
    const position = this.client.getPosition?.();
    const distance = prop && position?.mapId === 'duoc_vien' ? Math.round(Math.hypot(position.x - prop.x, position.y - prop.y)) : 'unknown';
    this.client.stopFishing?.();
    this.client.recordLog({ code: 'daily_step', detail: `fishing_result=${result} fish=${fish ?? 'unknown'}/${REQUIRED_FISH} attempts=${this.fishingAttempts}/${MAX_FISHING_ATTEMPTS} distance=${distance}`, at: now });
    if (!ack.ok) {
      const why = cleanServerText(ack.why ?? ack.toast, 'server_refused');
      if (why.toLocaleLowerCase().includes('không đứng cạnh mặt nước') && !this.fishingCloseAttempted) {
        const water = this.fishingPropId ? this.client.getProp('duoc_vien', this.fishingPropId) : null;
        if (!water) { this.fail('TARGET_INVALID', why); return; }
        this.fishingCloseAttempted = true;
        const approach = this.client.getFishingApproach?.(water) ?? { x: water.x, y: water.y };
        this.beginWalk({
          targetMapId: 'duoc_vien',
          target: approach,
          arrivalRadius: FISHING_APPROACH_RADIUS,
          abortOnHurt: this.abortOnHurt,
          maxHurt: this.maxHurt,
          requester: 'daily',
        }, 'seed_fishing');
        return;
      }
      this.fail('ACK_REFUSED', why);
      return;
    }
    if (fish !== null && fish >= REQUIRED_FISH) {
      this.setStep('seed_walk_complete');
      return;
    }
    if (this.fishingAttempts >= MAX_FISHING_ATTEMPTS || now >= this.fishingDeadlineAt) {
      this.fail('FISHING_NO_CATCH');
      return;
    }
    this.setStep('seed_fishing');
  }

  private handleHarvestAck(ack: DailyAck): void {
    const propId = this.pendingHarvestPropId;
    const why = cleanServerText(ack.why ?? ack.toast, 'server_refused');
    if (!propId) { this.fail('HARVEST_UNAVAILABLE', why); return; }
    const now = this.client.nowMs();
    if (!ack.ok) {
      if (why.toLocaleLowerCase().includes('chưa mọc lại') && finite(ack.retryAfter)) {
        this.resourceCoolingUntil.set(propId, now + Math.min(RESOURCE_WAIT_CAP_MS, Math.max(250, ack.retryAfter * 1_000)));
        this.resourceWaitUntil = 0;
        this.resourceCloseAttempted = false;
        this.pendingHarvestPropId = null;
        this.client.recordLog({ code: 'daily_step', detail: `harvest_cooling=${propId} retry=${ack.retryAfter}s`, at: now });
        this.setStep('seed_walk_resource');
        return;
      }
      if (why.toLocaleLowerCase().includes('không đứng cạnh tài nguyên ấy') && !this.resourceCloseAttempted) {
        const prop = this.client.getProp('tan_vien', propId);
        if (prop) {
          this.resourceCloseAttempted = true;
          this.beginWalk({
            targetMapId: 'tan_vien',
            target: { x: prop.x, y: prop.y + RESOURCE_CLOSE_OFFSET },
            arrivalRadius: 8,
            abortOnHurt: this.abortOnHurt,
            maxHurt: this.maxHurt,
            requester: 'daily',
          }, 'seed_harvest');
          return;
        }
      }
      this.fail('ACK_REFUSED', why);
      return;
    }
    const collected = this.currentLinhChi();
    if (finite(ack.regrowAfter)) {
      this.resourceCoolingUntil.set(propId, now + Math.min(RESOURCE_WAIT_CAP_MS, Math.max(250, ack.regrowAfter * 1_000)));
    }
    this.pendingHarvestPropId = null;
    this.resourceCloseAttempted = false;
    this.client.recordLog({ code: 'daily_step', detail: `harvest_ok=${propId} nam=${collected ?? 'unknown'}`, at: now });
    if (ack.du === true || collected !== null && collected >= REQUIRED_LINH_CHI) {
      this.setStep('seed_walk_complete');
    } else {
      this.setStep('seed_walk_resource');
    }
  }

  private beginChop(): void {
    if (this.isTrucGia()) {
      const propId = this.chopPropId;
      const mapId = this.chopMapId ?? BAMBOO_MAP;
      const prop = propId ? this.client.getProp(mapId, propId) : null;
      if (!prop) { this.fail('TARGET_INVALID'); return; }
      if (this.chopAttempts >= MAX_CHOP_ATTEMPTS) {
        this.fail('CHOP_NO_PROGRESS', this.bambooChopDetail(prop.id));
        return;
      }
      this.armBambooCollectAck(prop.id);
      if (!this.client.startChopping(prop, mapId)) {
        this.pendingCollectAck = null;
        this.client.cancelPendingCommand?.('seed.collect');
        this.fail('CHOP_UNAVAILABLE');
        return;
      }
      this.chopAttempts += 1;
      this.chopStartedAt = this.client.nowMs();
      if (this.pendingCollectAck) this.pendingCollectAck.deadlineAt = this.chopStartedAt + CHOP_WAIT_MS;
      this.client.recordLog({ code: 'daily_step', detail: `chop_prop=${prop.id} collected=${this.currentBambooCount()}/${REQUIRED_BAMBOO} distance=${this.bambooChopDistance(prop) ?? 'unknown'}`, at: this.chopStartedAt });
      this.setStep('seed_wait_drop');
      return;
    }
    const prop = this.client.getProp('duoc_vien', TREE_SEED);
    if (!prop) { this.fail('TARGET_INVALID'); return; }
    if (this.chopAttempts >= MAX_CHOP_ATTEMPTS) { this.fail('CHOP_NO_DROP'); return; }
    if (!this.client.startChopping(prop)) { this.fail('CHOP_UNAVAILABLE'); return; }
    this.chopAttempts += 1;
    this.chopStartedAt = this.client.nowMs();
    this.setStep('seed_wait_drop');
  }

  private waitForDrop(now: number): void {
    if (this.isTrucGia()) return;
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
    const pending = {
      deadlineAt: 0,
      result: null as DailyAck | null,
      mode: 'drop' as const,
      beforeCollectedIds: new Set(this.collectedIds),
      beforeCollected: state.activeCollected ?? 0,
    };
    this.pendingCollectAck = pending;
    this.client.watchCommand('seed.collect').then((ack) => {
      if (this.pendingCollectAck === pending) pending.result = ack;
    }, () => {
      if (this.pendingCollectAck === pending) pending.result = { cmd: 'seed.collect', ok: false, why: 'COMMAND_FAILED' };
    });
  }

  private armBambooCollectAck(propId: string): void {
    if (this.pendingCollectAck) return;
    const state = this.client.readDailyState();
    this.currentBambooCount(state);
    const pending = {
      deadlineAt: 0,
      result: null as DailyAck | null,
      mode: 'bamboo' as const,
      propId,
      beforeCollectedIds: new Set(this.collectedIds),
      beforeCollected: state.activeCollected ?? 0,
    };
    this.pendingCollectAck = pending;
    this.client.watchCommand('seed.collect').then((ack) => {
      if (this.pendingCollectAck === pending) pending.result = ack;
    }, () => {
      if (this.pendingCollectAck === pending) pending.result = { cmd: 'seed.collect', ok: false, why: 'COMMAND_FAILED' };
    });
  }

  private bambooChopProgressed(pending: { beforeCollectedIds: Set<string>; beforeCollected: number }): boolean {
    const state = this.client.readDailyState();
    this.currentBambooCount(state);
    return state.activeCollectedIds.some((id) => !pending.beforeCollectedIds.has(id))
      || (state.activeCollected ?? 0) > pending.beforeCollected;
  }

  private bambooChopDistance(prop: DailyProp): number | null {
    const position = this.client.getPosition?.();
    if (!position || position.mapId !== (this.chopMapId ?? BAMBOO_MAP)) return null;
    return Math.hypot(position.x - prop.x, position.y - (prop.y - TREE_TILE_SIZE / 2));
  }

  private bambooChopDetail(propId: string): string {
    const prop = this.client.getProp(this.chopMapId ?? BAMBOO_MAP, propId);
    return `prop=${propId} collected=${this.currentBambooCount()}/${REQUIRED_BAMBOO} distance=${prop ? this.bambooChopDistance(prop) ?? 'unknown' : 'unknown'}`;
  }

  private retryBambooChop(reason: string): void {
    const propId = this.chopPropId ?? 'unknown';
    const detail = this.bambooChopDetail(propId);
    this.client.recordLog({ code: 'daily_step', detail: `chop_retry=${detail} reason=${reason}`, at: this.client.nowMs() });
    if (this.chopAttempts >= MAX_CHOP_ATTEMPTS) {
      this.fail('CHOP_NO_PROGRESS', detail);
      return;
    }
    this.setStep('seed_walk_tree');
  }

  private finishBambooChop(propId: string, now: number): void {
    if (propId !== 'unknown') this.collectedIds.add(propId);
    const collected = this.currentBambooCount();
    this.chopAttempts = 0;
    this.chopPropId = null;
    this.chopStartedAt = 0;
    this.client.recordLog({ code: 'daily_step', detail: `chop_ok=${propId} collected=${collected}/${REQUIRED_BAMBOO} distance=${this.bambooChopDetail(propId).match(/distance=([^ ]+)/)?.[1] ?? 'unknown'}`, at: now });
    if (collected >= REQUIRED_BAMBOO) this.setStep('seed_walk_complete');
    else this.setStep('seed_walk_tree');
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
    const taskId = this.operation?.taskId;
    const reset = taskId === LINH_CHI_TASK
      ? state.activeSeedTask !== LINH_CHI_TASK
      : state.activeSeedTask !== taskId
        || taskId === DUOC_MOC_TASK && (state.activeCollected ?? 0) === 0
        || taskId === TRUC_GIA_TASK && state.activeCollectedIds.length === 0 && (state.activeCollected ?? 0) === 0;
    if (reset) {
      if (this.operation) this.operation.runIndex += 1;
      this.chopAttempts = 0;
      this.pendingHarvestPropId = null;
      this.resourceTried.clear();
      this.resourceCoolingUntil.clear();
      this.resourceWaitUntil = 0;
      this.resourceWaitRounds = 0;
      this.collectedIds.clear();
      this.chopPropId = null;
      this.chopMapId = null;
      this.fishingPropId = null;
      this.fishingAttempts = 0;
      this.fishingCaught = 0;
      this.fishingBagBaseline = this.readFishCount(state);
      this.fishingActiveRun = false;
      this.fishingDeadlineAt = 0;
      this.fishingCloseAttempted = false;
      this.escortCloseAttempted = false;
      this.setStep('seed_walk_npc');
      return;
    }
    if (now >= this.stepDeadlineAt) this.fail('STATE_SYNC_TIMEOUT');
  }

  private findGroundDrop(): DailyDrop | null {
    const state = this.client.readDailyState();
    return state.drops.find((drop) => drop.task === DUOC_MOC_TASK
      && drop.state === 'ground' && typeof drop.materialId === 'string'
      && finite(drop.x) && finite(drop.y)) ?? null;
  }

  private updateProgress(state: DailyClientState): void {
    if (!this.operation) return;
    if (this.operation.taskId === TRUC_GIA_TASK) {
      const collected = this.currentBambooCount(state);
      this.operation.progress = { itemId: 'truc_tam', collected, required: REQUIRED_BAMBOO };
      return;
    }
    if (this.operation.taskId === CAU_CA_TASK) {
      const collected = this.currentFishCount();
      if (collected === null) delete this.operation.progress;
      else this.operation.progress = { itemId: 'ca', collected, required: REQUIRED_FISH };
      return;
    }
    if (this.operation.taskId !== LINH_CHI_TASK) return;
    const collected = state.namLinhChi;
    if (collected === null) {
      delete this.operation.progress;
      return;
    }
    this.operation.progress = { itemId: 'nam_linh_chi', collected, required: REQUIRED_LINH_CHI };
  }

  private finishDone(): void {
    if (!this.operation) return;
    const state = this.client.readDailyState();
    this.updateProgress(state);
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
    this.pendingHarvestPropId = null;
    this.client.stopFishing?.();
    this.fishingActiveRun = false;
    this.client.recordLog({ code: 'daily_done', detail: `${this.operation.kind} stones=${stones} duoc=${duocCong}`, at: now });
  }

  private fail(reason: string, why?: string): void {
    if (!this.operation || !active(this.operation.status)) return;
    const now = this.client.nowMs();
    this.operation.status = 'failed';
    this.operation.step = 'failed';
    this.operation.reason = reason;
    if (why) this.operation.why = cleanServerText(why, 'server_refused');
    this.operation.updatedAt = now;
    this.pendingWalk = null;
    if (this.pendingCollectAck) this.client.cancelPendingCommand?.('seed.collect');
    if (this.pendingHarvestPropId) this.client.cancelPendingCommand?.('resource.harvest');
    if (this.pendingAck?.command === 'fishing.catch') this.client.cancelPendingCommand?.('fishing.catch');
    this.client.stopFishing?.();
    this.pendingAck = null;
    this.pendingCollectAck = null;
    this.pendingHarvestPropId = null;
    this.client.recordLog({ code: 'daily_failed', reasonCode: reason, detail: why ? cleanServerText(why, reason) : formatProgress(this.client.readDailyState(), reason), at: now });
  }
}
