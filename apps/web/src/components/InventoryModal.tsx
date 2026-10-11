import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { fetchInventory } from '../lib/api';
import { notify } from '../lib/dialogs';
import type { InventoryItem, InventorySnapshot } from '../types';
import { inventoryGradeLabel, inventoryGradeStyle } from './inventory-grade';
import { inventorySymbol } from './inventory-symbol';

type InventoryTab = 'vat-pham' | 'trang-bi' | 'dao-thuat' | 'khac';
const EMPTY_SLOT_LIMIT = 24;
const TAB_INFO: Array<{ id: InventoryTab; label: string }> = [
  { id: 'vat-pham', label: 'Vật phẩm' }, { id: 'trang-bi', label: 'Trang bị' }, { id: 'dao-thuat', label: 'Đạo thuật' }, { id: 'khac', label: 'Khác' },
];
const TAB_STORAGE_KEY = 'tutien.inventory.tab';
const readTab = (): InventoryTab => {
  try { const value = window.localStorage.getItem(TAB_STORAGE_KEY); return TAB_INFO.some((tab) => tab.id === value) ? value as InventoryTab : 'vat-pham'; }
  catch { return 'vat-pham'; }
};

export const InventoryModal: React.FC<{ accountId: string; accountLabel: string; onClose: () => void }> = ({ accountId, accountLabel, onClose }) => {
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<InventoryTab>(readTab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setInventory(await fetchInventory(accountId)); }
    catch (error) { notify(error); }
    finally { setLoading(false); }
  }, [accountId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const chooseTab = (next: InventoryTab) => {
    setTab(next); setSelectedId(null);
    try { window.localStorage.setItem(TAB_STORAGE_KEY, next); } catch { /* private mode/storage policy: selection still works in memory */ }
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return inventory?.known ? inventory.items.filter((item) => !normalized || item.name.toLocaleLowerCase().includes(normalized) || item.id.toLocaleLowerCase().includes(normalized)) : [];
  }, [inventory, query]);
  const counts = useMemo(() => inventoryTabCounts(filtered), [filtered]);
  const tabs = counts.khac ? TAB_INFO : TAB_INFO.filter((item) => item.id !== 'khac');
  useEffect(() => { if (!tabs.some((item) => item.id === tab)) chooseTab('vat-pham'); }, [tabs, tab]);
  const visibleItems = filtered.filter((item) => tab === 'khac' ? item.group === null : item.group === tab);
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null;
  const emptySlotCount = inventory?.known ? inventoryEmptySlotCount(inventory.bag?.capacity, inventory.bag?.usedSlots) : null;
  const selectByOffset = (currentId: string, offset: number) => {
    const current = Math.max(0, visibleItems.findIndex((item) => item.id === currentId));
    const next = visibleItems[(current + offset + visibleItems.length) % visibleItems.length];
    if (next) { setSelectedId(next.id); document.getElementById(`inventory-item-${encodeURIComponent(next.id)}`)?.focus(); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="inventory-title" className="flex max-h-[94dvh] w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0c101a] text-slate-100 shadow-2xl">
      <header className="flex items-start justify-between gap-2 border-b border-slate-800 p-3 sm:p-4">
        <div className="min-w-0"><h2 id="inventory-title" className="font-title text-base font-bold">Túi đồ</h2><p className="truncate text-xs text-slate-400">{accountLabel}</p></div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Làm mới túi đồ" className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới</button>
          <button type="button" onClick={onClose} aria-label="Đóng túi đồ" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><X className="h-4 w-4" /></button>
        </div>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto p-3 sm:p-4">
        <label className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-400 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500">
          <Search className="h-4 w-4 shrink-0" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc mã vật phẩm" className="min-w-0 w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400" />
        </label>
        {inventory?.known && <>
          <section aria-label="Sức chứa túi" className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-1"><h3 className="font-semibold">Túi đồ</h3><span className="tabular-nums">{inventory.bag?.usedSlots ?? 'Chưa biết'} / {inventory.bag?.capacity ?? 'Chưa biết'} ô đã dùng / sức chứa</span></div>
            {inventory.bag?.usedSlots !== null && inventory.bag?.usedSlots !== undefined && inventory.bag?.capacity !== null && inventory.bag?.capacity !== undefined && <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-700" role="progressbar" aria-label="Sức chứa túi" aria-valuemin={0} aria-valuemax={inventory.bag.capacity} aria-valuenow={Math.min(inventory.bag.usedSlots, inventory.bag.capacity)}><div className="h-full bg-emerald-500" style={{ width: `${inventory.bag.capacity ? Math.min(100, inventory.bag.usedSlots / inventory.bag.capacity * 100) : 0}%` }} /></div>}
            <p className="mt-1 text-slate-400">Ô trống và sức chứa dùng chung cho toàn túi; chưa phân bổ theo tab.</p>
            <p className="text-slate-400">Mở rộng túi: {inventory.bag?.extraSlots ?? 'Chưa biết'} ô thêm{inventory.bag?.maxExtraSlots !== null && inventory.bag?.maxExtraSlots !== undefined ? ` / tối đa ${inventory.bag.maxExtraSlots}` : ''} · Giá ô kế tiếp: {inventory.bag?.nextSlotPrice ?? 'Chưa biết'}</p>
          </section>
          <section aria-label="Trạng thái Hang Động" className="rounded-lg border border-amber-700/70 bg-amber-950/35 p-2.5 text-xs">
            <h3 className="mb-1 font-semibold text-amber-300">Hang Động</h3>
            {inventory.caveChest ? <div className="flex flex-wrap gap-1.5">{inventoryCaveStatusChips(inventory.caveChest).map((chip) => <span key={chip.key} className={`rounded-full border px-2 py-1 text-[11px] font-medium ${chip.active ? 'border-emerald-700 bg-emerald-950/70 text-emerald-200' : 'border-slate-700 bg-slate-900/80 text-slate-300'}`}>{chip.label}</span>)}</div> : <p className="text-slate-400">Chưa biết trạng thái</p>}
          </section>
          <nav role="tablist" aria-label="Phân loại túi đồ" className="flex min-w-0 flex-wrap gap-1 border-b border-slate-800">
            {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => chooseTab(item.id)} className={`border-b-2 px-2.5 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${tab === item.id ? 'border-emerald-400 font-semibold text-emerald-300' : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>{item.label} <span className="tabular-nums">({counts[item.id]})</span></button>)}
          </nav>
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(190px,0.65fr)]">
            <section aria-label={`${TAB_INFO.find((item) => item.id === tab)?.label ?? 'Vật phẩm'}: ${visibleItems.length} mục`}>
              {visibleItems.length || (emptySlotCount ?? 0) > 0 ? <div role="grid" aria-label="Lưới vật phẩm" className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(50px,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(62px,1fr))] sm:gap-2" onKeyDown={(event) => {
                const columns = Math.max(1, window.getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').length);
                const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
                if (offsets[event.key] !== undefined && selectedId) { event.preventDefault(); selectByOffset(selectedId, offsets[event.key]); }
              }}>{visibleItems.map((item, index) => <InventoryCell key={item.id} item={item} index={index} hasSelection={selectedId !== null} selected={item.id === selectedId} onSelect={() => setSelectedId(item.id)} />)}{Array.from({ length: inventoryGridEmptySlotCount(inventory.bag?.capacity, inventory.bag?.usedSlots) }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" className="aspect-square min-w-0 rounded-lg border border-dashed border-slate-600 bg-slate-950/40" />)}</div>
                : <p className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-400">Không có vật phẩm trong tab này.</p>}
              <p className="mt-1 text-[11px] text-slate-400">{emptySlotCount === null ? 'Chưa biết số ô trống dùng chung cho cả túi.' : `${emptySlotCount} ô trống${inventory.bag!.capacity! - inventory.bag!.usedSlots! > EMPTY_SLOT_LIMIT ? ` (hiển thị tối đa ${EMPTY_SLOT_LIMIT})` : ''}, dùng chung cho cả túi`}</p>
            </section>
            <div className="space-y-3">
              <section aria-label="Chi tiết vật phẩm" className={`rounded-xl border border-slate-800 bg-slate-900/60 ${selected ? 'p-3' : 'p-2'}`}>
                {selected ? <><h3 className="break-words text-sm font-semibold text-slate-100">{selected.name}</h3><p className="mt-1 text-xs text-slate-400">{inventoryGradeLabel(selected.grade)} · {selected.type ?? 'Chưa rõ loại'}{selected.count > 1 ? ` · ×${selected.count}` : ''}</p><p className="mt-2 break-words text-xs text-slate-300">{selected.desc ?? 'Chưa có mô tả.'}</p><p className="mt-2 break-all font-mono text-[10px] text-slate-400">ID: {selected.id}</p><div aria-hidden="true" className="mt-3 min-h-8 rounded border border-dashed border-slate-700" /></>
                  : <p className="text-xs leading-5 text-slate-400">Chọn một ô để xem chi tiết.</p>}
              </section>
              <EquipmentPanel equipment={inventory.equipment} />
            </div>
          </div>
        </>}
        {!inventory && <p role="status" className="py-6 text-center text-sm text-slate-400">{loading ? 'Đang tải…' : 'Chưa biết'}</p>}
        {inventory && !inventory.known && <p role="status" className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-sm text-slate-300">{inventoryKnowledgeLabel(inventory)}</p>}
      </div>
    </section>
  </div>;
};

export function inventoryKnowledgeLabel(inventory: InventorySnapshot): string {
  return inventory.known ? 'Đã tải túi đồ.' : 'Chưa biết · Túi đồ chưa được tải từ game.';
}

export function inventoryTabCounts(items: InventoryItem[]): Record<InventoryTab, number> {
  return { 'vat-pham': items.filter((item) => item.group === 'vat-pham').length,
    'trang-bi': items.filter((item) => item.group === 'trang-bi').length,
    'dao-thuat': items.filter((item) => item.group === 'dao-thuat').length,
    khac: items.filter((item) => item.group === null).length };
}

/** Shared bag capacity only; null means either input is unknown. */
export function inventoryEmptySlotCount(capacity: number | null | undefined, usedSlots: number | null | undefined): number | null {
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || typeof usedSlots !== 'number' || !Number.isFinite(usedSlots)) return null;
  return Math.min(EMPTY_SLOT_LIMIT, Math.max(0, Math.floor(capacity - usedSlots)));
}

export function inventoryGridEmptySlotCount(capacity: number | null | undefined, usedSlots: number | null | undefined): number {
  return inventoryEmptySlotCount(capacity, usedSlots) ?? 0;
}

export function inventoryCaveStatusChips(cave: NonNullable<InventorySnapshot['caveChest']>) {
  return [
    { key: 'key', label: cave.keyCount > 0 ? `Có chìa khóa ×${cave.keyCount}` : 'Chưa có chìa khóa', active: cave.keyCount > 0 },
    { key: 'chest', label: cave.claimed ? 'Đã nhận rương' : 'Chưa nhận rương', active: cave.claimed },
    { key: 'activation', label: cave.active ? 'Đang kích hoạt' : 'Chưa kích hoạt', active: cave.active },
  ] as const;
}

function InventoryCell({ item, index, hasSelection, selected, onSelect }: { item: InventoryItem; index: number; hasSelection: boolean; selected: boolean; onSelect: () => void }) {
  const color = inventoryGradeStyle(item.grade);
  const symbol = inventorySymbol(item.slot, item.type, item.openable);
  return <button id={`inventory-item-${encodeURIComponent(item.id)}`} type="button" role="gridcell" aria-label={`${item.name}, ${item.type ?? 'loại chưa rõ'}, ký hiệu ${symbol.label}, ${inventoryGradeLabel(item.grade)}, số lượng ${item.count}${item.openable ? ', hộp mở được' : ''}`} aria-selected={selected} tabIndex={selected || (!hasSelection && index === 0) ? 0 : -1} onClick={onSelect}
    onFocus={onSelect} className={`relative flex aspect-square min-w-0 items-center justify-center rounded-lg border-2 transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c101a] ${selected ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#0c101a]' : ''}`} style={{ borderColor: color.border, backgroundColor: color.surface }}>
    <span aria-hidden="true" title={symbol.label} className="text-[clamp(1.1rem,4vw,1.5rem)]">{symbol.mark}</span>
    {item.count > 1 && <span className="absolute bottom-0.5 right-0.5 rounded border border-white/70 bg-[#090c12] px-1 text-[clamp(8px,2.5vw,10px)] font-bold leading-4 tabular-nums text-white shadow-[0_1px_3px_#000]">{item.count}</span>}
    {item.openable && <span className="absolute left-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-100 bg-[#451a03] px-1 text-[11px] leading-none text-amber-50 shadow-[0_1px_3px_#000]" aria-label="Hộp mở được" title="Hộp mở được">🎁</span>}
  </button>;
}

function EquipmentPanel({ equipment }: { equipment: InventorySnapshot['equipment'] }) {
  return <section aria-label="Đang mặc" className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
    <h3 className="mb-2 text-xs font-semibold">Đang mặc</h3>
    {equipment?.length ? <ul className="grid grid-cols-2 gap-1.5">{equipment.map((slot) => { const symbol = inventorySymbol(slot.slotId, null); return <li key={slot.slotId} className="min-w-0 rounded-lg border border-slate-700 bg-slate-950/70 p-2 text-[11px]"><span className="block truncate text-slate-400">{symbol.mark} {slot.slotName}</span><span className="block break-words text-slate-100">{slot.item?.name ?? 'Trống'}</span>{slot.item && <span className="block truncate font-mono text-[9px] text-slate-400">{slot.item.id}</span>}</li>; })}</ul>
      : <p className="text-xs text-slate-400">Chưa biết ô trang bị.</p>}
  </section>;
}
