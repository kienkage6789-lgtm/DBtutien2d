import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AutoSupervisor,
  DEFAULT_AUTO_SUPERVISOR_CONFIG,
  type AutoClientPort,
  type AutoPlayerPort,
} from './auto-supervisor.js';

function makeClient() {
  let now = 0;
  let mapId = 'farm';
  let autoOn = false;
  let queued = false;
  let togglePresses = 0;
  const player: AutoPlayerPort = {
    x: 200,
    y: 200,
    hp: 100,
    hpMax: 100,
    downed: false,
    state: 'stand',
    path: [],
    stop() { this.path = []; },
    setPath(path) { this.path = path; },
  };
  const client: AutoClientPort = {
    nowSec: () => now,
    getPlayer: () => player,
    getMapId: () => mapId,
    getKhu: () => 1,
    isTransitioning: () => false,
    getAutoOn: () => autoOn,
    isAutoToggleQueued: () => queued,
    pressAutoToggle: () => { queued = true; togglePresses += 1; },
    reviveAtHome: () => {
      player.downed = false;
      player.state = 'stand';
      player.hp = 30;
      mapId = 'home';
      return true;
    },
    reviveOnSpot: () => false,
    pressMeditate: () => { player.state = 'sit'; },
    stand: () => { player.state = 'stand'; },
    cancelApproach: () => {},
    portalsOf: (id) => id === 'home' ? [{ tx: 0, ty: 0, toMapId: 'farm' }] : [],
    walkTo: (x, y) => {
      if (Math.hypot(player.x - x, player.y - y) < 32) return false;
      player.setPath([{ x, y }]);
      return true;
    },
  };
  return {
    client,
    player,
    setNow(value: number) { now = value; },
    setMap(value: string) { mapId = value; },
    applyToggle() { if (queued) { autoOn = !autoOn; queued = false; } },
    getTogglePresses() { return togglePresses; },
  };
}

test('supervisor returns to the anchor after death and keeps Auto off while traveling', () => {
  const fake = makeClient();
  const supervisor = new AutoSupervisor(fake.client, {
    ...DEFAULT_AUTO_SUPERVISOR_CONFIG,
    reviveDelaySec: 1,
    arrivalRadius: 16,
  });
  supervisor.start({ mapId: 'farm', khu: 1, x: 200, y: 200 });
  fake.applyToggle();
  assert.equal(supervisor.getSnapshot().phase, 'farming');
  assert.equal(fake.getTogglePresses(), 1, 'queued auto toggle must not be duplicated');

  fake.player.downed = true;
  fake.setNow(0.1);
  supervisor.tick();
  fake.applyToggle();
  assert.equal(supervisor.getSnapshot().phase, 'down_wait');
  assert.equal(fake.getTogglePresses(), 2, 'death must queue exactly one Auto-off');

  fake.setNow(2);
  supervisor.tick();
  assert.equal(supervisor.getSnapshot().phase, 'reviving');
  fake.setNow(2.1);
  supervisor.tick();
  assert.equal(supervisor.getSnapshot().phase, 'recovering');
  assert.equal(fake.player.state, 'stand');

  fake.setNow(3);
  supervisor.tick();
  assert.equal(fake.player.state, 'sit');
  fake.player.hp = 95;
  fake.setNow(4);
  supervisor.tick();
  assert.equal(supervisor.getSnapshot().phase, 'traveling');
  assert.equal(fake.getTogglePresses(), 2, 'traveling must not turn Auto back on');

  fake.player.x = 180;
  fake.player.y = 180;
  fake.player.path = [];
  fake.setMap('farm');
  fake.setNow(5);
  supervisor.tick();
  assert.equal(supervisor.getSnapshot().phase, 'resuming', 'within one tile with no route is treated as arrived');
  supervisor.tick();
  assert.equal(supervisor.getSnapshot().phase, 'farming');
  fake.applyToggle();
  assert.equal(fake.getTogglePresses(), 3);
  assert.equal(supervisor.getSnapshot().stats.trips, 1);
  assert.equal(supervisor.getSnapshot().stats.resumed, 1);
});

test('supervisor halts after the death limit in the configured window', () => {
  const fake = makeClient();
  const supervisor = new AutoSupervisor(fake.client, { ...DEFAULT_AUTO_SUPERVISOR_CONFIG, maxDeaths: 1 });
  supervisor.start();
  fake.applyToggle();
  fake.player.downed = true;
  supervisor.tick();
  fake.player.downed = false;
  supervisor.start();
  fake.player.downed = true;
  fake.setNow(1);
  supervisor.tick();
  assert.equal(supervisor.getSnapshot().phase, 'halted');
  assert.equal(supervisor.getSnapshot().reasonCode, 'death_limit');
  assert.equal(supervisor.getSnapshot().autoRequested, false);
});
