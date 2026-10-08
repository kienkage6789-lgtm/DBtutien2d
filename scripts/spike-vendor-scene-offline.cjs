// Spike giai đoạn 3 (OFFLINE): khởi động cảnh game của client chính thức, không hiển thị, không mạng.
// Ở chế độ offline client tự mô phỏng quái cục bộ: bãi thử an toàn cho logic di chuyển và Auto.
// Chạy: node scripts/spike-vendor-scene-offline.cjs
const { createVendorEnv } = require('./lib/vendor-env.cjs');

const env = createVendorEnv({ nowStart: 1_000_000 });
const { P } = env;
console.log('script nạp:', env.loaded + '/' + env.scripts.length);

function attempt(label, fn) {
  try {
    const r = fn();
    console.log('OK  ', label, r === undefined ? '' : JSON.stringify(r).slice(0, 160));
    return true;
  } catch (e) {
    console.log('FAIL', label, '->', String(e && e.message).slice(0, 200));
    const st = String(e && e.stack).split('\n').slice(1, 4).map((l) => l.trim().slice(0, 120));
    console.log('     ', st.join(' | '));
    return false;
  }
}

attempt('Game.init', () => { P.Game.init(); });
let mapData = null;
attempt('SceneWorld.startMapData', () => { mapData = P.SceneWorld.startMapData(); return { id: mapData && mapData.id }; });
attempt('SceneWorld.nuongNenDau', () => P.SceneWorld.nuongNenDau && P.SceneWorld.nuongNenDau(mapData));
attempt('Game.changeScene(SceneWorld)', () => { P.Game.changeScene(P.SceneWorld, null, true); return { scene: P.Game.scene === P.SceneWorld }; });
attempt('scene state', () => {
  const w = P.SceneWorld;
  return {
    player: !!w.player,
    pos: w.player ? [Math.round(w.player.x), Math.round(w.player.y)] : null,
    hp: w.player ? [w.player.hp, w.player.hpMax] : null,
    enemies: (w.enemies || []).length,
    map: w.map && w.map.data && w.map.data.id,
  };
});

// Tự gọi update(dt), không bao giờ gọi draw.
let updates = 0;
let updateErrors = 0;
const t0 = Date.now();
for (let i = 0; i < 600; i += 1) {
  env.advanceClock(1000 / 60);
  try { P.SceneWorld.update(1 / 60); updates += 1; } catch (e) {
    updateErrors += 1;
    if (updateErrors <= 3) console.log('update lỗi:', String(e && e.message).slice(0, 160));
  }
}
console.log('update(dt) gọi', updates, 'lần, lỗi', updateErrors, 'mất', Date.now() - t0, 'ms CPU thật cho 10 giây mô phỏng');
console.log('console.error trong client:', env.consoleErrors.length, env.consoleErrors.slice(0, 3));
