import { AccountRuntime, BotConfig, LogEntry, MapCatalog, MapRequestReceipt } from '../types';
import type { WorldBounds } from './minimap';
import { getToken, notifyAuthRequired } from './auth';

const API_BASE = '/api';
type MapPortal = NonNullable<WorldBounds['portals']>[number];

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) notifyAuthRequired();
  return response;
}

const parseMapPortals = (value: unknown): MapPortal[] | undefined => {
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
    throw new Error(json?.error || `Không tải được geometry map (HTTP ${response.status}).`);
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
  if (typeof data.widthPx === 'number' && Number.isFinite(data.widthPx)
    && typeof data.heightPx === 'number' && Number.isFinite(data.heightPx)
    && data.widthPx > 0 && data.heightPx > 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: data.widthPx,
      maxY: data.heightPx,
      tileSize: typeof data.tileSize === 'number' && Number.isFinite(data.tileSize) ? data.tileSize : undefined,
      portals: parseMapPortals(data.portals),
    };
  }
  throw new Error('Geometry map trả contract không hợp lệ.');
}

export interface MoveToRequest {
  requestId: string;
  mapId: string;
  khu: number;
  epoch?: number;
  x: number;
  y: number;
  arrivalRadius?: number;
}

export interface MoveToReceipt {
  requestId: string;
  operationId: string;
  status: 'accepted' | 'running' | 'arrived' | 'blocked' | 'failed' | 'cancelled';
  mapId: string;
  khu: number;
  x: number;
  y: number;
  updatedAt: number;
  reason: string | null;
}

export interface VitalsRefreshResult {
  status: 'refreshed' | 'skipped' | 'no_ack';
  reason?: string;
  movesSent: number;
  ackLatencyMs?: number;
}

export class VitalsRefreshApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'VitalsRefreshApiError';
  }
}

export async function requestVitalsRefresh(accountId: string): Promise<VitalsRefreshResult> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/vitals/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success || !json?.data || !['refreshed', 'skipped', 'no_ack'].includes(json.data.status)) {
    throw new VitalsRefreshApiError(
      typeof json?.error === 'string' ? json.error : `Không thể làm mới HP (HTTP ${response.status}).`,
      typeof json?.errorCode === 'string' ? json.errorCode : 'VITALS_REFRESH_FAILED',
      response.status,
      json?.retryable === true,
    );
  }
  return json.data as VitalsRefreshResult;
}

export class MoveToApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly acceptedTarget?: { x: number; y: number },
  ) {
    super(message);
    this.name = 'MoveToApiError';
  }
}

function parseAcceptedTarget(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const target = value as Record<string, unknown>;
  return typeof target.x === 'number' && Number.isFinite(target.x)
    && typeof target.y === 'number' && Number.isFinite(target.y)
    ? { x: target.x, y: target.y } : undefined;
}

export async function requestMoveTo(accountId: string, input: MoveToRequest): Promise<MoveToReceipt> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/navigation/move-to`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success || !json?.data || typeof json.data.operationId !== 'string') {
    const backendError = typeof json?.error === 'string' ? json.error : null;
    const code = typeof json?.code === 'string' ? json.code : backendError ?? 'move_to_failed';
    const knownMessages: Record<string, string> = {
      target_blocked: 'Vị trí này bị địa hình chặn. Hãy chọn một điểm khác gần đó.',
      target_out_of_bounds: 'Vị trí nằm ngoài phạm vi bản đồ.',
      world_context_stale_or_mismatch: 'Context map/khu đã cũ hoặc không khớp với trạng thái nhân vật.',
      vitals_unknown: 'Chưa có HP xác thực; hãy thử lại sau khi game gửi trạng thái nhân vật.',
      character_down: 'Nhân vật đang gục; thao tác di chuyển bị khóa.',
      operation_in_progress: 'Một thao tác di chuyển hoặc điều hướng khác đang chạy.',
      request_id_conflict: 'Request ID này đã được dùng cho một đích di chuyển khác.',
    };
    const message = typeof json?.message === 'string' ? json.message
      : knownMessages[code] ?? backendError ?? `Không thể di chuyển tới tọa độ (HTTP ${response.status}).`;
    const acceptedTarget = parseAcceptedTarget(
      json?.acceptedTarget ?? json?.nearestTarget ?? json?.data?.acceptedTarget ?? json?.data?.nearestTarget,
    );
    throw new MoveToApiError(message, code, response.status, acceptedTarget);
  }
  return json.data as MoveToReceipt;
}

export async function cancelMoveTo(accountId: string, operationId: string): Promise<MoveToReceipt> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/navigation/move-to/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success || !json?.data || typeof json.data.operationId !== 'string') {
    throw new Error(json?.error || `Không thể hủy di chuyển (HTTP ${response.status}).`);
  }
  return json.data as MoveToReceipt;
}

export async function fetchObservedMaps(): Promise<MapCatalog> {
  const response = await apiFetch(`${API_BASE}/maps`);
  if (!response.ok) throw new Error(`Map catalog API trả HTTP ${response.status}.`);
  const json = await response.json();
  if (!json?.success || json?.source !== 'public_client_catalog' || typeof json?.status !== 'string' || !Array.isArray(json?.data)) {
    throw new Error('Map catalog API trả contract không hợp lệ.');
  }

  const maps = json.data.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const map = item as { mapId?: unknown; name?: unknown; scope?: unknown; soKhu?: unknown; lastSeenAt?: unknown; observed?: unknown; catalogSource?: unknown };
    if (typeof map.mapId !== 'string' || !map.mapId.trim()) return [];
    const name = typeof map.name === 'string' && map.name.trim() ? map.name : map.mapId;
    const scope = map.scope === 'shared' || map.scope === 'personal' ? map.scope : null;
    const soKhu = typeof map.soKhu === 'number' && Number.isFinite(map.soKhu) ? map.soKhu : null;
    const lastSeenAt = typeof map.lastSeenAt === 'number' && Number.isFinite(map.lastSeenAt) ? map.lastSeenAt : null;
    const observed = map.observed === true;
    const catalogSource = map.catalogSource === 'observed_packet' ? 'observed_packet' : 'public_client';
    return [{ id: map.mapId, name, scope, soKhu, lastSeenAt, observed, catalogSource }];
  });

  return {
    source: 'public_client_catalog',
    status: json.status.toLowerCase() === 'unavailable' ? 'unavailable' : maps.length > 0 ? 'available' : 'empty',
    maps,
  };
}

export async function requestMapEntry(accountId: string, mapId: string): Promise<MapRequestReceipt> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/map/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapId }),
  });
  const json = await response.json();
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || `Không thể gửi yêu cầu chuyển map (HTTP ${response.status}).`);
  }
  if (!['navigation_started', 'already_at_destination'].includes(json?.data?.status)
    || json?.data?.mapId !== mapId
    || (json?.data?.operationId !== null && typeof json?.data?.operationId !== 'string')
    || !Array.isArray(json?.data?.route)) {
    throw new Error('API chuyển map trả xác nhận không hợp lệ.');
  }
  return {
    status: json.data.status,
    mapId,
    operationId: json.data.operationId ?? null,
    route: json.data.route,
  };
}

export async function fetchAccounts(): Promise<AccountRuntime[]> {
  const res = await apiFetch(`${API_BASE}/accounts`);
  const json = await res.json();
  return json.data || [];
}

export async function createAccount(data: {
  accountName: string;
  password?: string;
  token?: string;
  proxyUrl?: string;
}): Promise<AccountRuntime> {
  const res = await apiFetch(`${API_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function updatePassword(id: string, password: string): Promise<AccountRuntime> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function deleteAccount(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}`, { method: 'DELETE' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
}

export async function startBot(id: string): Promise<AccountRuntime> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}/start`, { method: 'POST' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function stopBot(id: string): Promise<AccountRuntime> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}/stop`, { method: 'POST' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function restartBot(id: string): Promise<AccountRuntime> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}/restart`, { method: 'POST' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function triggerAction(id: string, action: 'sell' | 'farm' | 'checkin'): Promise<any> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.result;
}

export async function fetchBotConfig(id: string): Promise<BotConfig> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}/config`);
  const json = await res.json();
  return json.data;
}

export async function updateBotConfig(id: string, config: Partial<BotConfig>): Promise<BotConfig> {
  const res = await apiFetch(`${API_BASE}/accounts/${id}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function startAllBots(): Promise<AccountRuntime[]> {
  const res = await apiFetch(`${API_BASE}/orchestrator/start-all`, { method: 'POST' });
  const json = await res.json();
  return json.data;
}

export async function stopAllBots(): Promise<AccountRuntime[]> {
  const res = await apiFetch(`${API_BASE}/orchestrator/stop-all`, { method: 'POST' });
  const json = await res.json();
  return json.data;
}

export async function fetchLogs(accountId?: string, limit: number = 100): Promise<LogEntry[]> {
  const url = accountId ? `${API_BASE}/accounts/${accountId}/logs?limit=${limit}` : `${API_BASE}/logs?limit=${limit}`;
  const res = await apiFetch(url);
  const json = await res.json();
  return json.data || [];
}
