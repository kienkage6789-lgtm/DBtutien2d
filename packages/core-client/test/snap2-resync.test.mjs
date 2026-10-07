import test from 'node:test';
import assert from 'node:assert/strict';
import { TuTienClient } from '../dist/client.js';

function createClient() {
  const client = new TuTienClient({
    serverUrl: 'ws://snap2-test.invalid',
    accountName: 'snap2-test',
    token: 'test-token',
  });
  const resyncs = [];
  client.socket.isConnected = () => true;
  client.socket.sendRaw = (packet) => {
    resyncs.push(packet);
    return true;
  };
  return { client, resyncs };
}

function mapPacket(mapId = 'mieu_hoang', khu = 1) {
  return { op: 'map', mapId, khu, soKhu: 1, x: 400, y: 297, ep: 9, p: [], e: [] };
}

test('snap2 full racing map is recovered with one deferred resync', () => {
  const { client, resyncs } = createClient();
  const snapshots = [];
  client.on('worldSnapshot', (snapshot) => snapshots.push(snapshot));

  client.socket.emit('snap2', { op: 'snap2', full: true, sq: 4, ep: 9, ef: [{ id: 'mob-1', x: 10, y: 20 }] });
  assert.equal(snapshots.length, 0);
  client.socket.emit('map', mapPacket());
  assert.equal(snapshots.length, 1);
  assert.deepEqual(resyncs, []);
  assert.deepEqual(snapshots[0].monsters, [{ id: 'mob-1', x: 10, y: 20 }]);
  const stats = client.getSnap2Stats();
  assert.equal(stats.monsterRowsSeen, 1);
  assert.equal(stats.monsterPatchRowsSeen, 0);
  assert.equal(typeof stats.lastMonsterRowsAt, 'number');
  client.dispose();
});

test('snap2 delta needs_full requests resync instead of silently stalling', () => {
  const { client, resyncs } = createClient();
  const snapshots = [];
  client.socket.emit('map', mapPacket());
  client.on('worldSnapshot', (snapshot) => snapshots.push(snapshot));

  client.socket.emit('snap2', { op: 'snap2', sq: 8, ep: 9, ef: [{ id: 'mob-1', x: 10, y: 20 }] });
  assert.deepEqual(resyncs, [{ op: 'resync' }]);
  client.socket.emit('snap2', { op: 'snap2', sq: 9, ep: 9, e: [{ id: 'mob-1', x: 10, y: 20 }] });
  assert.equal(client.getSnap2Stats().monsterPatchRowsSeen, 1);
  assert.deepEqual(resyncs, [{ op: 'resync' }]);
  client.socket.emit('snap2', { op: 'snap2', full: true, sq: 8, ep: 9, ef: [{ id: 'mob-1', x: 11, y: 21 }] });
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].monsters, [{ id: 'mob-1', x: 11, y: 21 }]);
  client.dispose();
});
