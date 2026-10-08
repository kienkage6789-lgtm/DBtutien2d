import assert from 'node:assert/strict';
import test from 'node:test';
import { vendorAutoErrorResponse } from './vendor-auto-errors.js';
import { moveToErrorResponse } from './move-to-errors.js';

test('vendor Auto errors use explicit machine codes and retry semantics', () => {
  assert.deepEqual(vendorAutoErrorResponse('VENDOR_CHARACTER_DOWN'), {
    status: 409,
    body: {
      success: false,
      error: 'VENDOR_CHARACTER_DOWN',
      errorCode: 'VENDOR_CHARACTER_DOWN',
      retryable: false,
    },
  });
  assert.equal(vendorAutoErrorResponse('VENDOR_VITALS_UNKNOWN').body.retryable, true);
  assert.equal(vendorAutoErrorResponse('VENDOR_NOT_RUNNING').status, 409);
  assert.deepEqual(vendorAutoErrorResponse('VENDOR_MAP_NOT_READY'), {
    status: 409,
    body: {
      success: false,
      error: 'VENDOR_MAP_NOT_READY',
      errorCode: 'VENDOR_MAP_NOT_READY',
      retryable: true,
    },
  });
  assert.deepEqual(vendorAutoErrorResponse('AUTO_ANCHOR_MAP_MISMATCH'), {
    status: 409,
    body: {
      success: false,
      error: 'AUTO_ANCHOR_MAP_MISMATCH',
      errorCode: 'AUTO_ANCHOR_MAP_MISMATCH',
      retryable: false,
    },
  });
  assert.equal(vendorAutoErrorResponse('AUTO_ANCHOR_MAP_UNKNOWN').body.retryable, false);
});

test('move-to errors follow the approved HTTP table and retry envelope', () => {
  assert.deepEqual(moveToErrorResponse('NOT_IN_GAME'), {
    status: 409,
    body: { success: false, error: 'NOT_IN_GAME', errorCode: 'NOT_IN_GAME', retryable: true },
  });
  assert.deepEqual(moveToErrorResponse('VENDOR_MAP_NOT_READY'), {
    status: 409,
    body: { success: false, error: 'VENDOR_MAP_NOT_READY', errorCode: 'VENDOR_MAP_NOT_READY', retryable: true },
  });
  assert.equal(moveToErrorResponse('CHARACTER_DOWN').status, 409);
  assert.equal(moveToErrorResponse('AUTO_ACTIVE').status, 409);
  assert.equal(moveToErrorResponse('OPERATION_IN_PROGRESS').status, 409);
  assert.equal(moveToErrorResponse('TARGET_INVALID').status, 400);
  assert.equal(moveToErrorResponse('TARGET_UNREACHABLE').status, 422);
  assert.equal(moveToErrorResponse('TARGET_ON_PORTAL').status, 422);
  assert.equal(moveToErrorResponse('ROUTE_UNAVAILABLE').status, 422);
  assert.equal(moveToErrorResponse('PATH_CROSSES_PORTAL').status, 422);
  assert.equal(moveToErrorResponse('OPERATION_NOT_FOUND').status, 404);
});
