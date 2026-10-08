import React, { useEffect, useMemo, useState } from 'react';
import type { AccountRuntime, MoveToOperation, ReachableMap } from '../types';
import { fetchReachableMaps, type MapCatalogItem } from '../lib/api';
import { resolveMapContext } from '../lib/context';

interface MapTravelControlProps {
  account: AccountRuntime;
  mapCatalog: MapCatalogItem[];
  onMoveTo: (
    target?: { x: number; y: number },
    options?: { targetMapId?: string; abortOnHurt?: boolean; maxHurt?: number },
  ) => Promise<MoveToOperation>;
  onCancelMoveTo: (operationId: string) => Promise<MoveToOperation>;
}

const running = (operation: MoveToOperation | null): boolean => operation?.status === 'accepted' || operation?.status === 'running';

export function getMapTravelLockReason(input: {
  runnerReady: boolean;
  contextUsable: boolean;
  autoActive: boolean;
  operation: MoveToOperation | null;
}): string | null {
  if (!input.runnerReady) return 'Bot chưa chạy: bấm "Chạy" trước';
  if (!input.contextUsable) return 'Chưa có vị trí map (đang vào game hoặc đang chuyển map)';
  if (input.autoActive) return 'Tắt Auto để di chuyển bằng tay';
  if (running(input.operation)) return 'Đang có thao tác di chuyển';
  return null;
}

export function formatMapTravelRoute(route: string[]): string {
  return route.join(` ${String.fromCodePoint(0x2192)} `);
}

const phaseLabel: Record<string, string> = {
  walking_to_gate: 'Đang đi tới cổng',
  on_gate: 'Đang đứng trên cổng',
  waiting_map: 'Đang chờ đổi map',
  walking_to_target: 'Đã vào map đích',
};

const statusLabel: Record<string, string> = {
  accepted: 'Đã nhận lệnh',
  running: 'Đang đi',
  arrived: 'Đã tới nơi',
  blocked: 'Bị chặn',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
};

export const MapTravelControl: React.FC<MapTravelControlProps> = ({ account, mapCatalog, onMoveTo, onCancelMoveTo }) => {
  const [loading, setLoading] = useState(false);
  const [maps, setMaps] = useState<ReachableMap[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [abortOnHurt, setAbortOnHurt] = useState(true);
  const [maxHurt, setMaxHurt] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const operation = account.moveTo ?? account.vendor?.moveTo ?? null;
  const context = resolveMapContext(account);
  const contextMapId = context.usable ? context.mapId : null;
  const autoActive = account.vendor?.autoRequested === true
    || (account.vendor?.supervisor.phase !== undefined && account.vendor.supervisor.phase !== 'idle');
  const runnerReady = account.status === 'running' && account.vendor !== undefined;
  const lockReason = getMapTravelLockReason({ runnerReady, contextUsable: context.usable, autoActive, operation });
  const operationRunning = running(operation);
  const reachableById = useMemo(() => new Map(maps.map((map) => [map.mapId, map])), [maps]);

  // Danh sách map tới được phụ thuộc map hiện tại: tải lại khi sang map mới hoặc khi chuyến đi vừa kết thúc.
  const operationKey = operation ? `${operation.operationId}:${operation.status}` : '';
  useEffect(() => {
    if (!runnerReady || !context.usable) {
      setMaps([]);
      setCurrentMapId(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void fetchReachableMaps(account.id)
      .then((result) => {
        if (!active) return;
        setCurrentMapId(result.currentMapId);
        setMaps(result.maps);
        setSelectedMapId((previous) => (previous && previous !== result.currentMapId && result.maps.some((map) => map.mapId === previous) ? previous : ''));
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account.id, runnerReady, context.usable, contextMapId, operationRunning ? '' : operationKey]);

  const nameOf = useMemo(() => {
    const byId = new Map(mapCatalog.map((map) => [map.mapId, map.name]));
    return (mapId: string): string => byId.get(mapId) ?? mapId;
  }, [mapCatalog]);

  const here = currentMapId ?? contextMapId;
  const reachable = useMemo(() => maps
    .filter((map) => map.mapId !== here)
    .sort((a, b) => a.hops - b.hops || nameOf(a.mapId).localeCompare(nameOf(b.mapId), 'vi')), [maps, here, nameOf]);
  const unreachable = useMemo(() => mapCatalog
    .filter((map) => map.mapId !== here && !reachableById.has(map.mapId))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi')), [mapCatalog, here, reachableById]);

  const routesKnown = maps.length > 0;
  const selected = reachableById.get(selectedMapId);
  const start = () => {
    if (!selected || lockReason) return;
    void onMoveTo(undefined, { targetMapId: selected.mapId, abortOnHurt, maxHurt }).catch(() => undefined);
  };
  const cancel = () => {
    if (operation && operationRunning) void onCancelMoveTo(operation.operationId).catch(() => undefined);
  };

  const placeholder = lockReason && !operationRunning ? 'Chọn map đích (đang khóa)…' : loading ? 'Đang đọc danh sách map…' : 'Chọn map đích…';

  return <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-950/10 px-3 py-2 text-xs">
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="font-semibold text-violet-200">Đi tới map</span>
      <span className="text-slate-400">{here ? `Đang ở: ${nameOf(here)}` : 'Chưa biết vị trí'}</span>
    </div>
    <div className="space-y-2">
      {lockReason && !operationRunning && <p role="status" className="text-amber-300">{lockReason}</p>}
      {error && <p role="alert" className="text-rose-300">Không đọc được danh sách map: {error}</p>}
      <select
        aria-label="Map đích"
        value={selectedMapId}
        onChange={(event) => setSelectedMapId(event.target.value)}
        disabled={!!lockReason || loading}
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200 disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {reachable.length > 0 && <optgroup label="Đi tới được">
          {reachable.map((map) => <option key={map.mapId} value={map.mapId}>{nameOf(map.mapId)} · {map.hops} chặng</option>)}
        </optgroup>}
        {unreachable.length > 0 && <optgroup label={routesKnown ? 'Không có đường' : 'Tất cả map (chưa biết đường)'}>
          {unreachable.map((map) => <option key={map.mapId} value={map.mapId} disabled>{routesKnown ? `${map.name} · không có đường` : map.name}</option>)}
        </optgroup>}
      </select>
      {selected && <p className="text-slate-300">Tuyến: <span className="text-cyan-200">{formatMapTravelRoute(selected.route.map(nameOf))}</span></p>}
      <label className="flex items-center gap-2 text-slate-300">
        <input type="checkbox" checked={abortOnHurt} onChange={(event) => setAbortOnHurt(event.target.checked)} disabled={!!lockReason} />
        Dừng khi bị đánh
        <input
          type="number"
          min={1}
          max={50}
          aria-label="Ngưỡng số lần bị đánh"
          value={maxHurt}
          onChange={(event) => setMaxHurt(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
          disabled={!!lockReason || !abortOnHurt}
          className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5"
        />
        <span className="text-slate-500">lần</span>
      </label>
      {selected && <p className="text-amber-300">Lưu ý: tuyến có thể đi qua map có quái; hủy giữa đường nghĩa là nhân vật đứng lại tại chỗ.</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={start} disabled={!selected || !!lockReason} className="rounded border border-emerald-500/40 bg-emerald-600/20 px-2.5 py-1.5 text-emerald-200 disabled:opacity-40">Đi tới map này</button>
        {operationRunning && <button type="button" onClick={cancel} className="rounded border border-rose-500/40 bg-rose-600/20 px-2.5 py-1.5 text-rose-200">Hủy</button>}
      </div>
      {operation && <p role="status" className="text-cyan-200">
        {operation.leg && operationRunning
          ? `${phaseLabel[operation.leg.phase] ?? operation.leg.phase} · ${nameOf(operation.leg.fromMapId)}${operation.leg.toMapId ? ` → ${nameOf(operation.leg.toMapId)}` : ''}`
          : `${statusLabel[operation.status] ?? operation.status}${operation.reason ? ` · ${operation.reason}` : ''}`}
      </p>}
    </div>
  </div>;
};
