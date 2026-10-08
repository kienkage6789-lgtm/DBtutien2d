import type { AccountRuntime, LogEntry } from '../types';
import type { WorldBounds } from './minimap';
import { getToken, notifyAuthRequired } from './auth';

const API_BASE = '/api';

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) notifyAuthRequired();
  return response;
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

export async function createAccount(data: {
  accountName: string;
  password?: string;
  token?: string;
  proxyUrl?: string;
}): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error);
  return json.data;
}

export async function updatePassword(id: string, password: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error);
  return json.data;
}

export async function startBot(id: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/start`, { method: 'POST' });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error);
  return json.data;
}

export async function stopBot(id: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/stop`, { method: 'POST' });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error);
  return json.data;
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
  if (!response.ok || !json.success) throw new Error(json.errorCode ? `${json.error} [${json.errorCode}]` : json.error);
  return json.data;
}

export async function stopVendorAuto(id: string): Promise<AccountRuntime> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/auto/stop`, { method: 'POST' });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.errorCode ? `${json.error} [${json.errorCode}]` : json.error);
  return json.data;
}

export async function startAllBots(): Promise<AccountRuntime[]> {
  const response = await apiFetch(`${API_BASE}/orchestrator/start-all`, { method: 'POST' });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error);
  return json.data;
}

export async function stopAllBots(): Promise<AccountRuntime[]> {
  const response = await apiFetch(`${API_BASE}/orchestrator/stop-all`, { method: 'POST' });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error);
  return json.data;
}

export async function deleteAccount(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error);
}

export async function fetchLogs(accountId?: string, limit = 100): Promise<LogEntry[]> {
  const path = accountId
    ? `${API_BASE}/accounts/${encodeURIComponent(accountId)}/logs?limit=${limit}`
    : `${API_BASE}/logs?limit=${limit}`;
  const response = await apiFetch(path);
  const json = await response.json();
  return json.data || [];
}
