import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { fetchInventory } from '../lib/api';
import { notify } from '../lib/dialogs';
import type { InventorySnapshot } from '../types';

export const InventoryModal: React.FC<{ accountId: string; accountLabel: string; onClose: () => void }> = ({ accountId, accountLabel, onClose }) => {
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setInventory(await fetchInventory(accountId)); }
    catch (error) { notify(error); }
    finally { setLoading(false); }
  }, [accountId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matches = (item: NonNullable<InventorySnapshot['items'][number]>) => !normalized
      || item.name.toLocaleLowerCase().includes(normalized) || item.id.toLocaleLowerCase().includes(normalized);
    const items = inventory?.known ? inventory.items.filter(matches) : [];
    return { openable: items.filter((item) => item.openable), other: items.filter((item) => !item.openable) };
  }, [inventory, query]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="inventory-title" className="flex max-h-[92dvh] w-full max-w-lg min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0c101a] shadow-2xl">
      <header className="flex items-start justify-between gap-2 border-b border-slate-800 p-3 sm:p-4">
        <div className="min-w-0"><h2 id="inventory-title" className="font-title text-base font-bold text-slate-100">Túi đồ</h2><p className="truncate text-xs text-slate-400">{accountLabel}</p></div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Làm mới túi đồ" className="flex items-center gap-1 rounded-lg border border-cyan-500/40 px-2 py-1.5 text-xs text-cyan-200 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới</button>
          <button type="button" onClick={onClose} aria-label="Đóng túi đồ" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </div>
      </header>
      <div className="space-y-3 overflow-y-auto p-3 sm:p-4">
        {inventory?.known && <section aria-label="Trạng thái Hang Động" className="rounded-lg border border-amber-500/25 bg-amber-950/20 p-2.5 text-xs">
          <h3 className="mb-1 font-semibold text-amber-200">Hang Động</h3>
          {inventory.caveChest ? <div className="grid grid-cols-1 gap-1 text-slate-300 min-[380px]:grid-cols-3">
            <span>{inventory.caveChest.keyCount > 0 ? 'Có chìa khóa' : 'Chưa có chìa khóa'}</span>
            <span>{inventory.caveChest.claimed ? 'Đã nhận rương' : 'Chưa nhận rương'}</span>
            <span>{inventory.caveChest.active ? 'Đang kích hoạt' : 'Chưa kích hoạt'}</span>
          </div> : <p className="text-slate-400">Chưa biết trạng thái</p>}
          <p className="mt-1 text-slate-500">{inventory.totalKinds ?? '—'} loại · {inventory.totalCount?.toLocaleString() ?? '—'} vật phẩm</p>
        </section>}
        <label className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-2 text-slate-400">
          <Search className="h-4 w-4 shrink-0" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc mã vật phẩm" className="min-w-0 w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500" />
        </label>
        {!inventory && <p role="status" className="py-6 text-center text-sm text-slate-400">{loading ? 'Đang tải…' : 'Chưa biết'}</p>}
        {inventory && !inventory.known && <p role="status" className="rounded-lg bg-slate-900 p-4 text-center text-sm text-slate-300">{inventoryKnowledgeLabel(inventory)}</p>}
        {inventory?.known && <>
          <InventoryGroup title="Hộp mở được" items={groups.openable} empty="Không có hộp phù hợp." />
          <InventoryGroup title="Vật phẩm khác" items={groups.other} empty="Không có vật phẩm phù hợp." />
        </>}
      </div>
    </section>
  </div>;
};

export function inventoryKnowledgeLabel(inventory: InventorySnapshot): string {
  return inventory.known ? 'Đã tải túi đồ.' : 'Chưa biết · Túi đồ chưa được tải từ game.';
}

function InventoryGroup({ title, items, empty }: { title: string; items: InventorySnapshot['items']; empty: string }) {
  return <section>
    <h3 className="mb-1.5 text-xs font-semibold text-slate-300">{title} <span className="text-slate-500">({items.length})</span></h3>
    {items.length ? <ul className="space-y-1.5">{items.map((item) => <li key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2">
      <span className="min-w-0"><span className="block break-words text-sm text-slate-100">{item.name}{item.openable && <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-200">Hộp</span>}</span><span className="block break-all text-[10px] text-slate-500">{item.id}</span></span>
      <span className="text-right text-sm tabular-nums text-slate-300">×{item.count.toLocaleString()}</span>
    </li>)}</ul> : <p className="rounded-lg border border-slate-800 p-3 text-xs text-slate-500">{empty}</p>}
  </section>;
}
