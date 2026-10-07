import test from 'node:test';
import assert from 'node:assert/strict';
import { TuTienClient } from '../dist/client.js';

function createClient(worldPacketGuard) {
  const client = new TuTienClient({
    serverUrl: 'ws://world-guard-test.invalid',
    accountName: 'world-guard-test',
    token: 'test-token',
    ...(worldPacketGuard ? { worldPacketGuard } : {}),
  });
  return client;
}

function captureWorldState(state) {
  return {
    hp: state.hp,
    maxHp: state.maxHp,
    mp: state.mp,
    mapId: state.mapId,
    khu: state.khu,
    x: state.x,
    y: state.y,
    contextEpoch: state.contextEpoch,
    bag: { ...state.bag },
    worldUpdatedAt: state.worldUpdatedAt,
    lastUpdated: state.lastUpdated,
  };
}

test('rejected state packet without canonical vitals leaves core state untouched', () => {
  const client = createClient((source) => source !== 'state');
  const before = captureWorldState(client.state);

  client.socket.emit('state', {
    op: 'state', mapId: 'stale-map', khu: 8,
    x: 90, y: 91, bag: { stale: 1 }, stones: 500,
  });

  assert.deepEqual(captureWorldState(client.state), before);
  client.dispose();
});

test('rejected state packet preserves canonical vitals and rejects all world fields', () => {
  const client = createClient((source) => source !== 'state');
  client.state.updateMap({ op: 'map', mapId: 'current-map', khu: 2, x: 12, y: 34 });
  const before = captureWorldState(client.state);

  client.socket.emit('state', {
    op: 'state', ep: 999, hp: 70, maxHp: 100, mp: 40, maxMp: 80,
    mapId: 'stale-map', khu: 9, x: 900, y: 901, p: [{ id: 'stale-player' }],
    e: [{ id: 'stale-monster' }], bag: { stale: 1 }, stones: 500,
  });

  assert.equal(client.state.hp, 70);
  assert.equal(client.state.maxHp, 100);
  assert.equal(client.state.mp, 40);
  assert.equal(client.state.maxMp, 80);
  assert.equal(client.state.vitals.status, 'fresh');
  assert.equal(client.state.vitals.source, 'state');
  assert.equal(client.state.mapId, before.mapId);
  assert.equal(client.state.khu, before.khu);
  assert.equal(client.state.x, before.x);
  assert.equal(client.state.y, before.y);
  assert.equal(client.state.contextEpoch, before.contextEpoch);
  assert.deepEqual(client.state.bag, before.bag);
  assert.equal(client.state.worldUpdatedAt, before.worldUpdatedAt);
  client.dispose();
});

test('rejected you packet preserves canonical vitals without applying its position', () => {
  const client = createClient((source) => source !== 'you');
  client.state.updateMap({ op: 'map', mapId: 'current-map', khu: 3, x: 20, y: 30 });
  const before = captureWorldState(client.state);

  client.socket.emit('you', {
    op: 'you', ep: -1, hp: 55, maxHp: 90, mp: 25, x: 700, y: 800,
  });

  assert.equal(client.state.hp, 55);
  assert.equal(client.state.maxHp, 90);
  assert.equal(client.state.mp, 25);
  assert.equal(client.state.x, before.x);
  assert.equal(client.state.y, before.y);
  assert.equal(client.state.mapId, before.mapId);
  assert.equal(client.state.khu, before.khu);
  assert.equal(client.state.worldUpdatedAt, before.worldUpdatedAt);
  client.dispose();
});

test('rejected world packets do not infer vitals from legacy status aliases', () => {
  const client = createClient((source) => source !== 'state' && source !== 'you');

  client.socket.emit('state', { op: 'state', ep: 4, ht: 80, hm: 100, sh: 30, slm: 50 });
  client.socket.emit('you', { op: 'you', ep: 4, ht: 70, hm: 100, sh: 20, slm: 50 });

  assert.equal(client.state.vitals.status, 'unknown');
  assert.equal(client.state.vitals.hp, null);
  assert.equal(client.state.vitals.mp, null);
  assert.equal(client.state.hp, 100);
  assert.equal(client.state.mp, 0);
  client.dispose();
});

test('rejected you packet without canonical vitals leaves core state untouched', () => {
  const client = createClient((source) => source !== 'you');
  const before = captureWorldState(client.state);

  client.socket.emit('you', { op: 'you', x: 44, y: 55 });

  assert.deepEqual(captureWorldState(client.state), before);
  client.dispose();
});

test('accepted state and you packets still apply', () => {
  const sources = [];
  const client = createClient((source) => { sources.push(source); return true; });

  client.socket.emit('state', {
    op: 'state', hp: 70, maxHp: 100, mapId: 'accepted-map', khu: 2,
    x: 10, y: 20, bag: { herb: 4 },
  });
  client.socket.emit('you', { op: 'you', hp: 60, maxHp: 100, mp: 30, x: 11, y: 21 });

  assert.deepEqual(sources, ['state', 'you']);
  assert.equal(client.state.hp, 60);
  assert.equal(client.state.mp, 30);
  assert.equal(client.state.mapId, 'accepted-map');
  assert.equal(client.state.x, 11);
  assert.equal(client.state.y, 21);
  assert.deepEqual(client.state.bag, { herb: 4 });
  client.dispose();
});

test('world guard exceptions reject world fields but preserve vitals and emit diagnostics', () => {
  const client = createClient(() => { throw new Error('stale packet'); });
  const errors = [];
  client.on('worldPacketGuardError', (...args) => errors.push(args));
  const before = captureWorldState(client.state);
  const packet = { op: 'you', hp: 1, x: 100, y: 100 };

  client.socket.emit('you', packet);

  assert.equal(client.state.hp, 1);
  assert.equal(client.state.x, before.x);
  assert.equal(client.state.y, before.y);
  assert.equal(client.state.mapId, before.mapId);
  assert.equal(client.state.worldUpdatedAt, before.worldUpdatedAt);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0].message, 'stale packet');
  assert.equal(errors[0][1], 'you');
  assert.equal(errors[0][2], packet);
  client.dispose();
});
