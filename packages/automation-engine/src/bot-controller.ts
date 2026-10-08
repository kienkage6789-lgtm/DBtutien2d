import { EventEmitter } from 'events';
import { TuTienClient, VITALS_ATTACK_MAX_AGE_MS, VITALS_REFRESH_MIN_INTERVAL_MS } from '@tutien2d/core-client';
import { BotActivityStatus, BotConfig, BotLogMessage, DEFAULT_BOT_CONFIG } from './types.js';
import { InventorySellerModule } from './inventory/seller.js';
import { RestockerModule } from './inventory/restocker.js';
import { FarmCaretakerModule } from './farm/farm-manager.js';
import { QuestRunnerModule } from './quest/quest-runner.js';
import {
  createTrainingState,
  stepTraining,
  TrainingAction,
  TrainingConfig,
  TrainingMachineState,
  TrainingSnapshot,
  TrainingVitalsRefreshResult,
} from './training/state-machine.js';

const normalizeTrainingMonsterType = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface TrainingMovementRequest {
  operationId: string;
  mapId: string;
  khu: number;
  x: number;
  y: number;
  arrivalRadius: number;
  shouldContinue: () => boolean;
}

export type TrainingMovementExecutor = (request: TrainingMovementRequest) => Promise<boolean>;
export type VitalsRefreshRequester = () => Promise<TrainingVitalsRefreshResult>;

export class BotController extends EventEmitter {
  public readonly client: TuTienClient;
  private config: BotConfig;
  private isRunning: boolean = false;
  private currentActivity: BotActivityStatus = 'idle';
  private tickTimer: NodeJS.Timeout | null = null;
  private tickInFlight = false;
  private runGeneration = 0;
  private trainingConfigRevision = 0;
  private trainingState: TrainingMachineState = createTrainingState('stopped');
  private trainingActionResult?: { operationId: string; ok: boolean; error?: string };
  private lastTrainingNoticeKey?: string;
  private seller: InventorySellerModule;
  private restocker: RestockerModule;
  private farm: FarmCaretakerModule;
  private quest: QuestRunnerModule;
  private mapNavigation?: (mapId: string, shouldContinue: () => boolean) => Promise<boolean>;
  private trainingMovement?: TrainingMovementExecutor;
  private vitalsRefreshRequester?: VitalsRefreshRequester;
  private lastVitalsRefreshRequestAt = 0;
  public readonly accountId: string;

  constructor(accountId: string, client: TuTienClient, config?: Partial<BotConfig>) {
    super();
    this.accountId = accountId;
    this.client = client;
    this.config = this.mergeConfig(config);

    this.seller = new InventorySellerModule(this.client, this.config.sellRules);
    this.restocker = new RestockerModule(this.client, {
      autoBuyHpMp: this.config.autoBuyHpMp,
      minHpPotion: this.config.minHpPotion,
      hpRestockItem: this.config.hpRestockItem,
      autoEatHp: this.config.autoEatHp,
      minHpPercent: this.config.minHpPercent,
    });
    this.farm = new FarmCaretakerModule(this.client, this.config.farmSeed);
    this.quest = new QuestRunnerModule(this.client);

    this.bindClientEvents();
  }

  private bindClientEvents(): void {
    this.client.on('log', (logEntry) => {
      const msg: BotLogMessage = {
        accountId: this.accountId,
        timestamp: logEntry.timestamp || Date.now(),
        level: logEntry.level || 'info',
        module: 'Client',
        message: logEntry.message,
      };
      this.emit('log', msg);
    });

    this.client.on('welcome', () => {
      if (this.isRunning) {
        this.emitLog('success', 'Bot', 'Đăng nhập vào game thành công. Kích hoạt chu kỳ tự động hóa.');
      }
    });
  }

  public getConfig(): BotConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<BotConfig>): void {
    const trainingWasEnabled = this.config.autoTraining === true;
    const trainingModeChanged = newConfig.autoTraining !== undefined && newConfig.autoTraining !== this.config.autoTraining;
    const trainingTargetChanged = (['farmMapId', 'farmKhu', 'farmX', 'farmY', 'trainingRadius', 'trainingAttackIntervalMs'] as const)
      .some(key => Object.prototype.hasOwnProperty.call(newConfig, key) && newConfig[key] !== this.config[key]);
    const trainingMonsterTypeChanged = Object.prototype.hasOwnProperty.call(newConfig, 'trainingMonsterType')
      && normalizeTrainingMonsterType(newConfig.trainingMonsterType) !== normalizeTrainingMonsterType(this.config.trainingMonsterType);
    this.config = this.mergeConfig(newConfig);
    if (trainingModeChanged || (trainingWasEnabled && (trainingTargetChanged || trainingMonsterTypeChanged))) {
      this.trainingConfigRevision++;
      this.trainingState = createTrainingState(`${this.accountId}:${this.runGeneration}:config:${this.trainingConfigRevision}`);
      this.trainingActionResult = undefined;
      this.lastTrainingNoticeKey = undefined;
    }
    if (newConfig.sellRules) this.seller.updateRules(newConfig.sellRules);
    this.restocker.updateOptions({
      autoBuyHpMp: this.config.autoBuyHpMp,
      minHpPotion: this.config.minHpPotion,
      hpRestockItem: this.config.hpRestockItem,
      autoEatHp: this.config.autoEatHp,
      minHpPercent: this.config.minHpPercent,
    });
    if (newConfig.farmSeed) this.farm.setSeed(newConfig.farmSeed);
    this.emit('configUpdated', this.config);
  }

  private mergeConfig(partial?: Partial<BotConfig>): BotConfig {
    const incoming = partial || {};
    const merged = {
      ...DEFAULT_BOT_CONFIG,
      ...incoming,
      autoDailyQuest: incoming.autoDailyQuest ?? incoming.autoDaily ?? DEFAULT_BOT_CONFIG.autoDailyQuest,
      autoCaveQuest: incoming.autoCaveQuest ?? incoming.autoCave ?? DEFAULT_BOT_CONFIG.autoCaveQuest,
      autoMainQuest: incoming.autoMainQuest ?? DEFAULT_BOT_CONFIG.autoMainQuest,
      sellRules: { ...DEFAULT_BOT_CONFIG.sellRules, ...incoming.sellRules },
      delayRangeMs: { ...DEFAULT_BOT_CONFIG.delayRangeMs, ...incoming.delayRangeMs },
    };
    const finite = (value: unknown, fallback: number, min: number, max: number): number => {
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
    };
    const minDelay = finite(merged.delayRangeMs.min, DEFAULT_BOT_CONFIG.delayRangeMs.min, 50, 60000);
    const maxDelay = finite(merged.delayRangeMs.max, DEFAULT_BOT_CONFIG.delayRangeMs.max, minDelay, 60000);

    return {
      ...merged,
      delayRangeMs: { min: minDelay, max: maxDelay },
      tickIntervalSec: finite(merged.tickIntervalSec, DEFAULT_BOT_CONFIG.tickIntervalSec, 1, 3600),
      farmKhu: finite(merged.farmKhu, DEFAULT_BOT_CONFIG.farmKhu ?? 1, 1, 999),
      autoTraining: incoming.autoTraining ?? DEFAULT_BOT_CONFIG.autoTraining ?? false,
      trainingMonsterType: normalizeTrainingMonsterType(merged.trainingMonsterType),
      trainingRadius: finite(merged.trainingRadius, DEFAULT_BOT_CONFIG.trainingRadius ?? 80, 1, 100000),
      trainingAttackIntervalMs: finite(merged.trainingAttackIntervalMs, DEFAULT_BOT_CONFIG.trainingAttackIntervalMs ?? 1000, 100, 3600000),
      farmX: merged.farmX === undefined ? undefined : finite(merged.farmX, 0, -100000, 100000),
      farmY: merged.farmY === undefined ? undefined : finite(merged.farmY, 0, -100000, 100000),
      farmMapId: String(merged.farmMapId || DEFAULT_BOT_CONFIG.farmMapId || 'tan_vien').trim(),
    };
  }

  public getActivity(): BotActivityStatus {
    return this.currentActivity;
  }

  /**
   * Inject the server-owned portal navigator. Keeping this behind a callback
   * prevents automation from bypassing map gates with a raw enter packet.
   */
  public setMapNavigation(
    navigate: (mapId: string, shouldContinue: () => boolean) => Promise<boolean>,
  ): void {
    this.mapNavigation = navigate;
  }

  /** Delegate training movement to the server's authoritative walk executor. */
  public setTrainingMovementExecutor(execute: TrainingMovementExecutor): void {
    this.trainingMovement = execute;
  }

  /** Inject the server-owned, account-scoped bounded refresh operation. */
  public setVitalsRefreshRequester(request: VitalsRefreshRequester): void {
    this.vitalsRefreshRequester = request;
  }

  public isBotRunning(): boolean {
    return this.isRunning;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const generation = ++this.runGeneration;
    this.trainingState = createTrainingState(`${this.accountId}:${generation}`);
    this.trainingActionResult = undefined;
    this.lastTrainingNoticeKey = undefined;
    this.setActivity('idle');
    this.emitLog('info', 'Bot', 'Bắt đầu phiên bot tự động...');

    if (!this.client.isConnected()) {
      this.client.connect();
    }

    this.scheduleNextTick(2000, generation);
    this.emit('started');
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.runGeneration++;
    this.trainingState = { ...this.trainingState, phase: 'STOPPED', pending: undefined, reason: 'SESSION_STOPPED' };
    this.trainingActionResult = undefined;
    this.lastTrainingNoticeKey = undefined;
    this.setActivity('idle');
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.client.disconnect();
    this.emitLog('info', 'Bot', 'Đã dừng bot.');
    this.emit('stopped');
  }

  private setActivity(activity: BotActivityStatus): void {
    if (this.currentActivity !== activity) {
      this.currentActivity = activity;
      this.emit('activityChange', activity);
    }
  }

  private scheduleNextTick(delayMs?: number, generation = this.runGeneration): void {
    if (!this.isRunning || generation !== this.runGeneration) return;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    const delay = delayMs ?? Math.max(1, this.config.tickIntervalSec * 1000);
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      void this.tick(generation);
    }, delay);
  }

  /**
   * Main automation tick
   */
  private async tick(generation = this.runGeneration): Promise<void> {
    if (!this.isRunning || generation !== this.runGeneration) return;
    if (this.tickInFlight) {
      this.scheduleNextTick(undefined, generation);
      return;
    }
    this.tickInFlight = true;

    if (!this.client.isConnected()) {
      // Waiting for connection
      this.tickInFlight = false;
      this.scheduleNextTick(3000, generation);
      return;
    }

    try {
      // Training is an exclusive controller while enabled; legacy farm and quest actions
      // must not race its movement or combat intents.
      if (this.config.autoTraining) {
        await this.runTrainingTick(generation);
        return;
      }

      // Legacy automations stay behind an explicit master switch, default off.
      if (this.config.legacyAutomationEnabled && this.config.autoEatHp) {
        this.setActivity('healing');
        await this.restocker.checkHealthAndHeal();
      }
      if (!this.isCurrentRun(generation)) return;

      if (this.config.legacyAutomationEnabled && this.config.autoDailyQuest) {
        this.setActivity('daily');
        await this.quest.performDailyCheckin();
        if (!this.isCurrentRun(generation)) return;
        await this.quest.runDailyTasks();
      }
      if (!this.isCurrentRun(generation)) return;

      if (this.config.legacyAutomationEnabled && this.config.autoMainQuest) {
        this.setActivity('questing');
        await this.quest.tryTurnInMainQuest();
      }
      if (!this.isCurrentRun(generation)) return;

      if (this.config.legacyAutomationEnabled && this.config.autoBuyHpMp) {
        this.setActivity('restocking');
        await this.restocker.checkStockAndBuy();
      }
      if (!this.isCurrentRun(generation)) return;

      // Auto farm owns its travel and farm cycle; never farm until a map snapshot confirms arrival.
      if (this.config.autoFarm) {
        const atFarm = await this.moveTowardFarm(generation);
        if (!this.isCurrentRun(generation)) return;
        if (atFarm && this.farm.canRunCycle(60000)) {
          this.setActivity('farming');
          await this.farm.executeFarmCycle(() => this.isCurrentRun(generation));
        }
      }
      if (!this.isCurrentRun(generation)) return;

      if (this.config.legacyAutomationEnabled && this.config.autoSell) {
        const threshold = this.config.sellRules.maxSlotsThreshold ?? 12;
        if (this.client.state.getTotalItemTypes() >= threshold) {
          this.setActivity('selling');
          await this.seller.executeSellPass();
        }
      }

      if (this.config.legacyAutomationEnabled && this.config.autoCaveQuest) {
        this.setActivity('cave');
        await this.quest.runCaveDungeon();
      }

      if (this.isCurrentRun(generation)) this.setActivity('idle');
    } catch (err: any) {
      if (this.isCurrentRun(generation)) {
        this.emitLog('error', 'Bot', `Lỗi trong vòng lặp bot: ${err.message}`);
        this.setActivity('error');
      }
    } finally {
      this.tickInFlight = false;
      if (this.isRunning) this.scheduleNextTick(undefined, this.runGeneration);
    }
  }

  private isCurrentRun(generation: number): boolean {
    return this.isRunning && generation === this.runGeneration;
  }

  /** Current pure policy state for future API exposure. */
  public getTrainingState(): TrainingMachineState {
    return { ...this.trainingState, pending: this.trainingState.pending ? { ...this.trainingState.pending } : undefined };
  }

  private trainingConfig(): TrainingConfig {
    return {
      enabled: this.config.autoTraining === true,
      monsterType: normalizeTrainingMonsterType(this.config.trainingMonsterType),
      mapId: this.config.farmMapId || '',
      khu: this.config.farmKhu ?? 1,
      area: { x: this.config.farmX ?? NaN, y: this.config.farmY ?? NaN, radius: this.config.trainingRadius ?? 80 },
      attackIntervalMs: this.config.trainingAttackIntervalMs ?? 1000,
      snapshotMaxAgeMs: Math.max(5000, this.config.tickIntervalSec * 3000),
      canSelectKhu: false,
      canRespawn: false,
    };
  }

  private trainingSnapshot(): TrainingSnapshot | undefined {
    const s = this.client.state;
    // Read the canonical core-client snapshot; vitals are never inferred from
    // the legacy numeric defaults on GameStateStore.
    const rawVitals = s.vitals;
    const allowedVitalStatuses = ['unknown', 'fresh', 'stale', 'invalid', 'conflict'] as const;
    const vitalStatus = rawVitals && allowedVitalStatuses.includes(rawVitals.status as typeof allowedVitalStatuses[number])
      ? rawVitals.status as TrainingSnapshot['vitalStatus'] : 'unknown';
    const hp = typeof rawVitals?.hp === 'number' && Number.isFinite(rawVitals.hp) ? rawVitals.hp : undefined;
    const maxHp = typeof rawVitals?.maxHp === 'number' && Number.isFinite(rawVitals.maxHp) ? rawVitals.maxHp : undefined;
    const validVitals = vitalStatus === 'fresh' && hp !== undefined && hp >= 0
      && (maxHp === undefined || maxHp > 0 && hp <= maxHp);
    const vitalsNow = Date.now();
    const vitalsObservedAt = typeof rawVitals?.observedAt === 'number' && Number.isFinite(rawVitals.observedAt)
      ? rawVitals.observedAt : null;
    const vitalsAgeMs = vitalsObservedAt === null ? null : Math.max(0, vitalsNow - vitalsObservedAt);
    const vitalsFresh = validVitals && vitalsObservedAt !== null
      && vitalsNow >= vitalsObservedAt && vitalsNow - vitalsObservedAt <= VITALS_ATTACK_MAX_AGE_MS;
    const mapId = s.mapKnown === true ? s.mapId : undefined;
    const khu = s.khuKnown === true ? s.khu : undefined;
    const hasPosition = s.positionKnown === true;
    return {
      // Status packets update lastUpdated too, so only world packets can establish
      // freshness for map, position, and monster data used by training.
      observedAt: s.worldUpdatedAt,
      mapId,
      khu,
      hp: validVitals ? hp : undefined,
      maxHp: validVitals ? maxHp : undefined,
      vitalsAgeMs,
      vitalsKnown: vitalsObservedAt !== null
        && typeof rawVitals?.hp === 'number' && Number.isFinite(rawVitals.hp),
      vitalObservedAt: vitalsObservedAt,
      selfPresence: s.selfPresence ? { ...s.selfPresence } : null,
      vitalStatus: validVitals ? 'fresh' : vitalStatus,
      vitalReason: typeof rawVitals?.reason === 'string' ? rawVitals.reason.slice(0, 256) : undefined,
      x: hasPosition && mapId !== undefined && khu !== undefined ? s.x : undefined,
      y: hasPosition && mapId !== undefined && khu !== undefined ? s.y : undefined,
      dead: s.downed === true || (validVitals && vitalsFresh && hp === 0 && (rawVitals?.source === 'you' || rawVitals?.source === 'hurt')),
      derivedMaxComplete: s.derivedMax.complete,
      monsters: (s.enemies ?? []).flatMap(enemy => typeof enemy.id === 'string' && Number.isFinite(enemy.x) && Number.isFinite(enemy.y)
        ? [{ id: enemy.id, name: typeof enemy.name === 'string' ? enemy.name : undefined, x: enemy.x, y: enemy.y, alive: typeof enemy.hp !== 'number' || !Number.isFinite(enemy.hp) || enemy.hp > 0 }]
        : []),
    };
  }

  private async runTrainingTick(generation: number): Promise<void> {
    const now = Date.now();
    let decision = stepTraining(this.trainingState, {
      now,
      config: this.trainingConfig(),
      snapshot: this.trainingSnapshot(),
      actionResult: this.trainingActionResult,
    });
    if ((decision.reason === 'VITALS_UNKNOWN' || decision.reason === 'VITALS_STALE')
      && this.vitalsRefreshRequester
      && now - this.lastVitalsRefreshRequestAt >= VITALS_REFRESH_MIN_INTERVAL_MS
      && this.isCurrentRun(generation)) {
      this.lastVitalsRefreshRequestAt = now;
      let refreshResult: TrainingVitalsRefreshResult;
      try {
        refreshResult = await this.vitalsRefreshRequester();
      } catch {
        // A transport/cleanup error is fail-closed for combat, but must not
        // terminate the whole training loop or cause an unbounded retry.
        refreshResult = { status: 'no_ack' };
      }
      if (!this.isCurrentRun(generation)) return;
      decision = stepTraining(decision.state, {
        now: Date.now(),
        config: this.trainingConfig(),
        snapshot: this.trainingSnapshot(),
        actionResult: this.trainingActionResult,
        vitalsRefreshResult: refreshResult,
      });
    }
    this.trainingState = decision.state;
    this.reconcileTrainingActionResult(decision.state);
    if (decision.state.phase === 'BLOCKED') {
      this.setActivity('paused');
      this.logTrainingStateChange(decision.state.phase, decision.reason ?? decision.state.reason);
      return;
    }
    if (decision.state.phase === 'STOPPED' || decision.state.phase === 'RECOVERING') {
      this.setActivity('paused');
      if (decision.state.phase === 'RECOVERING') this.logTrainingStateChange(decision.state.phase, decision.reason ?? decision.state.reason);
      else this.lastTrainingNoticeKey = undefined;
      return;
    }
    this.lastTrainingNoticeKey = undefined;
    this.setActivity('training');
    if (decision.action && this.isCurrentRun(generation)) {
      await this.executeTrainingAction(decision.action, generation, decision.state.sessionId);
    }
  }

  /** Keep transport acceptance attached to its operation until the reducer resolves it. */
  private reconcileTrainingActionResult(state: TrainingMachineState): void {
    const result = this.trainingActionResult;
    if (result && state.pending?.operationId !== result.operationId) this.trainingActionResult = undefined;
  }

  private logTrainingStateChange(phase: 'BLOCKED' | 'RECOVERING', reason?: string): void {
    const resolvedReason = reason ?? (phase === 'BLOCKED' ? 'BLOCKED' : 'RECOVERING');
    const key = `${phase}:${resolvedReason}`;
    if (key === this.lastTrainingNoticeKey) return;
    this.lastTrainingNoticeKey = key;
    this.emitLog('warn', 'Training', phase === 'BLOCKED'
      ? `Training bị chặn: ${resolvedReason}`
      : `Training đang chờ dữ liệu phục hồi: ${resolvedReason}`);
  }

  private async executeTrainingAction(action: TrainingAction, generation: number, sessionId: string): Promise<void> {
    const expectedSessionId = this.trainingState.sessionId;
    if (!this.isCurrentRun(generation) || expectedSessionId !== sessionId) return;
    let accepted = false;
    try {
      switch (action.type) {
        case 'ENTER_MAP':
          accepted = this.mapNavigation
            ? await this.mapNavigation(
              action.mapId,
              () => this.isCurrentRun(generation) && this.trainingState.sessionId === sessionId,
            )
            : false;
          break;
        case 'MOVE_TO_AREA':
          accepted = this.trainingMovement
            ? await this.trainingMovement({
              operationId: action.operationId,
              mapId: this.config.farmMapId || '',
              khu: this.config.farmKhu ?? 1,
              x: action.x,
              y: action.y,
              arrivalRadius: Math.min(16, this.config.trainingRadius ?? 80),
              shouldContinue: () => this.isCurrentRun(generation)
                && this.trainingState.sessionId === sessionId
                && this.trainingState.pending?.operationId === action.operationId,
            })
            : false;
          break;
        case 'ATTACK':
          accepted = this.isCurrentRun(generation) && this.trainingState.sessionId === sessionId && this.client.attackMob(action.targetId);
          break;
        case 'SELECT_KHU':
          // Khu selection is intentionally unsupported until its protocol is verified.
          accepted = false;
          break;
      }
    } catch (error) {
      if (!this.isCurrentRun(generation) || this.trainingState.sessionId !== expectedSessionId) return;
      this.trainingActionResult = { operationId: action.operationId, ok: false, error: error instanceof Error ? error.message : 'TRANSPORT_ERROR' };
      return;
    }
    if (!this.isCurrentRun(generation) || this.trainingState.sessionId !== expectedSessionId) return;
    // The training movement delegate resolves true only after the server executor
    // observes arrival; stepTraining still requires a newer snapshot in its own reducer.
    this.trainingActionResult = { operationId: action.operationId, ok: accepted, error: accepted ? undefined : 'TRANSPORT_REJECTED' };
  }

  private isAtConfiguredFarm(): boolean {
    const { farmMapId, farmKhu, farmX, farmY } = this.config;
    if (!farmMapId || farmX === undefined || farmY === undefined) return false;
    const state = this.client.state;
    return state.mapId === farmMapId
      && state.khu === (farmKhu ?? 1)
      && Math.hypot(farmX - state.x, farmY - state.y) <= 3;
  }

  private lastFarmMoveAt = 0;
  private lastFarmMoveKey = '';

  private async moveTowardFarm(generation: number): Promise<boolean> {
    const state = this.client.state;
    const targetMap = this.config.farmMapId || '';
    const targetKhu = this.config.farmKhu ?? 1;
    const targetX = this.config.farmX;
    const targetY = this.config.farmY;
    if (!targetMap || targetX === undefined || targetY === undefined) {
      this.emitLog('warn', 'Farm', 'Chưa cấu hình đầy đủ map và tọa độ bãi farm; tạm dừng điều hướng và không chạy farm.');
      return false;
    }
    const dx = targetX - state.x;
    const dy = targetY - state.y;
    const key = `${targetMap}:${targetKhu}:${targetX}:${targetY}`;
    if (key !== this.lastFarmMoveKey) {
      this.lastFarmMoveAt = 0;
      this.lastFarmMoveKey = key;
    }

    if (this.isAtConfiguredFarm()) return true;
    if (Date.now() - this.lastFarmMoveAt < 30000) return false;

    if (state.mapId !== targetMap) {
      this.lastFarmMoveAt = Date.now();
      if (!this.mapNavigation) {
        this.emitLog('warn', 'Farm', 'Chưa có portal navigator; không bypass cổng bằng enter(mapId).');
        return false;
      }
      const arrived = await this.mapNavigation(targetMap, () => this.isCurrentRun(generation));
      this.emitLog(arrived ? 'info' : 'warn', 'Farm', arrived
        ? `Đã tới map ${targetMap} qua tuyến portal và nhận snapshot xác nhận.`
        : `Chưa tới được map ${targetMap} qua tuyến portal.`);
      return arrived;
    }

    if (state.khu !== targetKhu) {
      this.lastFarmMoveAt = Date.now();
      this.emitLog('warn', 'Farm', `Protocol chưa xác nhận lệnh chọn khu; đang ở K${state.khu}, yêu cầu K${targetKhu}. Auto farm chờ, không tự nhận đã tới.`);
      return false;
    }

    this.lastFarmMoveKey = key;
    this.lastFarmMoveAt = Date.now();
    const sent = await this.client.sendMove(targetX, targetY, 2, 'walk', () => this.isCurrentRun(generation));
    this.emitLog(sent ? 'info' : 'warn', 'Farm', sent
      ? `Di chuyển về điểm farm (${targetX}, ${targetY}); sai lệch ${Math.round(Math.hypot(dx, dy))} đơn vị.`
      : 'Không gửi được lệnh di chuyển tới điểm farm.');
    return false;
  }

  public async triggerManualSell(): Promise<any> {
    this.emitLog('info', 'Bot', 'Thực hiện bán đồ thủ công theo yêu cầu...');
    const result = await this.seller.executeSellPass();
    return result;
  }

  public async triggerFarmPass(): Promise<void> {
    if (!this.isAtConfiguredFarm()) {
      this.emitLog('warn', 'Farm', 'Chưa xác nhận nhân vật ở đúng map/khu/tọa độ farm; bỏ qua lượt farm thủ công.');
      return;
    }
    this.emitLog('info', 'Bot', 'Chăm sóc dược điền thủ công theo yêu cầu...');
    await this.farm.executeFarmCycle();
  }

  public async triggerDailyCheckin(): Promise<boolean> {
    return await this.quest.performDailyCheckin();
  }

  private emitLog(level: 'info' | 'warn' | 'error' | 'success', module: string, message: string): void {
    const log: BotLogMessage = {
      accountId: this.accountId,
      timestamp: Date.now(),
      level,
      module,
      message,
    };
    this.emit('log', log);
  }
}
