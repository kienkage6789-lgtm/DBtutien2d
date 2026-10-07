import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'http';
import { CONFIG } from '../config.js';

const authEnabled = CONFIG.API_TOKEN.length > 0;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest();

export function tokenMatches(candidate: string | undefined | null): boolean {
  if (!authEnabled) return true;
  if (!candidate) return false;
  return crypto.timingSafeEqual(digest(candidate), digest(CONFIG.API_TOKEN));
}

export function bearerFromHeader(header: string | undefined): string | undefined {
  return /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1];
}

export function originAllowed(origin: string | undefined): boolean {
  return !origin || CONFIG.ALLOWED_ORIGINS.includes(origin);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (tokenMatches(bearerFromHeader(req.headers.authorization))) { next(); return; }
  res.status(401).json({ success: false, error: 'Unauthorized', errorCode: 'UNAUTHORIZED', requestId: res.locals.requestId, retryable: false });
}

export function verifyWsUpgrade(req: IncomingMessage): { ok: true } | { ok: false; code: number; reason: string } {
  if (!originAllowed(req.headers.origin)) return { ok: false, code: 403, reason: 'Origin not allowed' };
  if (!authEnabled) return { ok: true };
  const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim());
  const idx = protocols.indexOf('bearer');
  return tokenMatches(idx >= 0 ? protocols[idx + 1] : undefined)
    ? { ok: true } : { ok: false, code: 401, reason: 'Unauthorized' };
}
