import { describe, expect, it } from 'vitest';
import { isContextNewer, resolveMapContext, resolveVitalsAge, sanitizeMapContext } from './context';

const base = {
  mapContext: { mapId: 'tan_vien', khu: 1, soKhu: 20, observedAt: 1_000_000, fresh: true },
  mapContextAgeMs: 27, mapContextIsCurrent: true, mapContextReceivedAt: 1_000_030,
  mapId: 'tan_vien', khu: 1,
};

describe('resolveMapContext', () => {
  it('không bao giờ âm khi now < receivedAt', () => {
    const view = resolveMapContext(base, 1_000_000);
    expect(view.usable).toBe(true);
    expect(view.ageMs).toBeGreaterThanOrEqual(0);
  });
  it('hết hạn sau TTL', () => {
    expect(resolveMapContext(base, 1_000_030 + 14_973).usable).toBe(true);
    expect(resolveMapContext(base, 1_000_030 + 15_100)).toMatchObject({ usable: false, reason: 'expired' });
  });
  it('backend báo không current thì khóa', () => {
    expect(resolveMapContext({ ...base, mapContextIsCurrent: false }, 1_000_100)).toMatchObject({ usable: false, reason: 'not_current' });
  });
  it('map hoặc khu lệch nhau thì khóa', () => {
    expect(resolveMapContext({ ...base, mapId: 'long_uyen' }, 1_000_100)).toMatchObject({ usable: false, reason: 'mismatch' });
  });
  it('backend cũ không có age thì fallback observedAt', () => {
    const { mapContextAgeMs, mapContextReceivedAt, ...legacy } = base;
    expect(resolveMapContext(legacy, 1_000_500).usable).toBe(true);
  });
});

describe('isContextNewer/sanitizeMapContext', () => {
  it('chấp nhận cùng timestamp và từ chối payload sai kiểu', () => {
    expect(isContextNewer({ mapId: 'tan_vien', khu: 1, observedAt: 10 }, { mapId: 'tan_vien', khu: 1, observedAt: 10 })).toBe(true);
    expect(sanitizeMapContext({ mapId: 'tan_vien', khu: 1, soKhu: 20, observedAt: 10, fresh: true })).toEqual({ mapId: 'tan_vien', khu: 1, soKhu: 20, observedAt: 10, fresh: true });
    expect(sanitizeMapContext({ mapId: 'tan_vien', khu: '1', observedAt: 10, fresh: true })).toBeUndefined();
  });
});

describe('resolveVitalsAge', () => {
  const account = {
    vitals: { hp: 90, maxHp: null, mp: 10, maxMp: null, status: 'fresh' as const, source: 'you' as const, observedAt: 900 },
    vitalsAgeMs: 100,
    vitalsReceivedAt: 1_000,
  };

  it('cộng thời gian trôi và không âm khi clock nhận bị đi trước', () => {
    expect(resolveVitalsAge(account, 1_250)).toBe(350);
    expect(resolveVitalsAge(account, 900)).toBe(100);
  });

  it('trả null khi backend chưa có vitals fresh/age hợp lệ', () => {
    expect(resolveVitalsAge({ ...account, vitals: { ...account.vitals, status: 'stale' }, vitalsAgeMs: 1 }, 2_000)).toBeNull();
    expect(resolveVitalsAge({ ...account, vitalsAgeMs: null }, 2_000)).toBeNull();
    expect(resolveVitalsAge({ ...account, vitalsAgeMs: -1 }, 2_000)).toBeNull();
  });
});
