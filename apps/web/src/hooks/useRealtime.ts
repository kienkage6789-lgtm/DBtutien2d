import { useState, useEffect, useRef } from 'react';
import { AccountRuntime, DailyOperation, DailySeedTask, DailyStatus, LogEntry, MoveToOperation } from '../types';
import { fetchAccounts, fetchLogs } from '../lib/api';
import { isContextNewer, isOlderEpoch, sanitizeEntityContext, sanitizeMapContext } from '../lib/context';
import { sanitizeKhuList } from '../lib/khu';
import { getToken, notifyAuthRequired, onAuthChanged } from '../lib/auth';

const ACCOUNT_STATUSES = new Set<AccountRuntime['status']>(['running', 'stopped', 'error']);
const VITAL_STATUSES = new Set<NonNullable<AccountRuntime['vitals']>['status']>(['unknown', 'fresh', 'stale', 'invalid', 'conflict']);
const VITAL_SOURCES = new Set<NonNullable<AccountRuntime['vitals']>['source']>(['client', null]);
const MOVE_TO_STATUSES = new Set<MoveToOperation['status']>(['accepted', 'running', 'arrived', 'blocked', 'failed', 'cancelled']);
const DAILY_STATUSES = new Set<DailyOperation['status']>(['accepted', 'running', 'done', 'failed', 'cancelled']);
const DAILY_KINDS = new Set<DailyOperation['kind']>(['checkin', 'seed']);

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value: unknown): value is number | null => value === null || isFiniteNumber(value);

type EntityRow = { id: string; x: number; y: number; [key: string]: unknown };
function sanitizeEntities(value: unknown): EntityRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((row): row is EntityRow => !!row && typeof row === 'object'
    && typeof (row as EntityRow).id === 'string' && (row as EntityRow).id.length > 0
    && isFiniteNumber((row as EntityRow).x) && isFiniteNumber((row as EntityRow).y));
}

function sanitizeVitals(value: unknown, previous?: AccountRuntime['vitals']): AccountRuntime['vitals'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const patch = value as Record<string, unknown>;
  const base = previous ?? {
    hp: null, maxHp: null, mp: null, maxMp: null,
    status: 'unknown' as const, source: null, observedAt: null,
  };
  const next = { ...base };
  for (const field of ['hp', 'maxHp', 'mp', 'maxMp', 'observedAt'] as const) {
    if (hasOwn(patch, field) && isNullableNumber(patch[field])) next[field] = patch[field];
  }
  if (hasOwn(patch, 'status') && typeof patch.status === 'string' && VITAL_STATUSES.has(patch.status as NonNullable<AccountRuntime['vitals']>['status'])) {
    next.status = patch.status as NonNullable<AccountRuntime['vitals']>['status'];
  }
  if (hasOwn(patch, 'source') && VITAL_SOURCES.has(patch.source as NonNullable<AccountRuntime['vitals']>['source'])) {
    next.source = patch.source as NonNullable<AccountRuntime['vitals']>['source'];
  }
  return next;
}

function sanitizeDerivedMax(value: unknown): AccountRuntime['derivedMax'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const patch = value as Record<string, unknown>;
  if (patch.source !== 'derived' || typeof patch.complete !== 'boolean'
    || !isNullableNumber(patch.maxHp) || !isNullableNumber(patch.maxMp)
    || !isNullableNumber(patch.observedAt)) return undefined;
  return {
    maxHp: patch.maxHp,
    maxMp: patch.maxMp,
    complete: patch.complete,
    source: 'derived',
    observedAt: patch.observedAt,
  };
}

const MOVE_TO_MAP_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const MOVE_TO_LEG_PHASES = new Set(['walking_to_gate', 'on_gate', 'waiting_map', 'walking_to_target']);

export function sanitizeMoveTo(value: unknown): AccountRuntime['moveTo'] | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const operation = value as Record<string, unknown>;
  const point = (candidate: unknown): { x: number; y: number } | undefined => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const pointValue = candidate as Record<string, unknown>;
    return isFiniteNumber(pointValue.x) && isFiniteNumber(pointValue.y)
      ? { x: pointValue.x, y: pointValue.y }
      : undefined;
  };
  const target = operation.target === null ? null : point(operation.target);
  const resolvedTarget = operation.resolvedTarget === null ? null : point(operation.resolvedTarget);
  if (typeof operation.operationId !== 'string' || !operation.operationId
    || typeof operation.status !== 'string' || !MOVE_TO_STATUSES.has(operation.status as MoveToOperation['status'])
    || target === undefined || resolvedTarget === undefined
    || typeof operation.requester !== 'string' || !operation.requester
    || !isFiniteNumber(operation.startedAt) || !isFiniteNumber(operation.updatedAt)) return undefined;
  const route = operation.route === undefined
    ? undefined
    : Array.isArray(operation.route) && operation.route.every((item) => typeof item === 'string' && MOVE_TO_MAP_ID.test(item))
      ? [...operation.route]
      : undefined;
  const rawLeg = operation.leg;
  const leg = rawLeg === undefined ? undefined : (() => {
    if (!rawLeg || typeof rawLeg !== 'object' || Array.isArray(rawLeg)) return undefined;
    const value = rawLeg as Record<string, unknown>;
    return Number.isInteger(value.index) && Number(value.index) >= 0
      && typeof value.fromMapId === 'string' && MOVE_TO_MAP_ID.test(value.fromMapId)
      && (value.toMapId === null || typeof value.toMapId === 'string' && MOVE_TO_MAP_ID.test(value.toMapId))
      && typeof value.phase === 'string' && MOVE_TO_LEG_PHASES.has(value.phase)
      ? {
        index: Number(value.index),
        fromMapId: value.fromMapId,
        toMapId: value.toMapId as string | null,
        phase: value.phase as NonNullable<MoveToOperation['leg']>['phase'],
      }
      : undefined;
  })();
  const result: MoveToOperation = {
    operationId: operation.operationId,
    target,
    resolvedTarget,
    status: operation.status as MoveToOperation['status'],
    requester: operation.requester,
    startedAt: operation.startedAt,
    updatedAt: operation.updatedAt,
    ...(route ? { route } : {}),
    ...(leg ? { leg } : {}),
  };
  if (typeof operation.reason === 'string') result.reason = operation.reason;
  return result;
}

export function sanitizeDaily(value: unknown): DailyOperation | null | undefined {
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

function sanitizeDailyTask(value: unknown): DailySeedTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const nullableNumber = (candidate: unknown): candidate is number | null => candidate === null || Number.isInteger(candidate) && Number(candidate) >= 0;
  return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.kind === 'string'
    && nullableNumber(item.limit) && nullableNumber(item.runsToday) && nullableNumber(item.runsLeft)
    && typeof item.supported === 'boolean' && typeof item.active === 'boolean'
    ? { id: item.id, name: item.name, kind: item.kind, limit: item.limit as number | null, runsToday: item.runsToday as number | null, runsLeft: item.runsLeft as number | null, supported: item.supported, active: item.active }
    : null;
}

export function sanitizeDailyStatus(value: unknown): DailyStatus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const checkin = item.checkin;
  const tasks = Array.isArray(item.seedTasks) ? item.seedTasks.map(sanitizeDailyTask).filter((task): task is DailySeedTask => task !== null) : null;
  if ((item.today !== null && typeof item.today !== 'string') || (item.stage !== null && !isFiniteNumber(item.stage))
    || !checkin || typeof checkin !== 'object' || Array.isArray(checkin)
    || typeof (checkin as Record<string, unknown>).done !== 'boolean'
    || ((checkin as Record<string, unknown>).total !== null && !isFiniteNumber((checkin as Record<string, unknown>).total))
    || !tasks || tasks.length !== (item.seedTasks as unknown[]).length
    || (item.activeSeedTask !== null && typeof item.activeSeedTask !== 'string')
    || !['stones', 'duocCong', 'canhKho', 'namLinhChi', 'fishInBag'].every((field) => item[field] === null || isFiniteNumber(item[field]))) return undefined;
  return {
    today: item.today as string | null,
    stage: item.stage as number | null,
    checkin: { done: (checkin as Record<string, unknown>).done as boolean, total: (checkin as Record<string, unknown>).total as number | null },
    seedTasks: tasks,
    activeSeedTask: item.activeSeedTask as string | null,
    stones: item.stones as number | null,
    duocCong: item.duocCong as number | null,
    canhKho: item.canhKho as number | null,
    namLinhChi: item.namLinhChi as number | null,
    fishInBag: item.fishInBag as number | null,
  };
}

export function sanitizeLog(value: unknown): LogEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id || typeof item.accountId !== 'string' || !item.accountId
    || !isFiniteNumber(item.timestamp) || (item.level !== 'info' && item.level !== 'warn' && item.level !== 'error' && item.level !== 'success')
    || typeof item.module !== 'string' || typeof item.message !== 'string') return undefined;
  return { id: item.id, accountId: item.accountId, timestamp: item.timestamp, level: item.level, module: item.module, message: item.message };
}

const WORLD_NUMBER_FIELDS = new Set<string>(['khu', 'x', 'y', 'soKhu']);
const WORLD_STRING_FIELDS = new Set<string>(['mapId']);

/** Merge only validated fields from an untrusted realtime payload. */
export function mergeAccountRuntime(previous: AccountRuntime | undefined, incoming: unknown): AccountRuntime | null {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return previous ?? null;
  const payload = incoming as Record<string, unknown>;
  if (typeof payload.id !== 'string' || !payload.id.trim()) return previous ?? null;
  if (!previous && (typeof payload.status !== 'string' || !ACCOUNT_STATUSES.has(payload.status as AccountRuntime['status']))) return null;

  const next = { ...(previous ?? {} as AccountRuntime), id: payload.id } as AccountRuntime;
  const incomingMapContext = hasOwn(payload, 'mapContext') ? sanitizeMapContext(payload.mapContext) : undefined;
  const incomingEpoch = hasOwn(payload, 'mapContextEpoch') ? payload.mapContextEpoch : undefined;
  const worldAccepted = !incomingMapContext || !previous?.mapContext
    || (isContextNewer(previous.mapContext, incomingMapContext)
      && !isOlderEpoch(previous.mapContextEpoch, incomingEpoch));
  const numberFields = ['hp', 'maxHp', 'mp', 'maxMp', 'khu', 'x', 'y', 'latencyMs', 'soKhu'] as const;
  for (const field of numberFields) {
    if (!worldAccepted && WORLD_NUMBER_FIELDS.has(field)) continue;
    if (hasOwn(payload, field) && isNullableNumber(payload[field])) next[field] = payload[field] as never;
  }
  for (const field of ['accountName', 'connection', 'authError', 'characterName', 'mapId', 'activity'] as const) {
    if (!worldAccepted && WORLD_STRING_FIELDS.has(field)) continue;
    if (hasOwn(payload, field) && (typeof payload[field] === 'string' || payload[field] === null)) next[field] = payload[field] as never;
  }
  if (hasOwn(payload, 'status') && typeof payload.status === 'string' && ACCOUNT_STATUSES.has(payload.status as AccountRuntime['status'])) next.status = payload.status as AccountRuntime['status'];
  if (hasOwn(payload, 'downed') && (typeof payload.downed === 'boolean' || payload.downed === null)) next.downed = payload.downed;
  if (hasOwn(payload, 'moveTo')) {
    const moveTo = sanitizeMoveTo(payload.moveTo);
    if (moveTo !== undefined) next.moveTo = moveTo;
  } else if (payload.status === 'stopped' || payload.status === 'error') {
    next.moveTo = null;
  }
  if (hasOwn(payload, 'daily')) {
    const daily = sanitizeDaily(payload.daily);
    if (daily !== undefined) next.daily = daily;
  } else if (payload.status === 'stopped' || payload.status === 'error') {
    next.daily = null;
  }
  if (hasOwn(payload, 'dailyStatus')) {
    const dailyStatus = sanitizeDailyStatus(payload.dailyStatus);
    if (dailyStatus !== undefined) next.dailyStatus = dailyStatus;
  } else if (payload.status === 'stopped' || payload.status === 'error') {
    next.dailyStatus = null;
  }
  if (hasOwn(payload, 'vendor')) {
    if (payload.vendor && typeof payload.vendor === 'object' && !Array.isArray(payload.vendor)) {
      const vendor = { ...(payload.vendor as Record<string, unknown>) };
      if (hasOwn(vendor, 'moveTo')) {
        const moveTo = sanitizeMoveTo(vendor.moveTo);
        if (moveTo === undefined) delete vendor.moveTo;
        else vendor.moveTo = moveTo;
      }
      if (hasOwn(vendor, 'khuList')) {
        const khuList = sanitizeKhuList(vendor.khuList);
        if (khuList === undefined) delete vendor.khuList;
        else vendor.khuList = khuList;
      }
      if (hasOwn(vendor, 'daily')) {
        const daily = sanitizeDaily(vendor.daily);
        if (daily === undefined) delete vendor.daily;
        else vendor.daily = daily;
      }
      if (hasOwn(vendor, 'dailyStatus')) {
        const dailyStatus = sanitizeDailyStatus(vendor.dailyStatus);
        if (dailyStatus === undefined) delete vendor.dailyStatus;
        else vendor.dailyStatus = dailyStatus;
      }
      next.vendor = vendor as unknown as AccountRuntime['vendor'];
    } else {
      delete next.vendor;
    }
  } else if (payload.status === 'stopped' || payload.status === 'error') {
    delete next.vendor;
  }
  let vitalsAccepted = false;
  if (hasOwn(payload, 'vitals')) {
    const vitals = sanitizeVitals(payload.vitals, previous?.vitals);
    const prevAt = previous?.vitals?.observedAt;
    if (vitals && !(isFiniteNumber(prevAt) && isFiniteNumber(vitals.observedAt) && vitals.observedAt < prevAt)) {
      next.vitals = vitals;
      vitalsAccepted = true;
    }
  }
  if (hasOwn(payload, 'vitalsAgeMs')
    && (payload.vitalsAgeMs === null || isFiniteNumber(payload.vitalsAgeMs) && payload.vitalsAgeMs >= 0)
    && (vitalsAccepted || !hasOwn(payload, 'vitals'))) {
    next.vitalsAgeMs = payload.vitalsAgeMs as number | null;
    next.vitalsReceivedAt = Date.now();
  }
  if (hasOwn(payload, 'derivedMax')) {
    const derivedMax = sanitizeDerivedMax(payload.derivedMax);
    const prevAt = previous?.derivedMax?.observedAt;
    if (derivedMax && !(isFiniteNumber(prevAt) && isFiniteNumber(derivedMax.observedAt) && derivedMax.observedAt < prevAt)) {
      next.derivedMax = derivedMax;
    }
  }
  if (hasOwn(payload, 'dataStatus') && payload.dataStatus && typeof payload.dataStatus === 'object' && !Array.isArray(payload.dataStatus)) {
    const dataStatus = { ...(previous?.dataStatus ?? {}) } as AccountRuntime['dataStatus'];
    for (const key of ['hp', 'maxHp', 'mp', 'location', 'monsters', 'players'] as const) {
      if (hasOwn(payload.dataStatus as object, key) && typeof (payload.dataStatus as Record<string, unknown>)[key] === 'boolean') dataStatus[key] = (payload.dataStatus as Record<string, boolean>)[key];
    }
    next.dataStatus = dataStatus;
  }
  if (worldAccepted) {
    if (incomingMapContext) {
      next.mapContext = incomingMapContext;
      if (hasOwn(payload, 'mapContextAgeMs') && (payload.mapContextAgeMs === null || isFiniteNumber(payload.mapContextAgeMs))) {
        next.mapContextAgeMs = payload.mapContextAgeMs as number | null;
      }
      if (typeof payload.mapContextIsCurrent === 'boolean') next.mapContextIsCurrent = payload.mapContextIsCurrent;
      if (incomingEpoch === null || isFiniteNumber(incomingEpoch)) next.mapContextEpoch = incomingEpoch as number | null;
      next.mapContextReceivedAt = Date.now();
    }
    for (const [contextField, listField] of [['playersContext', 'players'], ['monstersContext', 'monsters']] as const) {
      const context = hasOwn(payload, contextField) ? sanitizeEntityContext(payload[contextField]) : undefined;
      const contextOk = !context || isContextNewer(previous?.[contextField], context);
      if (context && contextOk) next[contextField] = context;
      if (contextOk && hasOwn(payload, listField)) {
        const rows = sanitizeEntities(payload[listField]);
        if (rows) next[listField] = rows as never;
      }
    }
    if (hasOwn(payload, 'khuList')) {
      const khuList = sanitizeKhuList(payload.khuList);
      if (khuList !== undefined) next.khuList = khuList;
    }
  }
  return next;
}

function mergeAccountList(previous: AccountRuntime[], incoming: unknown): AccountRuntime[] {
  if (!Array.isArray(incoming)) return previous;
  const byId = new Map(previous.map((account) => [account.id, account]));
  for (const item of incoming) {
    const merged = mergeAccountRuntime(byId.get((item as { id?: unknown })?.id as string), item);
    if (merged) byId.set(merged.id, merged);
  }
  return Array.from(byId.values());
}

export function useRealtime() {
  const [accounts, setAccounts] = useState<AccountRuntime[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const realtimeVersionRef = useRef(0);

  const mergeFetchedAccounts = async () => {
    const versionAtRequest = realtimeVersionRef.current;
    const data = await fetchAccounts();
    // A WebSocket frame arrived while the HTTP snapshot was in flight. The
    // snapshot may now be older, so let the realtime stream remain authoritative.
    if (versionAtRequest !== realtimeVersionRef.current) return;
    setAccounts((prev) => mergeAccountList(prev, data));
  };

  // Initial fetch
  useEffect(() => {
    const reload = () => {
      if (!getToken()) {
        setAccounts([]);
        setLogs([]);
        return;
      }
      mergeFetchedAccounts().catch(console.error);
      fetchLogs().then((items) => setLogs(items.flatMap((item) => sanitizeLog(item) ? [sanitizeLog(item)!] : []))).catch(console.error);
    };
    reload();
    return onAuthChanged(reload);
  }, []);

  // WebSocket connection
  useEffect(() => {
    let shouldReconnect = true;
    let reconnectTimeout: any = null;
    let reconnectAttempts = 0;
    let reconnectRequested = false;

    function connect() {
      if (!shouldReconnect || !getToken()) { setIsConnected(false); return; }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      const token = getToken();
      let ws: WebSocket;
      try {
        ws = token ? new WebSocket(wsUrl, ['bearer', token]) : new WebSocket(wsUrl);
      } catch {
        setIsConnected(false);
        notifyAuthRequired();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts = 0;
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'initial_state':
              // Re-fetch full runtime data to refresh the authoritative snapshot.
              setAccounts((prev) => mergeAccountList(prev, msg.data?.accounts));
              mergeFetchedAccounts().catch(console.error);
              if (Array.isArray(msg.data?.logs)) {
                setLogs(msg.data.logs.flatMap((item: unknown) => {
                  const log = sanitizeLog(item);
                  return log ? [log] : [];
                }));
              }
              break;

            case 'account_updated': {
              realtimeVersionRef.current += 1;
              setAccounts((prev) => {
                const incomingId = msg.data && typeof msg.data === 'object' ? (msg.data as { id?: unknown }).id : undefined;
                const current = typeof incomingId === 'string' ? prev.find((account) => account.id === incomingId) : undefined;
                const merged = mergeAccountRuntime(current, msg.data);
                if (!merged) return prev;
                return current ? prev.map((account) => account.id === merged.id ? merged : account) : [...prev, merged];
              });
              break;
            }

            case 'bot_activity': {
              if (!msg.data || typeof msg.data !== 'object' || typeof msg.data.accountId !== 'string' || typeof msg.data.activity !== 'string') break;
              const { accountId, activity } = msg.data as { accountId: string; activity: string };
              setAccounts((prev) =>
                prev.map((a) => (a.id === accountId ? { ...a, activity } : a))
              );
              break;
            }

            case 'account_log': {
              const newLog = sanitizeLog(msg.data);
              if (newLog) setLogs((prev) => [...prev.slice(-300), newLog]);
              break;
            }
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (reconnectRequested) {
          reconnectRequested = false;
          connect();
          return;
        }
        if (shouldReconnect) {
          reconnectAttempts += 1;
          if (reconnectAttempts >= 5) {
            notifyAuthRequired();
            return;
          }
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();
    const unsubscribeAuth = onAuthChanged(() => {
      reconnectAttempts = 0;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        reconnectRequested = true;
        wsRef.current.close();
      } else {
        connect();
      }
    });

    return () => {
      shouldReconnect = false;
      unsubscribeAuth();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const refreshAccounts = async () => {
    try {
      await mergeFetchedAccounts();
    } catch (err) {
      console.error(err);
    }
  };

  return {
    accounts,
    logs,
    isConnected,
    refreshAccounts,
    setAccounts,
    setLogs,
  };
}
