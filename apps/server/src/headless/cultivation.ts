export type CultivationKind = 'brew' | 'meditate' | 'breakthrough';
export type CultivationStatus = 'running' | 'done' | 'failed' | 'cancelled';
export interface CultivationOperation {
  id: string; kind: CultivationKind; status: CultivationStatus; progress: { current: number; total: number };
  results: Array<{ target: string; ok: boolean; result?: string }>; error?: string; errorReason?: string;
  startedAt: number; updatedAt: number;
}
export interface CultivationRecipe { id: string; name: string; open: boolean; recipe: Array<{ id: string; qty: number }>; canFail?: boolean }
export interface CultivationState {
  inGame: boolean; connected: boolean; down: boolean; auto: boolean; mapId: string | null;
  activeOtherOperation: boolean;
  position: { x: number; y: number } | null; hurtCount: number; realmId: string | null;
  stonePosition?: { x: number; y: number } | null;
  furnacePosition?: { x: number; y: number } | null; furnaceMapId?: string | null;
  exp: number | null; expMax: number | null; questStage: number | null; nextGateReady: boolean | null;
  gateFrom: string | null; gateTo: string | null; gateItemId: string | null; gateItemQty: number | null;
  recipes: CultivationRecipe[]; permanentWater: boolean | null; plots: Array<{ id: string; state: string; watered: boolean | null; remainSec: number | null; position: { x: number; y: number } | null }>;
}
export interface CultivationClient {
  now(): number; read(): CultivationState; count(itemId: string): number | null;
  issue(command: string, args: Record<string, unknown>): Promise<{ ok: boolean; why?: string; success?: boolean; itemId?: string }>;
  walk(point: { x: number; y: number }, radius: number, mapId: string): Promise<void>;
  wait(ms: number): Promise<void>; record(code: string, detail?: string): void;
  ackTimeoutMs: number; commandDelayMs: number; meditateMaxMs: number;
}
export class CultivationError extends Error { constructor(public readonly code: string, public readonly reason?: string) { super(code); this.name = 'CultivationError'; } }
const active = (op: CultivationOperation | null) => op?.status === 'running';
const copy = (op: CultivationOperation | null): CultivationOperation | null => op ? { ...op, progress: { ...op.progress }, results: op.results.map((r) => ({ ...r })) } : null;
let sequence = 0;
export const STONE_POSITION = { x: 22 * 32 + 16, y: 18 * 32 + 16 };
export const STONE_RADIUS = 26; // client meditate_stone r=34 px, 8 px margin
export const FURNACE_RADIUS = 36; // client cauldron r=46 px, 10 px margin

/** One sequential, cancellable manual operation per runner. Game commands are never retried. */
export class CultivationOperations {
  private operation: CultivationOperation | null = null;
  private cancelled = false;
  private meditationStarted = false;
  private baselineHurt = 0;
  constructor(private readonly client: CultivationClient) {}
  getOperation() { return copy(this.operation); }
  hurtBaseline() { return this.baselineHurt; }
  cancel(id?: string) {
    if (!active(this.operation) || (id && id !== this.operation!.id)) throw new CultivationError('OPERATION_NOT_FOUND');
    this.cancelled = true; this.operation!.status = 'cancelled'; this.operation!.error = 'CANCELLED'; this.operation!.updatedAt = this.client.now();
    if (this.operation!.kind === 'meditate' && this.meditationStarted) {
      this.meditationStarted = false;
      void this.client.issue('meditate', { on: 0 }).catch(() => undefined);
    }
    return this.getOperation()!;
  }
  private validate() {
    const s = this.client.read();
    if (!s.inGame || !s.connected) throw new CultivationError('NOT_IN_GAME');
    if (s.down) throw new CultivationError('CHARACTER_DOWN');
    if (s.auto) throw new CultivationError('AUTO_ACTIVE');
    if (s.activeOtherOperation) throw new CultivationError('OPERATION_IN_PROGRESS');
    if (active(this.operation)) throw new CultivationError('OPERATION_IN_PROGRESS');
    return s;
  }
  private begin(kind: CultivationKind, total: number) {
    const s = this.validate(); this.cancelled = false; this.baselineHurt = s.hurtCount;
    const now = this.client.now(); this.operation = { id: `cultivation-${now}-${++sequence}`, kind, status: 'running', progress: { current: 0, total }, results: [], startedAt: now, updatedAt: now };
  }
  private checkpoint() {
    const s = this.client.read();
    if (this.cancelled) throw new CultivationError('CANCELLED');
    if (!s.connected || !s.inGame) throw new CultivationError('RECONNECTED');
    if (s.down) throw new CultivationError('CHARACTER_DOWN');
    if (s.auto) throw new CultivationError('AUTO_ACTIVE');
    if (s.hurtCount > this.baselineHurt) throw new CultivationError('HURT');
    return s;
  }
  private async send(command: string, args: Record<string, unknown>) {
    this.checkpoint(); const ack = await this.client.issue(command, args);
    if (!ack.ok) throw new CultivationError(ack.why || 'COMMAND_REFUSED');
    return ack;
  }
  private async approach(point: { x: number; y: number }, radius: number, mapId: string) {
    const s = this.checkpoint();
    if (s.mapId === mapId && s.position && Math.hypot(s.position.x - point.x, s.position.y - point.y) <= radius) return;
    try { await this.client.walk(point, radius, mapId); } catch (e) { throw new CultivationError('WALK_FAILED', e instanceof Error ? e.message : String(e)); }
    this.checkpoint();
  }
  private async until(predicate: () => boolean, error = 'COUNT_MISMATCH', timeout = this.client.ackTimeoutMs) {
    const deadline = this.client.now() + timeout;
    while (this.client.now() < deadline) { this.checkpoint(); if (predicate()) return; await this.client.wait(50); }
    throw new CultivationError(error);
  }
  private async run(body: () => Promise<void>) {
    try { await body(); if (this.operation?.status === 'running') this.operation.status = 'done'; }
    catch (e) {
      const code = e instanceof CultivationError ? e.code : 'CULTIVATION_FAILED';
      const reason = e instanceof CultivationError ? e.reason : undefined;
      if (this.operation?.status === 'running') { this.operation.status = this.cancelled || code === 'CANCELLED' ? 'cancelled' : 'failed'; this.operation.error = this.operation.status === 'cancelled' ? 'CANCELLED' : code; if (reason) this.operation.errorReason = reason.slice(0, 160); }
    }
    if (this.operation) { this.operation.updatedAt = this.client.now(); this.client.record(`cultivation_${this.operation.kind}_${this.operation.status}`, `count=${this.operation.progress.current}`); }
  }
  brew(recipeId: string, times = 1) {
    this.validate();
    if (!Number.isInteger(times) || times < 1 || times > 10) throw new CultivationError('INVALID_COUNT');
    const recipe = this.client.read().recipes.find((r) => r.id === recipeId);
    if (!recipe) throw new CultivationError('RECIPE_INVALID');
    if (recipe.open !== true) throw new CultivationError('RECIPE_LOCKED');
    const available = recipe.recipe.map((part) => ({ ...part, have: this.client.count(part.id) }));
    if (available.some((part) => part.have === null)) throw new CultivationError('CULTIVATION_DATA_UNKNOWN');
    const possible = Math.min(times, ...available.map((part) => Math.floor(part.have! / part.qty)));
    if (possible < 1) throw new CultivationError('INSUFFICIENT_MATERIALS');
    this.begin('brew', possible);
    void this.run(async () => {
      const initial = this.client.read();
      const map = initial.mapId === 'vuon_ca_nhan' ? 'vuon_ca_nhan' : initial.mapId === 'tan_vien' ? 'tan_vien' : 'tan_vien';
      const knownFurnace = initial.mapId === map && initial.furnaceMapId === map ? initial.furnacePosition : null;
      await this.approach(knownFurnace ?? (map === 'tan_vien' ? { x: 16 * 32 + 16, y: 11 * 32 + 16 } : { x: 10 * 32 + 16, y: 9 * 32 + 16 }), FURNACE_RADIUS, map);
      for (let i = 0; i < possible; i += 1) {
        this.checkpoint();
        const before = new Map(recipe.recipe.map((p) => [p.id, this.client.count(p.id)]));
        const productBefore = this.client.count(recipeId);
        if (productBefore === null || [...before.values()].some((v) => v === null)) throw new CultivationError('CULTIVATION_DATA_UNKNOWN');
        const ack = await this.send('brew', { recipeId });
        if (ack.success === false) { this.operation!.results.push({ target: recipeId, ok: false, result: 'thất bại' }); this.operation!.progress.current += 1; continue; }
        await this.until(() => recipe.recipe.every((p) => { const now = this.client.count(p.id); return now !== null && now === before.get(p.id)! - p.qty; }) && this.client.count(recipeId) === productBefore + 1);
        this.operation!.results.push({ target: recipeId, ok: true }); this.operation!.progress.current += 1;
        if (i + 1 < possible) await this.client.wait(this.client.commandDelayMs);
      }
    });
    return this.getOperation()!;
  }
  meditate(on: boolean, untilFull = false) {
    if (!on && active(this.operation) && this.operation?.kind === 'meditate') {
      this.cancelled = true;
      void this.client.issue('meditate', { on: 0 }).then((ack) => {
        if (!ack.ok) throw new CultivationError(ack.why || 'COMMAND_REFUSED');
        this.meditationStarted = false;
        if (this.operation?.status === 'running') { this.operation.status = 'done'; this.operation.progress.current = 1; this.operation.results.push({ target: 'stand', ok: true }); this.operation.updatedAt = this.client.now(); }
      }).catch((error) => { if (this.operation?.status === 'running') { this.operation.status = 'failed'; this.operation.error = error instanceof CultivationError ? error.code : 'COMMAND_FAILED'; } });
      return this.getOperation()!;
    }
    const s = this.validate();
    if (on && (s.exp === null || s.expMax === null)) throw new CultivationError('CULTIVATION_DATA_UNKNOWN');
    if (on && s.expMax !== null && s.exp !== null && s.exp >= s.expMax) throw new CultivationError('MEDITATION_ALREADY_FULL');
    this.begin('meditate', 1);
    void this.run(async () => {
      if (on) {
        const map = s.mapId === 'vuon_ca_nhan' ? 'vuon_ca_nhan' : 'tan_vien';
        await this.approach(s.stonePosition ?? STONE_POSITION, STONE_RADIUS, map);
        const before = this.client.read().exp;
        await this.send('meditate', { on: 1 }); this.meditationStarted = true; this.operation!.results.push({ target: 'meditate', ok: true }); this.operation!.progress.current = 1;
        const deadline = this.client.now() + this.client.meditateMaxMs;
        let lastProgress = this.client.now(); let lastExp = before;
        while (this.client.now() < deadline) {
          const current = this.checkpoint();
          if (current.exp === null || current.expMax === null) throw new CultivationError('CULTIVATION_DATA_UNKNOWN');
          if (current.exp >= current.expMax) break;
          if (lastExp !== null && current.exp > lastExp) { lastExp = current.exp; lastProgress = this.client.now(); }
          if (this.client.now() - lastProgress > Math.min(60_000, this.client.ackTimeoutMs * 2)) throw new CultivationError('MEDITATE_NO_PROGRESS');
          await this.client.wait(1_000);
        }
        if (this.client.now() >= deadline && this.client.read().exp !== null && this.client.read().exp! < (this.client.read().expMax ?? 0)) throw new CultivationError('MEDITATE_TIMEOUT');
        // Manual meditate remains active until the dashboard sends on:false or cancels it.
        if (!untilFull && this.client.read().exp !== null && this.client.read().exp! < (this.client.read().expMax ?? 0)) {
          while (this.client.now() < deadline) { this.checkpoint(); await this.client.wait(1_000); }
          throw new CultivationError('MEDITATE_TIMEOUT');
        }
      } else {
        await this.send('meditate', { on: 0 }); this.operation!.results.push({ target: 'stand', ok: true }); this.operation!.progress.current = 1;
      }
    }).finally(async () => {
      // Always release the local sit state, including cap, hurt, cancellation, timeout and failures.
      if (on && this.meditationStarted) { try { if (this.client.read().connected && this.client.read().inGame) await this.client.issue('meditate', { on: 0 }); } catch { /* state is already terminal */ } finally { this.meditationStarted = false; } }
    });
    return this.getOperation()!;
  }
  breakthrough(useBaoMenh = false) {
    const s = this.validate();
    if (s.nextGateReady !== true) throw new CultivationError('BREAKTHROUGH_NOT_READY');
    if (!s.gateFrom || !s.gateTo) throw new CultivationError('CULTIVATION_DATA_UNKNOWN');
    if (useBaoMenh && !s.gateTo.startsWith('truc_co')) throw new CultivationError('BAO_MENH_NOT_APPLICABLE');
    this.begin('breakthrough', 1);
    void this.run(async () => {
      const map = s.mapId === 'vuon_ca_nhan' ? 'vuon_ca_nhan' : 'tan_vien';
      await this.approach(s.stonePosition ?? STONE_POSITION, STONE_RADIUS, map);
      const beforeRealm = this.client.read().realmId;
      const ack = await this.send('breakthrough', { useBaoMenh: !!useBaoMenh });
      if (ack.success === false) { this.operation!.results.push({ target: s.gateTo!, ok: false, result: ack.why ?? 'thất bại' }); this.operation!.progress.current = 1; return; }
      await this.until(() => this.client.read().realmId !== null && this.client.read().realmId !== beforeRealm, 'BREAKTHROUGH_STATE_TIMEOUT');
      this.operation!.results.push({ target: s.gateTo!, ok: true }); this.operation!.progress.current = 1;
    });
    return this.getOperation()!;
  }
}
