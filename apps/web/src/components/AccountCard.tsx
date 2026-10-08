import React from 'react';
import { AlertTriangle, Heart, KeyRound, MapPin, Play, Square, Trash2, Zap } from 'lucide-react';
import type { AccountRuntime, MoveToOperation } from '../types';
import { resolveMapContext, resolveVitalsAge, VITALS_DISPLAY_STALE_MS } from '../lib/context';
import { MiniMap } from './MiniMap';
import { MapTravelControl } from './MapTravelControl';
import type { WorldBounds } from '../lib/minimap';
import type { MapCatalogItem } from '../lib/api';

const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const display = (value: unknown): string => {
  const number = finite(value);
  return number === null ? '—' : number.toLocaleString();
};

interface AccountCardProps {
  account: AccountRuntime;
  mapCatalog: MapCatalogItem[];
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onStartVendorAuto: (account: AccountRuntime) => void;
  onStopVendorAuto: (id: string) => void;
  onMoveTo: (id: string, target?: { x: number; y: number }, options?: { targetMapId?: string; abortOnHurt?: boolean; maxHurt?: number }) => Promise<MoveToOperation>;
  onCancelMoveTo: (id: string, operationId: string) => Promise<MoveToOperation>;
  onUpdatePassword: (account: AccountRuntime) => void;
  onDelete: (id: string) => void;
  mapGeometry?: WorldBounds | null;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  mapCatalog,
  onStart,
  onStop,
  onStartVendorAuto,
  onStopVendorAuto,
  onMoveTo,
  onCancelMoveTo,
  onUpdatePassword,
  onDelete,
  mapGeometry,
}) => {
  const running = account.status === 'running';
  const vitals = account.vitals;
  const derived = account.derivedMax;
  const hp = finite(vitals.hp);
  const mp = finite(vitals.mp);
  const maxHp = finite(vitals.maxHp) ?? finite(derived.maxHp);
  const maxMp = finite(vitals.maxMp) ?? finite(derived.maxMp);
  const fresh = vitals.status === 'fresh';
  const hpPercent = fresh && hp !== null && maxHp !== null && maxHp > 0 ? Math.round((hp / maxHp) * 100) : null;
  const mpPercent = fresh && mp !== null && maxMp !== null && maxMp > 0 ? Math.round((mp / maxMp) * 100) : null;
  const age = resolveVitalsAge(account);
  const mapView = resolveMapContext(account);
  const locationKnown = mapView.usable && account.x !== null && account.y !== null;
  const ageLabel = age === null ? '—' : age < 1000 ? '<1s' : `${Math.floor(age / 1000)}s`;

  return <div className={`rounded-xl p-4 border ${running ? 'border-emerald-500/30 glass-panel-glow' : 'glass-panel border-slate-800'}`}>
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="text-base font-bold text-slate-100 truncate">{account.characterName || account.accountName}</h3>
        <p className="text-[11px] text-slate-500 truncate">@{account.accountName} · engine vendor</p>
      </div>
      {running ? <button onClick={() => onStop(account.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40"><Square className="w-3.5 h-3.5 fill-rose-400" /> Dừng</button>
        : <button onClick={() => onStart(account.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/40"><Play className="w-3.5 h-3.5 fill-emerald-400" /> Chạy</button>}
    </div>

    {account.authError && <div className="mb-3 p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 truncate"><AlertTriangle className="w-4 h-4 shrink-0" />{account.authError}</span>
      <button onClick={() => onUpdatePassword(account)} className="px-2 py-1 rounded bg-rose-600 text-white text-[10px] shrink-0">Đổi mật khẩu</button>
    </div>}

    <div className="space-y-3 mb-3">
      <VitalBar icon={<Heart className="w-3.5 h-3.5" />} label="HP" value={hp} max={maxHp} percent={hpPercent} color="rose" stale={age !== null && age > VITALS_DISPLAY_STALE_MS} age={ageLabel} />
      <VitalBar icon={<Zap className="w-3.5 h-3.5" />} label="MP" value={mp} max={maxMp} percent={mpPercent} color="sky" stale={age !== null && age > VITALS_DISPLAY_STALE_MS} age={ageLabel} />
    </div>

    <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-950/50 border border-slate-800/80 p-2.5 text-xs">
      <span className="flex items-center gap-1.5 text-slate-400"><MapPin className="w-3.5 h-3.5 text-emerald-400" />{locationKnown ? `${mapView.mapId} · Khu ${mapView.khu ?? 'chưa biết'}` : 'Chưa có vị trí'}</span>
      <span className="text-right text-slate-400">{locationKnown ? `X ${display(account.x)} · Y ${display(account.y)}` : '—'}</span>
    </div>

    <MiniMap
      account={account}
      geometry={mapGeometry}
      onMoveTo={(target) => onMoveTo(account.id, target)}
      onCancelMoveTo={(operationId) => onCancelMoveTo(account.id, operationId)}
    />

    <MapTravelControl
      account={account}
      mapCatalog={mapCatalog}
      onMoveTo={(target, options) => onMoveTo(account.id, target, options)}
      onCancelMoveTo={(operationId) => onCancelMoveTo(account.id, operationId)}
    />

    {account.vendor && <div className="mt-3 rounded-lg border border-cyan-500/25 bg-cyan-950/15 px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2"><span className="font-semibold text-cyan-200">Auto chính thức · {account.vendor.supervisor.phase}</span><span className={account.vendor.autoRequested ? 'text-emerald-300' : 'text-slate-400'}>{account.vendor.autoRequested ? 'Đang bật' : 'Đang tắt'}</span></div>
      <p className="mt-1 text-slate-300">Neo: {account.vendor.supervisor.anchor ? `${account.vendor.supervisor.anchor.mapId} · Khu ${account.vendor.supervisor.anchor.khu ?? '—'} · X ${display(account.vendor.supervisor.anchor.x)} · Y ${display(account.vendor.supervisor.anchor.y)}` : 'chưa đặt'}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 text-slate-400"><span>Chết: {account.vendor.supervisor.stats.deaths}</span><span>Chuyến về: {account.vendor.supervisor.stats.trips}</span><span>Hurt: {account.vendor.hurtCount}</span></div>
      {account.vendor.supervisor.phase === 'halted' && <p role="alert" className="mt-1 text-rose-300">Đã dừng an toàn: {account.vendor.supervisor.reasonCode || 'không rõ lý do'}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={account.vendor.autoRequested || account.vendor.downed === true} onClick={() => onStartVendorAuto(account)} className="rounded-lg border border-cyan-500/40 bg-cyan-600/20 px-2.5 py-1.5 text-cyan-200 disabled:opacity-40">Bật Auto tại vị trí này</button>
        <button type="button" disabled={!account.vendor.autoRequested && account.vendor.supervisor.phase === 'idle'} onClick={() => onStopVendorAuto(account.id)} className="rounded-lg border border-rose-500/40 bg-rose-600/20 px-2.5 py-1.5 text-rose-200 disabled:opacity-40">Dừng Auto</button>
      </div>
    </div>}

    <div className="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-2 text-xs">
      <span className="text-slate-400">{account.downed === true ? 'Đang gục' : account.activity}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onUpdatePassword(account)} title="Cập nhật mật khẩu" className="p-1.5 rounded bg-slate-800/60 text-amber-300 border border-slate-700"><KeyRound className="w-4 h-4" /></button>
        <button onClick={() => onDelete(account.id)} title="Xóa tài khoản" className="p-1.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  </div>;
};

function VitalBar({ icon, label, value, max, percent, color, stale, age }: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  max: number | null;
  percent: number | null;
  color: 'rose' | 'sky';
  stale: boolean;
  age: string;
}) {
  const fill = color === 'rose' ? 'from-rose-600 to-rose-400' : 'from-sky-600 to-sky-400';
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between text-xs"><span className={`flex items-center gap-1 ${color === 'rose' ? 'text-rose-400' : 'text-sky-400'}`}>{icon}{label}</span><span className={`font-mono text-[11px] ${stale ? 'text-amber-300 opacity-70' : 'text-slate-300'}`}>{value === null ? '—' : display(value)} / {max === null ? '—' : display(max)} · {age}</span></div>
    <div className="w-full h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">{percent !== null && <div className={`h-full bg-gradient-to-r ${fill} rounded-full`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />}</div>
  </div>;
}
