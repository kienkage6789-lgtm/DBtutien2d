import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Map, MapPin } from 'lucide-react';
import { AccountRuntime, DiscoveredMap, MapCatalog, MapRequestReceipt } from '../types';

interface MapNavigationPanelProps {
  account: AccountRuntime;
  catalog: MapCatalog;
  catalogLoading: boolean;
  catalogError: string | null;
  onRequestMap?: (accountId: string, mapId: string) => Promise<MapRequestReceipt>;
}

const validSoKhu = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;

const formatLastSeen = (value: unknown): string => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toLocaleString()
    : 'Chưa thấy packet live';
};

export const MapNavigationPanel: React.FC<MapNavigationPanelProps> = ({
  account,
  catalog,
  catalogLoading,
  catalogError,
  onRequestMap,
}) => {
  const discoveredMaps = useMemo(() => {
    if (catalog?.source !== 'public_client_catalog' || !Array.isArray(catalog.maps)) return [];
    return catalog.maps.filter((item): item is DiscoveredMap =>
      !!item && typeof item.id === 'string' && item.id.trim().length > 0,
    );
  }, [catalog]);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestState, setRequestState] = useState<{
    mapId: string;
    requestedAt: number;
    status: 'waiting_confirmation' | 'confirmed' | 'timeout';
  } | null>(null);

  const selectedMap = discoveredMaps.find((item) => item.id === selectedMapId);
  const currentContext = account.mapContext?.fresh ? account.mapContext : null;
  const currentSoKhu = currentContext && validSoKhu(currentContext.soKhu)
    ? currentContext.soKhu
    : currentContext && validSoKhu(account.soKhu) ? account.soKhu : null;
  const isSelectedMapCurrent = selectedMap?.id === currentContext?.mapId;
  const soKhu = isSelectedMapCurrent && validSoKhu(currentSoKhu) ? currentSoKhu : selectedMap?.soKhu;
  const hasKnownSoKhu = validSoKhu(soKhu);
  const currentLocationKnown = !!currentContext;
  const currentSoKhuKnown = !!currentContext && validSoKhu(currentSoKhu);
  const catalogUnavailable = catalog.status === 'unavailable' || catalog.source !== 'public_client_catalog';

  useEffect(() => {
    if (!selectedMapId && currentContext?.mapId && discoveredMaps.some((item) => item.id === currentContext.mapId)) {
      setSelectedMapId(currentContext.mapId);
    }
  }, [currentContext?.mapId, discoveredMaps, selectedMapId]);

  useEffect(() => {
    if (!requestState || requestState.status !== 'waiting_confirmation') return;
    if (currentContext?.mapId === requestState.mapId && (currentContext.observedAt || 0) > requestState.requestedAt) {
      setRequestState({ ...requestState, status: 'confirmed' });
    }
  }, [currentContext?.mapId, currentContext?.observedAt, requestState]);

  useEffect(() => {
    if (!requestState || requestState.status !== 'waiting_confirmation') return;
    const timer = window.setTimeout(() => {
      setRequestState((current) => current?.mapId === requestState.mapId && current.status === 'waiting_confirmation'
        ? { ...current, status: 'timeout' }
        : current);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [requestState]);

  const requestMap = async () => {
    if (!selectedMap || !onRequestMap || requesting || isSelectedMapCurrent) return;
    const requestedAt = Date.now();
    setRequesting(true);
    setRequestError(null);
    try {
      const receipt = await onRequestMap(account.id, selectedMap.id);
      setRequestState({
        mapId: selectedMap.id,
        requestedAt,
        status: receipt.status === 'already_at_destination' ? 'confirmed' : 'waiting_confirmation',
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'API chuyển map chưa khả dụng.');
      setRequestState(null);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <section className="mb-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs" aria-label="Điều hướng map và khu">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 font-semibold text-slate-200"><Map className="h-4 w-4 text-emerald-400" />Danh sách map</h4>
        <span className="text-[10px] text-slate-500">Nguồn: {catalog.source}</span>
      </div>

      {catalogUnavailable ? (
        <p role="status" className="rounded bg-slate-900/80 p-2 text-slate-400">Unavailable: {catalogError || 'API catalog map không khả dụng.'}</p>
      ) : catalog.status === 'empty' || discoveredMaps.length === 0 ? (
        <p className="rounded bg-slate-900/80 p-2 text-slate-400">Chưa có map trong catalog.</p>
      ) : (
        <>
          {catalogLoading && <p className="mb-2 rounded bg-slate-900/80 p-2 text-slate-400">Đang cập nhật danh sách map…</p>}
          <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Danh sách map">
            {discoveredMaps.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => { setSelectedMapId(item.id); setRequestError(null); }}
                  aria-pressed={selectedMapId === item.id}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left ${selectedMapId === item.id ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{item.name}</span>
                    <span className="ml-1 text-[10px] text-slate-500">({item.id})</span>
                  </span>
                  <span className={`shrink-0 text-[10px] ${item.observed ? 'text-emerald-300' : 'text-slate-500'}`} title={item.observed ? `Packet gần nhất: ${formatLastSeen(item.lastSeenAt)}` : 'Metadata từ public client'}>
                    {item.observed ? 'Đã thấy live' : 'Catalog'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={requestMap} disabled={!selectedMap || !onRequestMap || requesting || isSelectedMapCurrent} className="mt-2 inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-300 disabled:cursor-not-allowed disabled:opacity-50">
            <ArrowRightLeft className="h-3.5 w-3.5" />{requesting ? 'Đang lập tuyến…' : isSelectedMapCurrent ? 'Đang ở map này' : 'Đi qua cổng tới map'}
          </button>
          {!onRequestMap && <p className="mt-1 text-[10px] text-amber-300">Unavailable: chưa có API gửi yêu cầu chuyển map.</p>}
          {requestState?.status === 'waiting_confirmation' && <p role="status" className="mt-2 text-sky-300">Đã lập tuyến tới <strong>{requestState.mapId}</strong>; bot sẽ đi tới từng cổng và chờ packet map mới.</p>}
          {requestState?.status === 'confirmed' && <p role="status" className="mt-2 text-emerald-300">Đã nhận packet xác nhận đang ở map <strong>{requestState.mapId}</strong>.</p>}
          {requestState?.status === 'timeout' && <p role="status" className="mt-2 text-amber-300">Chưa nhận được packet xác nhận map sau 15 giây; có thể thử lại.</p>}
          {account.navigation && account.navigation.phase !== 'idle' && account.navigation.targetMapId && (
            <div className="mt-2 rounded bg-slate-900/80 p-2 text-[11px]">
              <p className={account.navigation.phase === 'arrived' ? 'text-emerald-300' : account.navigation.phase === 'failed' || account.navigation.phase === 'blocked' ? 'text-rose-300' : 'text-sky-300'}>
                {account.navigation.phase === 'moving_to_portal' ? 'Đang đi tới cổng' : account.navigation.phase === 'waiting_map_confirmation' ? 'Đang chờ chuyển cảnh' : account.navigation.phase === 'arrived' ? 'Đã tới map đích' : account.navigation.phase === 'failed' || account.navigation.phase === 'blocked' ? 'Điều hướng bị dừng' : 'Đang lập tuyến'}
                {` · ${account.navigation.currentMapId || '—'} → ${account.navigation.targetMapId}`}
              </p>
              {account.navigation.route.length > 0 && (
                <p className="mt-1 text-slate-400">Chặng {Math.min(account.navigation.routeIndex + 1, account.navigation.route.length)}/{account.navigation.route.length}: {account.navigation.route[Math.min(account.navigation.routeIndex, account.navigation.route.length - 1)]?.fromMapId} → {account.navigation.route[Math.min(account.navigation.routeIndex, account.navigation.route.length - 1)]?.toMapId}</p>
              )}
              {account.navigation.reason && <p className="mt-1 text-amber-300">Lý do: {account.navigation.reason}</p>}
            </div>
          )}
        </>
      )}

      <div className="mt-3 border-t border-slate-800 pt-2">
        <div className="flex items-center gap-1.5 text-slate-300"><MapPin className="h-3.5 w-3.5 text-sky-400" />Map/khu hiện tại: {currentLocationKnown ? `${currentContext.mapId} · Khu ${currentContext.khu}` : 'Chưa có context fresh'}</div>
        <div className="mt-1 text-[10px] text-slate-500">Tổng khu soKhu: {currentSoKhuKnown ? currentSoKhu : 'Chưa có soKhu authoritative từ mapContext fresh'}</div>
        {selectedMap && (
          <div className="mt-2">
            {hasKnownSoKhu ? (
              <p className="text-slate-400">Map này có <strong className="text-slate-200">{soKhu}</strong> khu. Chọn khu chưa được bật vì chưa có command protocol đã xác minh.</p>
            ) : (
              <p className="text-amber-300">Không có soKhu authoritative cho map này; danh sách khu bị tắt.</p>
            )}
            <p className="mt-1 text-[10px] text-amber-300">Protocol/API hiện chưa hỗ trợ gửi lệnh chuyển khu.</p>
          </div>
        )}
      </div>
      {requestError && <p role="alert" className="mt-2 text-rose-300">{requestError}</p>}
    </section>
  );
};
