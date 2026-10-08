import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeAccountRuntime } from './useRealtime';

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
});
