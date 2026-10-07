import type { AccountRuntime, MapDataContext, MapEntityContext } from '../types';

export const MAP_CONTEXT_TTL_MS = 15_000;
export const ENTITY_CONTEXT_TTL_MS = 5_000;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readMapId = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' && value.trim() ? value : undefined;
const readKhu = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
const readObservedAt = (value: unknown): number | null | undefined =>
  value === null ? null : isFiniteNumber(value) && value >= 0 ? value : undefined;

export function sanitizeMapContext(value: unknown): MapDataContext | undefined {
  if (!isRecord(value)) return undefined;
  const mapId = readMapId(value.mapId);
  const khu = readKhu(value.khu);
  const observedAt = readObservedAt(value.observedAt);
  if (mapId === undefined || khu === undefined || observedAt === undefined || typeof value.fresh !== 'boolean') return undefined;
  const soKhu = value.soKhu === null || value.soKhu === undefined ? null
    : isFiniteNumber(value.soKhu) && value.soKhu > 0 ? value.soKhu : undefined;
  if (soKhu === undefined) return undefined;
  return { mapId, khu, soKhu, observedAt, fresh: value.fresh };
}

export function sanitizeEntityContext(value: unknown): MapEntityContext | undefined {
  if (!isRecord(value)) return undefined;
  const mapId = readMapId(value.mapId);
  const khu = readKhu(value.khu);
  const observedAt = readObservedAt(value.observedAt);
  if (mapId === undefined || khu === undefined || observedAt === undefined || typeof value.fresh !== 'boolean') return undefined;
  return { mapId, khu, observedAt, fresh: value.fresh };
}

interface ContextLike { mapId: string | null; khu: number | null; observedAt: number | null }

export function isContextNewer(previous: ContextLike | null | undefined, next: ContextLike): boolean {
  if (!previous || previous.mapId !== next.mapId || previous.khu !== next.khu) return true;
  if (next.observedAt === null || previous.observedAt === null) return true;
  return next.observedAt >= previous.observedAt;
}

export function isOlderEpoch(previous: unknown, next: unknown): boolean {
  return isFiniteNumber(previous) && isFiniteNumber(next) && next < previous;
}

export type MapContextView =
  | { usable: true; mapId: string; khu: number; ageMs: number }
  | { usable: false; reason: 'missing' | 'not_current' | 'expired' | 'mismatch'; ageMs: number | null };

export function resolveMapContext(
  account: Pick<AccountRuntime, 'mapContext' | 'mapContextAgeMs' | 'mapContextIsCurrent' | 'mapContextReceivedAt' | 'mapId' | 'khu'>,
  now: number = Date.now(),
): MapContextView {
  const ctx = account.mapContext;
  if (!ctx || ctx.mapId === null || ctx.khu === null) return { usable: false, reason: 'missing', ageMs: null };

  let ageMs: number | null = null;
  if (isFiniteNumber(account.mapContextAgeMs) && account.mapContextAgeMs >= 0 && isFiniteNumber(account.mapContextReceivedAt)) {
    ageMs = account.mapContextAgeMs + Math.max(0, now - account.mapContextReceivedAt);
  } else if (isFiniteNumber(ctx.observedAt)) {
    ageMs = Math.max(0, now - ctx.observedAt);
  }
  if (ageMs === null) return { usable: false, reason: 'missing', ageMs: null };
  if (!(account.mapContextIsCurrent ?? ctx.fresh)) return { usable: false, reason: 'not_current', ageMs };
  if (ageMs > MAP_CONTEXT_TTL_MS) return { usable: false, reason: 'expired', ageMs };
  if (account.mapId && (account.mapId !== ctx.mapId || account.khu !== ctx.khu)) {
    return { usable: false, reason: 'mismatch', ageMs };
  }
  return { usable: true, mapId: ctx.mapId, khu: ctx.khu, ageMs };
}

export function isEntityContextValid(
  ctx: MapEntityContext | null | undefined,
  view: MapContextView,
  ttlMs: number | null,
  now: number = Date.now(),
): boolean {
  if (!view.usable || !ctx || !ctx.fresh || ctx.mapId !== view.mapId || ctx.khu !== view.khu) return false;
  if (ttlMs !== null) {
    if (ctx.observedAt === null || Math.max(0, now - ctx.observedAt) > ttlMs) return false;
  }
  return true;
}

export const describeContextBlock = (view: MapContextView, ttlMs = MAP_CONTEXT_TTL_MS): string | null => {
  if (view.usable) return null;
  const age = view.ageMs === null ? '—' : `${Math.floor(view.ageMs / 1000)}s`;
  switch (view.reason) {
    case 'missing': return 'Chưa có map context từ backend';
    case 'not_current': return `Backend báo context không còn khớp client (tuổi ${age}); chờ snapshot mới`;
    case 'expired': return `Map context quá hạn: ${age} > TTL ${ttlMs / 1000}s; chờ snapshot mới`;
    case 'mismatch': return 'Vị trí và map context đang khác map/khu; chờ đồng bộ';
  }
};
