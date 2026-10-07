import test from 'node:test';
import assert from 'node:assert/strict';
import { TuTienClient } from '../dist/client.js';

function createClient(mapPacketGuard) {
  const client = new TuTienClient({
    serverUrl: 'ws://map-guard-test.invalid',
    accountName: 'map-guard-test',
    token: 'test-token',
    ...(mapPacketGuard ? { mapPacketGuard } : {}),
  });
  client.socket.isConnected = () => true;
  client.socket.sendRaw = () => true;
  return client;
}

const mapPacket = (mapId, ep, khu = 1) => ({
  op: 'map', mapId, khu, soKhu: 3, x: 12, y: 34, ep, p: [], e: [],
});

test('guard veto leaves map context and map epoch untouched', () => {
  const client = createClient((packet) => packet.mapId !== 'stale-map');
  client.socket.emit('welcome', { op: 'welcome', ep: 7 });
  client.socket.emit('map', mapPacket('current-map', 8));
  const before = {
    mapId: client.state.mapId,
    khu: client.state.khu,
    x: client.state.x,
    y: client.state.y,
    contextEpoch: client.state.contextEpoch,
    mapEpoch: client.mapEpoch,
  };

  client.socket.emit('map', mapPacket('stale-map', 99, 2));

  assert.deepEqual({
    mapId: client.state.mapId,
    khu: client.state.khu,
    x: client.state.x,
    y: client.state.y,
    contextEpoch: client.state.contextEpoch,
    mapEpoch: client.mapEpoch,
  }, before);
  client.dispose();
});

test('accepted map packets update context and accept static or incrementing epochs', () => {
  const client = createClient(() => true);
  client.socket.emit('welcome', { op: 'welcome', ep: 4 });
  client.socket.emit('map', mapPacket('first-map', 4));
  assert.equal(client.state.mapId, 'first-map');
  assert.equal(client.mapEpoch, 4);
  client.socket.emit('map', mapPacket('first-map', 5));
  assert.equal(client.mapEpoch, 5);
  assert.equal(client.state.contextEpoch, 1);
  client.dispose();
});

test('no guard preserves legacy map packet behavior', () => {
  const client = createClient();
  client.socket.emit('map', mapPacket('legacy-map', 12));
  assert.equal(client.state.mapId, 'legacy-map');
  assert.equal(client.mapEpoch, 12);
  client.dispose();
});

test('vetoed map packet does not reset snap2 reducer', () => {
  const client = createClient((packet) => packet.mapId !== 'stale-map');
  client.socket.emit('map', mapPacket('current-map', 1));
  client.socket.emit('snap2', { op: 'snap2', full: true, sq: 10, ep: 1, ef: [{ id: 'mob', x: 1, y: 2 }] });
  client.socket.emit('map', mapPacket('stale-map', 2));
  client.socket.emit('snap2', { op: 'snap2', sq: 11, ep: 1, e: [{ id: 'mob', x: 3, y: 4 }] });
  assert.equal(client.getSnap2Stats().accepted, 2);
  client.dispose();
});
