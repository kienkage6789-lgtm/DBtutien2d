import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeAccountRuntime, sanitizeAccountOwner, sanitizeCharacter, sanitizeDaily, sanitizeDailyStatus, sanitizeFrameMetrics, sanitizeLog, sanitizeMoveTo, sanitizeSystemAlert } from './useRealtime';

const base = {
  id: 'account-test', status: 'running' as const, accountName: 'test', characterName: 'test',
  hp: null, maxHp: null, mp: null, maxMp: null, mapId: '', khu: 0, x: 0, y: 0,
  latencyMs: 0, activity: 'idle', soKhu: null,
  mapContext: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
  mapContextAgeMs: null, mapContextIsCurrent: false,
  playersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
  monstersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
  dataStatus: { hp: false, maxHp: false, mp: false, location: false, monsters: false, players: false },
  monsters: [], players: [],
};

describe('mergeAccountRuntime vitals freshness', () => {
  afterEach(() => vi.restoreAllMocks());

  it('đóng dấu receipt khi nhận age hợp lệ và giữ snapshot có observedAt mới hơn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    const first = mergeAccountRuntime(undefined, {
      ...base,
      vitals: { hp: 90, maxHp: null, mp: 10, maxMp: null, status: 'fresh', source: 'client', observedAt: 1_000 },
      vitalsAgeMs: 1_000,
    });
    expect(first?.vitalsAgeMs).toBe(1_000);
    expect(first?.vitalsReceivedAt).toBe(2_000);

    vi.spyOn(Date, 'now').mockReturnValue(3_000);
    const older = mergeAccountRuntime(first!, {
      ...base,
      vitals: { hp: 10, maxHp: null, mp: 1, maxMp: null, status: 'fresh', source: 'client', observedAt: 900 },
      vitalsAgeMs: 2_100,
    });
    expect(older?.vitals?.hp).toBe(90);
    expect(older?.vitalsAgeMs).toBe(1_000);
    expect(older?.vitalsReceivedAt).toBe(2_000);
  });

  it('refreshes the official vendor snapshot and clears it after stop', () => {
    const first = mergeAccountRuntime(undefined, {
      ...base,
      vendor: { autoRequested: false, hurtCount: 0 },
    });
    const running = mergeAccountRuntime(first!, {
      ...base,
      vendor: { autoRequested: true, hurtCount: 1 },
    });
    expect(running?.vendor).toMatchObject({ autoRequested: true, hurtCount: 1 });

    const stopped = mergeAccountRuntime(running!, { ...base, status: 'stopped' });
    expect(stopped?.vendor).toBeUndefined();
  });

  it('merges the top-level move-to operation and clears it after stop', () => {
    const moveTo = {
      operationId: 'operation-test',
      target: { x: 100, y: 100 },
      resolvedTarget: { x: 112, y: 112 },
      status: 'running' as const,
      requester: 'user',
      startedAt: 1,
      updatedAt: 2,
    };
    const running = mergeAccountRuntime(undefined, { ...base, moveTo });
    expect(running?.moveTo).toEqual(moveTo);

    const stopped = mergeAccountRuntime(running!, { ...base, status: 'stopped' });
    expect(stopped?.moveTo).toBeNull();
  });

  it('keeps malformed route and leg absent instead of merging nulls', () => {
    const sanitized = sanitizeMoveTo({
      operationId: 'operation-test',
      target: null,
      resolvedTarget: null,
      status: 'running',
      requester: 'user',
      startedAt: 1,
      updatedAt: 2,
      route: ['map-a', 7],
      leg: { index: 0, fromMapId: 'map-a', toMapId: null, phase: 'bad' },
    });
    expect(sanitized).toEqual({
      operationId: 'operation-test',
      target: null,
      resolvedTarget: null,
      status: 'running',
      requester: 'user',
      startedAt: 1,
      updatedAt: 2,
    });
    expect(sanitizeMoveTo({ operationId: 'bad' })).toBeUndefined();
  });

  it('accepts a valid khu list, preserves null, and ignores malformed data', () => {
    const khuList = { mapId: 'tan_vien', khu: 1, dem: [2, 3], toiDa: 20, tran: [20, 20], observedAt: 1_000 };
    const first = mergeAccountRuntime(undefined, { ...base, mapContext: { mapId: 'tan_vien', khu: 1, soKhu: 20, observedAt: 1_000, fresh: true }, khuList });
    expect(first?.khuList).toEqual(khuList);
    const malformed = mergeAccountRuntime(first!, { ...base, mapContext: { mapId: 'tan_vien', khu: 1, soKhu: 20, observedAt: 1_001, fresh: true }, khuList: { ...khuList, dem: ['2'] } });
    expect(malformed?.khuList).toEqual(khuList);
    const cleared = mergeAccountRuntime(malformed!, { ...base, mapContext: { mapId: 'tan_vien', khu: 1, soKhu: 20, observedAt: 1_002, fresh: true }, khuList: null });
    expect(cleared?.khuList).toBeNull();
  });

  it('sanitizes daily operation/status and leaves malformed daily undefined', () => {
    const operation = {
      operationId: 'daily-1', kind: 'seed', status: 'running', step: 'seed_chop', runIndex: 1, runsTotal: 2,
      startedAt: 1, updatedAt: 2,
    };
    expect(sanitizeDaily(operation)).toEqual(operation);
    const linhChiOperation = { ...operation, taskId: 'linh_chi', step: 'seed_harvest', progress: { itemId: 'nam_linh_chi', collected: 2, required: 3 } };
    expect(sanitizeDaily(linhChiOperation)).toEqual(linhChiOperation);
    expect(sanitizeDaily({ ...linhChiOperation, progress: { itemId: 'nam_linh_chi', collected: '2', required: 3 } })).toBeUndefined();
    expect(sanitizeDaily({ ...operation, status: 'unknown' })).toBeUndefined();
    const status = {
      today: '2026-10-08', stage: 21, checkin: { done: false, total: 0 }, activeSeedTask: null,
      stones: 10, duocCong: 2, canhKho: 0,
      namLinhChi: 0, fishInBag: 0,
      seedTasks: [{ id: 'duoc_moc', name: 'Việc Dược Công', kind: 'collect', limit: 3, runsToday: 1, runsLeft: 2, supported: true, active: false }],
    };
    expect(sanitizeDailyStatus(status)).toEqual(status);
    expect(sanitizeDailyStatus({ ...status, seedTasks: [{ ...status.seedTasks[0], runsLeft: '2' }] })).toBeUndefined();
    expect(sanitizeDailyStatus({ ...status, namLinhChi: '2' })).toBeUndefined();
    expect(sanitizeDailyStatus({ ...status, fishInBag: '2' })).toBeUndefined();
  });

  it('returns undefined for malformed realtime log payloads', () => {
    expect(sanitizeLog({ id: 'log-1', accountId: 'account-test', timestamp: 1, level: 'info', module: 'test', message: 'ok' })).toEqual({
      id: 'log-1', accountId: 'account-test', timestamp: 1, level: 'info', module: 'test', message: 'ok',
    });
    expect(sanitizeLog({ id: 'log-1', accountId: 'account-test', timestamp: '1', level: 'info', module: 'test', message: 'bad' })).toBeUndefined();
  });

  it('sanitizes owner-only system alerts', () => {
    expect(sanitizeSystemAlert({ reason: 'expired', message: 'Hạn đã hết.' })).toEqual({ reason: 'expired', message: 'Hạn đã hết.' });
    expect(sanitizeSystemAlert({ reason: 'expired', message: 7 })).toBeUndefined();
  });
});

describe('account ownership sanitizer', () => {
  it('keeps valid owner fields and returns undefined for malformed types', () => {
    expect(sanitizeAccountOwner({ ownerId: 'user-1', ownerUsername: 'alice' })).toEqual({ ownerId: 'user-1', ownerUsername: 'alice' });
    expect(sanitizeAccountOwner({ ownerId: 42 })).toBeUndefined();
    expect(sanitizeAccountOwner({ ownerUsername: '' })).toBeUndefined();
  });
});

describe('character runtime sanitization', () => {
  it('keeps numeric strings unknown and clears character values on stale, stopped, or error updates', () => {
    const malformed = sanitizeCharacter({ sp: '5', bp: Infinity, exp: 3, fresh: true });
    expect(malformed).toMatchObject({ sp: null, bp: null, exp: 3, fresh: true });
    expect(sanitizeCharacter({ sp: '5', bp: '6', exp: '7', fresh: true })?.fresh).toBe(false);
    const character = { realmId: 'r1', realmName: 'Realm', sp: 5, spMax: 10, bp: 6, bpMax: 12, exp: 7, expMax: 14, fresh: true, observedAt: 10 };
    const running = mergeAccountRuntime(undefined, { ...base, character });
    expect(running?.character?.sp).toBe(5);
    expect(mergeAccountRuntime(running!, { ...base, dataStale: true })?.character).toBeNull();
    expect(mergeAccountRuntime(running!, { ...base, status: 'stopped' })?.character).toBeNull();
    expect(mergeAccountRuntime(running!, { ...base, status: 'error' })?.character).toBeNull();
  });

  it('sanitizes auto resume pending state and ignores malformed values', () => {
    const pending = mergeAccountRuntime(undefined, { ...base,
      vendor: { autoRequested: true, hurtCount: 0, autoResume: { pending: true, since: 1_000, expiresAt: 301_000 } },
    });
    expect(pending?.vendor?.autoResume).toEqual({ pending: true, since: 1_000, expiresAt: 301_000 });
    const malformed = mergeAccountRuntime(pending!, { ...base,
      vendor: { autoRequested: true, hurtCount: 0, autoResume: { pending: 'yes', since: '1000', expiresAt: Infinity } },
    });
    expect(malformed?.vendor?.autoResume).toBeNull();
    const absent = mergeAccountRuntime(pending!, { ...base, vendor: { autoRequested: true, hurtCount: 0 } });
    expect(absent?.vendor?.autoResume).toBeUndefined();
  });
});

describe('frame metrics sanitizer', () => {
  it('normalizes missing or malformed values to null and rejects malformed envelopes', () => {
    expect(sanitizeFrameMetrics({ frames: 3, avgMs: 1.5, p95Ms: '2', maxMs: -1, busyRatio: 0.5, windowMs: null })).toEqual({
      frames: 3, avgMs: 1.5, p95Ms: null, maxMs: null, busyRatio: 0.5, windowMs: null,
    });
    expect(sanitizeFrameMetrics(undefined)).toBeNull();
    expect(sanitizeFrameMetrics({ frames: '3', avgMs: 1 })).toBeNull();
    expect(mergeAccountRuntime(undefined, { ...base, metrics: { frames: 1, avgMs: 1, p95Ms: 1, maxMs: 1, busyRatio: 0.5, windowMs: 2 } })?.metrics?.frames).toBe(1);
    expect(mergeAccountRuntime(undefined, { ...base })?.metrics).toBeNull();
  });

  it('clears cached world and vital values when dataStale while preserving the last hurt count', () => {
    const stale = mergeAccountRuntime(undefined, {
      ...base, dataStale: true, hp: 50, mp: 20, khu: 3, x: 100, y: 200, mapId: 'tan_vien', downed: false,
      vitals: { hp: 50, maxHp: 100, mp: 20, maxMp: 40, status: 'fresh', source: 'client', observedAt: 100 },
      vendor: { autoRequested: true, hurtCount: 4, autoResume: { pending: true, since: 1, expiresAt: 2 }, mapId: 'tan_vien', hp: 50, downed: false },
    });
    expect(stale).toMatchObject({ dataStale: true, hp: null, mp: null, khu: null, x: null, y: null, mapId: null, downed: null });
    expect(stale?.vitals).toMatchObject({ hp: null, mp: null, status: 'unknown' });
    expect(stale?.vendor).toMatchObject({ dataStale: true, hurtCount: 4, autoResume: null, mapId: null, hp: null, downed: null });
  });
});
