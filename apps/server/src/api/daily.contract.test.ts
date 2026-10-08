import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyErrorResponse } from './daily-errors.js';

test('daily error contract keeps status and retry semantics', () => {
  assert.deepEqual(dailyErrorResponse(new Error('VENDOR_MAP_NOT_READY')), {
    status: 409,
    body: { success: false, error: 'VENDOR_MAP_NOT_READY', errorCode: 'VENDOR_MAP_NOT_READY', retryable: true },
  });
  assert.equal(dailyErrorResponse(new Error('STAGE_TOO_LOW')).status, 422);
  assert.equal(dailyErrorResponse(new Error('INVALID_REQUEST')).status, 400);
  assert.equal(dailyErrorResponse(new Error('OPERATION_NOT_FOUND')).status, 404);
  const cleaned = dailyErrorResponse(new Error('DAILY_FAILED: \u0001 lý do\n quá dài'));
  assert.equal(cleaned.body.errorCode, 'DAILY_FAILED');
  assert.equal(cleaned.body.error, 'DAILY_FAILED');
});

