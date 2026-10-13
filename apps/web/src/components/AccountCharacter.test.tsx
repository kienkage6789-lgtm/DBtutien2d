import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountRuntime } from '../types';
import { AccountPanel } from './AccountPanel';
import { AccountSidebar } from './AccountSidebar';

const base = {
  id: 'character-fixture', ownerId: null, ownerUsername: null, accountName: 'fixture', characterName: 'Fixture', engine: 'vendor',
  status: 'running', dataStale: false, connection: 'IN_GAME', authError: null, hasProxy: false, hasPassword: false, tokenExpiresAt: null,
  hp: null, maxHp: null, mp: null, maxMp: null, vitals: { hp: null, maxHp: null, mp: null, maxMp: null, status: 'unknown', source: null, observedAt: null },
  vitalsAgeMs: null, hurtCount: 0, lastHurtAt: null, derivedMax: { maxHp: null, maxMp: null, complete: false, source: 'derived', observedAt: null },
  downed: null, mapId: null, khu: null, x: null, y: null, moveTo: null, daily: null, dailyStatus: null, latencyMs: 0, activity: 'in_game',
  metrics: null, soKhu: null, khuList: null, mapContext: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false }, mapContextAgeMs: null,
  mapContextIsCurrent: false, playersContext: { mapId: null, khu: null, observedAt: null, fresh: false }, monstersContext: { mapId: null, khu: null, observedAt: null, fresh: false },
  dataStatus: { hp: false, maxHp: false, mp: false, maxMp: false, location: false, monsters: false, players: false }, monsters: [], players: [],
} as unknown as AccountRuntime;
const callbacks = {
  tab: 'overview' as const, onTabChange: () => {}, logs: [], onClearLogs: () => {}, controlsDisabled: false, controlLockReason: null,
  mapCatalog: [], onStart: () => {}, onStop: () => {}, onStartVendorAuto: () => {}, onStopVendorAuto: () => {}, onMoveTo: async () => ({} as any),
  onCancelMoveTo: async () => ({} as any), onUpdatePassword: () => {}, onDelete: () => {},
};

describe('character snapshot display', () => {
  it('shows the reconnect HP wait only when vendor.autoResume is pending', () => {
    const vendor = { autoRequested: true, hurtCount: 0, autoResume: { pending: true, since: Date.now(), expiresAt: Date.now() + 4_000 },
      supervisor: { phase: 'idle', anchor: null, reasonCode: null, stats: { deaths: 0, revives: 0, trips: 0, resumed: 0 } } };
    const pending = renderToStaticMarkup(<AccountPanel {...callbacks} tab="auto" account={{ ...base, vendor } as AccountRuntime} />);
    expect(pending).toContain('Đang chờ HP để tiếp tục Auto (còn 4 giây)');
    const idle = renderToStaticMarkup(<AccountPanel {...callbacks} tab="auto" account={{ ...base, vendor: { ...vendor, autoResume: null } } as AccountRuntime} />);
    expect(idle).not.toContain('Đang chờ HP để tiếp tục Auto');
  });

  it('shows em dashes for null or stale values and values with percentages when fresh', () => {
    const unknown = renderToStaticMarkup(<AccountPanel {...callbacks} account={{ ...base, status: 'stopped', character: null }} />);
    expect(unknown).toContain('Thần thức');
    expect(unknown).toContain('—');
    expect(unknown).toContain('Linh Thạch');
    expect(unknown).toContain('rel="noopener noreferrer"');
    expect(unknown).toContain('href="https://tutien2d.online/"');
    const disabled = renderToStaticMarkup(<AccountPanel {...callbacks} account={{ ...base, status: 'running' }} />);
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).not.toContain('href="https://tutien2d.online/"');
    expect(disabled).toContain('Dừng bot trước khi chơi: game chỉ cho một phiên đăng nhập mỗi tài khoản');

    const freshCharacter = { realmId: 'realm-fixture', realmName: 'Cảnh giới thử', sp: 5, spMax: 10, bp: 6, bpMax: 12, exp: 25, expMax: 100, stones: 1200, stonesToday: 50, stonesCap: 500, stonesSessionNet: -25, fresh: true, observedAt: 10 };
    const fresh = renderToStaticMarkup(<AccountPanel {...callbacks} account={{ ...base, character: freshCharacter }} />);
    expect(fresh).toContain('Cảnh giới thử');
    expect(fresh).toContain('5'); expect(fresh).toContain('50%');
    expect(fresh).toContain('6'); expect(fresh).toContain('50%');
    expect(fresh).toContain('25'); expect(fresh).toContain('25%');
    expect(fresh).toContain('1,200'); expect(fresh).toContain('50'); expect(fresh).toContain('/ 500'); expect(fresh).toContain('−25');

    const stale = renderToStaticMarkup(<AccountPanel {...callbacks} account={{ ...base, dataStale: true, character: freshCharacter }} />);
    expect(stale).not.toContain('Cảnh giới thử');
    expect(stale).toContain('—');
  });

  it('renders the sidebar values only when the character snapshot is fresh', () => {
    const items = [{ ...base, character: { realmId: null, realmName: 'Realm', sp: 5, spMax: 10, bp: 2, bpMax: 4, exp: 1, expMax: 2, stones: 1, stonesToday: 2, stonesCap: 3, stonesSessionNet: 0, fresh: true, observedAt: 2 } }];
    const markup = renderToStaticMarkup(<AccountSidebar accounts={items} selectedId={null} onSelect={() => {}} />);
    expect(markup).toContain('5');
    const staleMarkup = renderToStaticMarkup(<AccountSidebar accounts={[{ ...items[0], character: { ...items[0].character, fresh: false } }]} selectedId={null} onSelect={() => {}} />);
    expect(staleMarkup).toContain('—');
  });
});
