import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('JSON migration is one-time, owner-assigned, and public accounts redact secrets', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutien2d-step1-'));
  process.env.DATA_DIR = dataDir;
  process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-long-enough';
  const legacy = {
    accounts: [{ id: 'acc_fixture', accountName: 'Fixture', proxyUrl: 'http://proxy.invalid', status: 'stopped', stones: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    botConfigs: { acc_fixture: { engine: 'vendor', ignoredLegacyField: true } },
    logs: [{ id: 'log_fixture', accountId: 'acc_fixture', timestamp: Date.now(), level: 'info', module: 'test', message: 'fixture' }],
  };
  await fs.writeFile(path.join(dataDir, 'tutien_db.json'), JSON.stringify(legacy), 'utf8');
  const { db } = await import('./database.js');
  const admin = db.getUsers().find((user) => user.role === 'admin');
  assert.ok(admin);
  const account = db.getAccountById('acc_fixture');
  assert.ok(account);
  assert.equal(account.ownerId, admin.id);
  assert.equal((await fs.stat(path.join(dataDir, 'tutien_db.json.migrated'))).isFile(), true);
  const publicAccount = db.toPublic(account);
  assert.equal('proxyUrl' in publicAccount, false);
  assert.equal('encryptedPassword' in publicAccount, false);
  assert.deepEqual(db.getBotConfig('acc_fixture'), { engine: 'vendor' });
  assert.equal(db.getLogs('acc_fixture', 10).length, 1);
  db.addAuditLog({ actorId: admin.id, action: 'fixture_action', targetType: 'user', targetId: admin.id, detail: 'x\n\t  y' });
  const audit = db.getAuditLogs(10).find((entry) => entry.action === 'fixture_action');
  assert.ok(audit);
  assert.equal(audit.detail, 'x y');
  assert.deepEqual(audit.actor, { id: admin.id, username: admin.username });
  assert.equal(audit.targetName, admin.username);
  db.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});
