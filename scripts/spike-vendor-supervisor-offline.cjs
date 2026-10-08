// Thử OFFLINE bộ giám sát Auto: chết -> hồi sinh -> hồi phục -> đi về đúng vị trí Auto -> bật Auto lại.
// Không mạng, không đăng nhập. Chạy: node scripts/spike-vendor-supervisor-offline.cjs [giây] [home|spot] [maxDeaths]
const { createVendorEnv } = require('./lib/vendor-env.cjs');
const { createSupervisor } = require('./lib/auto-supervisor.cjs');

const totalSeconds = Number(process.argv[2] || 400);
const reviveMode = process.argv[3] || 'home';
const maxDeaths = Number(process.argv[4] || 3);
const env = createVendorEnv({ nowStart: 1_000_000 });
const { P } = env;
const W = P.SceneWorld;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => console.log('UNHANDLED:', String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)));
P.Assets.ensureMap = () => Promise.resolve([]);
P.Assets.idle = (cb) => { if (typeof cb === 'function') cb(); };

let updateErrors = 0;
async function step(hz = 60) {
  env.advanceClock(1000 / hz);
  P.Game.time += 1 / hz;
  env.flushRaf();
  try { W.update(1 / hz); } catch (e) { updateErrors += 1; if (updateErrors <= 3) console.log('update lỗi:', String(e && e.message).slice(0, 160)); }
}

async function main() {
  P.Game.init();
  W.nuongNenDau(W.startMapData());
  P.Game.changeScene(W, null, true);
  for (let i = 0; i < 60; i += 1) await step();

  // Sang map có quái, đặt cảnh giới như tài khoản thật.
  W.switchMap('thanh_truc_lam', null);
  for (let i = 0; i < 200 && !(W.map && W.map.data.id === 'thanh_truc_lam'); i += 1) { for (let k = 0; k < 6; k += 1) await step(); await sleep(15); }
  for (let i = 0; i < 100 && W.transitioning; i += 1) { for (let k = 0; k < 6; k += 1) await step(); await sleep(15); }
  console.log('sang map xong, transitioning =', !!W.transitioning);
  P.Progress.setRealm('luyen_khi_8'); P.Player.setRealm(W.player, 'luyen_khi_8');

  const logLines = [];
  const sup = createSupervisor({
    P,
    config: { reviveMode, maxDeaths },
    log: (...a) => {
      const line = 't=' + Math.round(P.Game.time) + 's ' + a.join(' ');
      logLines.push(line);
      console.log(line);
    },
  });
  sup.start();
  console.log('neo:', JSON.stringify({ map: sup.state.anchor.mapId, x: Math.round(sup.state.anchor.x), y: Math.round(sup.state.anchor.y) }));

  const t0 = P.Game.time;
  let frame = 0;
  let lastReport = -1;
  while (P.Game.time - t0 < totalSeconds && sup.phase !== 'halted') {
    await step();
    frame += 1;
    if (frame % 15 === 0) sup.tick(); // 4 lần mỗi giây mô phỏng
    if (frame % 120 === 0) await sleep(0);
    const sec = Math.floor(P.Game.time - t0);
    if (sec % 30 === 0 && sec !== lastReport) {
      lastReport = sec;
      console.log('  [' + sec + 's] phase', sup.phase, '| map', W.map && W.map.data.id, '| pos', [Math.round(W.player.x), Math.round(W.player.y)],
        '| hp', Math.round(W.player.hp) + '/' + W.player.hpMax, '| auto', !!W.autoOn, '| state', W.player.state);
    }
  }
  console.log('KẾT THÚC:', JSON.stringify({ phase: sup.phase, reason: sup.state.reason, stats: sup.state.stats, lỗiUpdate: updateErrors,
    map: W.map.data.id, vịTrí: [Math.round(W.player.x), Math.round(W.player.y)], autoOn: !!W.autoOn,
    consoleError: env.consoleErrors.slice(0, 2) }));
}

main().then(() => process.exit(0)).catch((e) => { console.log('lỗi:', String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ').slice(0, 400)); process.exit(1); });
