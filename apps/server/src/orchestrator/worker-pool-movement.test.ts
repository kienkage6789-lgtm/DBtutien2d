import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AUTO_CONSTANTS } from '@tutien2d/core-client';
import { VERIFIED_PORTAL_EDGES } from '../config/portal-catalog.js';
import { WorkerPool } from './worker-pool.js';

const MAP_ID = 'tan_vien';
const KHU = 1;
const START = { x: 18 * 32 + 16, y: 11 * 32 + 16 };
const PORTAL = { x: 7 * 32 + 16, y: 29 * 32 + 16 };

class FakeMovementClient extends EventEmitter {
  public readonly moves: Array<{ seq: number; x: number; y: number; at: number }> = [];
  public readonly state = { downed: false };
  public nextMoveSeq = 1;
  public connected = true;
  public emitAuthoritative = true;
  public rejectMoves = false;
  public entry: any;

  public isConnected(): boolean {
    return this.connected;
  }

  public async sendMove(x: number, y: number, _dir: number, _st: string, shouldSend: () => boolean): Promise<boolean> {
    if (!shouldSend() || this.rejectMoves) return false;
    const seq = this.nextMoveSeq;
    this.nextMoveSeq += 1;
    const move = { seq, x: Math.round(x), y: Math.round(y), at: Date.now() };
    this.moves.push(move);
    // Match the observed server cadence: movement ACK/current-self packets
    // arrive on seq multiples of ten, not on every outbound move.
    if (this.emitAuthoritative && seq % 10 === 0) {
      this.entry.location.x = move.x;
      this.entry.location.y = move.y;
      this.entry.mapContext.observedAt = Date.now();
      this.emit('you', { seq, x: move.x, y: move.y, fix: false, ep: 1 });
    }
    return true;
  }
}

function createEntry(client: FakeMovementClient, operationId: string): any {
  const entry: any = {
    client,
    dataStatus: { location: true },
    location: { mapId: MAP_ID, khu: KHU, x: START.x, y: START.y },
    mapContext: { mapId: MAP_ID, khu: KHU, observedAt: Date.now() - 1_000, fresh: true },
    mapContextEpoch: 1,
    mapEpoch: 1,
    vitals: { status: 'unknown', hp: null },
    moveTo: {
      requestId: 'offline-movement-test', operationId, status: 'accepted',
      mapId: MAP_ID, khu: KHU, x: PORTAL.x, y: PORTAL.y, updatedAt: Date.now(), reason: null,
    },
    navigation: { operationId, phase: 'moving_to_portal' },
  };
  client.entry = entry;
  return entry;
}

function preparePool(entry: any, shouldContinue: () => boolean = () => true): WorkerPool {
  const pool = new WorkerPool();
  const internal = pool as any;
  internal.activeBots.set('offline-movement-account', entry);
  internal.hasCurrentMapContext = () => true;
  internal.moveToIsCurrent = () => entry.moveTo?.status === 'accepted' || entry.moveTo?.status === 'running'
    ? shouldContinue() : false;
  internal.navigationIsCurrent = () => shouldContinue();
  internal.setMoveToStatus = (_accountId: string, current: any, status: string, reason: string | null = null) => {
    current.moveTo = { ...current.moveTo, status, reason, updatedAt: Date.now() };
  };
  return pool;
}

test('runMoveTo uses predicted coordinates, reaches the target, and removes the you listener', async () => {
  const client = new FakeMovementClient();
  const entry = createEntry(client, 'move-to-operation');
  const pool = preparePool(entry);
  await (pool as any).runMoveTo('offline-movement-account', entry, 'move-to-operation', 16);

  assert.equal(entry.moveTo.status, 'arrived');
  assert.equal(client.listenerCount('you'), 0);
  assert.ok(client.moves.length > 20);
  const elapsedSeconds = (client.moves.length - 1) * 0.1;
  const distance = client.moves.reduce((total, move, index) => {
    const previous = index === 0 ? START : client.moves[index - 1];
    return total + Math.hypot(move.x - previous.x, move.y - previous.y);
  }, 0);
  const effectiveSpeed = distance / elapsedSeconds;
  assert.ok(effectiveSpeed > AUTO_CONSTANTS.player.speed * AUTO_CONSTANTS.player.walkMult * 0.85);
  assert.ok(effectiveSpeed < AUTO_CONSTANTS.player.speed * AUTO_CONSTANTS.player.walkMult * 1.15);
});

test('runMoveTo preserves cancellation semantics and cleans up the listener', async () => {
  const client = new FakeMovementClient();
  const entry = createEntry(client, 'cancel-operation');
  const pool = preparePool(entry, () => client.moves.length < 4);
  await (pool as any).runMoveTo('offline-movement-account', entry, 'cancel-operation', 16, () => client.moves.length < 4);
  assert.equal(entry.moveTo.status, 'cancelled');
  assert.equal(entry.moveTo.reason, 'operation_cancelled_or_disconnected');
  assert.equal(client.listenerCount('you'), 0);
});

test('runMoveTo retains failed and genuinely stalled outcomes', async () => {
  const rejectedClient = new FakeMovementClient();
  rejectedClient.rejectMoves = true;
  const rejectedEntry = createEntry(rejectedClient, 'rejected-operation');
  const rejectedPool = preparePool(rejectedEntry);
  await (rejectedPool as any).runMoveTo('offline-movement-account', rejectedEntry, 'rejected-operation', 16);
  assert.equal(rejectedEntry.moveTo.status, 'failed');
  assert.equal(rejectedEntry.moveTo.reason, 'movement_command_rejected');
  assert.equal(rejectedClient.listenerCount('you'), 0);

  const stalledClient = new FakeMovementClient();
  stalledClient.emitAuthoritative = false;
  const stalledEntry = createEntry(stalledClient, 'stalled-operation');
  const stalledPool = preparePool(stalledEntry);
  await (stalledPool as any).runMoveTo('offline-movement-account', stalledEntry, 'stalled-operation', 16);
  assert.equal(stalledEntry.moveTo.status, 'blocked');
  assert.equal(stalledEntry.moveTo.reason, 'authoritative_position_stalled');
  assert.equal(stalledClient.listenerCount('you'), 0);
});

test('walkToPortal uses the same predicted stream and keeps authoritative portal semantics', async () => {
  const client = new FakeMovementClient();
  const entry = createEntry(client, 'portal-operation');
  const pool = preparePool(entry);
  const reached = await (pool as any).walkToPortal(
    'offline-movement-account', entry, 'portal-operation', VERIFIED_PORTAL_EDGES[0], () => true,
  );
  assert.equal(reached, true);
  assert.equal(client.listenerCount('you'), 0);
  assert.ok(client.moves.length > 20);
});
