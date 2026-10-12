import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountRuntime } from '../types';
import { sanitizeCharacter } from '../hooks/useRealtime';
import { accountRowStatus, canPlay, copyAccountName, filterAccounts, isAccountTabActive, OFFICIAL_GAME_URL, readDashboardStorage, realmLabel, resolveSelectedAccountId, vitalPercent, writeDashboardStorage, ACCOUNT_TABS } from './account-dashboard';

const account = (id: string, status: AccountRuntime['status'], extra: Partial<AccountRuntime> = {}) => ({ id, status, accountName: `user-${id}`, characterName: `Nhân vật ${id}`, dataStale: false, connection: 'CONNECTED', downed: false, ...extra }) as AccountRuntime;
const originalWindow = globalThis.window;
afterEach(() => { vi.stubGlobal('window', originalWindow); });

describe('dashboard sidebar helpers', () => {
  it('allows play only when stopped and not reconnecting', () => {
    expect(canPlay(account('run', 'running'))).toBe(false);
    expect(canPlay(account('stop', 'stopped'))).toBe(true);
    expect(canPlay(account('error', 'error'))).toBe(true);
    expect(canPlay(account('retry', 'stopped', { connection: 'RECONNECTING' }))).toBe(false);
    expect(canPlay(account('starting', 'stopped', { connection: 'CONNECTING' }))).toBe(false);
  });

  it('copies the account name safely when clipboard APIs are unavailable', async () => {
    await expect(copyAccountName('account-fixture')).resolves.toBe(false);
    expect(OFFICIAL_GAME_URL).toBe('https://tutien2d.online/');
  });

  it('formats vital percentage without inventing unknown values and clamps bounds', () => {
    expect(vitalPercent(null, 100)).toBeNull();
    expect(vitalPercent(0, 100)).toBe(0);
    expect(vitalPercent(-8, 100)).toBe(0);
    expect(vitalPercent(150, 100)).toBe(100);
    expect(vitalPercent(50, 100, false)).toBeNull();
    expect(vitalPercent(50, 100, true)).toBe(50);
  });

  it('filters status and searches character/account names', () => {
    const rows = [account('1', 'running'), account('2', 'stopped'), account('3', 'error')];
    expect(filterAccounts(rows, 'running', '').map((item) => item.id)).toEqual(['1']);
    expect(filterAccounts(rows, 'stopped', '').map((item) => item.id)).toEqual(['2']);
    expect(filterAccounts(rows, 'all', 'Nhân vật 3').map((item) => item.id)).toEqual(['3']);
  });

  it('groups row status with exceptional states ahead of running/stopped', () => {
    expect(accountRowStatus(account('a', 'running')).key).toBe('running');
    expect(accountRowStatus(account('b', 'stopped')).key).toBe('stopped');
    expect(accountRowStatus(account('c', 'running', { dataStale: true })).key).toBe('stale');
    expect(accountRowStatus(account('d', 'running', { connection: 'RECONNECTING' })).key).toBe('reconnecting');
    expect(accountRowStatus(account('e', 'running', { downed: true })).key).toBe('downed');
    expect(accountRowStatus(account('f', 'error')).key).toBe('error');
  });

  it('contains storage exceptions and clears a selection after account removal', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
    expect(readDashboardStorage('key', 'fallback')).toBe('fallback');
    expect(() => writeDashboardStorage('key', 'value')).not.toThrow();
    expect(resolveSelectedAccountId([account('kept', 'stopped')], 'deleted')).toBeNull();
    expect(resolveSelectedAccountId([], 'deleted', true)).toBeNull();
    expect(resolveSelectedAccountId([], 'pending', false)).toBe('pending');
  });

  it('renders one active tab at a time and keeps missing character data unknown', () => {
    for (const tab of ACCOUNT_TABS) expect(ACCOUNT_TABS.filter((candidate) => isAccountTabActive(tab.id, candidate.id))).toEqual([tab]);
    expect(sanitizeCharacter(undefined)).toBeUndefined();
    expect(sanitizeCharacter({ realmName: 7, sp: 'bad', spMax: null, bp: 1, bpMax: 2, exp: 3, expMax: 4 })).toEqual({ realmId: null, realmName: null, sp: null, spMax: null, bp: 1, bpMax: 2, exp: 3, expMax: 4, stones: null, stonesToday: null, stonesCap: null, stonesSessionNet: null, fresh: false, observedAt: null });
    expect(sanitizeCharacter({ realmId: 'a'.repeat(80), realmName: 'X\u0000Y', sp: '12', exp: Infinity, fresh: true, observedAt: 'bad' })).toMatchObject({ realmId: 'a'.repeat(64), realmName: 'XY', sp: null, spMax: null, bp: null, bpMax: null, exp: null, expMax: null, fresh: false, observedAt: null, stones: null, stonesToday: null, stonesCap: null, stonesSessionNet: null });
    expect(sanitizeCharacter({ stones: '12', stonesToday: -1, stonesCap: NaN, stonesSessionNet: '4' })).toMatchObject({ stones: null, stonesToday: null, stonesCap: null, stonesSessionNet: null });
    expect(sanitizeCharacter({ stones: 0, stonesToday: 0, stonesCap: 0, stonesSessionNet: -1 })).toMatchObject({ stones: 0, stonesToday: 0, stonesCap: 0, stonesSessionNet: -1 });
    expect(sanitizeCharacter({ stones: 3, fresh: true })).toMatchObject({ stones: 3, fresh: true });
    expect(realmLabel(undefined)).toBe('—');
    expect(realmLabel(sanitizeCharacter({}) )).toBe('—');
  });
});
