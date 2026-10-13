import { describe, expect, it } from 'vitest';
import { sanitizeQuest } from './api';

describe('sanitizeQuest', () => {
  it('preserves unknown fields as null and rejects malformed optional fields safely', () => {
    const value = sanitizeQuest({ known: false, stage: 0, at: 'now', nextGate: { ready: true } });
    expect(value).toMatchObject({ known: false, stage: null, objectives: null, stageName: null, nextGate: null, at: null,
      realm: { id: null, level: null }, target: { reachedTarget: null } });
  });

  it('cleans text and keeps unknown item counts, experience, and stage values null', () => {
    const value = sanitizeQuest({ known: true, stage: 35, stageName: 'bad', hint: 'hint', objectives: [{ text: 'a\u0000b', done: true }, { text: 4, done: true }],
      realm: { id: 'luyen_khi_2', name: 'Realm', level: '2' }, target: { reachedTarget: true },
      nextGate: { fromRealmId: 'luyen_khi_2', toRealmId: 'luyen_khi_3', item: { id: 'dan', name: 'Đan', qty: 1, have: null },
        questStageRequired: 12, stageOk: true, expFull: null, exp: null, expMax: null, ready: null } });
    expect(value?.stage).toBeNull();
    expect(value?.objectives).toEqual([{ text: 'a b', done: true }]);
    expect(value?.realm.level).toBeNull();
    expect(value?.nextGate?.item?.have).toBeNull();
    expect(value?.nextGate?.exp).toBeNull();
    expect(value?.nextGate?.ready).toBeNull();
  });
});
