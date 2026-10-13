import test from 'node:test';
import assert from 'node:assert/strict';
import { GardenOperations, type GardenClient, type GardenClientState } from './garden.js';

function fixture() {
  let now = 10_000; let maxInFlight = 0; let inFlight = 0; const sent: Array<{ command: string; args: Record<string, unknown> }> = [];
  const counts: Record<string, number> = { hat_a: 3, crop_a: 0 };
  let state: GardenClientState = {
    inGame: true, mapId: 'duoc_vien', inGarden: true, down: false, auto: false, stage: 8, duocCong: 20,
    plots: [{ id: 'plot_1', index: 1, state: 'empty', seedId: null, seedName: null, cropId: null, cropName: null, watered: null, remainSec: null, readyAt: null },
      { id: 'plot_2', index: 2, state: 'empty', seedId: null, seedName: null, cropId: null, cropName: null, watered: null, remainSec: null, readyAt: null },
      { id: 'plot_3', index: 3, state: 'growing', seedId: 'hat_a', seedName: 'Hạt A', cropId: 'crop_a', cropName: 'Cây A', watered: false, remainSec: 20, readyAt: 30_000 }],
    seeds: [{ seedId: 'hat_a', name: 'Hạt A', count: 3, growSec: 60, wetSec: 30, tier: 'Phàm' }],
    packs: [{ id: 'pham', name: 'Gói Phàm', cost: 2, realm: null, unlocked: true, affordable: true, give: [] }], activeOtherOperation: false, hurtCount: 0,
  };
  let failNext: string | null = null; let ignoreChanges = false;
  const client: GardenClient = {
    now: () => now, read: () => state,
    issue: async (command, args) => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); sent.push({ command, args });
      const fail = failNext; failNext = null;
      if (fail) { inFlight -= 1; return { ok: false, why: fail }; }
      if (!ignoreChanges && command === 'seed.buyPack') state = { ...state, duocCong: (state.duocCong ?? 0) - 2 };
      if (!ignoreChanges && command === 'farm.sow') { counts.hat_a -= 1; const plots = state.plots.map((p) => p.id === args.plot ? { ...p, state: 'growing' as const, seedId: 'hat_a' } : p); state = { ...state, plots, seeds: [{ ...state.seeds[0]!, count: counts.hat_a }] }; }
      if (!ignoreChanges && command === 'farm.harvest') { counts.crop_a += 1; state = { ...state, plots: state.plots.map((p) => p.id === args.plot ? { ...p, state: 'empty' as const, cropId: null } : p) }; }
      await Promise.resolve(); inFlight -= 1; return { ok: true };
    },
    walk: async () => {}, count: (id) => counts[id] ?? null, wait: async (ms) => { now += ms; }, record: () => {}, ackTimeoutMs: 300, commandDelayMs: 100,
  };
  const runner = new GardenOperations(client);
  return { runner, sent, state: () => state, setState: (next: GardenClientState) => { state = next; }, fail: (why: string) => { failNext = why; }, ignoreChanges: () => { ignoreChanges = true; }, counts, maxInFlight: () => maxInFlight, tick: () => { now += 1; } };
}

async function settle(f: ReturnType<typeof fixture>) {
  for (let i = 0; i < 100 && f.runner.getOperation()?.status === 'running'; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

test('garden buy pack caps by available points, waits per ACK and checks point delta', async () => {
  const f = fixture(); const op = f.runner.buyPack('pham', 20); assert.equal(op.progress.total, 10);
  await settle(f); assert.equal(f.runner.getOperation()?.status, 'done'); assert.equal(f.sent.length, 10); assert.equal(f.maxInFlight(), 1); assert.equal(f.state().duocCong, 0);
});

test('garden stops on refused ACK and never retries', async () => {
  const f = fixture(); f.fail('denied'); f.runner.buyPack('pham', 2); await settle(f);
  assert.equal(f.runner.getOperation()?.status, 'failed'); assert.equal(f.runner.getOperation()?.error, 'denied'); assert.equal(f.sent.length, 1);
});

test('garden ACK timeout is not retried and count mismatches stop the sequence', async () => {
  const timeout = fixture(); timeout.fail('ACK_TIMEOUT'); timeout.runner.buyPack('pham', 2); await settle(timeout);
  assert.equal(timeout.runner.getOperation()?.error, 'ACK_TIMEOUT'); assert.equal(timeout.sent.length, 1);
  const mismatch = fixture(); mismatch.ignoreChanges(); mismatch.runner.buyPack('pham', 1); await settle(mismatch);
  assert.equal(mismatch.runner.getOperation()?.error, 'GARDEN_COUNT_MISMATCH'); assert.equal(mismatch.sent.length, 1);
  const sowMismatch = fixture(); sowMismatch.ignoreChanges(); sowMismatch.runner.sow('hat_a', ['plot_1']); await settle(sowMismatch);
  assert.equal(sowMismatch.runner.getOperation()?.error, 'GARDEN_COUNT_MISMATCH'); assert.equal(sowMismatch.sent.length, 1);
  const harvestMismatch = fixture(); harvestMismatch.ignoreChanges(); harvestMismatch.setState({ ...harvestMismatch.state(), plots: [{ ...harvestMismatch.state().plots[0]!, state: 'ready', cropId: 'crop_a' }] });
  harvestMismatch.runner.harvest(['plot_1']); await settle(harvestMismatch);
  assert.equal(harvestMismatch.runner.getOperation()?.error, 'GARDEN_COUNT_MISMATCH'); assert.equal(harvestMismatch.sent.length, 1);
});

test('hurt during a sequence stops before its next command', async () => {
  const f = fixture(); f.runner.buyPack('pham', 2); f.setState({ ...f.state(), hurtCount: 1 }); await settle(f);
  assert.equal(f.runner.getOperation()?.error, 'HURT'); assert.equal(f.sent.length, 1);
});

test('garden sow targets only empty plots and respects seed count; harvest verifies one crop', async () => {
  const f = fixture(); f.runner.sow('hat_a', 'all-empty'); await settle(f);
  assert.equal(f.runner.getOperation()?.status, 'done'); assert.equal(f.sent.length, 2); assert.deepEqual(f.sent.map((x) => x.args.plot), ['plot_1', 'plot_2']);
  f.setState({ ...f.state(), plots: [{ ...f.state().plots[0]!, state: 'ready', cropId: 'crop_a' }] });
  f.runner.harvest('all-ready'); await settle(f); assert.equal(f.runner.getOperation()?.status, 'done'); assert.equal(f.counts.crop_a, 1);
  const cap = fixture(); cap.counts.hat_a = 1; cap.setState({ ...cap.state(), seeds: [{ ...cap.state().seeds[0]!, count: 1 }] });
  cap.runner.sow('hat_a', 'all-empty'); await settle(cap); assert.equal(cap.sent.length, 1); assert.equal(cap.sent[0]?.args.plot, 'plot_1');
});

test('garden refuses an unripe harvest target without sending a command', () => {
  const f = fixture(); f.setState({ ...f.state(), plots: [{ ...f.state().plots[0]!, state: 'growing' }] });
  assert.throws(() => f.runner.harvest(['plot_1']), /PLOT_NOT_READY/); assert.equal(f.sent.length, 0);
});

test('garden rejects locked, distant map, down, Auto and busy operations before sending', () => {
  for (const [state, code] of [[{ stage: 7 }, 'GARDEN_LOCKED'], [{ inGarden: false }, 'NOT_IN_GARDEN'], [{ down: true }, 'CHARACTER_DOWN'], [{ auto: true }, 'AUTO_ACTIVE'], [{ activeOtherOperation: true }, 'OPERATION_IN_PROGRESS']] as const) {
    const f = fixture(); f.setState({ ...f.state(), ...state });
    assert.throws(() => f.runner.sow('hat_a', 'all-empty'), (error: unknown) => error instanceof Error && error.message === code);
    assert.equal(f.sent.length, 0);
  }
});

test('garden JSON snapshot is detached and unknown Dược Công stays null', () => {
  const f = fixture(); f.setState({ ...f.state(), duocCong: null }); const snapshot = f.runner.getGarden();
  assert.equal(snapshot.duocCong, null); snapshot.plots[0]!.id = 'mutated'; assert.equal(f.runner.getGarden().plots[0]!.id, 'plot_1');
});
