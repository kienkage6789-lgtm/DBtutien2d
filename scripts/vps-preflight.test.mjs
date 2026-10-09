import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, modeAtMost, parsePort, permissionStatus } from './vps-preflight.mjs';

test('preflight pure checks', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(modeAtMost(0o700, 0o700), true);
  assert.equal(modeAtMost(0o755, 0o700), false);
  assert.equal(parsePort('4000'), 4000);
  assert.equal(parsePort('bad'), 4000);
  assert.equal(permissionStatus('missing-file', 0o600, 'linux').status, 'FAIL');
});
