import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeAccountRuntime } from './useRealtime';

const base = {
  id: 'account-test', status: 'running' as const, accountName: 'test', characterName: 'test', realm: '',
  hp: null, maxHp: null, mp: null, maxMp: null, stones: null, mapId: '', khu: 0, x: 0, y: 0,
  bagCount: 0, latencyMs: 0, activity: 'idle', bag: {}, farmMapId: '', farmKhu: 0, farmX: 0, farmY: 0,
  dataStatus: { realm: false, hp: false, maxHp: false, mp: false, maxMp: false, location: false, monsters: false, players: false },
  monsters: [], players: [],
};

describe('mergeAccountRuntime vitals freshness', () => {
  afterEach(() => vi.restoreAllMocks());

  it('đóng dấu receipt khi nhận age hợp lệ và giữ snapshot có observedAt mới hơn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    const first = mergeAccountRuntime(undefined, {
      ...base,
      vitals: { hp: 90, maxHp: null, mp: 10, maxMp: null, status: 'fresh', source: 'you', observedAt: 1_000 },
      vitalsAgeMs: 1_000,
    });
    expect(first?.vitalsAgeMs).toBe(1_000);
    expect(first?.vitalsReceivedAt).toBe(2_000);

    vi.spyOn(Date, 'now').mockReturnValue(3_000);
    const older = mergeAccountRuntime(first!, {
      ...base,
      vitals: { hp: 10, maxHp: null, mp: 1, maxMp: null, status: 'fresh', source: 'you', observedAt: 900 },
      vitalsAgeMs: 2_100,
    });
    expect(older?.vitals?.hp).toBe(90);
    expect(older?.vitalsAgeMs).toBe(1_000);
    expect(older?.vitalsReceivedAt).toBe(2_000);
  });
});
