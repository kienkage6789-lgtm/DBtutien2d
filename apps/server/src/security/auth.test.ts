import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('initial admin, sliding sessions, five-session cap, expiry, and rate limit', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutien2d-auth-'));
  process.env.DATA_DIR = dataDir;
  process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-long-enough';
  const auth = await import('./auth.js');
  const { db } = await import('../db/database.js');
  const admin = db.getUsers().find((user) => user.role === 'admin');
  assert.ok(admin);
  assert.equal(admin.mustChangePassword, true);
  const login = await auth.authenticatePassword(' ADMIN ', 'admin123', { ip: '127.0.0.1', userAgent: 'test' }, 1_000);
  assert.ok(login.token && login.session);
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: {} } as unknown as import('node:http').IncomingMessage;
  const touched = auth.resolveToken(login.token, request, 1_001, true);
  assert.equal(touched?.principal.userId, admin.id);
  assert.equal(touched?.session?.expiresAt, 1_001 + auth.SESSION_TTL_MS);
  assert.equal(auth.resolveToken(login.token, request, 1_001 + auth.SESSION_TTL_MS + 1, false), undefined);

  for (let i = 0; i < 5; i += 1) auth.createSession(admin.id, { ip: '127.0.0.1' }, 2_000 + i);
  assert.equal(db.getSessionByHash(login.session.tokenHash), undefined);

  let now = 0;
  const limiter = new auth.LoginRateLimiter({ now: () => now });
  for (let i = 0; i < 5; i += 1) limiter.recordFailure('127.0.0.1', 'Admin');
  assert.ok(limiter.retryAfter('127.0.0.1', 'admin') > 0);
  now = 15 * 60 * 1000 + 1;
  assert.equal(limiter.retryAfter('127.0.0.1', 'admin'), 0);
  db.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});
