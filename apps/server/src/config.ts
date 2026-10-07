import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

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
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
  console.warn(
    `[TuTien2D Server] ENCRYPTION_SECRET chưa được đặt — đã tạo khóa ngẫu nhiên tại ${secretPath}. ` +
      'Hãy sao lưu file này (mất khóa = không giải mã được mật khẩu đã lưu).'
  );
  return generated;
}

const isLoopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);
const HOST = process.env.HOST || '127.0.0.1';
const API_TOKEN = (process.env.API_TOKEN || '').trim();

if (!isLoopback(HOST) && API_TOKEN.length < 32) {
  throw new Error('HOST không phải loopback thì bắt buộc đặt API_TOKEN >= 32 ký tự.');
}

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  HOST,
  API_TOKEN,
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS
    || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4000,http://127.0.0.1:4000')
    .split(',').map((s) => s.trim()).filter(Boolean),
  DATA_DIR,
  ENCRYPTION_SECRET: resolveEncryptionSecret(),
  GAME_SERVER_URL: process.env.GAME_SERVER_URL || 'wss://game.tutien2d.online/',
  // Public values shipped by the game itself in runtime-config.js (anon key is public by design).
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://qrheujgqeplgozswcsun.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'sb_publishable_v4IGMcr9d15bJCrzq83itw_JfwhpjcZ',
  /** Delay window between consecutive account logins in "start all" (anti login-storm). */
  LOGIN_STAGGER_MS: { min: 1500, max: 4500 },
};
