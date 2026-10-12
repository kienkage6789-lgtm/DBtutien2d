import React, { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { AccountRuntime } from '../types';
import { resolveVitalsAge, VITALS_DISPLAY_STALE_MS } from '../lib/context';
import { accountRowStatus, filterAccounts, realmLabel, readDashboardStorage, writeDashboardStorage, type AccountFilter } from './account-dashboard';
import { VitalBar } from './VitalBar';

export const AccountSidebar: React.FC<{ accounts: AccountRuntime[]; selectedId: string | null; onSelect: (id: string) => void }> = ({ accounts, selectedId, onSelect }) => {
  const [filter, setFilter] = useState<AccountFilter>(() => {
    const stored = readDashboardStorage('tutien2d.dashboard.accountFilter', 'all');
    return ['all', 'running', 'stopped', 'error'].includes(stored) ? stored as AccountFilter : 'all';
  });
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => filterAccounts(accounts, filter, query), [accounts, filter, query]);
  React.useEffect(() => { writeDashboardStorage('tutien2d.dashboard.accountFilter', filter); }, [filter]);
  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (direction) { event.preventDefault(); const next = (index + direction + visible.length) % visible.length; listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(visible[index].id); }
  };
  return <aside className="flex max-h-[42dvh] min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 lg:sticky lg:top-[6.5rem] lg:h-[calc(100dvh-8rem)] lg:max-h-none">
    <div className="space-y-2 border-b border-slate-800 p-3">
      <label className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-slate-400 focus-within:border-emerald-500"><Search className="h-4 w-4 shrink-0" /><input aria-label="Tìm tài khoản theo tên" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên nhân vật…" className="min-w-0 w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500" /></label>
      <select aria-label="Lọc trạng thái tài khoản" value={filter} onChange={(event) => setFilter(event.target.value as AccountFilter)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-200">
        <option value="all">Tất cả</option><option value="running">Đang chạy</option><option value="stopped">Dừng</option><option value="error">Lỗi</option>
      </select>
      <p className="text-[11px] text-slate-500">{visible.length} / {accounts.length} tài khoản</p>
    </div>
    <div ref={listRef} role="listbox" aria-label="Danh sách tài khoản" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
      {visible.map((account, index) => <AccountRow key={account.id} account={account} selected={account.id === selectedId} onClick={() => onSelect(account.id)} onKeyDown={(event) => moveFocus(event, index)} />)}
      {visible.length === 0 && <p className="p-4 text-center text-xs text-slate-500">Không tìm thấy tài khoản.</p>}
    </div>
  </aside>;
};

const AccountRow: React.FC<{ account: AccountRuntime; selected: boolean; onClick: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void }> = ({ account, selected, onClick, onKeyDown }) => {
  const fresh = account.vitals.status === 'fresh' && !account.dataStale;
  const age = resolveVitalsAge(account);
  const tooOld = age !== null && age > VITALS_DISPLAY_STALE_MS;
  const hp = fresh && !tooOld ? account.vitals.hp : null;
  const mp = fresh && !tooOld ? account.vitals.mp : null;
  const hpMax = account.vitals.maxHp ?? account.derivedMax.maxHp;
  const mpMax = account.vitals.maxMp ?? account.derivedMax.maxMp;
  const char = account.character;
  const characterFresh = char?.fresh === true && !account.dataStale;
  const stones = characterFresh ? char?.stones ?? null : null;
  const stonesToday = characterFresh ? char?.stonesToday ?? null : null;
  const stonesCap = characterFresh ? char?.stonesCap ?? null : null;
  const status = accountRowStatus(account);
  const values: Array<{ label: string; value: number | null; max: number | null; color: 'rose' | 'sky' | 'violet' | 'amber' | 'emerald' }> = [
    { label: 'HP', value: hp, max: hpMax, color: 'rose' }, { label: 'Linh lực', value: mp, max: mpMax, color: 'sky' },
    { label: 'Thần thức', value: characterFresh ? char?.sp ?? null : null, max: characterFresh ? char?.spMax ?? null : null, color: 'violet' },
    { label: 'Giáp', value: characterFresh ? char?.bp ?? null : null, max: characterFresh ? char?.bpMax ?? null : null, color: 'amber' },
    { label: 'Đạo Hạnh', value: characterFresh ? char?.exp ?? null : null, max: characterFresh ? char?.expMax ?? null : null, color: 'emerald' },
  ];
  return <button type="button" role="option" aria-selected={selected} aria-label={`${account.characterName || account.accountName}, ${status.label}`} onClick={onClick} onKeyDown={onKeyDown} className={`block w-full min-w-0 rounded-xl border p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${selected ? 'border-emerald-500/60 bg-emerald-950/30' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
    <div className="mb-2 flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 truncate text-xs font-semibold text-slate-100">{account.characterName || account.accountName}</span><span className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-300"><i className={`h-2 w-2 rounded-full ${status.className}`} />{status.label}</span></div>
    <p className="mb-2 truncate text-[10px] text-slate-400">{characterFresh ? realmLabel(char) : '—'}</p>
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">{values.map((item) => <TinyVital key={item.label} {...item} />)}</div>
    <p className="mt-2 truncate text-[10px] text-amber-200">Linh Thạch: {stones === null ? '—' : stones.toLocaleString()} · hôm nay {stonesToday === null ? '—' : stonesToday.toLocaleString()}/{stonesCap === null ? '—' : stonesCap.toLocaleString()}</p>
  </button>;
};

const TinyVital: React.FC<{ label: string; value: number | null; max: number | null; color: 'rose' | 'sky' | 'violet' | 'amber' | 'emerald' }> = (props) => <VitalBar {...props} compact />;
