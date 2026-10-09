import assert from 'node:assert/strict';
import test from 'node:test';
import { EntitlementWatcher } from './entitlement-watcher.js';
import type { DbUser } from '../db/database.js';

const makeUser = (id: string, expiresAt: number | null, role: DbUser['role'] = 'user', status: DbUser['status'] = 'active'): DbUser => ({
  id, username: id, email: null, role, status, expiresAt, maxBots: 3, mustChangePassword: false,
  createdAt: new Date(0).toISOString(), createdBy: null, lastLoginAt: null,
});

test('watcher stops blocked users once, leaves active/admin users, and isolates stop errors', async () => {
  let now = 1_000;
  const users = [makeUser('expired', 900), makeUser('none', null), makeUser('active', 2_000), makeUser('admin', null, 'admin'), makeUser('bad', 900)];
  const running = new Map<string, string[]>([
    ['expired', ['a1']], ['none', ['a2']], ['active', ['a3']], ['admin', ['a4']], ['bad', ['a5']],
  ]);
  const stopped: string[] = [];
  const alerts: string[] = [];
  const audits: string[] = [];
  const logs: string[] = [];
  const watcher = new EntitlementWatcher({
    now: () => now,
    getUsers: () => users,
    getRunningAccountIdsForOwner: (ownerId) => [...(running.get(ownerId) ?? [])],
    stopAccountsForOwner: async (ownerId) => {
      if (ownerId === 'bad') throw new Error('STOP_FAILED');
      const ids = running.get(ownerId) ?? [];
      stopped.push(...ids);
      running.set(ownerId, []);
      return { ok: true, accountIds: ids };
    },
    audit: (input) => audits.push(input.action),
    log: (accountId) => logs.push(accountId),
    notify: (ownerId) => alerts.push(ownerId),
  });

  await watcher.sweepNow();
  await watcher.sweepNow();
  assert.deepEqual(stopped.sort(), ['a1', 'a2']);
  assert.deepEqual(alerts.sort(), ['expired', 'none']);
  assert.equal(audits.filter((action) => action === 'entitlement_stop').length, 2);
  assert.deepEqual(logs.sort(), ['a1', 'a2']);
  assert.deepEqual(running.get('active'), ['a3']);
  assert.deepEqual(running.get('admin'), ['a4']);
  assert.deepEqual(running.get('bad'), ['a5']);

  now = 3_000;
  assert.doesNotThrow(() => { void watcher.sweepNow(); });
});

test('watcher does not overlap sweeps and stop errors do not block other users', async () => {
  let release: (() => void) | undefined;
  let calls = 0;
  const user = makeUser('expired', 0);
  const running = ['a1'];
  const watcher = new EntitlementWatcher({
    now: () => 1_000,
    getUsers: () => [user],
    getRunningAccountIdsForOwner: () => [...running],
    stopAccountsForOwner: async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      running.length = 0;
      return true;
    },
    audit: () => undefined,
    log: () => undefined,
    notify: () => undefined,
  });
  const first = watcher.sweepNow();
  const second = watcher.sweepNow();
  await Promise.resolve();
  assert.equal(calls, 1);
  release?.();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
