import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountRuntime, QuestSnapshot } from '../types';
import { QuestStatus } from './QuestControl';

const account = { id: 'fixture', dataStale: false } as AccountRuntime;
const unknown: QuestSnapshot = { known: true, stage: null, stageCount: 34, stageName: null, hint: null, objectives: null, turnInNpc: null, stageComplete: null,
  realm: { id: null, name: null, level: null }, target: { realmId: 'luyen_khi_7', reachedTarget: null, stageGoal: 18 },
  nextGate: { fromRealmId: 'luyen_khi_6', toRealmId: 'luyen_khi_7', item: { id: 'luyen_khi_dan', name: 'Luyện Khí Đan', qty: 1, have: null },
    questStageRequired: null, stageOk: null, expFull: null, exp: null, expMax: null, ready: null }, at: null };

describe('QuestStatus', () => {
  it('shows em dashes for unknown values and progress bars without unsafe HTML', () => {
    const markup = renderToStaticMarkup(<QuestStatus account={account} quest={unknown} />);
    expect(markup).toContain('Giai đoạn —/34'); expect(markup).toContain('Luyện Khí Đan (—/1)');
    expect(markup).toContain('Đạo Hạnh đầy: — / — · chưa biết'); expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('SẴN SÀNG'); expect(markup).not.toContain('dangerouslySetInnerHTML');
  });

  it('shows both progress bars, target reached, and readiness when all gates are true', () => {
    const quest: QuestSnapshot = { ...unknown, stage: 18, stageName: 'Giai đoạn thử', realm: { id: 'luyen_khi_7', name: 'Luyện Khí Tầng 7', level: 7 },
      target: { ...unknown.target, reachedTarget: true }, objectives: [{ text: '<script>alert(1)</script>', done: true }],
      nextGate: { ...unknown.nextGate!, item: { ...unknown.nextGate!.item!, have: 1 }, exp: 1050, expMax: 1050, expFull: true, ready: true } };
    const markup = renderToStaticMarkup(<QuestStatus account={account} quest={quest} />);
    expect(markup).toContain('Đã tới Luyện Khí 7'); expect(markup).toContain('7/7'); expect(markup).toContain('18/18');
    expect((markup.match(/role="progressbar"/g) ?? []).length).toBe(2);
    expect(markup).toContain('SẴN SÀNG'); expect(markup).toContain('&lt;script&gt;'); expect(markup).not.toContain('<script>');
  });
});
