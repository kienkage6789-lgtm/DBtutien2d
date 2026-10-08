import assert from 'node:assert/strict';
import test from 'node:test';
import { vendorAutoErrorResponse } from './vendor-auto-errors.js';

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
  assert.equal(vendorAutoErrorResponse('ENGINE_CORE_ACTIVE: stop core first').status, 409);
  assert.equal(vendorAutoErrorResponse('AUTO_ANCHOR_MAP_UNKNOWN').body.retryable, false);
});
