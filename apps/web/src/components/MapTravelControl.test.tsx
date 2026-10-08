import { describe, expect, it } from 'vitest';
import { formatMapTravelRoute, getMapTravelLockReason } from './MapTravelControl';

describe('map travel control', () => {
  const base = {
    runnerReady: true,
    contextUsable: true,
    autoActive: false,
    operation: null,
  };

  it('explains why map travel is locked', () => {
    expect(getMapTravelLockReason({ ...base, runnerReady: false })).toContain('Bot chưa chạy');
    expect(getMapTravelLockReason({ ...base, contextUsable: false })).toContain('vị trí map');
    expect(getMapTravelLockReason({ ...base, autoActive: true })).toContain('Auto');
    expect(getMapTravelLockReason(base)).toBeNull();
  });

  it('formats the planned map route for display', () => {
    const label = formatMapTravelRoute(['tan_vien', 'thanh_truc_lam']);
    expect(label).toContain('tan_vien');
    expect(label).toContain('thanh_truc_lam');
  });
});
