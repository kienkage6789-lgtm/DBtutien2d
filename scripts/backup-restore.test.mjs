import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, integrityCheck } from './backup.mjs';
import { restoreBackup } from './restore.mjs';

function createTestDb(dataDir, value) {
  const sqlite = new DatabaseSync(path.join(dataDir, 'tutien_db.sqlite'));
  sqlite.exec('CREATE TABLE IF NOT EXISTS values_table (value TEXT NOT NULL); DELETE FROM values_table;');
  sqlite.prepare('INSERT INTO values_table (value) VALUES (?)').run(value);
  sqlite.close();
  fs.writeFileSync(path.join(dataDir, '.secret'), 'test-secret-only-in-temp');
}

function readTestDb(dataDir) {
  const sqlite = new DatabaseSync(path.join(dataDir, 'tutien_db.sqlite'));
  try { return String(sqlite.prepare('SELECT value FROM values_table LIMIT 1').get()?.value ?? ''); }
  finally { sqlite.close(); }
}

test('backup and restore round trip with integrity validation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-backup-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  createTestDb(dataDir, 'before');
  const first = createBackup({ dataDir, backupDir, now: new Date('2026-10-09T00:00:00Z') });
  createTestDb(dataDir, 'after');
  const restored = restoreBackup({ directory: first.directory, dataDir, backupDir, stopped: true });
  assert.equal(readTestDb(dataDir), 'before');
  assert.equal(integrityCheck(path.join(dataDir, 'tutien_db.sqlite')), true);
  assert.ok(restored.preRestoreDirectory);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a changed manifest file and retains backup count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-backup-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  createTestDb(dataDir, 'value');
  const first = createBackup({ dataDir, backupDir, keep: 2, now: new Date('2026-10-09T00:00:00Z') });
  const second = createBackup({ dataDir, backupDir, keep: 2, now: new Date('2026-10-09T00:00:01Z') });
  const third = createBackup({ dataDir, backupDir, keep: 2, now: new Date('2026-10-09T00:00:02Z') });
  assert.equal(fs.readdirSync(backupDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d/.test(entry.name)).length, 2);
  fs.appendFileSync(path.join(third.directory, 'tutien_db.sqlite'), 'tamper');
  assert.throws(() => restoreBackup({ directory: third.directory, dataDir, backupDir, stopped: true }), /checksum/);
  assert.ok(first.directory !== second.directory);
  fs.rmSync(root, { recursive: true, force: true });
});
