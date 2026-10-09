import crypto from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 6;

export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en-US');
}

export function validateUsername(value: unknown): string {
  const normalized = normalizeUsername(value);
  if (!normalized || normalized.length > 64) throw new Error('USERNAME_INVALID');
  return normalized;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
  return value;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  });
  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function parseHash(encoded: string): { n: number; r: number; p: number; salt: Buffer; digest: Buffer } | null {
  const match = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(encoded);
  if (!match) return null;
  const [, nText, rText, pText, saltText, digestText] = match;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)
    || n < 1024 || r < 1 || p < 1 || n > 1_048_576 || r > 64 || p > 16) return null;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const digest = Buffer.from(digestText, 'base64url');
    if (salt.length < 8 || digest.length !== KEY_LENGTH) return null;
    return { n, r, p, salt, digest };
  } catch {
    return null;
  }
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = parseHash(encoded);
  if (!parsed) return false;
  try {
    const candidate = crypto.scryptSync(password, parsed.salt, parsed.digest.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: 32 * 1024 * 1024,
    });
    return candidate.length === parsed.digest.length && crypto.timingSafeEqual(candidate, parsed.digest);
  } catch {
    return false;
  }
}

export const DUMMY_PASSWORD_HASH = hashPassword('invalid-login-dummy');

