import assert from 'node:assert/strict';
import { vitalsRefreshErrorResponse } from './routes.js';

assert.deepEqual(vitalsRefreshErrorResponse('refresh_rate_limited'), {
  status: 409,
  body: {
    success: false,
    error: 'refresh_rate_limited',
    errorCode: 'VITALS_REFRESH_RATE_LIMITED',
    retryable: true,
  },
});
assert.equal(vitalsRefreshErrorResponse('downed_true').status, 409);
assert.equal(vitalsRefreshErrorResponse('downed_true').body.errorCode, 'VITALS_REFRESH_NOT_ALLOWED');
assert.equal(vitalsRefreshErrorResponse('downed_true').body.retryable, false);
assert.equal(vitalsRefreshErrorResponse('refresh_in_progress').body.retryable, true);

// The router is mounted behind requireAuth in apps/server/src/index.ts; this
// contract test deliberately avoids starting a server or reading credentials.
console.log('vitals-refresh API contract tests passed');
