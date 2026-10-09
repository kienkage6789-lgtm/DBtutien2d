import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const BACKUP_SCHEMA_VERSION = 1;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function pad(value) { return String(value).padStart(2, '0'); }

export function timestampName(date = new Date()) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function chmodSafe(filePath, mode) {
  try { fs.chmodSync(filePath, mode); } catch { /* Windows does not enforce Unix modes. */ }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSafe(directory, 0o700);
}

function sqlPath(filePath) { return filePath.replaceAll("'", "''"); }

export function integrityCheck(filePath) {
  const sqlite = new DatabaseSync(filePath);
  try {
    const row = sqlite.prepare('PRAGMA integrity_check').get();
    return String(row?.integrity_check ?? Object.values(row ?? {})[0] ?? '') === 'ok';
  } finally {
    sqlite.close();
  }
}

function schemaVersion(filePath) {
  const sqlite = new DatabaseSync(filePath);
  try {
    const row = sqlite.prepare('PRAGMA user_version').get();
    return Number(row?.user_version ?? Object.values(row ?? {})[0] ?? 0);
  } finally {
    sqlite.close();
  }
}

function vacuumInto(sourcePath, destinationPath) {
  const sqlite = new DatabaseSync(sourcePath);
  try {
    sqlite.exec(`VACUUM INTO '${sqlPath(destinationPath)}'`);
  } finally {
    sqlite.close();
  }
}

function fileManifest(directory, names) {
  return names.map((name) => {
    const filePath = path.join(directory, name);
    return { name, size: fs.statSync(filePath).size, sha256: sha256File(filePath) };
  });
}

function uniqueDirectory(rootDirectory, baseName) {
  let candidate = path.join(rootDirectory, baseName);
  let suffix = 1;
  while (fs.existsSync(candidate)) candidate = path.join(rootDirectory, `${baseName}-${suffix++}`);
  return candidate;
}

function regularBackupDirectories(rootDirectory) {
  try {
    return fs.readdirSync(rootDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}(?:-\d+)?$/.test(entry.name))
      .map((entry) => path.join(rootDirectory, entry.name))
      .sort();
  } catch { return []; }
}

function pruneBackups(rootDirectory, keep) {
  const directories = regularBackupDirectories(rootDirectory);
  const safeKeep = Math.max(1, Math.floor(keep));
  for (const directory of directories.slice(0, Math.max(0, directories.length - safeKeep))) {
    // Only generated timestamp directories under the configured backup root are eligible.
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function manifestFor(directory, createdAt, dbPath, fileNames) {
  return {
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: createdAt.toISOString(),
    schemaVersion: schemaVersion(dbPath),
    files: fileManifest(directory, fileNames),
  };
}

export function createBackup({
  dataDir,
  backupDir,
  keep = 14,
  now = new Date(),
} = {}) {
  const resolvedDataDir = path.resolve(dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data'));
  const resolvedBackupDir = path.resolve(backupDir || process.env.BACKUP_DIR || path.join(resolvedDataDir, 'backups'));
  const dbPath = path.join(resolvedDataDir, 'tutien_db.sqlite');
  const secretPath = path.join(resolvedDataDir, '.secret');
  if (!fs.existsSync(dbPath)) throw new Error('SQLite database not found.');
  if (!fs.existsSync(secretPath)) throw new Error('Encryption secret file not found.');

  ensureDirectory(resolvedBackupDir);
  const directory = uniqueDirectory(resolvedBackupDir, timestampName(now));
  ensureDirectory(directory);
  const backupDbPath = path.join(directory, 'tutien_db.sqlite');
  try {
    vacuumInto(dbPath, backupDbPath);
    if (!integrityCheck(backupDbPath)) throw new Error('Backup integrity check failed.');
    fs.copyFileSync(secretPath, path.join(directory, '.secret'), fs.constants.COPYFILE_EXCL);
    chmodSafe(path.join(directory, '.secret'), 0o600);
    const manifest = manifestFor(directory, now, backupDbPath, ['tutien_db.sqlite', '.secret']);
    const manifestPath = path.join(directory, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    chmodSafe(manifestPath, 0o600);
    pruneBackups(resolvedBackupDir, Number.isFinite(keep) ? keep : 14);
    return { directory, manifest };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function createPreRestoreSnapshot({ dataDir, backupDir, now = new Date() } = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  const resolvedBackupDir = path.resolve(backupDir || path.join(resolvedDataDir, 'backups'));
  const dbPath = path.join(resolvedDataDir, 'tutien_db.sqlite');
  if (!fs.existsSync(dbPath)) return null;
  ensureDirectory(resolvedBackupDir);
  const directory = uniqueDirectory(resolvedBackupDir, `pre-restore-${timestampName(now)}`);
  ensureDirectory(directory);
  const targetDb = path.join(directory, 'tutien_db.sqlite');
  try {
    vacuumInto(dbPath, targetDb);
    if (!integrityCheck(targetDb)) throw new Error('Pre-restore integrity check failed.');
    const names = ['tutien_db.sqlite'];
    const secretPath = path.join(resolvedDataDir, '.secret');
    if (fs.existsSync(secretPath)) {
      fs.copyFileSync(secretPath, path.join(directory, '.secret'), fs.constants.COPYFILE_EXCL);
      chmodSafe(path.join(directory, '.secret'), 0o600);
      names.push('.secret');
    }
    const manifest = manifestFor(directory, now, targetDb, names);
    const manifestPath = path.join(directory, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, preRestore: true }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    chmodSafe(manifestPath, 0o600);
    return { directory, manifest };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function parseKeep(value, fallback = 14) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  try {
    const result = createBackup({
      dataDir: process.env.DATA_DIR,
      backupDir: process.env.BACKUP_DIR,
      keep: parseKeep(process.env.BACKUP_KEEP),
    });
    console.log(`Backup created: ${result.directory}`);
  } catch {
    console.error('Backup failed.');
    process.exitCode = 1;
  }
}
