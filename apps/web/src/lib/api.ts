import type { AccountRuntime, AdminProxy, AdminUser, AuditLogEntry, AuthUser, DailyOperation, DailySeedTask, DailyStatus, GardenOperation, GardenSnapshot, InventoryEquipmentItem, InventorySnapshot, KhuInfo, LogEntry, MoveToOperation, MoveToStatus, QuestSnapshot, ReachableMap } from '../types';
import type { WorldBounds } from './minimap';
import { sanitizeKhuList } from './khu';
import { getToken, notifyAuthRequired, setToken } from './auth';

const API_BASE = '/api';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export class ApiRequestError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) notifyAuthRequired();
  return response;
}

function parseApiUser(value: unknown): AuthUser | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const user = value as Record<string, unknown>;
  const rawEntitlement = user.entitlement;
  if (!rawEntitlement || typeof rawEntitlement !== 'object' || Array.isArray(rawEntitlement)) return undefined;
  const entitlement = rawEntitlement as Record<string, unknown>;
  if (typeof user.id !== 'string' || typeof user.username !== 'string'
    || (user.role !== 'admin' && user.role !== 'user')
    || (user.status !== 'active' && user.status !== 'disabled')
    || (user.expiresAt !== null && !isFiniteNumber(user.expiresAt))
    || !Number.isInteger(user.maxBots) || Number(user.maxBots) < 0 || Number(user.maxBots) > 1000
    || typeof user.mustChangePassword !== 'boolean'
    || !['admin', 'active', 'expired', 'none', 'disabled'].includes(String(entitlement.state))
    || (entitlement.expiresAt !== null && !isFiniteNumber(entitlement.expiresAt))
    || (entitlement.remainingMs !== null && !isFiniteNumber(entitlement.remainingMs))) return undefined;
  const rawUsage = user.usage;
  const usage = rawUsage === undefined ? undefined : rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
    && Number.isInteger((rawUsage as Record<string, unknown>).accounts)
    && Number.isInteger((rawUsage as Record<string, unknown>).running)
    && Number.isInteger((rawUsage as Record<string, unknown>).maxBots)
    && Number((rawUsage as Record<string, unknown>).accounts) >= 0
    && Number((rawUsage as Record<string, unknown>).running) >= 0
    && Number((rawUsage as Record<string, unknown>).maxBots) >= 0
    ? {
      accounts: Number((rawUsage as Record<string, unknown>).accounts),
      running: Number((rawUsage as Record<string, unknown>).running),
      maxBots: Number((rawUsage as Record<string, unknown>).maxBots),
    } : undefined;
  if (rawUsage !== undefined && !usage) return undefined;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    expiresAt: user.expiresAt as number | null,
    maxBots: Number(user.maxBots),
    mustChangePassword: user.mustChangePassword,
    entitlement: {
      state: entitlement.state as AuthUser['entitlement']['state'],
      expiresAt: entitlement.expiresAt as number | null,
      remainingMs: entitlement.remainingMs as number | null,
    },
    ...(usage ? { usage } : {}),
  };
}

export function sanitizeAdminUser(value: unknown): AdminUser | undefined {
  const base = parseApiUser(value);
  if (!base || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const usage = item.usage;
  if (typeof item.createdAt !== 'string' || (item.lastLoginAt !== null && typeof item.lastLoginAt !== 'string')
    || (item.createdBy !== null && typeof item.createdBy !== 'string')
    || !usage || typeof usage !== 'object' || Array.isArray(usage)
    || !Number.isInteger(item.activeSessions) || Number(item.activeSessions) < 0) return undefined;
  const usageItem = usage as Record<string, unknown>;
  if (![usageItem.accounts, usageItem.running, usageItem.maxBots].every((field) => Number.isInteger(field) && Number(field) >= 0)) return undefined;
  return {
    ...base,
    createdAt: item.createdAt,
    lastLoginAt: item.lastLoginAt as string | null,
    createdBy: item.createdBy as string | null,
    usage: {
      accounts: Number(usageItem.accounts),
      running: Number(usageItem.running),
      maxBots: Number(usageItem.maxBots),
    },
    activeSessions: Number(item.activeSessions),
  };
}

export function sanitizeAuditLog(value: unknown): AuditLogEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const actor = item.actor;
  const parsedActor = actor === null ? null : actor && typeof actor === 'object' && !Array.isArray(actor)
    && typeof (actor as Record<string, unknown>).id === 'string'
    && typeof (actor as Record<string, unknown>).username === 'string'
    ? { id: (actor as Record<string, string>).id, username: (actor as Record<string, string>).username } : undefined;
  if (typeof item.id !== 'string' || !item.id || !isFiniteNumber(item.at) || typeof item.action !== 'string'
    || parsedActor === undefined || typeof item.targetType !== 'string'
    || (item.targetId !== null && typeof item.targetId !== 'string')
    || (item.targetName !== undefined && typeof item.targetName !== 'string')
    || typeof item.detail !== 'string') return undefined;
  return {
    id: item.id,
    at: item.at,
    action: item.action,
    actor: parsedActor,
    targetType: item.targetType,
    targetId: item.targetId as string | null,
    ...(typeof item.targetName === 'string' ? { targetName: item.targetName } : {}),
    detail: item.detail,
  };
}

function attachServerClock(user: AuthUser, json: Record<string, unknown> | null): AuthUser {
  const serverNow = typeof json?.serverNow === 'number' && Number.isFinite(json.serverNow) ? json.serverNow : null;
  return serverNow === null ? user : { ...user, serverClockOffsetMs: serverNow - Date.now() };
}

function apiError(json: Record<string, unknown> | null, response: Response, fallback: string): ApiRequestError {
  const message = typeof json?.error === 'string' ? json.error : fallback;
  const code = typeof json?.errorCode === 'string' ? json.errorCode : undefined;
  const retryAfterSec = response.status === 429 ? Number(response.headers.get('Retry-After') ?? 0) || undefined : undefined;
  return new ApiRequestError(code ? `${message} [${code}]` : message, response.status, code, retryAfterSec);
}

export async function login(username: string, password: string): Promise<{ user: AuthUser; sessionExpiresAt: number | null }> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const parsedUser = parseApiUser(json?.user);
  const user = parsedUser ? attachServerClock(parsedUser, json) : undefined;
  const token = typeof json?.token === 'string' ? json.token : '';
  if (!response.ok || json?.success !== true || !user || !token) {
    const retryAfterSec = response.status === 429
      ? Number(response.headers.get('Retry-After') ?? 0) || undefined : undefined;
    throw new ApiRequestError(
      typeof json?.errorCode === 'string' && typeof json?.error === 'string' ? `${json.error} [${json.errorCode}]` : typeof json?.error === 'string' ? json.error : 'Đăng nhập thất bại.',
      response.status,
      typeof json?.errorCode === 'string' ? json.errorCode : undefined,
      retryAfterSec,
    );
  }
  setToken(token);
  return {
    user,
    sessionExpiresAt: typeof json?.sessionExpiresAt === 'number' ? json.sessionExpiresAt : null,
  };
}

export async function fetchCurrentUser(): Promise<{ user: AuthUser; sessionExpiresAt: number | null }> {
  const response = await apiFetch(`${API_BASE}/auth/me`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const parsedUser = parseApiUser(json?.user);
  const user = parsedUser ? attachServerClock(parsedUser, json) : undefined;
  if (!response.ok || json?.success !== true || !user) {
    throw new ApiRequestError(typeof json?.error === 'string' ? json.error : 'Phiên đăng nhập không hợp lệ.', response.status, typeof json?.errorCode === 'string' ? json.errorCode : undefined);
  }
  return { user, sessionExpiresAt: typeof json?.sessionExpiresAt === 'number' ? json.sessionExpiresAt : null };
}

export async function logout(): Promise<void> {
  const response = await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  if (!response.ok && response.status !== 401) {
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    throw new ApiRequestError(typeof json?.error === 'string' ? json.error : 'Không thể đăng xuất.', response.status);
  }
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  const response = await apiFetch(`${API_BASE}/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const parsedUser = parseApiUser(json?.user);
  const user = parsedUser ? attachServerClock(parsedUser, json) : undefined;
  if (!response.ok || json?.success !== true || !user) {
    throw new ApiRequestError(typeof json?.error === 'string' ? json.error : 'Không thể đổi mật khẩu.', response.status, typeof json?.errorCode === 'string' ? json.errorCode : undefined);
  }
  return user;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const response = await apiFetch(`${API_BASE}/admin/users`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true || !Array.isArray(json?.data)) throw apiError(json, response, 'Không thể tải danh sách người dùng.');
  const users = json.data.map(sanitizeAdminUser);
  if (users.some((user) => !user)) throw new ApiRequestError('Dữ liệu người dùng không hợp lệ.', response.status);
  return users.filter((user): user is AdminUser => user !== undefined);
}

export function sanitizeAdminProxy(value: unknown): AdminProxy | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.label !== 'string' || (item.scheme !== 'http' && item.scheme !== 'socks5')
    || typeof item.endpoint !== 'string' || typeof item.hasAuth !== 'boolean' || !Number.isInteger(item.maxAccounts)
    || typeof item.enabled !== 'boolean' || !['unknown', 'ok', 'down'].includes(String(item.status))
    || (item.lastCheckAt !== null && !isFiniteNumber(item.lastCheckAt)) || (item.lastLatencyMs !== null && !isFiniteNumber(item.lastLatencyMs))
    || (item.lastError !== null && typeof item.lastError !== 'string') || !Number.isInteger(item.assigned) || !Array.isArray(item.accounts)
    || typeof item.createdAt !== 'string') return undefined;
  const accounts = item.accounts.flatMap((account) => {
    if (!account || typeof account !== 'object' || Array.isArray(account)) return [];
    const row = account as Record<string, unknown>;
    return typeof row.id === 'string' && typeof row.accountName === 'string' && typeof row.ownerUsername === 'string' && typeof row.running === 'boolean'
      ? [{ id: row.id, accountName: row.accountName, ownerUsername: row.ownerUsername, running: row.running }] : [];
  });
  if (accounts.length !== item.accounts.length) return undefined;
  return {
    id: item.id, label: item.label, scheme: item.scheme, endpoint: item.endpoint, hasAuth: item.hasAuth,
    maxAccounts: Number(item.maxAccounts), enabled: item.enabled, status: item.status as AdminProxy['status'],
    lastCheckAt: item.lastCheckAt as number | null, lastLatencyMs: item.lastLatencyMs as number | null,
    lastError: item.lastError as string | null, assigned: Number(item.assigned), accounts, createdAt: item.createdAt,
  };
}

export async function fetchAdminProxies(): Promise<AdminProxy[]> {
  const response = await apiFetch(`${API_BASE}/admin/proxies`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true || !Array.isArray(json?.data)) throw apiError(json, response, 'Không thể tải danh sách proxy.');
  const proxies = json.data.map(sanitizeAdminProxy);
  if (proxies.some((proxy) => !proxy)) throw new ApiRequestError('Dữ liệu proxy không hợp lệ.', response.status);
  return proxies.filter((proxy): proxy is AdminProxy => proxy !== undefined);
}

export async function createAdminProxy(input: { label: string; url: string; maxAccounts: number }): Promise<AdminProxy> {
  const json = await adminMutation('/admin/proxies', 'POST', input);
  const proxy = sanitizeAdminProxy(json.data);
  if (!proxy) throw new ApiRequestError('Dữ liệu proxy mới không hợp lệ.', 200);
  return proxy;
}

export async function updateAdminProxy(id: string, input: { label?: string; url?: string; maxAccounts?: number; enabled?: boolean }): Promise<AdminProxy> {
  const json = await adminMutation(`/admin/proxies/${encodeURIComponent(id)}`, 'PATCH', input);
  const proxy = sanitizeAdminProxy(json.data);
  if (!proxy) throw new ApiRequestError('Dữ liệu proxy không hợp lệ.', 200);
  return proxy;
}

export async function checkAdminProxy(id: string): Promise<AdminProxy> {
  const json = await adminMutation(`/admin/proxies/${encodeURIComponent(id)}/check`, 'POST');
  const proxy = sanitizeAdminProxy(json.data);
  if (!proxy) throw new ApiRequestError('Dữ liệu proxy không hợp lệ.', 200);
  return proxy;
}

export async function deleteAdminProxy(id: string): Promise<void> {
  await adminMutation(`/admin/proxies/${encodeURIComponent(id)}`, 'DELETE');
}

export async function setAccountProxy(id: string, proxyId: string | null): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/admin/accounts/${encodeURIComponent(id)}/proxy`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proxyId }),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true) throw apiError(json, response, 'Không thể gán proxy.');
  return json.data as AccountRuntime;
}

async function adminMutation(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await apiFetch(`${API_BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true) throw apiError(json, response, 'Không thể thực hiện thao tác quản trị.');
  return json ?? {};
}

export async function createAdminUser(input: { username: string; password: string; maxBots: number }): Promise<AdminUser> {
  const json = await adminMutation('/admin/users', 'POST', input);
  const user = sanitizeAdminUser(json.data);
  if (!user) throw new ApiRequestError('Dữ liệu người dùng mới không hợp lệ.', 200);
  return user;
}

export async function updateAdminUser(id: string, input: { status?: 'active' | 'disabled'; maxBots?: number }): Promise<void> {
  await adminMutation(`/admin/users/${encodeURIComponent(id)}`, 'PATCH', input);
}

export async function grantAdminUser(id: string, duration: '1d' | '7d' | '30d'): Promise<void> {
  await adminMutation(`/admin/users/${encodeURIComponent(id)}/grant`, 'POST', { duration });
}

export async function setAdminUserExpiry(id: string, expiresAt: number | null): Promise<void> {
  await adminMutation(`/admin/users/${encodeURIComponent(id)}/expiry`, 'POST', { expiresAt });
}

export async function resetAdminUserPassword(id: string, newPassword: string): Promise<void> {
  await adminMutation(`/admin/users/${encodeURIComponent(id)}/password`, 'POST', { newPassword });
}

export async function stopAdminUserBots(id: string): Promise<number> {
  const json = await adminMutation(`/admin/users/${encodeURIComponent(id)}/stop-bots`, 'POST');
  const data = json.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Number.isInteger((data as Record<string, unknown>).stopped)) {
    throw new ApiRequestError('Dữ liệu dừng bot không hợp lệ.', 200);
  }
  return Number((data as Record<string, unknown>).stopped);
}

export async function revokeAdminUserSessions(id: string): Promise<{ revoked: number; preservedCurrent: boolean }> {
  const json = await adminMutation(`/admin/users/${encodeURIComponent(id)}/revoke-sessions`, 'POST');
  const data = json.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiRequestError('Dữ liệu thu hồi phiên không hợp lệ.', 200);
  const item = data as Record<string, unknown>;
  if (!Number.isInteger(item.revoked) || typeof item.preservedCurrent !== 'boolean') throw new ApiRequestError('Dữ liệu thu hồi phiên không hợp lệ.', 200);
  return { revoked: Number(item.revoked), preservedCurrent: item.preservedCurrent };
}

export async function deleteAdminUser(id: string): Promise<void> {
  await adminMutation(`/admin/users/${encodeURIComponent(id)}`, 'DELETE');
}

export async function fetchAdminAudit(limit = 50, before?: number): Promise<{ data: AuditLogEntry[]; nextBefore: number | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set('before', String(before));
  const response = await apiFetch(`${API_BASE}/admin/audit?${params.toString()}`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true || !Array.isArray(json?.data)) throw apiError(json, response, 'Không thể tải nhật ký kiểm toán.');
  const data = json.data.map(sanitizeAuditLog);
  if (data.some((entry) => !entry)) throw new ApiRequestError('Dữ liệu nhật ký kiểm toán không hợp lệ.', response.status);
  const nextBefore = json.nextBefore === null ? null : isFiniteNumber(json.nextBefore) ? json.nextBefore : undefined;
  if (nextBefore === undefined) throw new ApiRequestError('Con trỏ nhật ký kiểm toán không hợp lệ.', response.status);
  return { data: data.filter((entry): entry is AuditLogEntry => entry !== undefined), nextBefore };
}

const parseMapPortals = (value: unknown): NonNullable<WorldBounds['portals']> | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((portal) => {
    if (!portal || typeof portal !== 'object' || Array.isArray(portal)) return [];
    const item = portal as Record<string, unknown>;
    if (typeof item.portalId !== 'string' || typeof item.fromMapId !== 'string'
      || typeof item.toMapId !== 'string' || !Number.isInteger(item.tx) || !Number.isInteger(item.ty)) return [];
    return [{
      portalId: item.portalId,
      fromMapId: item.fromMapId,
      toMapId: item.toMapId,
      tx: item.tx as number,
      ty: item.ty as number,
      ...(typeof item.label === 'string' ? { label: item.label } : {}),
    }];
  });
};

export async function fetchMapGeometry(mapId: string): Promise<WorldBounds> {
  const response = await apiFetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}/geometry`);
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success || !json?.data || typeof json.data !== 'object') {
    throw new Error(json?.error || `Map geometry unavailable (HTTP ${response.status}).`);
  }
  const data = json.data as Record<string, unknown>;
  const bounds = data.bounds;
  if (bounds && typeof bounds === 'object' && !Array.isArray(bounds)) {
    const candidate = bounds as Record<string, unknown>;
    if ([candidate.minX, candidate.minY, candidate.maxX, candidate.maxY].every((value) => typeof value === 'number' && Number.isFinite(value))
      && Number(candidate.maxX) > Number(candidate.minX) && Number(candidate.maxY) > Number(candidate.minY)) {
      return {
        minX: Number(candidate.minX),
        minY: Number(candidate.minY),
        maxX: Number(candidate.maxX),
        maxY: Number(candidate.maxY),
        tileSize: typeof data.tileSize === 'number' && Number.isFinite(data.tileSize) ? data.tileSize : undefined,
        portals: parseMapPortals(data.portals),
      };
    }
  }
  throw new Error('Map geometry contract is invalid.');
}

export async function fetchAccounts(): Promise<AccountRuntime[]> {
  const response = await apiFetch(`${API_BASE}/accounts`);
  const json = await response.json();
  return json.data || [];
}

export interface MapCatalogItem {
  mapId: string;
  name: string;
  scope?: string | null;
}

export async function fetchMapCatalog(): Promise<MapCatalogItem[]> {
  const response = await apiFetch(`${API_BASE}/maps`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true || !Array.isArray(json?.data)) return [];
  return json.data.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const map = item as Record<string, unknown>;
    if (typeof map.mapId !== 'string' || typeof map.name !== 'string') return [];
    return [{ mapId: map.mapId, name: map.name, scope: typeof map.scope === 'string' ? map.scope : null }];
  });
}

export async function createAccount(data: {
  accountName: string;
  password?: string;
  token?: string;
}): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể thêm tài khoản.');
  return json.data as AccountRuntime;
}

export async function updatePassword(id: string, password: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể cập nhật mật khẩu game.');
  return json.data as AccountRuntime;
}

export async function startBot(id: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/start`, { method: 'POST' });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể chạy bot.');
  return json.data as AccountRuntime;
}

export async function stopBot(id: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/stop`, { method: 'POST' });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể dừng bot.');
  return json.data as AccountRuntime;
}

export async function startVendorAuto(
  id: string,
  anchor?: { mapId: string; khu: number | null; x: number; y: number },
): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/auto/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(anchor ? { anchor } : {}),
  });
  const json = await response.json();
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể bật Auto.');
  return json.data as AccountRuntime;
}

export async function stopVendorAuto(id: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/auto/stop`, { method: 'POST' });
  const json = await response.json();
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể dừng Auto.');
  return json.data as AccountRuntime;
}

export class MoveToApiError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly acceptedTarget?: { x: number; y: number },
    public readonly retryable = false,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'MoveToApiError';
  }
}

const MOVE_TO_STATUSES = new Set<MoveToStatus>(['accepted', 'running', 'arrived', 'blocked', 'failed', 'cancelled']);
const MAP_ID = /^[a-zA-Z0-9_-]{1,64}$/;
type MoveToLeg = NonNullable<MoveToOperation['leg']>;
const parseRoute = (value: unknown): string[] | undefined => Array.isArray(value)
  && value.every((item) => typeof item === 'string' && MAP_ID.test(item)) ? [...value] : undefined;
const parseLeg = (value: unknown): MoveToLeg | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const leg = value as Record<string, unknown>;
  const phases = new Set(['walking_to_gate', 'on_gate', 'waiting_map', 'walking_to_target']);
  return Number.isInteger(leg.index) && Number(leg.index) >= 0
    && typeof leg.fromMapId === 'string' && MAP_ID.test(leg.fromMapId)
    && (leg.toMapId === null || typeof leg.toMapId === 'string' && MAP_ID.test(leg.toMapId))
    && typeof leg.phase === 'string' && phases.has(leg.phase)
    ? { index: Number(leg.index), fromMapId: leg.fromMapId, toMapId: leg.toMapId as string | null, phase: leg.phase as MoveToLeg['phase'] }
    : undefined;
};

const parsePoint = (value: unknown): { x: number; y: number } | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const point = value as Record<string, unknown>;
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y)
    ? { x: point.x, y: point.y } : undefined;
};

const parseMoveToOperation = (value: unknown): MoveToOperation | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const operation = value as Record<string, unknown>;
  const target = operation.target === null ? null : parsePoint(operation.target);
  const resolvedTarget = operation.resolvedTarget === null ? null : parsePoint(operation.resolvedTarget);
  if (typeof operation.operationId !== 'string' || (target === undefined) || resolvedTarget === undefined
    || typeof operation.status !== 'string' || !MOVE_TO_STATUSES.has(operation.status as MoveToStatus)
    || typeof operation.requester !== 'string'
    || typeof operation.startedAt !== 'number' || !Number.isFinite(operation.startedAt)
    || typeof operation.updatedAt !== 'number' || !Number.isFinite(operation.updatedAt)) return undefined;
  const route = parseRoute(operation.route);
  const leg = parseLeg(operation.leg);
  return {
    operationId: operation.operationId,
    target,
    resolvedTarget,
    status: operation.status as MoveToStatus,
    ...(typeof operation.reason === 'string' ? { reason: operation.reason } : {}),
    requester: operation.requester,
    startedAt: operation.startedAt,
    updatedAt: operation.updatedAt,
    ...(route ? { route } : {}),
    ...(leg ? { leg } : {}),
  };
};

function moveToError(json: Record<string, unknown> | null, response: Response): MoveToApiError {
  const code = typeof json?.errorCode === 'string' ? json.errorCode
    : typeof json?.error === 'string' ? json.error : 'MOVE_TO_FAILED';
  const message = typeof json?.error === 'string' ? json.error : `Không thể di chuyển (HTTP ${response.status}).`;
  const acceptedTarget = parsePoint(json?.acceptedTarget ?? json?.nearestTarget ?? json?.data);
  const retryAfterSec = typeof json?.retryAfterSec === 'number' && Number.isInteger(json.retryAfterSec) && json.retryAfterSec > 0
    ? json.retryAfterSec : undefined;
  return new MoveToApiError(message, code, response.status, acceptedTarget, json?.retryable === true, retryAfterSec);
}

function parseKhuInfo(value: unknown): KhuInfo | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const nullableString = data.mapId === null || typeof data.mapId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(data.mapId);
  const nullablePositiveInteger = (item: unknown): item is number => item === null || typeof item === 'number' && Number.isInteger(item) && item > 0;
  if (!nullableString || !nullablePositiveInteger(data.khu) || !nullablePositiveInteger(data.soKhu)) return undefined;
  const list = sanitizeKhuList(data.list);
  if (list === undefined) return undefined;
  return { mapId: data.mapId as string | null, khu: data.khu as number | null, soKhu: data.soKhu as number | null, list };
}

export async function fetchKhu(accountId: string, refresh = false): Promise<KhuInfo> {
  const suffix = refresh ? '?refresh=1' : '';
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/khu${suffix}`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const data = parseKhuInfo(json?.data);
  if (!response.ok || json?.success !== true || !data) throw moveToError(json, response);
  return data;
}

export async function changeKhu(accountId: string, khu: number): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/khu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ khu }),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true || !json.data || typeof json.data !== 'object') throw moveToError(json, response);
  return json.data as AccountRuntime;
}

export async function fetchReachableMaps(accountId: string): Promise<{ currentMapId: string; maps: ReachableMap[] }> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/reachable-maps`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true || !json.data || typeof json.data !== 'object' || Array.isArray(json.data)) {
    throw moveToError(json, response);
  }
  const data = json.data as Record<string, unknown>;
  const maps = Array.isArray(data.maps) ? data.maps.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const map = item as Record<string, unknown>;
    const route = parseRoute(map.route);
    if (typeof map.mapId !== 'string' || !MAP_ID.test(map.mapId) || !Number.isInteger(map.hops) || Number(map.hops) < 0 || !route) return [];
    return [{ mapId: map.mapId, ...(typeof map.name === 'string' ? { name: map.name } : {}), hops: Number(map.hops), route }];
  }) : [];
  if (typeof data.currentMapId !== 'string' || !MAP_ID.test(data.currentMapId)) throw new Error('Reachable maps contract is invalid.');
  return { currentMapId: data.currentMapId, maps };
}

export async function moveTo(
  accountId: string,
  target?: { x: number; y: number },
  options: { targetMapId?: string; abortOnHurt?: boolean; maxHurt?: number } = {},
): Promise<MoveToOperation> {
  const body = {
    ...(target ? { x: target.x, y: target.y } : {}),
    ...(options.targetMapId !== undefined ? { mapId: options.targetMapId } : {}),
    ...(options.abortOnHurt !== undefined ? { abortOnHurt: options.abortOnHurt } : {}),
    ...(options.maxHurt !== undefined ? { maxHurt: options.maxHurt } : {}),
  };
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/move-to`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const operation = parseMoveToOperation(json?.data);
  if (!response.ok || json?.success !== true || !operation) throw moveToError(json, response);
  return operation;
}

export async function cancelMoveTo(accountId: string, operationId: string): Promise<MoveToOperation> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/move-to/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const operation = parseMoveToOperation(json?.data);
  if (!response.ok || json?.success !== true || !operation) throw moveToError(json, response);
  return operation;
}

export class DailyApiError extends Error {
  public constructor(
    message: string,
    public readonly errorCode: string,
    public readonly httpStatus: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'DailyApiError';
  }
}

const DAILY_STATUSES = new Set<DailyOperation['status']>(['accepted', 'running', 'done', 'failed', 'cancelled']);
const DAILY_KINDS = new Set<DailyOperation['kind']>(['checkin', 'seed']);

function parseDailyOperation(value: unknown): DailyOperation | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.operationId !== 'string' || !item.operationId
    || typeof item.kind !== 'string' || !DAILY_KINDS.has(item.kind as DailyOperation['kind'])
    || typeof item.status !== 'string' || !DAILY_STATUSES.has(item.status as DailyOperation['status'])
    || typeof item.step !== 'string' || !Number.isInteger(item.runIndex) || Number(item.runIndex) < 1
    || !Number.isInteger(item.runsTotal) || Number(item.runsTotal) < 1
    || !isFiniteNumber(item.startedAt) || !isFiniteNumber(item.updatedAt)) return undefined;
  const rewards = item.rewards && typeof item.rewards === 'object' && !Array.isArray(item.rewards) ? item.rewards as Record<string, unknown> : null;
  const parsedRewards = rewards && isFiniteNumber(rewards.stones) && isFiniteNumber(rewards.duocCong)
    ? { stones: Number(rewards.stones), duocCong: Number(rewards.duocCong) } : undefined;
  const progress = item.progress && typeof item.progress === 'object' && !Array.isArray(item.progress) ? item.progress as Record<string, unknown> : null;
  const parsedProgress = progress && typeof progress.itemId === 'string' && isFiniteNumber(progress.collected)
    && isFiniteNumber(progress.required) && progress.collected >= 0 && progress.required > 0
    ? { itemId: progress.itemId, collected: Number(progress.collected), required: Number(progress.required) } : undefined;
  if (item.progress !== undefined && !parsedProgress) return undefined;
  return {
    operationId: item.operationId,
    kind: item.kind as DailyOperation['kind'],
    ...(typeof item.taskId === 'string' ? { taskId: item.taskId } : {}),
    status: item.status as DailyOperation['status'],
    step: item.step,
    runIndex: Number(item.runIndex),
    runsTotal: Number(item.runsTotal),
    ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
    ...(typeof item.why === 'string' ? { why: item.why } : {}),
    ...(parsedRewards ? { rewards: parsedRewards } : {}),
    ...(parsedProgress ? { progress: parsedProgress } : {}),
    startedAt: Number(item.startedAt),
    updatedAt: Number(item.updatedAt),
  };
}

function parseDailyTask(value: unknown): DailySeedTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const nullableNumber = (candidate: unknown): candidate is number | null => candidate === null || Number.isInteger(candidate) && Number(candidate) >= 0;
  return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.kind === 'string'
    && nullableNumber(item.limit) && nullableNumber(item.runsToday) && nullableNumber(item.runsLeft)
    && typeof item.supported === 'boolean' && typeof item.active === 'boolean'
    ? { id: item.id, name: item.name, kind: item.kind, limit: item.limit as number | null, runsToday: item.runsToday as number | null, runsLeft: item.runsLeft as number | null, supported: item.supported, active: item.active }
    : null;
}

export function parseDailyStatus(value: unknown): DailyStatus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const checkin = item.checkin;
  const parsedTasks = Array.isArray(item.seedTasks) ? item.seedTasks.map(parseDailyTask).filter((task): task is DailySeedTask => task !== null) : null;
  if ((item.today !== null && typeof item.today !== 'string') || (item.stage !== null && !isFiniteNumber(item.stage))
    || !checkin || typeof checkin !== 'object' || Array.isArray(checkin)
    || typeof (checkin as Record<string, unknown>).done !== 'boolean'
    || ((checkin as Record<string, unknown>).total !== null && !isFiniteNumber((checkin as Record<string, unknown>).total))
    || !parsedTasks || parsedTasks.length !== (item.seedTasks as unknown[]).length
    || (item.activeSeedTask !== null && typeof item.activeSeedTask !== 'string')
    || !['stones', 'duocCong', 'canhKho', 'namLinhChi', 'fishInBag'].every((field) => item[field] === null || isFiniteNumber(item[field]))) return undefined;
  return {
    today: item.today as string | null,
    stage: item.stage as number | null,
    checkin: { done: (checkin as Record<string, unknown>).done as boolean, total: (checkin as Record<string, unknown>).total as number | null },
    seedTasks: parsedTasks,
    activeSeedTask: item.activeSeedTask as string | null,
    stones: item.stones as number | null,
    duocCong: item.duocCong as number | null,
    canhKho: item.canhKho as number | null,
    namLinhChi: item.namLinhChi as number | null,
    fishInBag: item.fishInBag as number | null,
  };
}

function dailyError(json: Record<string, unknown> | null, response: Response): DailyApiError {
  const code = typeof json?.errorCode === 'string' ? json.errorCode : typeof json?.error === 'string' ? json.error : 'DAILY_FAILED';
  const message = typeof json?.error === 'string' ? json.error : `Không thể chạy nhiệm vụ hằng ngày (HTTP ${response.status}).`;
  return new DailyApiError(message, code, response.status, json?.retryable === true);
}

export async function fetchDaily(accountId: string): Promise<{ status: DailyStatus; current: DailyOperation | null }> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/daily`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const status = parseDailyStatus(json?.data);
  const current = parseDailyOperation(json?.data && typeof json.data === 'object' && !Array.isArray(json.data) ? (json.data as Record<string, unknown>).current : undefined);
  if (!response.ok || json?.success !== true || !status || current === undefined) throw dailyError(json, response);
  return { status, current };
}

export function sanitizeInventory(value: unknown): InventorySnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.known !== 'boolean') return undefined;
  if (!item.known) return { known: false, items: [], bag: null, equipment: null, totalKinds: null, totalCount: null, caveChest: null,
    at: isFiniteNumber(item.at) && item.at >= 0 ? item.at : null };
  if (!Array.isArray(item.items)) return undefined;
  const rawItems = item.items;
  const items = rawItems.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 128
      || typeof entry.name !== 'string' || entry.name.length > 160
      || !isFiniteNumber(entry.count) || !Number.isSafeInteger(entry.count) || entry.count < 0
      || typeof entry.openable !== 'boolean') return [];
    const groups = ['vat-pham', 'trang-bi', 'dao-thuat'];
    const grade = typeof entry.grade === 'string' || typeof entry.grade === 'number' && Number.isFinite(entry.grade) ? entry.grade as string | number : null;
    return [{ id: entry.id, name: entry.name, count: entry.count, openable: entry.openable,
      type: typeof entry.type === 'string' && entry.type.length <= 80 ? entry.type : null,
      grade,
      slot: typeof entry.slot === 'string' && entry.slot.length <= 80 ? entry.slot : null,
      icon: typeof entry.icon === 'string' && entry.icon.length <= 128 ? entry.icon : null,
      desc: typeof entry.desc === 'string' ? entry.desc.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
      group: typeof entry.group === 'string' && groups.includes(entry.group) ? entry.group as 'vat-pham' | 'trang-bi' | 'dao-thuat' : null }];
  });
  const rawBag = item.bag;
  const bag = rawBag && typeof rawBag === 'object' && !Array.isArray(rawBag)
    ? Object.fromEntries(['usedSlots', 'capacity', 'extraSlots', 'maxExtraSlots', 'nextSlotPrice'].map((key) => {
      const value = (rawBag as Record<string, unknown>)[key];
      return [key, isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0 ? value : null];
    })) as InventorySnapshot['bag'] : null;
  const rawEquipment = item.equipment;
  const equipment = Array.isArray(rawEquipment) ? rawEquipment.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const slot = raw as Record<string, unknown>;
    if (typeof slot.slotId !== 'string' || slot.slotId.length > 80 || typeof slot.slotName !== 'string' || slot.slotName.length > 120) return [];
    let equipped: InventoryEquipmentItem | null = null;
    if (slot.item && typeof slot.item === 'object' && !Array.isArray(slot.item)) {
      const value = slot.item as Record<string, unknown>;
      if (typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128 && typeof value.name === 'string' && value.name.length <= 160) {
        equipped = { id: value.id, name: value.name, grade: typeof value.grade === 'string' || typeof value.grade === 'number' && Number.isFinite(value.grade) ? value.grade : null };
      }
    }
    return [{ slotId: slot.slotId, slotName: slot.slotName, item: equipped }];
  }) : null;
  const rawCave = item.caveChest;
  const caveChest = rawCave && typeof rawCave === 'object' && !Array.isArray(rawCave)
    && isFiniteNumber((rawCave as Record<string, unknown>).keyCount)
    && Number.isSafeInteger((rawCave as Record<string, unknown>).keyCount)
    && ((rawCave as Record<string, unknown>).keyCount as number) >= 0
    && typeof (rawCave as Record<string, unknown>).claimed === 'boolean'
    && typeof (rawCave as Record<string, unknown>).active === 'boolean'
    ? { keyCount: (rawCave as Record<string, unknown>).keyCount as number, claimed: (rawCave as Record<string, unknown>).claimed as boolean, active: (rawCave as Record<string, unknown>).active as boolean }
    : null;
  return { known: true, items, bag, equipment,
    totalKinds: isFiniteNumber(item.totalKinds) && Number.isSafeInteger(item.totalKinds) && item.totalKinds >= 0 ? item.totalKinds : null,
    totalCount: isFiniteNumber(item.totalCount) && Number.isSafeInteger(item.totalCount) && item.totalCount >= 0 ? item.totalCount : null,
    caveChest, at: isFiniteNumber(item.at) && item.at >= 0 ? item.at : null };
}

export async function fetchInventory(accountId: string): Promise<InventorySnapshot> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/inventory`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const data = sanitizeInventory(json?.data);
  if (!response.ok || json?.success !== true || !data) {
    const code = typeof json?.errorCode === 'string' ? json.errorCode : 'INVENTORY_FAILED';
    throw new ApiRequestError(code, response.status, code);
  }
  return data;
}

export function sanitizeQuest(value: unknown): QuestSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.known !== 'boolean') return undefined;
  const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null =>
    typeof v === 'number' && Number.isFinite(v) && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;
  const text = (v: unknown, max = 300): string | null => typeof v === 'string'
    ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null : null;
  if (!raw.known) return { known: false, stage: null, stageCount: 34, stageName: null, hint: null, objectives: null, turnInNpc: null,
    stageComplete: null, realm: { id: null, name: null, level: null }, target: { realmId: 'luyen_khi_7', reachedTarget: null, stageGoal: 18 }, nextGate: null,
    at: num(raw.at) };
  const realmRaw = raw.realm && typeof raw.realm === 'object' && !Array.isArray(raw.realm) ? raw.realm as Record<string, unknown> : {};
  const targetRaw = raw.target && typeof raw.target === 'object' && !Array.isArray(raw.target) ? raw.target as Record<string, unknown> : {};
  const stage = typeof raw.stage === 'number' && Number.isFinite(raw.stage) && raw.stage >= 0 && raw.stage <= 34 ? raw.stage : null;
  const objectives = Array.isArray(raw.objectives) ? raw.objectives.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>; const label = text(row.text);
    return label && typeof row.done === 'boolean' ? [{ text: label, done: row.done }] : [];
  }) : null;
  let nextGate: QuestSnapshot['nextGate'] = null;
  if (raw.nextGate && typeof raw.nextGate === 'object' && !Array.isArray(raw.nextGate)) {
    const gate = raw.nextGate as Record<string, unknown>;
    const itemRaw = gate.item && typeof gate.item === 'object' && !Array.isArray(gate.item) ? gate.item as Record<string, unknown> : null;
    const item = itemRaw && typeof itemRaw.id === 'string' && itemRaw.id.length <= 100 && typeof itemRaw.name === 'string'
      ? { id: itemRaw.id, name: text(itemRaw.name) ?? itemRaw.id, qty: num(itemRaw.qty, 1) ?? 1, have: num(itemRaw.have) } : null;
    if (typeof gate.fromRealmId === 'string' && gate.fromRealmId.length <= 100 && typeof gate.toRealmId === 'string' && gate.toRealmId.length <= 100) {
      nextGate = { fromRealmId: gate.fromRealmId, toRealmId: gate.toRealmId, item,
        questStageRequired: num(gate.questStageRequired, 0, 34), stageOk: typeof gate.stageOk === 'boolean' ? gate.stageOk : null,
        expFull: typeof gate.expFull === 'boolean' ? gate.expFull : null, exp: num(gate.exp), expMax: num(gate.expMax),
        ready: typeof gate.ready === 'boolean' ? gate.ready : null };
    }
  }
  return { known: true, stage, stageCount: 34, stageName: text(raw.stageName), hint: text(raw.hint), objectives,
    turnInNpc: text(raw.turnInNpc), stageComplete: typeof raw.stageComplete === 'boolean' ? raw.stageComplete : null,
    realm: { id: text(realmRaw.id, 100), name: text(realmRaw.name), level: num(realmRaw.level, 1, 13) },
    target: { realmId: 'luyen_khi_7', reachedTarget: typeof targetRaw.reachedTarget === 'boolean' ? targetRaw.reachedTarget : null,
      stageGoal: num(targetRaw.stageGoal, 0, 34) ?? 18 }, nextGate, at: num(raw.at) };
}

export async function fetchQuest(accountId: string): Promise<QuestSnapshot> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/quest`);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const data = sanitizeQuest(json?.data);
  if (!response.ok || json?.success !== true || !data) {
    const code = typeof json?.errorCode === 'string' ? json.errorCode : 'QUEST_FAILED';
    throw new ApiRequestError(code, response.status, code);
  }
  return data;
}

export function sanitizeGarden(value: unknown): GardenSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const num = (v: unknown): number | null => isFiniteNumber(v) ? v : null;
  const str = (v: unknown): string | null => typeof v === 'string' ? v.slice(0, 100) : null;
  const plots = Array.isArray(raw.plots) ? raw.plots.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const p = entry as Record<string, unknown>;
    if (typeof p.id !== 'string' || !/^plot_(?:[1-9]|10)$/.test(p.id)) return [];
    const states = ['empty', 'growing', 'ready', 'unknown'];
    return [{ id: p.id, index: Number.isInteger(p.index) ? Number(p.index) : Number(p.id.slice(5)), state: states.includes(String(p.state)) ? p.state as GardenSnapshot['plots'][number]['state'] : 'unknown',
      seedId: str(p.seedId), seedName: str(p.seedName), cropId: str(p.cropId), cropName: str(p.cropName), watered: typeof p.watered === 'boolean' ? p.watered : null, remainSec: num(p.remainSec), readyAt: num(p.readyAt) }];
  }) : [];
  const seeds = Array.isArray(raw.seeds) ? raw.seeds.flatMap((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).seedId === 'string' ? [{
    seedId: String((entry as Record<string, unknown>).seedId).slice(0, 80), name: str((entry as Record<string, unknown>).name) ?? 'Chưa rõ', count: num((entry as Record<string, unknown>).count),
    growSec: num((entry as Record<string, unknown>).growSec), wetSec: num((entry as Record<string, unknown>).wetSec), tier: str((entry as Record<string, unknown>).tier),
  }] : []) : [];
  const packs = Array.isArray(raw.packs) ? raw.packs.flatMap((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).id === 'string' ? [{
    id: String((entry as Record<string, unknown>).id).slice(0, 40), name: str((entry as Record<string, unknown>).name) ?? 'Gói chưa rõ', cost: num((entry as Record<string, unknown>).cost), realm: str((entry as Record<string, unknown>).realm),
    unlocked: typeof (entry as Record<string, unknown>).unlocked === 'boolean' ? (entry as Record<string, unknown>).unlocked as boolean : null,
    affordable: typeof (entry as Record<string, unknown>).affordable === 'boolean' ? (entry as Record<string, unknown>).affordable as boolean : null,
    give: Array.isArray((entry as Record<string, unknown>).give) ? ((entry as Record<string, unknown>).give as unknown[]).flatMap((g) => g && typeof g === 'object' && !Array.isArray(g) && typeof (g as Record<string, unknown>).itemId === 'string' ? [{ itemId: String((g as Record<string, unknown>).itemId).slice(0, 80), name: str((g as Record<string, unknown>).name) ?? 'Vật phẩm', qty: num((g as Record<string, unknown>).qty) }] : []) : [],
  }] : []) : [];
  return { known: raw.known === true, mapId: str(raw.mapId), inGarden: raw.inGarden === true, unlocked: typeof raw.unlocked === 'boolean' ? raw.unlocked : null,
    duocCong: num(raw.duocCong), permanentWater: typeof raw.permanentWater === 'boolean' ? raw.permanentWater : null, at: num(raw.at), plots, seeds, packs, operation: sanitizeGardenOperation(raw.operation) };
}

async function gardenRequest(accountId: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/garden${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true) { const code = typeof json?.errorCode === 'string' ? json.errorCode : 'GARDEN_FAILED'; throw new ApiRequestError(code, response.status, code); }
  return json.data;
}
export async function fetchGarden(accountId: string): Promise<GardenSnapshot> { const data = sanitizeGarden(await gardenRequest(accountId, '')); if (!data) throw new ApiRequestError('GARDEN_INVALID', 502, 'GARDEN_INVALID'); return data; }
export async function fetchGardenOperation(accountId: string): Promise<GardenOperation | null> { const raw = await gardenRequest(accountId, '/operation'); return sanitizeGardenOperation(raw); }
function sanitizeGardenOperation(value: unknown): GardenOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null; const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !['buy-pack', 'sow', 'harvest', 'water', 'scoop'].includes(String(raw.kind)) || !['running', 'done', 'failed', 'cancelled'].includes(String(raw.status))) return null;
  const p = raw.progress && typeof raw.progress === 'object' ? raw.progress as Record<string, unknown> : {};
  if (!Number.isSafeInteger(p.current) || Number(p.current) < 0 || !Number.isSafeInteger(p.total) || Number(p.total) < 0 || !isFiniteNumber(raw.startedAt) || !isFiniteNumber(raw.updatedAt)) return null;
  const results = Array.isArray(raw.results) ? raw.results.flatMap((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).target === 'string' && typeof (entry as Record<string, unknown>).ok === 'boolean' ? [{ target: String((entry as Record<string, unknown>).target).slice(0, 80), ok: (entry as Record<string, unknown>).ok as boolean, ...(typeof (entry as Record<string, unknown>).code === 'string' ? { code: String((entry as Record<string, unknown>).code).slice(0, 80) } : {}) }] : []) : [];
  return { id: raw.id.slice(0, 128), kind: raw.kind as GardenOperation['kind'], status: raw.status as GardenOperation['status'], progress: { current: Number(p.current), total: Number(p.total) }, results, ...(typeof raw.error === 'string' ? { error: raw.error.slice(0, 100) } : {}), ...(typeof raw.errorReason === 'string' ? { errorReason: raw.errorReason.slice(0, 160) } : {}), startedAt: raw.startedAt, updatedAt: raw.updatedAt };
}
export async function startGardenBuyPack(accountId: string, packId: string, times: number): Promise<GardenOperation> { const op = sanitizeGardenOperation(await gardenRequest(accountId, '/buy-pack', { packId, times })); if (!op) throw new ApiRequestError('GARDEN_INVALID', 502, 'GARDEN_INVALID'); return op; }
export async function startGardenSow(accountId: string, seedId: string, plotIds: string[] | 'all-empty', autoTravel = false): Promise<GardenOperation> { const op = sanitizeGardenOperation(await gardenRequest(accountId, '/sow', { seedId, plotIds, autoTravel })); if (!op) throw new ApiRequestError('GARDEN_INVALID', 502, 'GARDEN_INVALID'); return op; }
export async function startGardenHarvest(accountId: string, plotIds: string[] | 'all-ready', autoTravel = false): Promise<GardenOperation> { const op = sanitizeGardenOperation(await gardenRequest(accountId, '/harvest', { plotIds, autoTravel })); if (!op) throw new ApiRequestError('GARDEN_INVALID', 502, 'GARDEN_INVALID'); return op; }
export async function cancelGarden(accountId: string, operationId: string): Promise<GardenOperation> { const op = sanitizeGardenOperation(await gardenRequest(accountId, '/cancel', { operationId })); if (!op) throw new ApiRequestError('GARDEN_INVALID', 502, 'GARDEN_INVALID'); return op; }
export async function startGardenWater(accountId: string, autoTravel = false): Promise<GardenOperation> { const op = sanitizeGardenOperation(await gardenRequest(accountId, '/water', { plotIds: 'all-watering-needed', autoTravel })); if (!op) throw new ApiRequestError('GARDEN_INVALID', 502, 'GARDEN_INVALID'); return op; }
export async function startGardenScoop(accountId: string, autoTravel = false): Promise<GardenOperation> { const op = sanitizeGardenOperation(await gardenRequest(accountId, '/scoop', { autoTravel })); if (!op) throw new ApiRequestError('GARDEN_INVALID', 502, 'GARDEN_INVALID'); return op; }

export function sanitizeCultivationOperation(value: unknown): import('../types').CultivationOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null; const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !['brew', 'meditate', 'breakthrough'].includes(String(raw.kind)) || !['running', 'done', 'failed', 'cancelled'].includes(String(raw.status))) return null;
  const p = raw.progress && typeof raw.progress === 'object' ? raw.progress as Record<string, unknown> : {};
  if (!Number.isSafeInteger(p.current) || Number(p.current) < 0 || !Number.isSafeInteger(p.total) || Number(p.total) < 0 || !isFiniteNumber(raw.startedAt) || !isFiniteNumber(raw.updatedAt)) return null;
  const results = Array.isArray(raw.results) ? raw.results.flatMap((row) => row && typeof row === 'object' && !Array.isArray(row) && typeof (row as Record<string, unknown>).target === 'string' && typeof (row as Record<string, unknown>).ok === 'boolean' ? [{ target: String((row as Record<string, unknown>).target).slice(0, 80), ok: (row as Record<string, unknown>).ok as boolean, ...(typeof (row as Record<string, unknown>).result === 'string' ? { result: String((row as Record<string, unknown>).result).slice(0, 80) } : {}) }] : []) : [];
  return { id: raw.id.slice(0, 128), kind: raw.kind as import('../types').CultivationOperation['kind'], status: raw.status as import('../types').CultivationOperation['status'], progress: { current: Number(p.current), total: Number(p.total) }, results, ...(typeof raw.error === 'string' ? { error: raw.error.slice(0, 100) } : {}), ...(typeof raw.errorReason === 'string' ? { errorReason: raw.errorReason.slice(0, 160) } : {}), startedAt: raw.startedAt, updatedAt: raw.updatedAt };
}
async function cultivationRequest(accountId: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true) { const code = typeof json?.errorCode === 'string' ? json.errorCode : 'CULTIVATION_FAILED'; throw new ApiRequestError(code, response.status, code); }
  return json.data;
}
export function sanitizeCultivationState(raw: unknown): import('../types').CultivationState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>; const recipes = Array.isArray(value.recipes) ? value.recipes.flatMap((r) => r && typeof r === 'object' && !Array.isArray(r) && typeof (r as Record<string, unknown>).id === 'string' ? [{ id: String((r as Record<string, unknown>).id).slice(0, 48), name: typeof (r as Record<string, unknown>).name === 'string' ? String((r as Record<string, unknown>).name).slice(0, 80) : 'Chưa rõ', open: (r as Record<string, unknown>).open === true, recipe: Array.isArray((r as Record<string, unknown>).recipe) ? ((r as Record<string, unknown>).recipe as unknown[]).flatMap((part) => part && typeof part === 'object' && !Array.isArray(part) && typeof (part as Record<string, unknown>).id === 'string' && Number.isSafeInteger((part as Record<string, unknown>).qty) && Number((part as Record<string, unknown>).qty) > 0 ? [{ id: String((part as Record<string, unknown>).id).slice(0, 80), qty: Number((part as Record<string, unknown>).qty) }] : []) : [] }] : []) : [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const str = (v: unknown) => typeof v === 'string' ? v.slice(0, 100) : null;
  return { inGame: value.inGame === true, connected: value.connected === true, down: value.down === true, auto: value.auto === true, mapId: str(value.mapId), realmId: str(value.realmId), exp: num(value.exp), expMax: num(value.expMax), questStage: num(value.questStage), nextGateReady: typeof value.nextGateReady === 'boolean' ? value.nextGateReady : null, gateFrom: str(value.gateFrom), gateTo: str(value.gateTo), gateItemId: str(value.gateItemId), gateItemQty: num(value.gateItemQty), recipes };
}
export async function fetchCultivationState(accountId: string): Promise<import('../types').CultivationState> { const data = sanitizeCultivationState(await cultivationRequest(accountId, '/cultivation')); if (!data) throw new ApiRequestError('CULTIVATION_INVALID', 502, 'CULTIVATION_INVALID'); return data; }
export async function fetchCultivationOperation(accountId: string) { return sanitizeCultivationOperation(await cultivationRequest(accountId, '/cultivation/operation')); }
export async function cancelCultivation(accountId: string, operationId: string) { const op = sanitizeCultivationOperation(await cultivationRequest(accountId, '/cultivation/cancel', { operationId })); if (!op) throw new ApiRequestError('CULTIVATION_INVALID', 502, 'CULTIVATION_INVALID'); return op; }
export async function startBrew(accountId: string, recipeId: string, times: number) { const op = sanitizeCultivationOperation(await cultivationRequest(accountId, '/alchemy/brew', { recipeId, times })); if (!op) throw new ApiRequestError('CULTIVATION_INVALID', 502, 'CULTIVATION_INVALID'); return op; }
export async function startMeditate(accountId: string, on: boolean, untilFull = false) { const op = sanitizeCultivationOperation(await cultivationRequest(accountId, '/cultivation/meditate', { on, ...(untilFull ? { untilFull: true } : {}) })); if (!op) throw new ApiRequestError('CULTIVATION_INVALID', 502, 'CULTIVATION_INVALID'); return op; }
export async function startBreakthrough(accountId: string, useBaoMenh = false) { const op = sanitizeCultivationOperation(await cultivationRequest(accountId, '/cultivation/breakthrough', { useBaoMenh })); if (!op) throw new ApiRequestError('CULTIVATION_INVALID', 502, 'CULTIVATION_INVALID'); return op; }

async function postDaily(path: string, body: Record<string, unknown>): Promise<DailyOperation> {
  const response = await apiFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  const operation = parseDailyOperation(json?.data);
  if (!response.ok || json?.success !== true || !operation) throw dailyError(json, response);
  return operation;
}

export function startDailyCheckin(accountId: string): Promise<DailyOperation> {
  return postDaily(`/accounts/${encodeURIComponent(accountId)}/daily/checkin`, {});
}

export function startDailySeed(accountId: string, taskId: string, options: { runs?: number; abortOnHurt?: boolean; maxHurt?: number } = {}): Promise<DailyOperation> {
  return postDaily(`/accounts/${encodeURIComponent(accountId)}/daily/seed`, { taskId, ...options });
}

export function cancelDaily(accountId: string, operationId: string): Promise<DailyOperation> {
  return postDaily(`/accounts/${encodeURIComponent(accountId)}/daily/cancel`, { operationId });
}

export async function startAllBots(): Promise<AccountRuntime[]> {
  const response = await apiFetch(`${API_BASE}/orchestrator/start-all`, { method: 'POST' });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể bật toàn bộ bot.');
  return json.data as AccountRuntime[];
}

export async function stopAllBots(): Promise<AccountRuntime[]> {
  const response = await apiFetch(`${API_BASE}/orchestrator/stop-all`, { method: 'POST' });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json || json.success !== true) throw apiError(json, response, 'Không thể dừng toàn bộ bot.');
  return json.data as AccountRuntime[];
}

export async function deleteAccount(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || json?.success !== true) throw apiError(json, response, 'Không thể xóa tài khoản.');
}

export async function fetchLogs(accountId?: string, limit = 100): Promise<LogEntry[]> {
  const path = accountId
    ? `${API_BASE}/accounts/${encodeURIComponent(accountId)}/logs?limit=${limit}`
    : `${API_BASE}/logs?limit=${limit}`;
  const response = await apiFetch(path);
  const json = await response.json();
  return json.data || [];
}
