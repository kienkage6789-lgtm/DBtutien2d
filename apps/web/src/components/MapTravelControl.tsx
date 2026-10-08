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
  if (!input.runnerReady) return 'VendorRunner chÆ°a cháº¡y';
  if (!input.contextUsable) return 'Map context chÆ°a sáºµn sÃ ng';
  if (input.autoActive) return 'Táº¯t Auto Ä‘á»ƒ Ä‘i qua cá»•ng';
  if (running(input.operation)) return 'Äang cÃ³ thao tÃ¡c di chuyá»ƒn';
  return null;
}

export function formatMapTravelRoute(route: string[]): string {
  return route.join(' â†’ ');
}

const formatMapTravelRouteDisplay = (route: string[]): string => route.join(` ${String.fromCodePoint(0x2192)} `);

const phaseLabel: Record<string, string> = {
  walking_to_gate: 'Đang đi tới cổng',
  on_gate: 'Đang đứng trên cổng',
  waiting_map: 'Đang chờ đổi map',
  walking_to_target: 'Đã vào map đích',
};

export const MapTravelControl: React.FC<MapTravelControlProps> = ({ account, mapCatalog, onMoveTo, onCancelMoveTo }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [maps, setMaps] = useState<ReachableMap[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [abortOnHurt, setAbortOnHurt] = useState(true);
  const [maxHurt, setMaxHurt] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const operation = account.moveTo ?? account.vendor?.moveTo ?? null;
  const context = resolveMapContext(account);
  const autoActive = account.vendor?.autoRequested === true || account.vendor?.supervisor.phase !== undefined && account.vendor.supervisor.phase !== 'idle';
  const runnerReady = account.status === 'running' && account.vendor !== undefined;
  const lockReason = getMapTravelLockReason({ runnerReady, contextUsable: context.usable, autoActive, operation });
  const reachableById = useMemo(() => new Map(maps.map((map) => [map.mapId, map])), [maps]);
  const catalog = useMemo(() => {
    const byId = new Map(mapCatalog.map((map) => [map.mapId, map]));
    for (const map of maps) if (!byId.has(map.mapId)) byId.set(map.mapId, { mapId: map.mapId, name: map.mapId });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [mapCatalog, maps]);

  useEffect(() => {
    if (!open || maps.length > 0 || loading) return;
    setLoading(true);
    setError(null);
    void fetchReachableMaps(account.id)
      .then((result) => {
        setCurrentMapId(result.currentMapId);
        setMaps(result.maps);
        if (!selectedMapId) setSelectedMapId(result.maps.find((map) => map.mapId !== result.currentMapId)?.mapId ?? '');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [account.id, loading, maps.length, open, selectedMapId]);

  const selected = reachableById.get(selectedMapId);
  const start = () => {
    if (!selected || lockReason) return;
    void onMoveTo(undefined, { targetMapId: selected.mapId, abortOnHurt, maxHurt }).catch(() => undefined);
  };
  const cancel = () => {
    if (operation && running(operation)) void onCancelMoveTo(operation.operationId).catch(() => undefined);
  };

  return <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-950/10 px-3 py-2 text-xs">
    <button type="button" onClick={() => setOpen((value) => !value)} className="font-semibold text-violet-200">
      {open ? 'Thu gọn' : 'Đi tới map…'}
    </button>
    {open && <div className="mt-2 space-y-2">
      {lockReason && <p role="status" className="text-amber-300">Đang khóa: {lockReason}</p>}
      {loading && <p className="text-slate-400">Đang đọc danh sách map tới được…</p>}
      {error && <p role="alert" className="text-rose-300">Không đọc được tuyến: {error}</p>}
      <select
        aria-label="Map đích"
        value={selectedMapId}
        onChange={(event) => setSelectedMapId(event.target.value)}
        disabled={!!lockReason || loading}
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200 disabled:opacity-50"
      >
        <option value="">Chọn map đích…</option>
        {catalog.map((map) => {
          const isCurrent = map.mapId === (currentMapId ?? (context.usable ? context.mapId : null));
          const route = reachableById.get(map.mapId);
          return <option key={map.mapId} value={map.mapId} disabled={isCurrent || !route}>
            {map.name} · {isCurrent ? 'hiện tại' : route ? `${route.hops} chặng` : 'không có đường'}
          </option>;
        })}
      </select>
      {selected && <p className="text-slate-300">Tuyến: <span className="text-cyan-200">{formatMapTravelRouteDisplay(selected.route)}</span></p>}
      <label className="flex items-center gap-2 text-slate-300">
        <input type="checkbox" checked={abortOnHurt} onChange={(event) => setAbortOnHurt(event.target.checked)} disabled={!!lockReason} />
        Dừng khi bị đánh
      </label>
      <label className="flex items-center gap-2 text-slate-300">
        Ngưỡng hurt
        <input type="number" min={1} max={50} value={maxHurt} onChange={(event) => setMaxHurt(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} disabled={!!lockReason || !abortOnHurt} className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1" />
      </label>
      {selected && selected.route.length > 1 && <p className="text-amber-300">Cảnh báo: đi qua map có quái; hủy giữa đường nghĩa là nhân vật đứng lại tại chỗ.</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={start} disabled={!selected || !!lockReason} className="rounded border border-emerald-500/40 bg-emerald-600/20 px-2.5 py-1.5 text-emerald-200 disabled:opacity-40">Bắt đầu</button>
        {operation && running(operation) && <button type="button" onClick={cancel} className="rounded border border-rose-500/40 bg-rose-600/20 px-2.5 py-1.5 text-rose-200">Hủy</button>}
      </div>
      {operation && <p role="status" className="text-cyan-200">
        {operation.leg ? `${phaseLabel[operation.leg.phase] ?? operation.leg.phase} · ${operation.leg.fromMapId}${operation.leg.toMapId ? ` → ${operation.leg.toMapId}` : ''}` : `${operation.status}${operation.reason ? ` · ${operation.reason}` : ''}`}
      </p>}
    </div>}
  </div>;
};
