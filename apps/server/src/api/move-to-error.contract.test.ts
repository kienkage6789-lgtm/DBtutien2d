import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { apiRouter, moveToErrorResponse, parseLimit } from './routes.js';
import { db } from '../db/database.js';
import { workerPool } from '../orchestrator/worker-pool.js';
import { bearerFromHeader, originAllowed } from '../security/auth.js';

const staleContext = moveToErrorResponse('world_context_stale_or_mismatch');
assert.equal(staleContext.status, 409, 'stale world context maps to HTTP 409');
assert.deepEqual(staleContext.body, {
  success: false,
  error: 'world_context_stale_or_mismatch',
  errorCode: 'world_context_stale_or_mismatch',
  retryable: false,
}, '409 response preserves a machine-readable reason');

const unknownVitals = moveToErrorResponse('vitals_unknown');
assert.equal(unknownVitals.status, 409, 'unknown vitals maps to HTTP 409');
assert.equal(unknownVitals.body.errorCode, 'vitals_unknown');
assert.equal(unknownVitals.body.retryable, true);

const deadCharacter = moveToErrorResponse('character_down');
assert.equal(deadCharacter.status, 409, 'downed character maps to HTTP 409');
assert.equal(deadCharacter.body.errorCode, 'character_down');
assert.equal(deadCharacter.body.retryable, false);

const blockedTarget = moveToErrorResponse('target_blocked', { x: 64, y: 96 });
assert.equal(blockedTarget.status, 422, 'blocked target maps to HTTP 422');
assert.deepEqual(blockedTarget.body, {
  success: false,
  error: 'target_blocked',
  errorCode: 'target_blocked',
  retryable: false,
  code: 'target_blocked',
  acceptedTarget: { x: 64, y: 96 },
  nearestTarget: { x: 64, y: 96 },
}, '422 body preserves target error and nearest walkable target');

assert.equal(parseLimit('0'), 100, 'zero uses a safe default');
assert.equal(parseLimit('abc'), 100, 'invalid limit uses a safe default');
assert.equal(parseLimit('999999'), 500, 'large limits are capped');
assert.equal(parseLimit('17'), 17, 'valid limit is preserved');
assert.equal(bearerFromHeader('Bearer example-token'), 'example-token');
assert.equal(bearerFromHeader('Basic example-token'), undefined);
assert.equal(originAllowed('http://localhost:3000'), true, 'configured dashboard origin is allowed');
assert.equal(originAllowed('http://evil.example'), false, 'unconfigured browser origin is denied');

const originalGetAccountById = db.getAccountById;
const originalRequestMoveTo = workerPool.requestMoveTo;
const accountId = 'move-to-contract-test';
db.getAccountById = ((id: string) => id === accountId ? ({ id, accountName: 'test' }) : null) as typeof db.getAccountById;
workerPool.requestMoveTo = (() => { throw new Error('world_context_stale_or_mismatch'); }) as typeof workerPool.requestMoveTo;

const app = express();
app.use(express.json());
app.use(apiRouter);
const server = createServer(app);
try {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/accounts/${accountId}/navigation/move-to`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'req-test', mapId: 'tan_vien', khu: 1, x: 32, y: 32 }),
  });
  assert.equal(response.status, 409, 'move-to route emits HTTP 409 for stale world context');
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'world_context_stale_or_mismatch',
    errorCode: 'world_context_stale_or_mismatch',
    retryable: false,
  }, 'HTTP response body carries the specific machine-readable rejection reason');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.getAccountById = originalGetAccountById;
  workerPool.requestMoveTo = originalRequestMoveTo;
}

console.log('move-to error contract tests passed');
