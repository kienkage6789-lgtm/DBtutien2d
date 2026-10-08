import { describe, expect, it } from 'vitest';
import { getDailyLockReason } from './DailyControl';

const base = { runnerReady: true, mapReady: true, autoActive: false, operation: null, moveTo: null, stage: 21 };

describe('daily dashboard locks', () => {
  it('reports the operational lock in priority order', () => {
    expect(getDailyLockReason({ ...base, runnerReady: false })).toContain('Bot chưa chạy');
    expect(getDailyLockReason({ ...base, mapReady: false })).toBe('Map chưa sẵn sàng');
    expect(getDailyLockReason({ ...base, autoActive: true })).toContain('Tắt Auto');
    expect(getDailyLockReason({ ...base, moveTo: { status: 'running' } as never })).toContain('thao tác khác');
  });

  it('locks Dược Công below stage 8 and not điểm danh', () => {
    expect(getDailyLockReason({ ...base, stage: 7, forSeed: true })).toContain('8');
    expect(getDailyLockReason({ ...base, stage: 7 })).toBeNull();
  });
});

