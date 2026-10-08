// Spike giai đoạn 3b (OFFLINE): bật Auto của client chính thức trong mô phỏng cục bộ, không mạng.
// Quan sát: chọn mục tiêu, đi tới, đánh. Chạy: node scripts/spike-vendor-auto-offline.cjs [mapId] [giây]
const { createVendorEnv } = require('./lib/vendor-env.cjs');

const mapId = process.argv[2] || 'thanh_truc_lam';
const autoSeconds = Number(process.argv[3] || 60);
const env = createVendorEnv({ nowStart: 1_000_000 });
const { P } = env;
const W = P.SceneWorld;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => console.log('UNHANDLED:', String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ').slice(0, 500)));

// Không có ảnh thật: bỏ bước chờ tải ảnh của bản đồ (logic không cần ảnh).
if (P.Assets) {
  P.Assets.ensureMap = () => Promise.resolve([]);
  P.Assets.idle = (cb) => { if (typeof cb === 'function') cb(); };
}

let updateErrors = 0;
async function tick(seconds, hz = 60, onTick) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i += 1) {
    env.advanceClock(1000 / hz);
    // Game.time do vòng lặp chính của Game cập nhật; ta bỏ qua vòng đó nên phải tự tiến đồng hồ này.
    P.Game.time += 1 / hz;
    try { W.update(1 / hz); } catch (e) {
      updateErrors += 1;
      if (updateErrors <= 3) console.log('update lỗi:', String(e && e.message).slice(0, 200));
    }
    if (onTick) onTick(i / hz);
    if (i % 30 === 0) await sleep(0); // cho Promise/setTimeout của client chạy
  }
}

async function main() {
  P.Game.init();
  W.nuongNenDau(W.startMapData());
  P.Game.changeScene(W, null, true);
  await tick(1);
  console.log('bắt đầu ở', W.map.data.id);

  W.switchMap(mapId, null);
  for (let i = 0; i < 100 && !(W.map && W.map.data.id === mapId); i += 1) { await tick(0.1); await sleep(20); }
  console.log('đã sang', W.map.data.id, '| quái', (W.enemies || []).length, '| transitioning', !!W.transitioning);
  if (W.transitioning) {
    // Hiệu ứng mờ dần phụ thuộc DOM giả nên có thể không tự tắt; cờ này chỉ chặn Auto/di chuyển.
    for (let i = 0; i < 50 && W.transitioning; i += 1) { await tick(0.1); await sleep(20); }
    if (W.transitioning) { console.log('transitioning vẫn bật sau 5 s mô phỏng -> tắt tay để thử Auto'); W.transitioning = false; }
  }

  // Cho nhân vật mô phỏng cảnh giới như tài khoản thật để có MP/kỹ năng.
  try { if (P.Progress && P.Progress.setRealm) P.Progress.setRealm('luyen_khi_8'); P.Player.setRealm(W.player, 'luyen_khi_8'); } catch (e) { console.log('setRealm lỗi:', String(e && e.message).slice(0, 120)); }
  console.log('nhân vật:', 'hp', W.player.hp + '/' + W.player.hpMax, 'mp', W.player.mp + '/' + W.player.mpMax, 'pos', [Math.round(W.player.x), Math.round(W.player.y)]);

  const counts = { attack: 0, castSpell: 0, castThunder: 0 };
  const oa = P.Player.attack, oc = P.Player.castSpell, ot = P.Player.castThunder;
  P.Player.attack = function (...a) { const r = oa.apply(this, a); if (r) counts.attack += 1; return r; };
  P.Player.castSpell = function (...a) { const r = oc.apply(this, a); if (r === true) counts.castSpell += 1; return r; };
  P.Player.castThunder = function (...a) { const r = ot.apply(this, a); if (r === true) counts.castThunder += 1; return r; };

  P.Input.pressAutoToggle();
  await tick(0.2);
  console.log('autoOn sau khi bấm:', !!W.autoOn);
  const start = { x: W.player.x, y: W.player.y };
  let lastLog = -1;
  await tick(autoSeconds, 60, (t) => {
    const sec = Math.floor(t);
    if (sec % 5 === 0 && sec !== lastLog) {
      lastLog = sec;
      const dead = (W.enemies || []).filter((e) => e.dead).length;
      console.log('t=' + sec + 's', 'pos', [Math.round(W.player.x), Math.round(W.player.y)], 'state', W.player.state,
        'hp', Math.round(W.player.hp) + '/' + W.player.hpMax, 'mp', Math.round(W.player.mp || 0), 'quái chết', dead, 'đòn', JSON.stringify(counts));
    }
  });
  const dead = (W.enemies || []).filter((e) => e.dead).length;
  console.log('KẾT THÚC: quãng đường', Math.round(Math.hypot(W.player.x - start.x, W.player.y - start.y)), 'px; quái chết', dead, '; đòn', JSON.stringify(counts), '; lỗi update', updateErrors);
  console.log('console.error trong client:', env.consoleErrors.length, env.consoleErrors.slice(0, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.log('lỗi:', String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ').slice(0, 400)); process.exit(1); });
