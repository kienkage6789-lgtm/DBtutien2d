import { describe, expect, it } from 'vitest';
import { sanitizeCultivationOperation, sanitizeCultivationState } from './api';

describe('cultivation response sanitizers', () => {
  it('keeps missing and malformed cultivation measurements unknown', () => {
    expect(sanitizeCultivationState({ inGame: true, exp: '12', expMax: Infinity, nextGateReady: 'yes', recipes: [{ id: 'x', open: true, recipe: [{ id: 'herb', qty: -2 }] }] })).toEqual({
      inGame: true, connected: false, down: false, auto: false, mapId: null, realmId: null, exp: null, expMax: null, questStage: null,
      nextGateReady: null, gateFrom: null, gateTo: null, gateItemId: null, gateItemQty: null,
      recipes: [{ id: 'x', name: 'Chưa rõ', open: true, recipe: [] }],
    });
    expect(sanitizeCultivationState(null)).toBeNull();
  });

  it('rejects malformed operation shapes and sanitizes result text', () => {
    expect(sanitizeCultivationOperation({ id: 'bad', kind: 'hack', status: 'running' })).toBeNull();
    expect(sanitizeCultivationOperation({ id: 'op', kind: 'brew', status: 'done', progress: { current: 1, total: 1 }, results: [{ target: 'pill', ok: false, result: '<x>' }], startedAt: 1, updatedAt: 2 })).toMatchObject({ results: [{ target: 'pill', ok: false, result: '<x>' }] });
  });
});
