import type { AccountRuntime, DailyOperation, DailySeedTask, DailyStatus, KhuInfo, LogEntry, MoveToOperation, MoveToStatus, ReachableMap } from '../types';
import type { WorldBounds } from './minimap';
import { sanitizeKhuList } from './khu';
import { getToken, notifyAuthRequired } from './auth';

const API_BASE = '/api';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

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
    || !['stones', 'duocCong', 'canhKho'].every((field) => item[field] === null || isFiniteNumber(item[field]))) return undefined;
  return {
    today: item.today as string | null,
    stage: item.stage as number | null,
    checkin: { done: (checkin as Record<string, unknown>).done as boolean, total: (checkin as Record<string, unknown>).total as number | null },
    seedTasks: parsedTasks,
    activeSeedTask: item.activeSeedTask as string | null,
    stones: item.stones as number | null,
    duocCong: item.duocCong as number | null,
    canhKho: item.canhKho as number | null,
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
