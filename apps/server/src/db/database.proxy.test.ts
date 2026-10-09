import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseService } from './database.js';

test('proxy records encrypt URL, assign atomically, and enforce capacity', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutien2d-proxy-db-'));
  process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-long-enough';
  const service = new DatabaseService(dataDir);
  try {
    const admin = service.getUsers().find((user) => user.role === 'admin');
    assert.ok(admin);
    const proxy = service.createProxy({
      label: 'local-test-proxy',
      scheme: 'http',
      url: 'http://proxy.example:8080',
      maxAccounts: 1,
      createdBy: admin.id,
    });
    assert.equal(service.getProxySecret(proxy.id), 'http://proxy.example:8080');
    assert.doesNotMatch(proxy.urlEncrypted, /proxy\\.example|8080/);

    const account = service.createAccount('proxy-fixture-account', { legacyToken: 'fixture-token' }, null, admin.id, {
      proxyId: proxy.id,
      requireProxy: true,
    });
    assert.equal(account.proxyId, proxy.id);
    assert.equal(service.getProxyAssignedCount(proxy.id), 1);
    assert.throws(() => service.createAccount('proxy-fixture-account-2', { legacyToken: 'fixture-token-2' }, null, admin.id, {
      proxyId: proxy.id,
      requireProxy: true,
    }), /NO_PROXY_AVAILABLE|PROXY_FULL/);
    assert.throws(() => service.deleteProxy(proxy.id), /PROXY_IN_USE/);
    assert.equal('proxyId' in service.toPublic(account), false);
  } finally {
    service.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
