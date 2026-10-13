import test from 'node:test';
import assert from 'node:assert/strict';
import { CultivationError, CultivationOperations, type CultivationClient, type CultivationState } from './cultivation.js';

function fixture() {
  let now = 1_000; const commands: Array<{ command: string; args: Record<string, unknown> }> = []; const walks: Array<{ point: { x: number; y: number }; mapId?: string }> = []; const counts = new Map<string, number>([['herb', 6], ['pill', 0], ['bao_menh_phu', 0]]);
  let state: CultivationState = { inGame: true, connected: true, down: false, auto: false, activeOtherOperation: false, mapId: 'tan_vien', position: { x: 720, y: 592 }, stonePosition: { x: 720, y: 592 }, hurtCount: 0,
    realmId: 'luyen_khi_1', exp: 10, expMax: 20, questStage: 12, nextGateReady: true, gateFrom: 'luyen_khi_1', gateTo: 'luyen_khi_2', gateItemId: null, gateItemQty: null,
    recipes: [{ id: 'pill', name: 'Pill', open: true, recipe: [{ id: 'herb', qty: 2 }] }], permanentWater: false, furnaceMapId: 'tan_vien', furnacePosition: { x: 528, y: 368 }, plots: [] };
  let refusal: string | null = null; let ackSuccess: boolean | undefined; let advanceExp = false; let mutateRealm = true; let mutateBrew = true; let pauseWait = false; let releaseWait: (() => void) | null = null;
  const client: CultivationClient = {
    now: () => now, read: () => state, count: (id) => counts.has(id) ? counts.get(id)! : null,
    issue: async (command, args) => {
      commands.push({ command, args });
      const why = refusal; refusal = null; if (why) return { ok: false, why };
      if (command === 'brew' && mutateBrew && ackSuccess !== false) { const recipe = state.recipes.find((r) => r.id === args.recipeId)!; for (const part of recipe.recipe) counts.set(part.id, counts.get(part.id)! - part.qty); counts.set(String(args.recipeId), (counts.get(String(args.recipeId)) ?? 0) + 1); }
      if (command === 'breakthrough' && mutateRealm && ackSuccess !== false) state = { ...state, realmId: 'luyen_khi_2' };
      if (command === 'meditate' && args.on === 1) { /* wait drives exp to keep the clock deterministic */ }
      if (command === 'meditate' && args.on === 0) { /* stand */ }
      return { ok: true, ...(ackSuccess !== undefined ? { success: ackSuccess } : {}) };
    },
    walk: async (point, _radius, mapId) => { walks.push({ point, mapId }); state = { ...state, mapId, position: point }; },
    wait: async (ms) => { if (pauseWait) await new Promise<void>((resolve) => { releaseWait = resolve; }); now += ms; if (advanceExp && state.exp !== null) state = { ...state, exp: Math.min(state.expMax ?? state.exp + 1, state.exp + 1) }; await Promise.resolve(); },
    record: () => {}, ackTimeoutMs: 100, commandDelayMs: 1, meditateMaxMs: 5_000,
  };
  const runner = new CultivationOperations(client);
  return { runner, commands, walks, state: () => state, setState: (s: CultivationState) => { state = s; }, setRefusal: (v: string) => { refusal = v; }, setAckSuccess: (v: boolean | undefined) => { ackSuccess = v; }, setAdvanceExp: (v: boolean) => { advanceExp = v; }, setMutateRealm: (v: boolean) => { mutateRealm = v; }, setMutateBrew: (v: boolean) => { mutateBrew = v; }, holdWait: () => { pauseWait = true; }, release: () => { pauseWait = false; releaseWait?.(); releaseWait = null; }, count: (id: string) => counts.get(id) ?? null, tick: (ms = 1) => { now += ms; } };
}
async function settle(f: ReturnType<typeof fixture>) { for (let i = 0; i < 100; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); if (f.runner.getOperation()?.status !== 'running') return; } }

test('brew is serialized, caps to materials, and verifies item deltas', async () => {
  const f = fixture(); const op = f.runner.brew('pill', 10); assert.equal(op.progress.total, 3); await settle(f);
  assert.equal(f.runner.getOperation()?.status, 'done'); assert.equal(f.commands.filter((x) => x.command === 'brew').length, 3); assert.equal(f.count('herb'), 0); assert.equal(f.count('pill'), 3);
});
test('locked and short-material recipes are rejected before sending', () => {
  const f = fixture(); f.setState({ ...f.state(), recipes: [{ ...f.state().recipes[0]!, open: false }] });
  assert.throws(() => f.runner.brew('pill'), (e: unknown) => e instanceof CultivationError && e.code === 'RECIPE_LOCKED'); assert.equal(f.commands.length, 0);
  f.setState({ ...f.state(), recipes: [{ ...f.state().recipes[0]!, open: true, recipe: [{ id: 'herb', qty: 9 }] }] });
  assert.throws(() => f.runner.brew('pill'), (e: unknown) => e instanceof CultivationError && e.code === 'INSUFFICIENT_MATERIALS'); assert.equal(f.commands.length, 0);
});
test('brew stops on refused ACK and does not retry', async () => {
  const f = fixture(); f.setRefusal('server_no'); f.runner.brew('pill', 2); await settle(f);
  assert.equal(f.runner.getOperation()?.error, 'server_no'); assert.equal(f.commands.filter((x) => x.command === 'brew').length, 1);
});
test('ACK timeout is terminal and the recipe command is never retried', async () => {
  const f = fixture(); f.setRefusal('ACK_TIMEOUT'); f.runner.brew('pill', 3); await settle(f);
  assert.equal(f.runner.getOperation()?.error, 'ACK_TIMEOUT'); assert.equal(f.commands.filter((x) => x.command === 'brew').length, 1);
});
test('brew travels to tan_vien when started outside supported furnace maps', async () => {
  const f = fixture(); f.setState({ ...f.state(), mapId: 'unknown_map', furnaceMapId: null }); f.runner.brew('pill'); await settle(f);
  assert.equal(f.runner.getOperation()?.status, 'done'); assert.equal(f.walks[0]?.mapId, 'tan_vien'); assert.equal(f.commands.filter((x) => x.command === 'brew').length, 1);
});
test('cultivation keeps tan_vien or vuon_ca_nhan and defaults other maps to tan_vien', async () => {
  const garden = fixture(); garden.setState({ ...garden.state(), mapId: 'vuon_ca_nhan', position: { x: 0, y: 0 }, furnaceMapId: 'vuon_ca_nhan', furnacePosition: { x: 336, y: 304 } });
  garden.runner.brew('pill'); await settle(garden); assert.equal(garden.walks[0]?.mapId, 'vuon_ca_nhan');
  const stone = fixture(); stone.setState({ ...stone.state(), mapId: 'vuon_ca_nhan', position: { x: 0, y: 0 }, stonePosition: { x: 272, y: 240 } });
  stone.runner.breakthrough(); await settle(stone); assert.equal(stone.walks[0]?.mapId, 'vuon_ca_nhan');
  const fallback = fixture(); fallback.setState({ ...fallback.state(), mapId: 'duoc_vien', stonePosition: null });
  fallback.runner.breakthrough(); await settle(fallback); assert.equal(fallback.walks[0]?.mapId, 'tan_vien');
});
test('brew count mismatch and unknown inventory or exp stop without inventing values', async () => {
  const mismatch = fixture(); mismatch.setMutateBrew(false); mismatch.runner.brew('pill'); await settle(mismatch);
  assert.equal(mismatch.runner.getOperation()?.error, 'COUNT_MISMATCH');
  const unknownHave = fixture(); unknownHave.setState({ ...unknownHave.state(), recipes: [{ ...unknownHave.state().recipes[0]!, recipe: [{ id: 'missing', qty: 1 }] }] });
  assert.throws(() => unknownHave.runner.brew('pill'), (e: unknown) => e instanceof CultivationError && e.code === 'CULTIVATION_DATA_UNKNOWN');
  assert.equal(unknownHave.commands.length, 0);
  const unknownExp = fixture(); unknownExp.setState({ ...unknownExp.state(), exp: null });
  assert.throws(() => unknownExp.runner.meditate(true), (e: unknown) => e instanceof CultivationError && e.code === 'CULTIVATION_DATA_UNKNOWN');
  assert.equal(unknownExp.commands.length, 0);
});
test('breakthrough requires ready and sends exactly one command', async () => {
  const f = fixture(); f.setState({ ...f.state(), nextGateReady: false });
  assert.throws(() => f.runner.breakthrough(), (e: unknown) => e instanceof CultivationError && e.code === 'BREAKTHROUGH_NOT_READY'); assert.equal(f.commands.length, 0);
  f.setState({ ...f.state(), nextGateReady: true }); f.runner.breakthrough(); await settle(f);
  assert.equal(f.runner.getOperation()?.status, 'done'); assert.equal(f.commands.filter((x) => x.command === 'breakthrough').length, 1);
});
test('breakthrough timeout does not retry and server success false is a result', async () => {
  const f = fixture(); f.setMutateRealm(false); f.runner.breakthrough(); await settle(f);
  assert.equal(f.runner.getOperation()?.error, 'BREAKTHROUGH_STATE_TIMEOUT'); assert.equal(f.commands.filter((x) => x.command === 'breakthrough').length, 1);
  const failed = fixture(); failed.setAckSuccess(false); failed.runner.breakthrough(); await settle(failed);
  assert.equal(failed.runner.getOperation()?.status, 'done'); assert.equal(failed.runner.getOperation()?.results[0]?.ok, false); assert.equal(failed.commands.filter((x) => x.command === 'breakthrough').length, 1);
});
test('meditate stops at full, stands, and fails if exp does not progress', async () => {
  const full = fixture(); full.setAdvanceExp(true); full.setState({ ...full.state(), exp: 19 }); full.runner.meditate(true, true); await settle(full);
  assert.equal(full.runner.getOperation()?.status, 'done'); assert.ok(full.commands.some((x) => x.command === 'meditate' && x.args.on === 0));
  const stalled = fixture(); stalled.runner.meditate(true); await settle(stalled);
  assert.equal(stalled.runner.getOperation()?.error, 'MEDITATE_NO_PROGRESS'); assert.ok(stalled.commands.some((x) => x.command === 'meditate' && x.args.on === 0));
});
test('one account cannot start a second operation and manual meditation can be stopped', async () => {
  const f = fixture(); f.holdWait(); const op = f.runner.meditate(true); assert.throws(() => f.runner.brew('pill'), /OPERATION_IN_PROGRESS/);
  await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(f.commands.map((x) => x.args.on), [1]);
  f.runner.meditate(false); f.release(); await settle(f); assert.equal(f.runner.getOperation()?.status, 'done');
  assert.deepEqual(f.commands.filter((x) => x.command === 'meditate').map((x) => x.args.on), [1, 0]);
  assert.equal(f.runner.getOperation()?.id, op.id);
});
test('hurt, down, auto, reconnect, and cancellation stop an active meditation', async () => {
  for (const [change, code] of [
    [(s: CultivationState) => ({ ...s, hurtCount: 1 }), 'HURT'], [(s: CultivationState) => ({ ...s, down: true }), 'CHARACTER_DOWN'],
    [(s: CultivationState) => ({ ...s, auto: true }), 'AUTO_ACTIVE'], [(s: CultivationState) => ({ ...s, connected: false }), 'RECONNECTED'],
  ] as const) {
    const f = fixture(); f.setAdvanceExp(true); f.holdWait(); f.runner.meditate(true, true); await new Promise<void>((resolve) => setImmediate(resolve)); f.setState(change(f.state())); f.release(); await settle(f);
    assert.equal(f.runner.getOperation()?.error, code);
  }
  const cancelled = fixture(); const operation = cancelled.runner.meditate(true, true); cancelled.runner.cancel(operation.id); await settle(cancelled);
  assert.equal(cancelled.runner.getOperation()?.status, 'cancelled');
});
