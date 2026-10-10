import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { versionAtLeast24 } from './check-linux-compat.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

function parseMemAvailableBytes(content) {
  const match = /^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(content);
  return match ? Number(match[1]) * 1024 : null;
}

function readAvailableMemoryBytes() {
  if (process.platform === 'linux') {
    try {
      const parsed = parseMemAvailableBytes(fs.readFileSync('/proc/meminfo', 'utf8'));
      if (parsed !== null) return parsed;
    } catch { /* use os.freemem below */ }
  }
  return os.freemem();
}

function availableMemoryMb(bytes) { return Math.floor(Math.max(0, bytes) / (1024 * 1024)); }

export function modeAtMost(mode, maximum) {
  return (mode & 0o777) & ~(maximum & 0o777) ? false : true;
}

export function isLoopbackHost(value) {
  const normalized = String(value ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function parsePort(value, fallback = 4000) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

export function permissionStatus(filePath, maximum, platform = process.platform) {
  if (platform !== 'linux') return { status: 'WARN', detail: 'Không thể kết luận quyền Unix trên nền tảng này.' };
  try {
    const mode = fs.statSync(filePath).mode;
    return modeAtMost(mode, maximum)
      ? { status: 'PASS', detail: 'quyền Unix phù hợp' }
      : { status: 'FAIL', detail: 'quyền Unix rộng hơn mức cho phép' };
  } catch {
    return { status: 'FAIL', detail: 'không đọc được metadata quyền' };
  }
}

function result(status, label, detail) { return { status, label, detail }; }

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows has no Unix mode enforcement. */ }
}

function addPermissionCheck(results, filePath, maximum, label) {
  if (!fs.existsSync(filePath)) return;
  const check = permissionStatus(filePath, maximum);
  results.push(result(check.status, label, check.detail));
}

export async function isPortAvailable(port, host = '127.0.0.1') {
  return await new Promise((resolve) => {
    const probe = net.createServer();
    const finish = (available) => {
      probe.removeAllListeners();
      try { probe.close(); } catch { /* not listening */ }
      resolve(available);
    };
    probe.once('error', () => finish(false));
    probe.listen({ port, host }, () => finish(true));
  });
}

async function freePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ port: 0, host }, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function openSqliteSmoke() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-preflight-sqlite-'));
  const filePath = path.join(directory, 'check.sqlite');
  try {
    const sqlite = new DatabaseSync(filePath);
    sqlite.exec('CREATE TABLE check_value (id INTEGER PRIMARY KEY); INSERT INTO check_value VALUES (1); PRAGMA integrity_check;');
    sqlite.close();
    return true;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function waitForExit(child, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(child.exitCode ?? 1); return; }
    let settled = false;
    const finish = (code) => { if (!settled) { settled = true; resolve(code ?? 1); } };
    child.once('exit', finish);
    const timer = setTimeout(() => finish(1), timeoutMs);
    timer.unref?.();
  });
}

async function runProcess(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume();
    child.stderr.resume();
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function smokeServer(rootDirectory, results) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-preflight-server-'));
  const port = await freePort();
  const username = 'preflight-admin';
  const password = `P${Buffer.from(cryptoRandomBytes(18)).toString('base64url')}!`;
  const child = spawn(process.execPath, [path.join(rootDirectory, 'apps/server/dist/index.js')], {
    cwd: rootDirectory,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      TRUST_PROXY: '0',
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      ALLOW_LEGACY_API_TOKEN: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  let ok = false;
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`);
        if (health.status === 200) { healthy = true; break; }
      } catch { /* process is still booting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (healthy) {
      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const loginBody = await login.json();
      const token = typeof loginBody?.token === 'string' ? loginBody.token : '';
      const me = token
        ? await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
        : null;
      ok = login.status === 200 && me?.status === 200;
    }
  } catch {
    ok = false;
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  results.push(result(ok ? 'PASS' : 'FAIL', 'Smoke server', ok ? 'health + auth/me hoạt động' : 'không hoàn tất smoke test'));
}

function cryptoRandomBytes(size) {
  // Avoid importing application configuration or any secret-bearing module.
  return crypto.randomBytes(size);
}

export async function runPreflight({ rootDirectory = REPO_ROOT, smoke = false, vendorBoot = false } = {}) {
  const results = [];
  results.push(result(versionAtLeast24(process.versions.node) ? 'PASS' : 'FAIL', 'Node.js', process.versions.node));
  try { results.push(result(openSqliteSmoke() ? 'PASS' : 'FAIL', 'node:sqlite', 'mở DB tạm thành công')); }
  catch { results.push(result('FAIL', 'node:sqlite', 'không mở được DB tạm')); }

  const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDirectory, 'data'));
  try {
    ensureDirectory(dataDir);
    fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
    const check = permissionStatus(dataDir, 0o700);
    results.push(result(check.status, 'DATA_DIR', check.detail));
  } catch { results.push(result('FAIL', 'DATA_DIR', 'không tạo/ghi được thư mục dữ liệu')); }
  addPermissionCheck(results, path.join(dataDir, '.secret'), 0o600, '.secret');
  addPermissionCheck(results, path.join(dataDir, 'tutien_db.sqlite'), 0o600, 'SQLite');

  const vendorDirectory = path.resolve(process.env.VENDOR_CLIENT_DIR || path.join(rootDirectory, 'vendor/tutien2d-public-client/2026-10-06'));
  results.push(result(fs.existsSync(vendorDirectory) ? 'PASS' : 'FAIL', 'Vendor client', fs.existsSync(vendorDirectory) ? 'tồn tại' : 'không tìm thấy'));
  const serverDist = path.join(rootDirectory, 'apps/server/dist');
  const webDist = path.join(rootDirectory, 'apps/web/dist');
  results.push(result(fs.existsSync(serverDist) ? 'PASS' : 'FAIL', 'apps/server/dist', fs.existsSync(serverDist) ? 'đã build' : 'chưa build'));
  results.push(result(fs.existsSync(webDist) ? 'PASS' : 'FAIL', 'apps/web/dist', fs.existsSync(webDist) ? 'đã build' : 'chưa build'));

  const host = process.env.HOST || '127.0.0.1';
  results.push(result(isLoopbackHost(host) ? 'PASS' : 'FAIL', 'HOST', isLoopbackHost(host) ? 'loopback' : 'phải là loopback'));
  const trustHops = /^\d+$/.test(process.env.TRUST_PROXY || '') ? Number(process.env.TRUST_PROXY) : (process.env.TRUST_PROXY === 'true' ? 1 : 0);
  results.push(result(trustHops >= 1 && trustHops <= 10 ? 'PASS' : 'FAIL', 'TRUST_PROXY', trustHops >= 1 && trustHops <= 10 ? `đã bật ${trustHops} hop` : 'phải đặt số hop proxy thật (1..10)'));
  let publicOrigin = false;
  try { publicOrigin = ['http:', 'https:'].includes(new URL(process.env.PUBLIC_ORIGIN || '').protocol); } catch { publicOrigin = false; }
  results.push(result(publicOrigin ? 'PASS' : 'FAIL', 'PUBLIC_ORIGIN', publicOrigin ? 'đã đặt' : 'phải là origin http/https'));

  const port = parsePort(process.env.PORT);
  let available = false;
  try { available = await isPortAvailable(port, host); } catch { available = false; }
  results.push(result(available ? 'PASS' : 'FAIL', 'PORT', available ? `${port} đang trống` : `${port} đang được dùng hoặc không bind được`));
  results.push(result('PASS', 'Tài nguyên', `RAM tổng ${availableMemoryMb(os.totalmem())} MB, khả dụng khoảng ${availableMemoryMb(readAvailableMemoryBytes())} MB; ${os.cpus().length} lõi`));

  if (smoke) await smokeServer(rootDirectory, results);
  if (vendorBoot) {
    const code = await runProcess(process.execPath, [path.join(rootDirectory, 'scripts/spike-vendor-client-boot.cjs')], { cwd: rootDirectory, env: { ...process.env } });
    results.push(result(code === 0 ? 'PASS' : 'FAIL', 'Vendor boot offline', code === 0 ? 'khởi tạo client thành công' : 'khởi tạo client thất bại'));
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  const results = await runPreflight({
    smoke: process.argv.includes('--smoke'),
    vendorBoot: process.argv.includes('--vendor-boot'),
  });
  console.table(results);
  process.exitCode = results.some((entry) => entry.status === 'FAIL') ? 1 : 0;
}
