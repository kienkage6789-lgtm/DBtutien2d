import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-shard-test-'));
process.env.DATA_DIR = testDataDir;
process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK = '1';
process.env.TUTIEN_TEST_RPC_HANG = '1';
const { redactShardStderr, ShardManager } = await import('../orchestrator/shard-manager.js');
const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../vendor/tutien2d-public-client/2026-10-06');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !condition()) await delay(25);
  assert.equal(condition(), true, 'condition should become true before timeout');
}

test('forked shards start offline runners, isolate accounts, mark crashes, and exit on parent shutdown', { timeout: 45_000 }, async (t) => {
  const exited: string[] = [];
  const manager = new ShardManager({ onExit: (accountId) => exited.push(accountId) },
    { vendorShards: 2, maxRunners: 0, rpcTimeoutMs: 1_000, stopGraceMs: 3_000,
      entryPath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/shard/shard-main.js') });
  t.after(async () => {
    await manager.shutdown(5_000).catch(() => undefined);
    delete process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK;
    delete process.env.TUTIEN_TEST_RPC_HANG;
    delete process.env.TUTIEN_TEST_STOP_HANG;
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });
  const opts = (name: string) => ({ accountName: name, credentials: { refreshToken: 'offline-fixture' },
    gameServerUrl: 'wss://fixture.invalid/game', allowedGameServerUrl: 'wss://fixture.invalid/game', vendorClientDir: fixtureDir,
    reconnectMaxRetries: 0, loginTimeoutMs: 3_000, loopIntervalMs: 20 });
  const first = manager.factory(opts('fixture-one'), { accountId: 'fixture-one' });
  const second = manager.factory(opts('fixture-two'), { accountId: 'fixture-two' });
  const internals = manager as unknown as { shards: Map<string, { id: string; child: import('node:child_process').ChildProcess; accounts: Set<string> }> };
  await first.start(); await second.start();
  await waitFor(() => first.getSnapshot().value.mapId === 'tan_vien' && second.getSnapshot().value.mapId === 'tan_vien');
  assert.equal(manager.health().length, 2);
  assert.deepEqual([...internals.shards.values()].map((entry) => entry.accounts.size).sort(), [1, 1]);
  await assert.rejects(first.start(), /ACCOUNT_ALREADY_ASSIGNED/);
  await assert.rejects(manager.call('fixture-one', 'constructor', []), /SHARD_METHOD_NOT_ALLOWED/);
  const firstShard = [...internals.shards.values()].find((entry) => entry.accounts.has('fixture-one'))!;
  firstShard.child.send({ v: 99, type: 'call', rid: 'bad-version', accountId: 'fixture-one', method: 'stopAuto', args: [] });
  firstShard.child.send({ v: 1, type: 'call', rid: 'bad-method', accountId: 'fixture-one', method: 'constructor', args: [] });
  await first.stopAuto();
  await waitFor(() => manager.health().some((entry) => entry.id === [...internals.shards.values()].find((shard) => shard.accounts.has('fixture-one'))?.id && entry.ignoredPackets >= 2), 4_000);
  const rpcStartedAt = Date.now();
  await assert.rejects(second.questProbe('status', {}), /SHARD_RPC_TIMEOUT/);
  assert.ok(Date.now() - rpcStartedAt < 4_000, 'stalled RPC should time out without a blind retry');
  const shard = [...internals.shards.values()].find((entry) => entry.accounts.has('fixture-one'));
  assert.ok(shard);
  const exitObserved = new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 8_000);
    const poll = () => { if (exited.includes('fixture-one')) { clearTimeout(timer); resolve(); } else setTimeout(poll, 25); };
    poll();
  });
  shard.child.kill('SIGKILL');
  await exitObserved;
  assert.deepEqual(exited, ['fixture-one']);
  assert.equal(internals.shards.size, 1);
  await manager.shutdown(8_000);
  assert.equal(internals.shards.size, 0);

  delete process.env.TUTIEN_TEST_RPC_HANG;
  const disconnectManager = new ShardManager({ onExit: (accountId) => exited.push(accountId) },
    { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 5_000, stopGraceMs: 1_000,
      entryPath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'shard-main.ts') });
  t.after(async () => disconnectManager.shutdown(2_000).catch(() => undefined));
  process.env.TUTIEN_TEST_KEEPALIVE = '1';
  const disconnected = disconnectManager.factory(opts('fixture-disconnect'), { accountId: 'fixture-disconnect' });
  await disconnected.start();
  const disconnectInternals = disconnectManager as unknown as { shards: Map<string, { child: import('node:child_process').ChildProcess }> };
  const disconnectedChild = [...disconnectInternals.shards.values()][0].child;
  disconnectedChild.disconnect();
  await waitFor(() => exited.includes('fixture-disconnect'));
  delete process.env.TUTIEN_TEST_KEEPALIVE;
  assert.equal(disconnectedChild.exitCode === null, false, 'shard exits after parent IPC disconnect');
  await disconnectManager.shutdown(2_000);

  process.env.TUTIEN_TEST_STOP_HANG = '1';
  const stopManager = new ShardManager({ onExit: (accountId) => exited.push(accountId) },
    { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 5_000, stopGraceMs: 250,
      entryPath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/shard/shard-main.js') });
  const third = stopManager.factory(opts('fixture-three'), { accountId: 'fixture-three' });
  await third.start();
  await assert.rejects(third.stop(), /SHARD_STOP_TIMEOUT/);
  assert.ok(exited.includes('fixture-three'), 'stop timeout kills its shard and clears every runner assignment');
  await stopManager.shutdown(2_000);
});

test('development shard entry spawns from TypeScript through a file URL', { timeout: 15_000 }, async (t) => {
  try { createRequire(import.meta.url).resolve('tsx'); } catch { t.skip('tsx is not installed'); return; }
  const tsDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-tsx-shard-test-'));
  t.after(() => fs.rmSync(tsDataDir, { recursive: true, force: true }));
  const previousTestHook = process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK;
  process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK = '1';
  t.after(() => { if (previousTestHook === undefined) delete process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK; else process.env.TUTIEN_ALLOW_SHARD_TEST_HOOK = previousTestHook; });
  const tsEntry = path.join(tsDataDir, 'tsx-shard-entry.ts');
  fs.writeFileSync(tsEntry, "process.on('message', (message) => { if (message?.type === 'shutdown') { process.disconnect(); process.exit(0); } }); process.send?.({ v: 1, type: 'ready' });\n", 'utf8');
  const manager = new ShardManager({}, { vendorShards: 1, maxRunners: 0, rpcTimeoutMs: 5_000, stopGraceMs: 1_000,
    entryPath: tsEntry });
  t.after(async () => manager.shutdown(3_000).catch(() => undefined));
  const shard = (manager as unknown as { spawn(): { ready: Promise<void>; child: import('node:child_process').ChildProcess; stderr: string } }).spawn();
  try { await shard.ready; } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : 'SHARD_EXITED'} ${redactShardStderr(shard.stderr)}`);
  }
  assert.equal(shard.child.exitCode, null);
  await manager.shutdown(3_000);
  assert.notEqual(shard.child.exitCode, null);
});
