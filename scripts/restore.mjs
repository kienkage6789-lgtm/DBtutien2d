import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createPreRestoreSnapshot, integrityCheck, sha256File } from './backup.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function chmodSafe(filePath, mode) {
  try { fs.chmodSync(filePath, mode); } catch { /* Windows does not enforce Unix modes. */ }
}

function readManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!value || typeof value !== 'object' || !Array.isArray(value.files)) throw new Error('Invalid backup manifest.');
  return value;
}

function verifyBackup(directory, manifest) {
  if (manifest.backupSchemaVersion !== 1) throw new Error('Unsupported backup manifest.');
  const files = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.name !== 'string' || path.basename(entry.name) !== entry.name
      || (entry.name !== 'tutien_db.sqlite' && entry.name !== '.secret')
      || typeof entry.sha256 !== 'string' || !/^\w{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid backup manifest.');
    const filePath = path.join(directory, entry.name);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== entry.size || sha256File(filePath) !== entry.sha256) {
      throw new Error('Backup checksum verification failed.');
    }
    files.set(entry.name, filePath);
  }
  if (!files.has('tutien_db.sqlite') || !files.has('.secret')) throw new Error('Backup is missing required files.');
  if (!integrityCheck(files.get('tutien_db.sqlite'))) throw new Error('Backup database integrity check failed.');
  return files;
}

function restoreDatabaseIntegrity(filePath) {
  const sqlite = new DatabaseSync(filePath);
  try {
    const row = sqlite.prepare('PRAGMA integrity_check').get();
    return String(row?.integrity_check ?? Object.values(row ?? {})[0] ?? '') === 'ok';
  } finally {
    sqlite.close();
  }
}

export function restoreBackup({ directory, dataDir, backupDir, stopped = false } = {}) {
  if (!stopped) throw new Error('Server must be stopped; pass --i-stopped-the-server.');
  const sourceDirectory = path.resolve(directory);
  const resolvedDataDir = path.resolve(dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data'));
  const resolvedBackupDir = path.resolve(backupDir || process.env.BACKUP_DIR || path.join(resolvedDataDir, 'backups'));
  const manifest = readManifest(sourceDirectory);
  const files = verifyBackup(sourceDirectory, manifest);
  fs.mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(resolvedDataDir, '.restore-'));
  const stagedDb = path.join(staging, 'tutien_db.sqlite');
  const stagedSecret = path.join(staging, '.secret');
  let preRestore;
  try {
    fs.copyFileSync(files.get('tutien_db.sqlite'), stagedDb);
    fs.copyFileSync(files.get('.secret'), stagedSecret);
    chmodSafe(stagedDb, 0o600);
    chmodSafe(stagedSecret, 0o600);
    if (!restoreDatabaseIntegrity(stagedDb)) throw new Error('Staged database integrity check failed.');

    preRestore = createPreRestoreSnapshot({ dataDir: resolvedDataDir, backupDir: resolvedBackupDir });
    const targetDb = path.join(resolvedDataDir, 'tutien_db.sqlite');
    const targetSecret = path.join(resolvedDataDir, '.secret');
    for (const suffix of ['', '-wal', '-shm']) {
      const sidecar = `${targetDb}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    fs.copyFileSync(stagedDb, targetDb);
    fs.copyFileSync(stagedSecret, targetSecret);
    chmodSafe(targetDb, 0o600);
    chmodSafe(targetSecret, 0o600);
    if (!integrityCheck(targetDb)) throw new Error('Restored database integrity check failed.');
  } catch (error) {
    if (preRestore) {
      try {
        const targetDb = path.join(resolvedDataDir, 'tutien_db.sqlite');
        const targetSecret = path.join(resolvedDataDir, '.secret');
        fs.copyFileSync(path.join(preRestore.directory, 'tutien_db.sqlite'), targetDb);
        if (fs.existsSync(path.join(preRestore.directory, '.secret'))) fs.copyFileSync(path.join(preRestore.directory, '.secret'), targetSecret);
      } catch { /* preserve the original restore error */ }
    }
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return { preRestoreDirectory: preRestore?.directory ?? null, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  const directory = process.argv[2];
  if (!directory || !process.argv.includes('--i-stopped-the-server')) {
    console.error('Restore requires <backup-directory> and --i-stopped-the-server.');
    process.exitCode = 1;
  } else {
    try {
      const result = restoreBackup({ directory, dataDir: process.env.DATA_DIR, backupDir: process.env.BACKUP_DIR, stopped: true });
      console.log(`Restore completed. Pre-restore snapshot: ${result.preRestoreDirectory ?? 'none'}`);
    } catch {
      console.error('Restore failed.');
      process.exitCode = 1;
    }
  }
}
