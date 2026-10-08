import { describe, expect, it } from 'vitest';
import { getKhuLockReason, isKhuFull, khuCooldownRemainingSec, sanitizeKhuList } from './khu';

const list = {
  mapId: 'tan_vien',
  khu: 1,
  dem: [20, 3, 19],
  toiDa: 20,
  tran: [20, 20, 20],
  observedAt: 100,
};

describe('khu dashboard policy', () => {
  it('sanitizes valid lists and rejects malformed arrays without converting them to null', () => {
    expect(sanitizeKhuList(list)).toEqual(list);
    expect(sanitizeKhuList({ ...list, dem: ['20'] })).toBeUndefined();
    expect(sanitizeKhuList(null)).toBeNull();
  });

  it('marks a khu full from either tran or the overall capacity', () => {
    expect(isKhuFull(list, 0)).toBe(true);
    expect(isKhuFull(list, 1)).toBe(false);
    expect(isKhuFull({ ...list, tran: [19, 20, 20] }, 0)).toBe(true);
    expect(isKhuFull(list, 10)).toBe(false);
  });

  it('reports locks in the same priority the control uses', () => {
    const base = { runnerReady: true, contextUsable: true, soKhu: 20, autoActive: false, operation: null, khuRequestPending: false, cooldownRemainingSec: 0 };
    expect(getKhuLockReason({ ...base, runnerReady: false })).toContain('Bot chưa chạy');
    expect(getKhuLockReason({ ...base, contextUsable: false })).toContain('Map chưa sẵn sàng');
    expect(getKhuLockReason({ ...base, soKhu: 1 })).toBe('Map này không chia khu');
    expect(getKhuLockReason({ ...base, autoActive: true })).toContain('Auto');
    expect(getKhuLockReason({ ...base, khuRequestPending: true })).toContain('đổi khu');
    expect(getKhuLockReason({ ...base, cooldownRemainingSec: 2 })).toContain('2s');
  });

  it('rounds cooldown upward and reaches zero after expiry', () => {
    expect(khuCooldownRemainingSec(5_000, 3_001)).toBe(2);
    expect(khuCooldownRemainingSec(5_000, 5_001)).toBe(0);
  });
});
