import React, { useEffect, useState } from 'react';
import {
  Play,
  Square,
  Coins,
  MapPin,
  Backpack,
  Settings,
  Trash2,
  Heart,
  Zap,
  AlertTriangle,
  KeyRound,
  Bug,
} from 'lucide-react';
import { AccountRuntime, MapCatalog, MapRequestReceipt } from '../types';
import { fetchBotConfig, updateBotConfig } from '../lib/api';
import { MapNavigationPanel } from './MapNavigationPanel';
import { MiniMap } from './MiniMap';
import { WorldBounds } from '../lib/minimap';

const finiteValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const displayNumber = (value: unknown): string => {
  const parsed = finiteValue(value);
  return parsed === null ? '—' : parsed.toLocaleString();
};

interface AccountCardProps {
  account: AccountRuntime;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onOpenInventory: (account: AccountRuntime) => void;
  onOpenConfig: (account: AccountRuntime) => void;
  onUpdatePassword: (account: AccountRuntime) => void;
  onDelete: (id: string) => void;
  mapCatalog: MapCatalog;
  mapCatalogLoading: boolean;
  mapCatalogError: string | null;
  onRequestMap?: (accountId: string, mapId: string) => Promise<MapRequestReceipt>;
  mapGeometry?: WorldBounds | null;
  onMoveTo?: (target: { x: number; y: number }) => Promise<void> | void;
  onCancelMoveTo?: (operationId: string) => void;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  onStart,
  onStop,
  onOpenInventory,
  onOpenConfig,
  onUpdatePassword,
  onDelete,
  mapCatalog,
  mapCatalogLoading,
  mapCatalogError,
  onRequestMap,
  mapGeometry,
  onMoveTo,
  onCancelMoveTo,
}) => {
  const [autoFarmEnabled, setAutoFarmEnabled] = useState<boolean | null>(null);
  const [farmToggleLoading, setFarmToggleLoading] = useState(false);
  const [farmToggleError, setFarmToggleError] = useState<string | null>(null);

  const isRunning = account.status === 'running';
  const dataStatus = account.dataStatus;
  const vitals = account.vitals;
  const stonesSnapshot = account.stonesSnapshot;
  // New payloads carry canonical snapshots; the top-level values are retained
  // for compatibility with an older running server. Only use that fallback
  // when its dataStatus flag explicitly says the field is authoritative.
  const hp = finiteValue(vitals?.hp ?? (dataStatus?.hp ? account.hp : null));
  const maxHp = finiteValue(vitals?.maxHp ?? (dataStatus?.maxHp ? account.maxHp : null));
  const mp = finiteValue(vitals?.mp ?? (dataStatus?.mp ? account.mp : null));
  const maxMp = finiteValue(vitals?.maxMp ?? (dataStatus?.maxMp ? account.maxMp : null));
  const derivedMaxHp = finiteValue(account.derivedMax?.maxHp);
  const derivedMaxMp = finiteValue(account.derivedMax?.maxMp);
  const derivedComplete = account.derivedMax?.complete === true;
  const displayMaxHp = maxHp ?? derivedMaxHp;
  const displayMaxMp = maxMp ?? derivedMaxMp;
  const usingDerivedHpMax = maxHp === null && derivedMaxHp !== null;
  const usingDerivedMpMax = maxMp === null && derivedMaxMp !== null;
  const hasFreshVitals = vitals?.status === 'fresh';
  const hasAuthoritativeHp = ((hasFreshVitals && finiteValue(vitals?.hp) !== null) || (dataStatus?.hp === true && hp !== null));
  const hasAuthoritativeMaxHp = ((hasFreshVitals && finiteValue(vitals?.maxHp) !== null) || (dataStatus?.maxHp === true && maxHp !== null));
  const hasAuthoritativeMp = ((hasFreshVitals && finiteValue(vitals?.mp) !== null) || (dataStatus?.mp === true && mp !== null));
  const hasAuthoritativeMaxMp = ((hasFreshVitals && finiteValue(vitals?.maxMp) !== null) || (dataStatus?.maxMp === true && maxMp !== null));
  const hasAnyAuthoritativeHp = hasAuthoritativeHp || hasAuthoritativeMaxHp;
  const hasAnyAuthoritativeMp = hasAuthoritativeMp || hasAuthoritativeMaxMp;
  const hasAuthoritativeStones = (stonesSnapshot?.status === 'fresh' && finiteValue(stonesSnapshot.value) !== null)
    || (dataStatus?.stones === true && finiteValue(account.stones) !== null);
  const displayStones = finiteValue(stonesSnapshot?.value ?? (dataStatus?.stones ? account.stones : null));
  const mapContext = account.mapContext?.fresh ? account.mapContext : null;
  const hasAuthoritativeLocation = !!mapContext;
  const hasAuthoritativeRealm = dataStatus?.realm === true;
  const vitalsStatus = vitals?.status ?? 'unknown';
  const vitalsStatusLabel: Record<string, string> = {
    unknown: 'chưa có dữ liệu',
    fresh: 'đang đồng bộ',
    stale: 'dữ liệu cũ',
    invalid: 'dữ liệu không hợp lệ',
    conflict: 'dữ liệu xung đột',
  };
  const hpPercent = hasAuthoritativeHp && displayMaxHp !== null && displayMaxHp > 0 && (hasAuthoritativeMaxHp || derivedComplete) && hp !== null
    ? Math.min(100, Math.max(0, Math.round((hp / displayMaxHp) * 100))) : null;
  const estimatedHpPercent = !hasAuthoritativeHp && account.selfPresence?.hpPercent !== null && account.selfPresence?.hpPercent !== undefined
    ? Math.round(account.selfPresence.hpPercent) : null;
  const mpPercent = hasAuthoritativeMp && displayMaxMp !== null && displayMaxMp > 0 && (hasAuthoritativeMaxMp || derivedComplete) && mp !== null
    ? Math.min(100, Math.max(0, Math.round((mp / displayMaxMp) * 100))) : null;
  const hasCharacterCoordinates = !!mapContext && finiteValue(account.x) !== null && finiteValue(account.y) !== null;
  const mapId = mapContext?.mapId || '';
  const realm = hasAuthoritativeRealm && typeof account.realm === 'string' && account.realm.trim() ? account.realm.replace(/_/g, ' ') : null;
  const playersContextMatches = !!mapContext && account.playersContext?.fresh === true
    && account.playersContext.mapId === mapContext.mapId && account.playersContext.khu === mapContext.khu;
  const monstersContextMatches = !!mapContext && account.monstersContext?.fresh === true
    && account.monstersContext.mapId === mapContext.mapId && account.monstersContext.khu === mapContext.khu;
  const players = playersContextMatches && Array.isArray(account.players) ? account.players : [];
  const monsters = monstersContextMatches && Array.isArray(account.monsters) ? account.monsters : [];

  useEffect(() => {
    let active = true;
    setAutoFarmEnabled(null);
    setFarmToggleError(null);
    fetchBotConfig(account.id)
      .then((config) => { if (active) setAutoFarmEnabled(config.autoFarm === true); })
      .catch(() => { if (active) setFarmToggleError('Không đọc được cấu hình auto farm.'); });
    return () => { active = false; };
  }, [account.id]);

  const toggleAutoFarm = async () => {
    if (autoFarmEnabled === null || farmToggleLoading) return;
    const enabled = !autoFarmEnabled;
    setFarmToggleLoading(true);
    setFarmToggleError(null);
    try {
      await updateBotConfig(account.id, { autoFarm: enabled, autoTravelToFarm: enabled });
      setAutoFarmEnabled(enabled);
    } catch (error) {
      setFarmToggleError(error instanceof Error ? error.message : 'Không lưu được cấu hình auto farm.');
    } finally {
      setFarmToggleLoading(false);
    }
  };

  const getActivityBadge = (activity: string) => {
    switch (activity) {
      case 'selling':
        return <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Bán đồ</span>;
      case 'farming':
        return <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-lime-500/20 text-lime-300 border border-lime-500/30">Dược điền</span>;
      case 'healing':
      case 'restocking':
        return <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">Hồi phục</span>;
      case 'questing':
      case 'daily':
        return <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">Nhiệm vụ</span>;
      case 'cave':
        return <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Bí cảnh</span>;
      default:
        return <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-slate-800 text-slate-400 border border-slate-700">Nghỉ</span>;
    }
  };

  return (
    <div className={`rounded-xl p-4 transition-all duration-300 ${
      isRunning
        ? 'glass-panel-glow border-emerald-500/30'
        : account.authError
        ? 'glass-panel border-rose-500/40 bg-rose-950/10'
        : 'glass-panel hover:border-slate-700/80'
    }`}>
      {/* Top Header: Character Name, Realm, Status */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold border ${
              isRunning
                ? 'bg-gradient-to-br from-emerald-900/60 to-slate-900 border-emerald-500/50 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                : account.authError
                ? 'bg-rose-900/30 border-rose-500/40 text-rose-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}>
              {account.characterName ? account.characterName.slice(0, 2).toUpperCase() : 'TT'}
            </div>
            {isRunning && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100 tracking-wide font-title">
                {account.characterName || account.accountName}
              </h3>
              <span className="text-[11px] font-mono text-slate-500">(@{account.accountName})</span>
            </div>

            <div className="flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 capitalize">
                {realm || (hasAuthoritativeRealm ? '—' : 'Chưa có dữ liệu cảnh giới')}
              </span>
              {isRunning && getActivityBadge(account.activity)}
            </div>
          </div>
        </div>

        {/* Start / Stop Toggle */}
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <button
              onClick={() => onStop(account.id)}
              title="Dừng bot"
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors shadow-sm"
            >
              <Square className="w-3.5 h-3.5 fill-rose-400" />
              <span>Dừng</span>
            </button>
          ) : (
            <button
              onClick={() => onStart(account.id)}
              title="Bắt đầu bot"
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 transition-colors shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-emerald-400" />
              <span>Chạy</span>
            </button>
          )}
        </div>
      </div>

      {/* Auth Error Banner if password expired/invalid */}
      {account.authError && (
        <div className="mb-3 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="truncate">{account.authError}</span>
          </div>
          <button
            onClick={() => onUpdatePassword(account)}
            className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold shrink-0 transition-colors"
          >
            Đổi Mật Khẩu
          </button>
        </div>
      )}

      {/* HP Bar */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-rose-400 font-medium">
            <Heart className="w-3.5 h-3.5 fill-rose-500/30" /> HP (Sinh Lực)
          </span>
          <span className={`font-mono text-[11px] ${vitalsStatus === 'fresh' ? 'text-slate-300' : 'text-amber-300'}`}>
            {estimatedHpPercent !== null
              ? `HP ~${estimatedHpPercent}% (ước lượng)`
              : !hasAnyAuthoritativeHp && vitalsStatus !== 'fresh'
              ? `Vitals: ${vitalsStatusLabel[vitalsStatus] || vitalsStatus}`
              : `${hasAuthoritativeHp ? displayNumber(hp) : '—'} / ${displayMaxHp === null ? '—' : `${usingDerivedHpMax && !derivedComplete ? '~' : ''}${displayNumber(displayMaxHp)}${usingDerivedHpMax ? ' (suy ra)' : ''}`}${hpPercent === null ? '' : ` (${hpPercent}%)`}`}
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-500 rounded-full"
            style={{ width: `${hpPercent ?? 0}%` }}
          />
        </div>
      </div>

      {/* MP Bar */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-sky-400 font-medium">
            <Zap className="w-3.5 h-3.5 fill-sky-500/30" /> MP (Linh Lực)
          </span>
          <span className="text-slate-300 font-mono text-[11px]">
            {!hasAnyAuthoritativeMp && !hasAuthoritativeMp && displayMaxMp === null ? 'MP: đang chờ dữ liệu realtime' : `${hasAuthoritativeMp ? displayNumber(mp) : '—'} / ${displayMaxMp === null ? '—' : `${usingDerivedMpMax && !derivedComplete ? '~' : ''}${displayNumber(displayMaxMp)}${usingDerivedMpMax ? ' (suy ra)' : ''}`}${mpPercent === null ? '' : ` (${mpPercent}%)`}`}
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-500 rounded-full"
            style={{ width: `${mpPercent ?? 0}%` }}
          />
        </div>
      </div>

      {/* Stats Row: Linh Thạch & Map Location */}
      <div className="grid grid-cols-2 gap-2 py-2 px-3 rounded-lg bg-slate-950/50 border border-slate-800/80 mb-3 text-xs">
        <div className="flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-amber-400" />
          <span className="text-slate-400">Linh thạch:</span>
          <span className="text-amber-300 font-bold font-mono">
            {account.status === 'running' && hasAuthoritativeStones && displayStones !== null
              ? displayStones.toLocaleString()
              : 'Đang chờ dữ liệu realtime'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 justify-end">
          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-300 capitalize truncate max-w-[120px]">
            {hasAuthoritativeLocation && mapId ? `${mapId.replace(/_/g, ' ')} (Khu ${displayNumber(mapContext.khu)})` : 'Chưa có dữ liệu vị trí'}
          </span>
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-[11px]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-slate-200">
          <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-emerald-400" /><span className="font-semibold">Bản đồ · thực thể</span></div>
          <span className="text-slate-400">{hasAuthoritativeLocation ? `${mapId || '—'} · Khu ${displayNumber(mapContext.khu)}` : 'Chưa có dữ liệu vị trí'}</span>
        </div>
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 border-b border-slate-800 pb-2 text-[10px]">
          <span className="text-emerald-300">● Nhân vật</span>
          <span className="text-sky-300">● Người chơi</span>
          <span className="text-rose-300">◆ Quái vật</span>
          <span className="text-amber-300">■ Bãi farm (tọa độ cấu hình)</span>
        </div>
        <div className="space-y-1.5">
          {hasCharacterCoordinates && <div className="flex items-center justify-between gap-2 rounded bg-slate-900/80 px-2 py-1.5"><span className="min-w-0 truncate text-emerald-300">● {account.characterName || account.accountName}</span><span className="shrink-0 font-mono text-slate-300">X {displayNumber(account.x)} · Y {displayNumber(account.y)}</span></div>}
          {hasAuthoritativeLocation && !hasCharacterCoordinates && <p className="px-2 py-1 text-slate-500">Dữ liệu vị trí đã nhận nhưng thiếu tọa độ nhân vật</p>}
          <div className="flex items-center justify-between gap-2 rounded bg-slate-900/80 px-2 py-1.5"><span className="min-w-0 truncate text-amber-300">■ Bãi farm · {account.farmMapId || 'Chưa cấu hình'} / K{displayNumber(account.farmKhu)}</span><span className="shrink-0 font-mono text-slate-300">X {displayNumber(account.farmX)} · Y {displayNumber(account.farmY)}</span></div>

          <MiniMap account={account} geometry={mapGeometry} onMoveTo={onMoveTo} onCancelMoveTo={onCancelMoveTo} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 pt-1 text-[10px] text-slate-400">
            <span>Người chơi: {playersContextMatches ? players.length : 'chưa fresh'}</span>
            <span>Quái: {monstersContextMatches ? monsters.length : 'chưa fresh'}</span>
          </div>
        </div>
        {(playersContextMatches || monstersContextMatches) && <div className="mt-2 text-right text-[10px] text-slate-500">Snapshot lúc {new Date(Math.max(playersContextMatches ? account.playersContext!.observedAt ?? 0 : 0, monstersContextMatches ? account.monstersContext!.observedAt ?? 0 : 0)).toLocaleTimeString()}</div>}
      </div>

      {account.training && (
        <div className="mb-3 rounded-lg border border-indigo-500/20 bg-indigo-950/20 px-3 py-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-indigo-200">Training · {account.training.phase}</span>
            <span className={account.training.enabled ? 'text-emerald-300' : 'text-slate-500'}>{account.training.enabled ? 'Đang bật' : 'Đang tắt'}</span>
          </div>
          {account.training.reason && <p className="mt-1 text-amber-300">{account.training.reason}</p>}
          <p className="mt-1 text-slate-300">Quái mục tiêu: {account.training.target.monsterType?.trim() || 'Mọi loại'}</p>
        </div>
      )}

      <MapNavigationPanel account={account} catalog={mapCatalog} catalogLoading={mapCatalogLoading} catalogError={mapCatalogError} onRequestMap={onRequestMap} />

      <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-xs font-semibold text-slate-200">Auto farm</div><div className="text-[10px] text-slate-500">Bật để farm và tự di chuyển về map farm đã cấu hình</div><div className={`mt-1 text-[10px] font-medium ${autoFarmEnabled ? 'text-emerald-300' : 'text-slate-400'}`}>{autoFarmEnabled === null ? 'Đang tải cấu hình…' : autoFarmEnabled ? 'Đang bật' : 'Đang tắt'}</div></div>
          <button type="button" role="switch" aria-label="Bật hoặc tắt auto farm" aria-checked={autoFarmEnabled === true} disabled={autoFarmEnabled === null || farmToggleLoading} onClick={toggleAutoFarm} className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-wait disabled:opacity-50 ${autoFarmEnabled ? 'border-emerald-500 bg-emerald-600' : 'border-slate-700 bg-slate-800'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${autoFarmEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        {farmToggleError && <p role="alert" className="mt-2 text-[10px] text-rose-300">{farmToggleError}</p>}
      </div>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-800/60">
        <div className="flex items-center gap-1">
          {/* Tác vụ cũ đang được sửa nên tạm ẩn khỏi UI. */}

          {/* Inventory modal */}
          <button
            onClick={() => onOpenInventory(account)}
            title="Xem túi đồ"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border border-slate-700 text-xs transition-colors"
          >
            <Backpack className="w-3.5 h-3.5" />
            <span>Túi ({account.bagCount || 0})</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* Update Password */}
          <button
            onClick={() => onUpdatePassword(account)}
            title="Cập nhật mật khẩu game"
            className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-amber-300 border border-slate-700 transition-colors"
          >
            <KeyRound className="w-4 h-4" />
          </button>

          {/* Config modal */}
          <button
            onClick={() => onOpenConfig(account)}
            title="Cài đặt quy tắc Bot"
            className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border border-slate-700 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Delete account */}
          <button
            onClick={() => onDelete(account.id)}
            title="Xóa tài khoản khỏi hệ thống"
            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
