import React from 'react';
import { ArrowLeft, Play, Square, X, KeyRound, Trash2, Heart, Zap, Activity, MapPin, Copy } from 'lucide-react';
import type { AccountRuntime, MoveToOperation } from '../types';
import type { WorldBounds } from '../lib/minimap';
import type { MapCatalogItem } from '../lib/api';
import { resolveMapContext, resolveVitalsAge, VITALS_DISPLAY_STALE_MS } from '../lib/context';
import { vitalPercent, ACCOUNT_TABS, isAccountTabActive, realmLabel, canPlay, OFFICIAL_GAME_URL, copyAccountName, type AccountTab } from './account-dashboard';
import { MiniMap } from './MiniMap';
import { MapTravelControl } from './MapTravelControl';
import { KhuControl } from './KhuControl';
import { DailyControl } from './DailyControl';
import { InventoryModal } from './InventoryModal';
import { LogTerminal } from './LogTerminal';
import { VitalBar } from './VitalBar';

interface Props {
  account: AccountRuntime; tab: AccountTab; onTabChange: (tab: AccountTab) => void; logs: import('../types').LogEntry[]; onClearLogs: () => void;
  ownerLabel?: string | null; controlsDisabled: boolean; controlLockReason: string | null; mapCatalog: MapCatalogItem[]; mapGeometry?: WorldBounds | null;
  onBack?: () => void; onStart: (id: string) => void; onStop: (id: string) => void;
  onStartVendorAuto: (account: AccountRuntime) => void; onStopVendorAuto: (id: string) => void;
  onMoveTo: (id: string, target?: { x: number; y: number }, options?: { targetMapId?: string; abortOnHurt?: boolean; maxHurt?: number }) => Promise<MoveToOperation>;
  onCancelMoveTo: (id: string, operationId: string) => Promise<MoveToOperation>; onUpdatePassword: (account: AccountRuntime) => void; onDelete: (id: string) => void;
}

export const AccountPanel: React.FC<Props> = (props) => {
  const [copyNotice, setCopyNotice] = React.useState('');
  const { account, tab, onTabChange } = props;
  const running = account.status === 'running';
  const label = account.characterName || account.accountName;
  const characterFresh = account.character?.fresh === true && !account.dataStale;
  const mapView = resolveMapContext(account);
  const age = resolveVitalsAge(account);
  const fresh = account.vitals.status === 'fresh' && !account.dataStale && (age === null || age <= VITALS_DISPLAY_STALE_MS);
  const hp = fresh ? account.vitals.hp : null;
  const mp = fresh ? account.vitals.mp : null;
  const hpMax = fresh ? account.vitals.maxHp ?? account.derivedMax.maxHp : null;
  const mpMax = fresh ? account.vitals.maxMp ?? account.derivedMax.maxMp : null;
  const playable = canPlay(account);
  const copyName = async () => { const copied = await copyAccountName(account.accountName); setCopyNotice(copied ? 'Đã sao chép' : 'Không sao chép được'); window.setTimeout(() => setCopyNotice(''), 1800); };

  return <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/40">
    <header className="border-b border-slate-800 bg-slate-950/60 p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 max-w-full flex-col items-start gap-2 lg:flex-row">{props.onBack && <button type="button" onClick={props.onBack} className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-2 text-xs text-slate-200 lg:hidden"><ArrowLeft className="mr-1 inline h-3.5 w-3.5" />Quay lại danh sách</button>}
          <div className="min-w-0 max-w-full"><h2 className="truncate font-title text-lg font-bold text-slate-100">{label}</h2><p className="truncate text-xs text-slate-400">{characterFresh ? realmLabel(account.character) : '—'} · @{account.accountName}</p></div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{running ? <button onClick={() => props.onStop(account.id)} className="flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200"><Square className="h-3.5 w-3.5 fill-rose-400" />Dừng</button> : <button onClick={() => props.onStart(account.id)} disabled={props.controlsDisabled} title={props.controlLockReason ?? 'Chạy bot'} className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-200 disabled:opacity-40"><Play className="h-3.5 w-3.5 fill-emerald-400" />Chạy</button>}
          <a href={playable ? OFFICIAL_GAME_URL : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!playable} tabIndex={playable ? 0 : -1} title={!playable ? 'Dừng bot trước khi chơi: game chỉ cho một phiên đăng nhập mỗi tài khoản' : 'Mở trang game chính thức'} onClick={(event) => { if (!playable) event.preventDefault(); }} onKeyDown={(event) => { if (!playable && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); }} className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-xs ${playable ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'pointer-events-none cursor-not-allowed border-slate-700 bg-slate-800/50 text-slate-500'}`}>Chơi</a>
          <button type="button" onClick={() => void copyName()} className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-2 text-xs text-slate-300"><Copy className="h-3.5 w-3.5" />Sao chép đạo hiệu</button>{copyNotice && <span role="status" className="text-xs text-emerald-300">{copyNotice}</span>}
          {account.vendor?.autoRequested ? <button type="button" onClick={() => props.onStopVendorAuto(account.id)} className="hidden rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 sm:block">Tắt Auto</button> : <button type="button" onClick={() => props.onStartVendorAuto(account)} disabled={props.controlsDisabled || !account.vendor || account.vendor.downed === true} title={props.controlLockReason ?? (!account.vendor ? 'Cần chạy tài khoản để bật Auto' : 'Bật Auto')} className="hidden rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200 disabled:opacity-40 sm:block">Bật Auto</button>}
          <button type="button" onClick={props.onBack} aria-label="Đóng chi tiết tài khoản" className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-slate-100"><X className="h-4 w-4" /></button>
        </div>
      </div>
      {account.dataStale && <p role="status" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">Dữ liệu cũ · trạng thái chưa biết</p>}
      {!playable && <p className="mt-2 text-xs text-amber-300">Dừng bot trước khi chơi: game chỉ cho một phiên đăng nhập mỗi tài khoản</p>}
      {account.connection === 'RECONNECTING' && <p role="status" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">Đang kết nối lại · lần thử {account.vendor?.reconnectAttempts ?? '—'}</p>}
      {account.authError && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200"><span>{account.authError}</span><button type="button" onClick={() => props.onUpdatePassword(account)} className="rounded bg-rose-600 px-2.5 py-1.5 text-white">Đổi mật khẩu</button></div>}
    </header>
    <nav role="tablist" aria-label="Chi tiết tài khoản" className="flex min-w-0 flex-wrap gap-1 border-b border-slate-800 bg-slate-950/30 px-2">
      {ACCOUNT_TABS.map((item) => <button key={item.id} type="button" role="tab" id={`account-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="account-tabpanel" onClick={() => onTabChange(item.id)} className={`shrink-0 border-b-2 px-3 py-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${tab === item.id ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{item.label}</button>)}
    </nav>
    <div role="tabpanel" id="account-tabpanel" aria-labelledby={`account-tab-${tab}`} className="min-w-0 space-y-4 p-3 sm:p-5">
      {isAccountTabActive(tab, 'overview') && <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><LargeVital label="HP" value={hp} max={hpMax} icon={<Heart className="h-5 w-5" />} color="rose" fresh={fresh} age={age} /><LargeVital label="Linh lực (MP)" value={mp} max={mpMax} icon={<Zap className="h-5 w-5" />} color="sky" fresh={fresh} age={age} /></div>
        <CharacterStats account={account} />
        <StonesStats account={account} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"> <InfoBox icon={<MapPin />} label="Vị trí" value={mapView.usable ? `${mapView.mapId} · Khu ${mapView.khu ?? 'chưa biết'} · X ${account.x ?? '—'} · Y ${account.y ?? '—'}` : 'Chưa có vị trí mới'} /><InfoBox icon={<Activity />} label="Hoạt động" value={account.downed === true ? 'Đang gục' : account.activity || '—'} /><InfoBox label="Độ trễ" value={account.latencyMs === null ? '—' : `${account.latencyMs} ms`} /><InfoBox label="Proxy" value={account.hasProxy ? `${account.proxy?.label ?? 'Đã gán'} · ${account.proxy?.status ?? 'chưa biết'}` : 'Chưa gán'} />{props.ownerLabel && <InfoBox label="Chủ sở hữu" value={props.ownerLabel} />}</div>
      </div>}
      {isAccountTabActive(tab, 'map') && <div className="space-y-4"><MiniMap account={account} controlsDisabled={props.controlsDisabled} geometry={props.mapGeometry} onMoveTo={(target) => props.onMoveTo(account.id, target)} onCancelMoveTo={(operationId) => props.onCancelMoveTo(account.id, operationId)} /><MapTravelControl account={account} controlsDisabled={props.controlsDisabled} controlLockReason={props.controlLockReason} mapCatalog={props.mapCatalog} onMoveTo={(target, options) => props.onMoveTo(account.id, target, options)} onCancelMoveTo={(operationId) => props.onCancelMoveTo(account.id, operationId)} /><KhuControl account={account} controlsDisabled={props.controlsDisabled} controlLockReason={props.controlLockReason} /></div>}
      {isAccountTabActive(tab, 'daily') && <DailyControl account={account} controlsDisabled={props.controlsDisabled} controlLockReason={props.controlLockReason} />}
      {isAccountTabActive(tab, 'inventory') && (running ? <InventoryModal accountId={account.id} accountLabel={label} embedded /> : <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">Túi đồ chỉ khả dụng khi tài khoản đang chạy.</p>)}
      {isAccountTabActive(tab, 'auto') && <AutoPanel account={account} disabled={props.controlsDisabled} lockReason={props.controlLockReason} onStart={props.onStartVendorAuto} onStop={props.onStopVendorAuto} />}
      {isAccountTabActive(tab, 'logs') && <LogTerminal logs={props.logs} accounts={[account]} onClearLogs={props.onClearLogs} initialAccountId={account.id} />}
      {isAccountTabActive(tab, 'account') && <div className="grid gap-3 sm:grid-cols-2"><InfoBox label="Tài khoản" value={account.accountName} /><InfoBox label="Proxy" value={account.hasProxy ? `${account.proxy?.label ?? 'Đã gán'} · ${account.proxy?.status ?? 'chưa biết'}` : 'Chưa gán'} />{props.ownerLabel && <InfoBox label="Chủ sở hữu" value={props.ownerLabel} />}<div className="flex flex-wrap gap-2 sm:col-span-2"><button type="button" onClick={() => props.onUpdatePassword(account)} className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"><KeyRound className="h-4 w-4" />Đổi mật khẩu</button><button type="button" onClick={() => props.onDelete(account.id)} className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"><Trash2 className="h-4 w-4" />Xóa tài khoản</button></div></div>}
    </div>
  </section>;
};

const CharacterStats: React.FC<{ account: AccountRuntime }> = ({ account }) => {
  const character = account.character;
  const fresh = character?.fresh === true && !account.dataStale;
  const values = [
    { label: 'Thần thức', value: fresh ? character?.sp ?? null : null, max: fresh ? character?.spMax ?? null : null, color: 'violet' as const },
    { label: 'Giáp', value: fresh ? character?.bp ?? null : null, max: fresh ? character?.bpMax ?? null : null, color: 'amber' as const },
    { label: 'Đạo Hạnh', value: fresh ? character?.exp ?? null : null, max: fresh ? character?.expMax ?? null : null, color: 'emerald' as const },
  ];
  return <div className="grid gap-3 sm:grid-cols-3">{values.map((item) => {
    const percent = vitalPercent(item.value, item.max, fresh);
    return <section key={item.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><h3 className="text-sm font-semibold text-slate-200">{item.label}</h3><p className="mt-3 font-mono text-xl text-slate-100">{item.value === null ? '—' : item.value.toLocaleString()} <span className="text-sm text-slate-400">/ {item.max === null ? '—' : item.max.toLocaleString()}</span></p><div className="mt-3"><VitalBar label={item.label} value={item.value} max={item.max} fresh={fresh} color={item.color} compact={false} showLabel={false} /></div><p className="mt-2 text-[11px] text-slate-400">{percent === null ? (character && !fresh ? 'Dữ liệu cũ' : 'Chưa có số liệu mới') : `${percent}%`}</p></section>;
  })}</div>;
};

const StonesStats: React.FC<{ account: AccountRuntime }> = ({ account }) => {
  const character = account.character;
  const fresh = character?.fresh === true && !account.dataStale;
  const stones = fresh ? character?.stones ?? null : null;
  const today = fresh ? character?.stonesToday ?? null : null;
  const cap = fresh ? character?.stonesCap ?? null : null;
  const net = fresh ? character?.stonesSessionNet ?? null : null;
  const percent = vitalPercent(today, cap, fresh);
  const fmt = (value: number | null) => value === null ? '—' : value.toLocaleString();
  return <section className="rounded-xl border border-amber-500/25 bg-slate-900/60 p-4"><h3 className="text-sm font-semibold text-amber-200">Linh Thạch</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-[11px] text-slate-400">Hiện có</p><p className="font-mono text-lg text-slate-100">{fmt(stones)}</p></div><div><p className="text-[11px] text-slate-400">Hôm nay từ quái</p><p className="font-mono text-lg text-slate-100">{fmt(today)} <span className="text-sm text-slate-400">/ {fmt(cap)}</span></p><div className="mt-2"><VitalBar label="Linh Thạch hôm nay" value={today} max={cap} fresh={fresh} color="amber" compact={false} showLabel={false} /></div><p className="mt-1 text-[11px] text-slate-400">{percent === null ? '—' : `${percent}%`}</p></div><div><p className="text-[11px] text-slate-400">Biến động từ lúc bật</p><p className="font-mono text-lg text-slate-100">{net === null ? '—' : `${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net).toLocaleString()}`}</p></div></div><p className="mt-3 text-[11px] text-slate-500">Từ quái; trần theo cảnh giới</p></section>;
};

const LargeVital: React.FC<{ label: string; value: number | null; max: number | null; icon: React.ReactNode; color: 'rose' | 'sky'; fresh: boolean; age: number | null }> = ({ label, value, max, icon, color, fresh, age }) => {
  const percent = vitalPercent(value, max, fresh);
  const theme = color === 'rose' ? 'text-rose-300' : 'text-sky-300';
  return <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><div className={`flex items-center gap-2 ${theme}`}>{icon}<h3 className="text-sm font-semibold">{label}</h3></div><p className="mt-3 font-mono text-2xl text-slate-100">{value === null ? '—' : value.toLocaleString()} <span className="text-sm text-slate-400">/ {max === null ? '—' : max.toLocaleString()}</span></p><div className="mt-3"><VitalBar label={label} value={value} max={max} fresh={fresh} color={color} compact={false} showLabel={false} /></div><p className="mt-2 text-[11px] text-slate-400">{percent === null ? 'Chưa có số liệu mới' : `${percent}% · dữ liệu ${age === null ? '—' : `${Math.floor(age / 1000)} giây`}`}</p></section>;
};

const InfoBox: React.FC<{ icon?: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 p-3"><p className="flex items-center gap-1.5 text-[11px] text-slate-400">{icon && React.cloneElement(icon as React.ReactElement, { className: 'h-3.5 w-3.5 text-emerald-400' })}{label}</p><p className="mt-1 break-words text-sm text-slate-100">{value}</p></div>;

const AutoPanel: React.FC<{ account: AccountRuntime; disabled: boolean; lockReason: string | null; onStart: (account: AccountRuntime) => void; onStop: (id: string) => void }> = ({ account, disabled, lockReason, onStart, onStop }) => {
  const vendor = account.vendor;
  if (!vendor) return <p className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 text-sm text-slate-400">Auto chính thức khả dụng khi tài khoản đang chạy.</p>;
  const anchor = vendor.supervisor.anchor;
  const resumeSeconds = vendor.autoResume?.pending && typeof vendor.autoResume.expiresAt === 'number' ? Math.max(0, Math.ceil((vendor.autoResume.expiresAt - Date.now()) / 1000)) : null;
  return <section className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-cyan-100">Auto chính thức · {vendor.supervisor.phase}</h3><span className={vendor.autoRequested ? 'text-emerald-300' : 'text-slate-300'}>{vendor.autoRequested ? 'Đang bật' : 'Đang tắt'}</span></div>{vendor.autoResume?.pending && <p className="mt-2 text-sm text-amber-200">Đang chờ HP để tiếp tục Auto (còn {resumeSeconds ?? '—'} giây)</p>}<p className="mt-3 text-sm text-slate-200">Neo: {anchor ? `${anchor.mapId} · Khu ${anchor.khu ?? '—'} · X ${anchor.x} · Y ${anchor.y}` : 'chưa đặt'}</p><div className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-300"><span>Chết: {vendor.supervisor.stats.deaths}</span><span>Chuyến về: {vendor.supervisor.stats.trips}</span><span>Hurt: {vendor.hurtCount}</span></div>{vendor.supervisor.phase === 'halted' && <p role="alert" className="mt-2 text-sm text-rose-300">Đã dừng an toàn: {vendor.supervisor.reasonCode || 'không rõ lý do'}</p>}<div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={disabled || vendor.autoRequested || vendor.downed === true} title={lockReason ?? 'Bật Auto'} onClick={() => onStart(account)} className="rounded-lg border border-cyan-400/50 bg-cyan-500/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">Bật Auto tại vị trí này</button><button type="button" disabled={!vendor.autoRequested && vendor.supervisor.phase === 'idle'} onClick={() => onStop(account.id)} className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200 disabled:opacity-40">Dừng Auto</button></div></section>;
};
