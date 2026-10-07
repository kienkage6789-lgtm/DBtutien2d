import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PacketTap } from '../dist/debug/packet-tap.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-packet-tap-'));
try {
  const tap = new PacketTap(dir, 60_000, () => 'self-secret-id');
  tap.record({ op: 'state', token: 'DO_NOT_WRITE', hp: 90, save: { mp: 12 } });
  tap.record({ op: 'snap2', pf: [{ id: 'self-secret-id', x: 1, y: 2, hp: 80, name: 'private-name', token: 'row-token' }], ef: [{ id: 7, x: 3, y: 4, kind: 'mob' }] });
  tap.recordOutboundMove({ seq: 41, x: 10.6, y: 20.2, ep: 7, token: 'DO_NOT_WRITE', id: 'private-id' });
  tap.flush();
  const [filename] = fs.readdirSync(dir);
  const raw = fs.readFileSync(path.join(dir, filename), 'utf8');
  const result = JSON.parse(raw);
  assert.deepEqual(result.ops, { state: 1, snap2: 1 });
  assert.equal(result.entityArrays['snap2.pf'].idTypes[0], 'string');
  assert.deepEqual(result.vitalPackets[0].top, { hp: 90 });
  assert.deepEqual(result.vitalPackets[0].save, { mp: 12 });
  assert.equal(result.outboundMoves.length, 1);
  assert.deepEqual(Object.keys(result.outboundMoves[0]).sort(), ['at', 'ep', 'seq', 'x', 'y']);
  assert.equal(result.outboundMoves[0].seq, 41);
  assert.equal(result.outboundMoves[0].x, 11);
  assert.equal(result.outboundMoves[0].y, 20);
  assert.equal(result.outboundMoves[0].ep, 7);
  assert.equal(raw.includes('DO_NOT_WRITE'), false);
  assert.equal(raw.includes('row-token'), false);
  assert.equal(raw.includes('private-name'), false);
  assert.equal(raw.includes('self-secret-id'), false);
  assert.equal(raw.includes('private-id'), false);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('core-client packet tap tests passed');
