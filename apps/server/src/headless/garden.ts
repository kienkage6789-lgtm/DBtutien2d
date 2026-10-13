export type GardenPlotState = 'empty' | 'growing' | 'ready' | 'unknown';
export interface GardenPlot { id: string; index: number; state: GardenPlotState; seedId: string | null; seedName: string | null; cropId: string | null; cropName: string | null; watered: boolean | null; remainSec: number | null; readyAt: number | null }
export interface GardenSeed { seedId: string; name: string; count: number | null; growSec: number | null; wetSec: number | null; tier: string | null }
export interface GardenPack { id: string; name: string; cost: number | null; realm: string | null; unlocked: boolean | null; affordable: boolean | null; give: Array<{ itemId: string; name: string; qty: number | null }> }
export interface GardenSnapshot { known: boolean; mapId: string | null; inGarden: boolean; unlocked: boolean | null; duocCong: number | null; plots: GardenPlot[]; seeds: GardenSeed[]; packs: GardenPack[]; operation: GardenOperation | null; at: number }
export type GardenOperationKind = 'buy-pack' | 'sow' | 'harvest';
export type GardenOperationStatus = 'running' | 'done' | 'failed' | 'cancelled';
export interface GardenOperation { id: string; kind: GardenOperationKind; status: GardenOperationStatus; progress: { current: number; total: number }; results: Array<{ target: string; ok: boolean; code?: string }>; error?: string; startedAt: number; updatedAt: number }
export interface GardenClientState { inGame: boolean; mapId: string | null; inGarden: boolean; down: boolean; auto: boolean; stage: number | null; duocCong: number | null; plots: GardenPlot[]; seeds: GardenSeed[]; packs: GardenPack[]; activeOtherOperation: boolean; hurtCount: number }
export interface GardenClient {
  now(): number; read(): GardenClientState; issue(command: string, args: Record<string, unknown>): Promise<{ ok: boolean; why?: string }>;
  walk(point: { x: number; y: number }, radius: number, mapId?: string): Promise<void>; count(itemId: string): number | null; wait(ms: number): Promise<void>; record(code: string, detail?: string): void;
  ackTimeoutMs: number; commandDelayMs: number;
}
export class GardenError extends Error { public constructor(public readonly code: string) { super(code); this.name = 'GardenError'; } }

const active = (operation: GardenOperation | null): boolean => operation?.status === 'running';
const copyOp = (op: GardenOperation | null): GardenOperation | null => op ? { ...op, progress: { ...op.progress }, results: op.results.map((result) => ({ ...result })) } : null;
let sequence = 0;

/** One serialized writer per runner; every game command has one ACK wait and no retry. */
export class GardenOperations {
  private operation: GardenOperation | null = null;
  private cancelled = false;
  private baselineHurt = 0;
  public constructor(private readonly client: GardenClient) {}
  public getOperation(): GardenOperation | null { return copyOp(this.operation); }
  public hurtBaseline(): number { return this.baselineHurt; }
  public getGarden(): GardenSnapshot {
    const state = this.client.read();
    if (!state.inGame) return { known: false, mapId: null, inGarden: false, unlocked: null, duocCong: null,
      plots: Array.from({ length: 10 }, (_, i) => ({ id: `plot_${i + 1}`, index: i + 1, state: 'unknown', seedId: null, seedName: null, cropId: null, cropName: null, watered: null, remainSec: null, readyAt: null })),
      seeds: state.seeds.map((seed) => ({ ...seed, count: null })), packs: state.packs.map((pack) => ({ ...pack, unlocked: null, affordable: null, give: pack.give.map((item) => ({ ...item })) })), operation: this.getOperation(), at: this.client.now() };
    return { known: true, mapId: state.mapId, inGarden: state.inGarden, unlocked: state.stage === null ? null : state.stage >= 8,
      duocCong: state.duocCong, plots: state.plots.map((plot) => ({ ...plot })), seeds: state.seeds.map((seed) => ({ ...seed })),
      packs: state.packs.map((pack) => ({ ...pack, give: pack.give.map((item) => ({ ...item })) })), operation: this.getOperation(), at: this.client.now() };
  }
  private validate(inGarden: boolean): GardenClientState {
    const state = this.client.read();
    if (!state.inGame) throw new GardenError('NOT_IN_GAME');
    if (state.stage === null) throw new GardenError('GARDEN_DATA_UNKNOWN');
    if (state.stage < 8) throw new GardenError('GARDEN_LOCKED');
    if (state.down) throw new GardenError('CHARACTER_DOWN');
    if (state.auto) throw new GardenError('AUTO_ACTIVE');
    if (state.activeOtherOperation || active(this.operation)) throw new GardenError('OPERATION_IN_PROGRESS');
    if (inGarden && !state.inGarden) throw new GardenError('NOT_IN_GARDEN');
    return state;
  }
  private begin(kind: GardenOperationKind, total: number): GardenOperation {
    this.validate(false); this.cancelled = false; this.baselineHurt = this.client.read().hurtCount;
    const now = this.client.now();
    this.operation = { id: `garden-${now}-${++sequence}`, kind, status: 'running', progress: { current: 0, total }, results: [], startedAt: now, updatedAt: now };
    this.client.record(`garden_${kind.replace('-', '_')}_started`, `count=${total}`);
    return this.getOperation()!;
  }
  public cancel(id?: string): GardenOperation {
    if (!this.operation || !active(this.operation) || (id && id !== this.operation.id)) throw new GardenError('OPERATION_NOT_FOUND');
    this.cancelled = true; this.operation.status = 'cancelled'; this.operation.error = 'CANCELLED'; this.operation.updatedAt = this.client.now();
    return this.getOperation()!;
  }
  private checkpoint(): GardenClientState {
    const state = this.client.read();
    if (this.cancelled) throw new GardenError('CANCELLED');
    if (!state.inGame) throw new GardenError('RECONNECTED');
    if (state.down) throw new GardenError('CHARACTER_DOWN');
    if (state.auto) throw new GardenError('AUTO_ACTIVE');
    if (state.hurtCount > this.baselineHurt) throw new GardenError('HURT');
    return state;
  }
  private async send(command: string, args: Record<string, unknown>): Promise<void> {
    this.checkpoint();
    const ack = await this.client.issue(command, args);
    if (!ack.ok) throw new GardenError(ack.why || 'COMMAND_REFUSED');
    this.checkpoint();
  }
  private async waitFor(predicate: () => boolean): Promise<void> {
    const deadline = this.client.now() + this.client.ackTimeoutMs;
    while (this.client.now() < deadline) {
      this.checkpoint();
      if (predicate()) return;
      await this.client.wait(50);
    }
    throw new GardenError('GARDEN_COUNT_MISMATCH');
  }
  private async perform(action: () => Promise<void>, targets: string[]): Promise<GardenOperation> {
    try {
      for (const target of targets) {
        this.checkpoint(); await action();
        const op = this.operation!; op.progress.current += 1; op.results.push({ target, ok: true }); op.updatedAt = this.client.now();
        if (op.progress.current < op.progress.total) await this.client.wait(this.client.commandDelayMs);
      }
      this.operation!.status = 'done';
    } catch (error) {
      const code = error instanceof GardenError ? error.code : 'GARDEN_FAILED';
      const cancelled = this.cancelled || code === 'CANCELLED';
      this.operation!.status = cancelled ? 'cancelled' : 'failed'; this.operation!.error = cancelled ? 'CANCELLED' : code;
      const failedTarget = targets[this.operation!.progress.current];
      if (failedTarget) this.operation!.results.push({ target: failedTarget, ok: false, code: cancelled ? 'CANCELLED' : code });
      this.client.record(`garden_${this.operation!.kind.replace('-', '_')}_${cancelled ? 'cancelled' : 'failed'}`, `count=${this.operation!.progress.current} code=${cancelled ? 'CANCELLED' : code}`);
    }
    this.operation!.updatedAt = this.client.now();
    if (this.operation!.status === 'done') this.client.record(`garden_${this.operation!.kind.replace('-', '_')}_done`, `count=${this.operation!.progress.current}`);
    return this.getOperation()!;
  }
  public buyPack(packId: string, times = 1): GardenOperation {
    const state = this.validate(false); const pack = state.packs.find((item) => item.id === packId);
    if (!pack) throw new GardenError('PACK_INVALID');
    if (pack.unlocked !== true) throw new GardenError('PACK_LOCKED');
    if (pack.cost === null || state.duocCong === null) throw new GardenError('GARDEN_DATA_UNKNOWN');
    const count = Math.min(times, Math.floor(state.duocCong / pack.cost));
    if (count < 1) throw new GardenError('INSUFFICIENT_DUOC_CONG');
    this.begin('buy-pack', count);
    void this.perform(async () => {
      const before = this.client.read().duocCong;
      if (before === null) throw new GardenError('GARDEN_COUNT_MISMATCH');
      await this.send('seed.buyPack', { packId });
      await this.waitFor(() => { const after = this.client.read().duocCong; return after !== null && before - after === pack.cost; });
    }, Array.from({ length: count }, () => packId));
    return this.getOperation()!;
  }
  public sow(seedId: string, plotIds?: string[] | 'all-empty'): GardenOperation {
    const state = this.validate(true); const seed = state.seeds.find((item) => item.seedId === seedId);
    if (!seed || seed.count === null || seed.count < 1) throw new GardenError('NO_SEEDS');
    const chosen = plotIds === undefined || plotIds === 'all-empty' ? state.plots.filter((plot) => plot.state === 'empty')
      : plotIds.map((id) => state.plots.find((plot) => plot.id === id)).filter((plot): plot is GardenPlot => !!plot);
    if (!chosen.length) throw new GardenError('NO_EMPTY_PLOTS');
    if (chosen.some((plot) => plot.state !== 'empty')) throw new GardenError('PLOT_NOT_EMPTY');
    const targets = chosen.slice(0, seed.count).map((plot) => plot.id); this.begin('sow', targets.length);
    void this.perform(async () => {
      const plot = targets[this.operation!.progress.current]!; const before = this.client.count(seedId);
      if (before === null) throw new GardenError('GARDEN_COUNT_MISMATCH');
      await this.send('farm.sow', { plot, seed: seedId });
      await this.waitFor(() => { const after = this.client.count(seedId); return after !== null && before - after === 1; });
    }, targets);
    return this.getOperation()!;
  }
  public harvest(plotIds?: string[] | 'all-ready'): GardenOperation {
    const state = this.validate(true);
    const chosen = plotIds === undefined || plotIds === 'all-ready' ? state.plots.filter((plot) => plot.state === 'ready')
      : plotIds.map((id) => state.plots.find((plot) => plot.id === id)).filter((plot): plot is GardenPlot => !!plot);
    if (!chosen.length) throw new GardenError('NO_READY_PLOTS');
    if (chosen.some((plot) => plot.state !== 'ready')) throw new GardenError('PLOT_NOT_READY');
    const targets = chosen.map((plot) => plot.id); this.begin('harvest', targets.length);
    void this.perform(async () => {
      const plotId = targets[this.operation!.progress.current]!; const before = this.client.read().plots.find((plot) => plot.id === plotId);
      const item = before?.cropId; const countBefore = item ? this.client.count(item) : null;
      await this.send('farm.harvest', { plot: plotId });
      if (countBefore === null || !item) throw new GardenError('GARDEN_COUNT_MISMATCH');
      await this.waitFor(() => { const after = this.client.count(item); return after !== null && after === countBefore + 1; });
    }, targets);
    return this.getOperation()!;
  }
}
