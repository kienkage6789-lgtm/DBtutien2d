import { describe, expect, it } from 'vitest';
import { sanitizeGarden } from '../lib/api';
import { formatGardenCountdown } from './GardenControl';

describe('garden dashboard data', () => {
  it('keeps unknown values and drops malformed plot and seed rows', () => {
    const data = sanitizeGarden({ known: true, mapId: 'duoc_vien', inGarden: true, unlocked: null, duocCong: null, at: 100,
      plots: [{ id: 'plot_1', index: 1, state: 'growing', remainSec: 61, readyAt: 200 }, { id: 'bad', state: 'ready' }],
      seeds: [{ seedId: 'hat_a', name: 'A', count: null, growSec: 60, wetSec: 30 }, { seedId: 5 }], packs: [{ id: 'pham', cost: 2, give: [{ itemId: 'hat_a', qty: 2 }] }] });
    expect(data).toMatchObject({ known: true, unlocked: null, duocCong: null, plots: [{ id: 'plot_1', state: 'growing', remainSec: 61 },], seeds: [{ seedId: 'hat_a', count: null }], packs: [{ id: 'pham' }] });
    expect(sanitizeGarden({ known: 'yes' })?.known).toBe(false);
  });

  it('formats countdowns at zero, negative, unknown, minute and hour boundaries', () => {
    expect(formatGardenCountdown(null)).toBe('Chưa biết');
    expect(formatGardenCountdown(-3)).toBe('Sẵn sàng');
    expect(formatGardenCountdown(0)).toBe('Sẵn sàng');
    expect(formatGardenCountdown(61)).toBe('01:01');
    expect(formatGardenCountdown(3601)).toBe('1:00:01');
  });
});
