// Bộ giám sát Auto: nhớ map và toạ độ nơi bắt đầu Auto; nếu nhân vật chết thì hồi sinh,
// hồi phục, đi về đúng chỗ cũ rồi bật Auto lại. Dùng được cho mô phỏng offline lẫn client online
// vì chỉ dùng API của client chính thức (SceneWorld, Player, Input, Pathfinder, MapData).
//
// Vòng đời: farming -> down_wait -> reviving -> recovering -> traveling -> resuming -> farming
//           (halted khi vi phạm giới hạn an toàn; không tự thoát khỏi halted).

const TILE = 32;

function createSupervisor({ P, log = () => {}, config = {} }) {
  const W = P.SceneWorld;
  const cfg = {
    reviveMode: 'home',            // 'home' (an toàn, 60% HP ở làng) hoặc 'spot' (tại chỗ 35% HP, dễ chết tiếp)
    recoverRatio: 0.9,             // hồi phục tới tỉ lệ HP này mới đi tiếp
    arrivalRadius: 16,             // px: coi là đã về tới vị trí Auto (nếu không có đường và đã trong 1 ô thì cũng coi là tới)
    maxDeaths: 3,                  // quá số lần chết trong cửa sổ thì dừng hẳn
    deathWindowSec: 600,
    reviveDelaySec: 1.5,           // chờ sau khi gục (client chờ 1.2 s trước khi hiện bảng hồi sinh)
    reviveTimeoutSec: 20,
    recoverTimeoutSec: 180,
    travelTimeoutSec: 240,
    portalWaitSec: 8,              // chờ đổi map sau khi đứng lên ô cổng
    hurtAbortRatio: 0.35,          // đang đi về mà HP tụt dưới ngưỡng này thì dừng Auto lại và báo
    ...config,
  };
  const state = {
    phase: 'idle',
    anchor: null,
    deathTimes: [],
    phaseSince: 0,
    reason: null,
    stats: { deaths: 0, revives: 0, trips: 0, resumed: 0 },
    lastPress: 0,
    portalStandSince: null,
    travelStartHp: null,
  };

  const now = () => P.Game.time; // giây (client tự tăng); dùng chung cho mô phỏng và online
  const player = () => W.player;
  const mapId = () => (W.map && W.map.data ? W.map.data.id : null);
  const hpRatio = () => (player() && player().hpMax > 0 ? player().hp / player().hpMax : 1);
  const dist = (x, y) => Math.hypot(player().x - x, player().y - y);
  const isDown = () => !!(player() && (player().downed || player().state === 'down'));

  function setPhase(phase, reason) {
    if (phase === 'traveling') {
      // Bắt đầu một chuyến đi về: reset các bộ đếm của chuyến.
      state.noPath = 0;
      state.travelStartHp = null;
      state.portalStandSince = null;
      state.stats.trips += 1;
    }
    state.phase = phase;
    state.phaseSince = now();
    if (reason) state.reason = reason;
    log('phase ->', phase, reason ? '(' + reason + ')' : '');
  }
  function halt(reason) {
    try { autoOff(); if (player()) player().stop(); if (W.cancelApproach) W.cancelApproach(); } catch { /* bỏ qua */ }
    setPhase('halted', reason);
  }
  // Lệnh bật/tắt Auto được xếp hàng (Input._autoToggle) và chỉ xử lý ở khung sau của cảnh; không
  // bấm thêm khi còn lệnh chờ, nếu không hai lệnh sẽ triệt tiêu nhau.
  function setAuto(desired) {
    if (P.Input._autoToggle) return;
    if (!!W.autoOn !== desired) P.Input.pressAutoToggle();
  }
  function autoOff() { setAuto(false); }
  function autoOn() { setAuto(true); }

  // ---- đồ thị map từ dữ liệu cổng của client ----
  function portalsOf(id) {
    const m = P.MapData.get ? P.MapData.get(id) : null;
    return (m && m.portals ? m.portals : []).map((p) => ({ tx: p.tx, ty: p.ty, to: p.toMap || p.to })).filter((p) => p.to);
  }
  function mapRoute(from, to) {
    if (from === to) return [from];
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const p of portalsOf(cur)) {
        if (prev.has(p.to)) continue;
        prev.set(p.to, cur);
        if (p.to === to) {
          const out = [to];
          for (let at = cur; at !== null; at = prev.get(at)) out.unshift(at);
          return out;
        }
        queue.push(p.to);
      }
    }
    return null;
  }

  // ---- di chuyển bằng đúng bộ tìm đường của client (giống bấm chuột để đi) ----
  function walkTo(x, y) {
    const pl = player();
    const route = P.Pathfinder.route(W.map, pl.x, pl.y, x, y, P.CONFIG.PLAYER.HITBOX_W / 2, P.CONFIG.PLAYER.HITBOX_H);
    if (route && route.length) { pl.setPath(route); return true; }
    return false;
  }

  function start() {
    if (!player()) throw new Error('chưa có nhân vật');
    state.anchor = { mapId: mapId(), x: player().x, y: player().y, khu: (W.map && W.map.khu) || null };
    log('nhớ vị trí Auto:', state.anchor.mapId, Math.round(state.anchor.x), Math.round(state.anchor.y));
    autoOn();
    setPhase('farming');
  }

  function recordDeath() {
    const t = now();
    state.deathTimes = state.deathTimes.filter((x) => t - x <= cfg.deathWindowSec);
    state.deathTimes.push(t);
    state.stats.deaths += 1;
    return state.deathTimes.length;
  }

  function tick() {
    if (!state.anchor || state.phase === 'idle' || state.phase === 'halted') return;
    const pl = player();
    if (!pl) return halt('mất nhân vật');
    const t = now();
    const elapsed = t - state.phaseSince;

    // Chết ở bất kỳ pha nào (kể cả đang đi về) đều quay lại vòng hồi sinh.
    if (isDown() && !['down_wait', 'reviving'].includes(state.phase)) {
      autoOff();
      const n = recordDeath();
      if (n > cfg.maxDeaths) return halt('chết ' + n + ' lần trong ' + cfg.deathWindowSec + ' giây');
      return setPhase('down_wait', 'gục lần ' + n);
    }

    // Trong mọi pha không phải farming, Auto phải TẮT: nếu để bật, nhân vật sẽ lao đi đuổi quái
    // thay vì hồi phục hoặc đi về neo. Ép lại ở mỗi tick vì lệnh tắt có thể bị xếp hàng lúc đang gục.
    if (['down_wait', 'reviving', 'recovering', 'traveling'].includes(state.phase)) autoOff();

    switch (state.phase) {
      case 'farming': return;
      case 'down_wait':
        if (elapsed < cfg.reviveDelaySec) return;
        {
          let ok = false;
          if (cfg.reviveMode === 'spot') ok = !!W.reviveOnSpot();
          if (!ok) ok = !!W.reviveAtHome();
          state.stats.revives += 1;
          return setPhase('reviving', ok ? 'đã gửi hồi sinh' : 'hồi sinh bị từ chối');
        }
      case 'reviving':
        if (!isDown() && !W.transitioning) return setPhase('recovering');
        if (elapsed > cfg.reviveTimeoutSec) return halt('hồi sinh quá ' + cfg.reviveTimeoutSec + ' giây');
        return;
      case 'recovering':
        if (hpRatio() >= cfg.recoverRatio) { try { if (pl.state === 'sit') P.Player.stand(pl); } catch { /* bỏ qua */ } return setPhase('traveling'); }
        if (elapsed > cfg.recoverTimeoutSec) return halt('hồi phục quá ' + cfg.recoverTimeoutSec + ' giây');
        if (pl.state !== 'sit' && pl.state !== 'pose' && t - state.lastPress > 2) { state.lastPress = t; P.Input.pressMeditate(); }
        return;
      case 'traveling': {
        if (W.transitioning) { state.portalStandSince = null; return; }
        if (elapsed > cfg.travelTimeoutSec) return halt('đi về quá ' + cfg.travelTimeoutSec + ' giây');
        if (state.travelStartHp === null) state.travelStartHp = hpRatio();
        if (hpRatio() < cfg.hurtAbortRatio) return halt('HP quá thấp khi đi về (' + Math.round(hpRatio() * 100) + '%)');
        const here = mapId();
        if (here === state.anchor.mapId) {
          if (dist(state.anchor.x, state.anchor.y) <= cfg.arrivalRadius) return setPhase('resuming');
          if (!pl.path || pl.path.length === 0) {
            if (!walkTo(state.anchor.x, state.anchor.y)) {
              // Bộ tìm đường không trả đường cho khoảng cách dưới một ô: nếu đã trong một ô quanh neo thì đã tới.
              if (dist(state.anchor.x, state.anchor.y) <= TILE) return setPhase('resuming');
              state.noPath = (state.noPath || 0) + 1;
              if (state.noPath >= 8) return halt('không tìm được đường tới vị trí Auto');
            }
          }
          return;
        }
        const route = mapRoute(here, state.anchor.mapId);
        if (!route) return halt('không có đường từ ' + here + ' tới ' + state.anchor.mapId);
        const next = route[1];
        const candidates = portalsOf(here).filter((p) => p.to === next);
        if (!candidates.length) return halt('không có cổng ' + here + ' -> ' + next);
        candidates.sort((a, b) => dist(a.tx * TILE + TILE / 2, a.ty * TILE + TILE / 2) - dist(b.tx * TILE + TILE / 2, b.ty * TILE + TILE / 2));
        const gate = candidates[0];
        const gx = gate.tx * TILE + TILE / 2, gy = gate.ty * TILE + TILE / 2;
        if (!pl.path || pl.path.length === 0) {
          if (dist(gx, gy) <= TILE) {
            // đứng ngay trên ô cổng mà chưa đổi map: chờ một lúc rồi bỏ cuộc
            if (state.portalStandSince === null) state.portalStandSince = t;
            if (t - state.portalStandSince > cfg.portalWaitSec) return halt('cổng ' + here + ' -> ' + next + ' không mở');
          } else if (!walkTo(gx, gy)) {
            state.noPath = (state.noPath || 0) + 1;
            if (state.noPath >= 8) return halt('không tìm được đường tới cổng ' + next);
          }
        }
        return;
      }
      case 'resuming':
        if (W.transitioning) return;
        log('về tới vị trí Auto: map', mapId(), '| cách neo', Math.round(dist(state.anchor.x, state.anchor.y)), 'px | HP', Math.round(hpRatio() * 100) + '%');
        autoOn();
        state.stats.resumed += 1;
        state.noPath = 0;
        state.travelStartHp = null;
        state.portalStandSince = null;
        return setPhase('farming', 'tiếp tục Auto');
      default: return;
    }
  }

  return { start, tick, halt, state, cfg, mapRoute, get phase() { return state.phase; } };
}

module.exports = { createSupervisor };
