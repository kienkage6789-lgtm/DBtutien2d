import assert from 'node:assert/strict';
import test from 'node:test';
import { khuErrorResponse } from './khu-errors.js';
import { KhuError } from '../headless/khu-change.js';

test('khu errors follow the HTTP table and preserve retry metadata', () => {
  assert.equal(khuErrorResponse(new KhuError('TARGET_INVALID')).status, 400);
  assert.equal(khuErrorResponse(new KhuError('KHU_ALREADY_HERE')).status, 409);
  assert.equal(khuErrorResponse(new KhuError('MAP_NOT_SPLIT')).status, 422);
  assert.deepEqual(khuErrorResponse(new KhuError('KHU_COOLDOWN', 'Vừa đổi khu, chờ 4 giây nữa.', 4)), {
    status: 429,
    body: {
      success: false,
      error: 'Vừa đổi khu, chờ 4 giây nữa.',
      errorCode: 'KHU_COOLDOWN',
      retryable: true,
      retryAfterSec: 4,
    },
  });
  assert.deepEqual(khuErrorResponse(new KhuError('KHU_REJECTED', 'Từ chối\nngắn')), {
    status: 422,
    body: {
      success: false,
      error: 'Từ chối ngắn',
      errorCode: 'KHU_REJECTED',
      retryable: false,
    },
  });
  assert.equal(khuErrorResponse(new KhuError('KHU_TIMEOUT')).status, 504);
  assert.equal(khuErrorResponse(new KhuError('KHU_TIMEOUT')).body.retryable, true);
});
