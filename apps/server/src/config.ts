import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'node:url';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

/**
 * Master key used to encrypt stored passwords / refresh tokens (AES-256-GCM).
 * Priority: ENCRYPTION_SECRET env var -> persisted random secret in DATA_DIR/.secret
 * (generated on first run). There is intentionally NO hardcoded default.
 */
function resolveEncryptionSecret(): string {
  if (process.env.ENCRYPTION_SECRET && process.env.ENCRYPTION_SECRET.length >= 16) {
    return process.env.ENCRYPTION_SECRET;
  }

  const secretPath = path.join(DATA_DIR, '.secret');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(secretPath)) {
    try { fs.chmodSync(secretPath, 0o600); } catch { /* Windows does not enforce Unix modes. */ }
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(secretPath, 0o600); } catch { /* Windows does not enforce Unix modes. */ }
  console.warn(
    `[TuTien2D Server] ENCRYPTION_SECRET chưa được đặt — đã tạo khóa ngẫu nhiên tại ${secretPath}. ` +
      'Hãy sao lưu file này (mất khóa = không giải mã được mật khẩu đã lưu).'
  );
  return generated;
}

const isLoopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);
const HOST = process.env.HOST || '127.0.0.1';
const API_TOKEN = (process.env.API_TOKEN || '').trim();
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const ALLOW_LEGACY_API_TOKEN = process.env.ALLOW_LEGACY_API_TOKEN === '1';
const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};
const MAX_TOTAL_RUNNERS = parseNonNegativeInt(process.env.MAX_TOTAL_RUNNERS, 0);
const MIN_FREE_MEM_MB = parseNonNegativeInt(process.env.MIN_FREE_MEM_MB, 300);
const ENTITLEMENT_SWEEP_MS = Math.max(100, parseNonNegativeInt(process.env.ENTITLEMENT_SWEEP_MS, 30_000));
const API_RATE_LIMIT_USER_PER_MIN = parseNonNegativeInt(process.env.API_RATE_LIMIT_USER_PER_MIN, 600);
const API_RATE_LIMIT_IP_PER_MIN = parseNonNegativeInt(process.env.API_RATE_LIMIT_IP_PER_MIN, 1200);
const WS_MAX_CONNECTIONS_PER_USER = Math.max(1, parseNonNegativeInt(process.env.WS_MAX_CONNECTIONS_PER_USER, 10));
const WS_MAX_CONNECTIONS_TOTAL = Math.max(1, parseNonNegativeInt(process.env.WS_MAX_CONNECTIONS_TOTAL, 500));
const WS_MAX_MESSAGES_PER_MIN = Math.max(1, parseNonNegativeInt(process.env.WS_MAX_MESSAGES_PER_MIN, 60));

const cleanEnvText = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
const normalizeOrigin = (value: string): string => {
  const cleaned = cleanEnvText(value);
  if (!cleaned || cleaned === '*') return cleaned;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return cleaned;
    return parsed.origin;
  } catch {
    return cleaned;
  }
};
const PUBLIC_ORIGIN = normalizeOrigin(process.env.PUBLIC_ORIGIN || '');
const configuredOrigins = (process.env.ALLOWED_ORIGINS
  || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4000,http://127.0.0.1:4000')
  .split(',').map(normalizeOrigin).filter(Boolean);
if (configuredOrigins.includes('*') || PUBLIC_ORIGIN === '*') {
  throw new Error('ALLOWED_ORIGINS/PUBLIC_ORIGIN không được dùng wildcard *.');
}
const ALLOWED_ORIGINS = Array.from(new Set([
  ...configuredOrigins,
  ...(PUBLIC_ORIGIN ? [PUBLIC_ORIGIN] : []),
]));

if (!isLoopback(HOST) && API_TOKEN.length < 32) {
  throw new Error('HOST không phải loopback thì bắt buộc đặt API_TOKEN >= 32 ký tự.');
}
if (!isLoopback(HOST) && !TRUST_PROXY) {
  throw new Error('HOST ngoài loopback phải chạy sau reverse proxy HTTPS và đặt TRUST_PROXY=1.');
}
if (!ADMIN_USERNAME || ADMIN_USERNAME.length > 64 || ADMIN_PASSWORD.length < 6) {
  throw new Error('ADMIN_USERNAME không rỗng/tối đa 64 ký tự và ADMIN_PASSWORD phải có ít nhất 6 ký tự.');
}

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  HOST,
  API_TOKEN,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  TRUST_PROXY,
  ALLOW_LEGACY_API_TOKEN,
  MAX_TOTAL_RUNNERS,
  MIN_FREE_MEM_MB,
  ENTITLEMENT_SWEEP_MS,
  API_RATE_LIMIT_USER_PER_MIN,
  API_RATE_LIMIT_IP_PER_MIN,
  WS_MAX_CONNECTIONS_PER_USER,
  WS_MAX_CONNECTIONS_TOTAL,
  WS_MAX_MESSAGES_PER_MIN,
  PUBLIC_ORIGIN,
  ALLOWED_ORIGINS,
  DATA_DIR,
  BACKUP_DIR,
  ENCRYPTION_SECRET: resolveEncryptionSecret(),
  GAME_SERVER_URL: process.env.GAME_SERVER_URL || 'wss://game.tutien2d.online/',
  VENDOR_CLIENT_DIR: process.env.VENDOR_CLIENT_DIR || path.join(REPO_ROOT, 'vendor/tutien2d-public-client/2026-10-06'),
  // Public values shipped by the game itself in runtime-config.js (anon key is public by design).
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://qrheujgqeplgozswcsun.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'sb_publishable_v4IGMcr9d15bJCrzq83itw_JfwhpjcZ',
  /** Delay window between consecutive account logins in "start all" (anti login-storm). */
  LOGIN_STAGGER_MS: { min: 1500, max: 4500 },
};
