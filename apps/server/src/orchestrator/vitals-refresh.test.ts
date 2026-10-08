import assert from 'node:assert/strict';
import { OperationLedger } from '@tutien2d/core-client';
import {
  refreshVitals,
  resetVitalsRefreshStateForTests,
  type VitalsRefreshDependencies,
} from './vitals-refresh.js';

const baseSnapshot = {
  downed: false,
  monsters: [] as Array<{ x: number; y: number }>,
  moveToStatus: null as string | null,
  navigationPhase: 'idle',
  mapContextIsCurrent: true,
  position: { x: 246, y: 696 },
  dir: 2,
};

function makeDeps(overrides: Partial<VitalsRefreshDependencies> = {}): VitalsRefreshDependencies {
  let listener: ((packet: Record<string, unknown>) => void) | null = null;
  return {
    accountId: 'account-default',
    getSnapshot: () => ({ ...baseSnapshot }),
    isConnected: () => true,
    sendMove: async (_x, _y, _dir, _st, shouldSend) => {
      assert.equal(shouldSend(), true);
      return true;
    },
    onYou: (next) => {
      listener = next;
      return () => { listener = null; };
    },
    now: () => 1_000,
    wait: async () => {},
    ...overrides,
  };
}

resetVitalsRefreshStateForTests();

for (const [name, overrides] of [
  ['disconnected', { isConnected: () => false }],
  ['downed', { getSnapshot: () => ({ ...baseSnapshot, downed: true }) }],
  ['move-to', { getSnapshot: () => ({ ...baseSnapshot, moveToStatus: 'running' }) }],
  ['navigation', { getSnapshot: () => ({ ...baseSnapshot, navigationPhase: 'moving_to_portal' }) }],
  ['near monster', { getSnapshot: () => ({ ...baseSnapshot, monsters: [{ x: 300, y: 696 }] }) }],
  ['missing context', { getSnapshot: () => ({ ...baseSnapshot, mapContextIsCurrent: false }) }],
  ['missing position', { getSnapshot: () => ({ ...baseSnapshot, position: null }) }],
] as const) {
  const result = await refreshVitals(makeDeps({ accountId: `guard-${name}`, ...overrides }));
  assert.equal(result.status, 'skipped', `${name} must skip`);
  assert.equal(result.movesSent, 0, `${name} must not send`);
}

const ledger = new OperationLedger();
ledger.begin('attack', 'attack:test', 1_000);
const combat = await refreshVitals(makeDeps({ accountId: 'combat', operationLedger: ledger }));
assert.deepEqual(combat, { status: 'skipped', reason: 'attack_or_skill_pending', movesSent: 0 });

let sends = 0;
const firstNoAck = await refreshVitals(makeDeps({
  accountId: 'rate-limit',
  sendMove: async (_x, _y, _dir, _st, shouldSend) => {
    assert.equal(shouldSend(), true);
    sends += 1;
    return true;
  },
}));
assert.equal(firstNoAck.status, 'no_ack');
assert.equal(sends, 10, 'no_ack must not retry beyond the ten-move burst');
const rateLimited = await refreshVitals(makeDeps({ accountId: 'rate-limit' }));
assert.deepEqual(rateLimited, { status: 'skipped', reason: 'refresh_rate_limited', movesSent: 0 });

let currentListener: ((packet: Record<string, unknown>) => void) | null = null;
let earlyMoves = 0;
const early = await refreshVitals(makeDeps({
  accountId: 'early',
  onYou: (listener) => {
    currentListener = listener;
    return () => { currentListener = null; };
  },
  sendMove: async (_x, _y, _dir, _st, shouldSend) => {
    assert.equal(shouldSend(), true);
    earlyMoves += 1;
    if (earlyMoves === 4) currentListener?.({ op: 'you' });
    return true;
  },
}));
assert.equal(early.status, 'refreshed');
assert.equal(early.movesSent, 4, 'refresh must stop on the kth you');
assert.equal(currentListener, null, 'you listener must be removed after success');

let errorListener: ((packet: Record<string, unknown>) => void) | null = null;
await assert.rejects(() => refreshVitals(makeDeps({
  accountId: 'listener-error',
  onYou: (listener) => {
    errorListener = listener;
    return () => { errorListener = null; };
  },
  sendMove: async () => { throw new Error('send failed'); },
})), /send failed/);
assert.equal(errorListener, null, 'you listener must be removed on error');

let finishFirst!: () => void;
const inFlight = refreshVitals(makeDeps({
  accountId: 'lock-a',
  // Chỉ chặn lần gửi đầu để giữ khóa; các lần sau trả về ngay.
  sendMove: (() => {
    let blocked = false;
    return async () => {
      if (blocked) return true;
      blocked = true;
      return new Promise<boolean>((resolve) => { finishFirst = () => resolve(true); });
    };
  })(),
}));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const locked = await refreshVitals(makeDeps({ accountId: 'lock-a' }));
assert.deepEqual(locked, { status: 'skipped', reason: 'refresh_in_progress', movesSent: 0 });
const otherAccount = refreshVitals(makeDeps({ accountId: 'lock-b' }));
finishFirst();
assert.equal((await inFlight).status, 'no_ack');
assert.equal((await otherAccount).status, 'no_ack');
assert.deepEqual(await refreshVitals(makeDeps({ accountId: 'lock-b' })), {
  status: 'skipped', reason: 'refresh_rate_limited', movesSent: 0,
}, 'refresh rate limit must be scoped independently per account');

console.log('vitals-refresh tests passed');
