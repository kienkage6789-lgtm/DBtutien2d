import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import { CONFIG } from '../config.js';
import { db } from '../db/database.js';
import { sendError } from './errors.js';
import { DUMMY_PASSWORD_HASH, hashPassword, normalizeUsername, validatePassword, validateUsername, verifyPassword } from './password.js';
import type { DbSession, DbUser, UserRole } from '../db/database.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Principal {
  userId: string | null;
  role: UserRole;
  sessionId: string | null;
  legacyToken: boolean;
}

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
  session?: DbSession;
}

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      session?: DbSession;
      ownedAccount?: { id: string; ownerId: string };
    }
  }
}

const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();

const cleanHeader = (value: string | undefined, maxLength: number): string | null => {
  if (!value) return null;
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength) || null;
};

export function bearerFromHeader(header: string | undefined): string | undefined {
  const token = /^Bearer\s+([^\s]+)$/i.exec(header ?? '')?.[1];
  return token && token.length <= 4096 ? token : undefined;
}

export function originAllowed(origin: string | undefined): boolean {
  return !origin || CONFIG.ALLOWED_ORIGINS.includes(origin);
}

export function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = (value ?? '').replace(/^::ffff:/i, '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function requestAddress(req: Request | IncomingMessage): string {
  const socketAddress = req.socket?.remoteAddress;
  return socketAddress || ('ip' in req && typeof req.ip === 'string' ? req.ip : '') || '';
}

function legacyTokenAllowed(req: Request | IncomingMessage, token: string | undefined): boolean {
  if (!CONFIG.API_TOKEN || !token) return false;
  if (!isLoopbackAddress(requestAddress(req))) return false;
  if (req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['x-real-ip']) return false; // qua reverse proxy: không nhận token cũ
  if (!isLoopbackAddress(CONFIG.HOST) && !CONFIG.ALLOW_LEGACY_API_TOKEN) return false;
  const candidate = digest(token);
  const expected = digest(CONFIG.API_TOKEN);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function tokenMatches(candidate: string | undefined | null): boolean {
  if (!candidate || !CONFIG.API_TOKEN) return false;
  const left = digest(candidate);
  const right = digest(CONFIG.API_TOKEN);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function principalForLegacyToken(req: Request | IncomingMessage): Principal | undefined {
  const protocols = String(req.headers.authorization ?? '').split(',').map((part) => part.trim());
  const token = bearerFromHeader(protocols[0]);
  return legacyTokenAllowed(req, token) ? { userId: null, role: 'admin', sessionId: null, legacyToken: true } : undefined;
}

export interface SessionResolution {
  principal: Principal;
  session?: DbSession;
  user?: DbUser;
}

export function resolveToken(token: string | undefined, req: Request | IncomingMessage, now: number = Date.now(), touch = true): SessionResolution | undefined {
  if (legacyTokenAllowed(req, token)) {
    return { principal: { userId: null, role: 'admin', sessionId: null, legacyToken: true } };
  }
  if (!token) return undefined;
  const session = db.getSessionByHash(digest(token).toString('hex'));
  if (!session) return undefined;
  const user = db.getUserById(session.userId);
  if (!user || user.status !== 'active' || session.expiresAt <= now) {
    if (session.expiresAt <= now) db.deleteSession(session.id);
    return undefined;
  }
  const nextExpiresAt = now + SESSION_TTL_MS;
  if (touch) db.touchSession(session.id, now, nextExpiresAt);
  const nextSession = { ...session, lastSeenAt: now, expiresAt: nextExpiresAt };
  return {
    principal: { userId: user.id, role: user.role, sessionId: session.id, legacyToken: false },
    session: nextSession,
    user,
  };
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = bearerFromHeader(req.headers.authorization);
  const resolved = resolveToken(token, req);
  if (!resolved) {
    sendError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
    return;
  }
  req.principal = resolved.principal;
  req.session = resolved.session;
  next();
}

/** Compatibility name kept for modules that used the old API_TOKEN middleware. */
export const requireAuth = authenticate;

export function verifyWsUpgrade(req: IncomingMessage): { ok: true; principal: Principal; token: string } | { ok: false; code: number; reason: string } {
  if (!originAllowed(req.headers.origin)) return { ok: false, code: 403, reason: 'Origin not allowed' };
  const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const bearerIndex = protocols.indexOf('bearer');
  const token = bearerIndex >= 0 ? protocols[bearerIndex + 1] : undefined;
  const resolved = resolveToken(token, req);
  return resolved ? { ok: true, principal: resolved.principal, token: token ?? '' } : { ok: false, code: 401, reason: 'Unauthorized' };
}

export function publicUser(user: DbUser): {
  id: string;
  username: string;
  role: UserRole;
  status: 'active' | 'disabled';
  expiresAt: number | null;
  maxBots: number;
  mustChangePassword: boolean;
} {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    expiresAt: user.expiresAt,
    maxBots: user.maxBots,
    mustChangePassword: user.mustChangePassword,
  };
}

export function createSession(userId: string, metadata: { ip?: string | null; userAgent?: string | null }, now: number = Date.now()): { token: string; session: DbSession } {
  const token = crypto.randomBytes(32).toString('base64url');
  const session: DbSession = {
    id: `ses_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    userId,
    tokenHash: digest(token).toString('hex'),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    ip: cleanHeader(metadata.ip ?? undefined, 128),
    userAgent: cleanHeader(metadata.userAgent ?? undefined, 256),
  };
  db.createSession(session);
  return { token, session };
}

export interface LoginAttempt {
  user?: DbUser;
  token?: string;
  session?: DbSession;
}

export async function authenticatePassword(usernameInput: unknown, passwordInput: unknown, metadata: { ip?: string; userAgent?: string }, now: number = Date.now()): Promise<LoginAttempt> {
  const username = validateUsername(usernameInput);
  const password = validatePassword(passwordInput);
  const user = db.getUserByUsername(username);
  const hash = user ? db.getPasswordHash(user.id) : DUMMY_PASSWORD_HASH;
  const valid = verifyPassword(password, hash ?? DUMMY_PASSWORD_HASH);
  if (!user || user.status !== 'active' || !valid) return {};
  db.updateUser(user.id, { lastLoginAt: now });
  const created = createSession(user.id, metadata, now);
  return { user: db.getUserById(user.id), token: created.token, session: created.session };
}

export function setPassword(userId: string, password: unknown): void {
  const nextPassword = validatePassword(password);
  db.setPassword(userId, hashPassword(nextPassword), false);
}

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxFailures: number;
  private readonly windowMs: number;

  public constructor(options: { now?: () => number; maxFailures?: number; windowMs?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
  }

  private prune(key: string, now: number): number[] {
    const current = this.failures.get(key) ?? [];
    const recent = current.filter((timestamp) => timestamp > now - this.windowMs);
    if (recent.length > 0) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent;
  }

  public retryAfter(ip: string, username: string): number {
    const now = this.now();
    const candidates = [this.prune(`ip:${ip}`, now), this.prune(`username:${normalizeUsername(username)}`, now)]
      .filter((entries) => entries.length >= this.maxFailures)
      .flatMap((entries) => entries);
    if (candidates.length === 0) return 0;
    const earliest = Math.min(...candidates);
    return Math.max(1, Math.ceil((earliest + this.windowMs - now) / 1000));
  }

  public recordFailure(ip: string, username: string): void {
    const now = this.now();
    for (const key of [`ip:${ip}`, `username:${normalizeUsername(username)}`]) {
      const entries = this.prune(key, now);
      entries.push(now);
      this.failures.set(key, entries.slice(-this.maxFailures));
    }
  }

  public clear(ip: string, username: string): void {
    this.failures.delete(`ip:${ip}`);
    this.failures.delete(`username:${normalizeUsername(username)}`);
  }
}

export const loginRateLimiter = new LoginRateLimiter();

export function requestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
