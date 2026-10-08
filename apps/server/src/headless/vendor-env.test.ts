import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVendorEnv } from './vendor-env.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const vendorClientDir = path.join(repoRoot, 'vendor/tutien2d-public-client/2026-10-06');

async function frame(env: ReturnType<typeof createVendorEnv>, dt = 1 / 60): Promise<void> {
  env.advanceClock(dt * 1000);
  env.P.Game.time += dt;
  env.flushRaf();
  env.P.Game.scene?.update?.(dt);
  await Promise.resolve();
}

test('official client loads offline with deterministic time/RNG and Auto updates', async () => {
  const env = createVendorEnv({ vendorClientDir, nowStart: 1_000_000, randomSeed: 7 });
  try {
    assert.ok(env.scripts.length >= 240, `expected the checked-in client script list, got ${env.scripts.length}`);
    assert.ok(env.loaded >= env.scripts.length - 2, `only the two known harmless script errors are allowed: ${env.loadErrors.length}`);
    assert.ok(env.P.Game && env.P.SceneWorld && env.P.Input, 'vendor globals must be present');

    const initialGameTime = env.P.Game.time;
    env.P.Game.init();
    env.P.SceneWorld.nuongNenDau(env.P.SceneWorld.startMapData());
    env.P.Game.changeScene(env.P.SceneWorld, null, true);
    for (let i = 0; i < 90; i += 1) await frame(env);
    assert.ok(env.P.SceneWorld.player, 'offline scene must create a player');
    assert.ok(env.P.Game.time > initialGameTime, 'Game.time must be advanced by the headless frame loop');

    const targetMap = 'thanh_truc_lam';
    env.P.SceneWorld.switchMap(targetMap, null);
    for (let i = 0; i < 180 && env.P.SceneWorld.transitioning; i += 1) {
      // The vendor snapshot uses a real wall-clock timeout for scene
      // transitions, so yield the host event loop as well as advancing the
      // deterministic in-vm clock.
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      await frame(env, 0.1);
    }
    assert.equal(env.P.SceneWorld.transitioning, false, 'rAF queue must settle SceneWorld transitions');
    const ensured = await env.P.Assets.ensureMap(targetMap);
    assert.deepEqual(ensured, [], 'headless map assets resolve immediately');
    let idleCalled = false;
    env.P.Assets.idle(() => { idleCalled = true; });
    assert.equal(idleCalled, true, 'headless Assets.idle must call immediately');

    try { env.P.Progress?.setRealm?.('luyen_khi_8'); env.P.Player?.setRealm?.(env.P.SceneWorld.player, 'luyen_khi_8'); } catch { /* fixture can use the default realm */ }
    const player = env.P.SceneWorld.player;
    const start = { x: player.x, y: player.y };
    env.P.Input.pressAutoToggle();
    for (let i = 0; i < 900; i += 1) await frame(env);
    assert.equal(env.P.SceneWorld.autoOn, true, 'queued Auto toggle must be processed by a later frame');
    const moved = Math.hypot(player.x - start.x, player.y - start.y) > 0;
    const deadEnemies = (env.P.SceneWorld.enemies ?? []).filter((enemy: any) => enemy.dead).length;
    assert.ok(moved || deadEnemies > 0, 'offline Auto must move or engage a generated enemy');
    assert.ok(env.consoleErrors.length <= 50, 'client console errors are bounded');
  } finally {
    env.dispose();
  }
});

test('vendor environment rejects a missing client directory clearly', () => {
  assert.throws(
    () => createVendorEnv({ vendorClientDir: path.join(repoRoot, 'vendor', 'does-not-exist') }),
    /VENDOR_CLIENT_DIR_MISSING/,
  );
});

test('storage keeps what the client writes, so the server save restores realm (regression: no-op storage left hpMax 100 and no skills)', () => {
  const env = createVendorEnv({ vendorClientDir, nowStart: 1_000_000, randomSeed: 3 });
  try {
    const storage = env.win.localStorage as { setItem(k: string, v: string): void; getItem(k: string): string | null };
    storage.setItem('probe', 'giá trị');
    assert.equal(storage.getItem('probe'), 'giá trị', 'localStorage phải lưu thật');
    assert.equal(storage.getItem('khong-co'), null);

    env.P.Game.init();
    env.P.Utils.store.set(env.P.CONFIG.PROGRESS_KEY, { realm: 'luyen_khi_8', stage: 1 });
    env.P.Quest.load();
    assert.equal(env.P.Progress.realmId, 'luyen_khi_8', 'bản lưu nhận từ gói state phải dựng đúng cảnh giới');
  } finally {
    env.dispose?.();
  }
});
