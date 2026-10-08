import React, { useEffect, useState } from 'react';
import type { AccountRuntime, MoveToOperation } from '../types';
import { isValidWorldBounds, miniMapToWorld, worldToMiniMap } from '../lib/minimap';
import type { Point, WorldBounds } from '../lib/minimap';
import { describeContextBlock, ENTITY_CONTEXT_TTL_MS, isEntityContextValid, resolveMapContext } from '../lib/context';

interface MiniMapProps {
  account: AccountRuntime;
  geometry?: WorldBounds | null;
  onMoveTo: (target: Point) => Promise<MoveToOperation>;
  onCancelMoveTo: (operationId: string) => Promise<MoveToOperation>;
}

const W = 1000;
const H = 600;
const isRunning = (operation: MoveToOperation | null): boolean =>
  operation?.status === 'accepted' || operation?.status === 'running';

export const formatMoveToStatus = (operation: MoveToOperation | null): string | null => {
  if (!operation) return null;
  const labels: Record<MoveToOperation['status'], string> = {
    accepted: 'Đã nhận yêu cầu',
    running: 'Đang di chuyển',
    arrived: 'Đã tới đích',
    blocked: 'Bị chặn',
    failed: 'Thất bại',
    cancelled: 'Đã hủy',
  };
  return `${labels[operation.status]}${operation.reason ? ` · ${operation.reason}` : ''}`;
};

export function getMoveToLockReason(input: {
  runnerReady: boolean;
  contextUsable: boolean;
  khuKnown: boolean;
  geometryValid: boolean;
  autoActive: boolean;
  operation: MoveToOperation | null;
  requestPending: boolean;
}): string | null {
  if (!input.runnerReady) return 'VendorRunner chua chay';
  if (!input.contextUsable) return 'Map context chưa sẵn sàng';
  if (!input.khuKnown) return 'Khu chưa biết; chờ snapshot mới';
  if (!input.geometryValid) return 'Thiếu geometry map hợp lệ';
  if (input.autoActive) return 'Tắt Auto để di chuyển bằng tay';
  if (isRunning(input.operation)) return 'Đang có thao tác di chuyển';
  if (input.requestPending) return 'Đang gửi yêu cầu di chuyển';
  return null;
}

export const MiniMap: React.FC<MiniMapProps> = ({ account, geometry, onMoveTo, onCancelMoveTo }) => {
  const [clock, setClock] = useState(Date.now());
  const [localOperation, setLocalOperation] = useState<MoveToOperation | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setLocalOperation(null);
    setRequestPending(false);
  }, [account.id]);

  const view = resolveMapContext(account, clock);
  const monstersValid = isEntityContextValid(account.monstersContext, view, ENTITY_CONTEXT_TTL_MS, clock);
  const playersValid = isEntityContextValid(account.playersContext, view, null, clock);
  const mapId = view.usable ? view.mapId : account.mapContext?.mapId;
  const validGeometry = isValidWorldBounds(geometry) ? geometry : null;
  const portals = validGeometry?.portals?.filter((step) => step.fromMapId === mapId) ?? [];
  const operation = account.moveTo ?? account.vendor?.moveTo ?? localOperation;
  const autoActive = account.vendor?.autoRequested === true
    || (account.vendor?.supervisor?.phase !== undefined && account.vendor.supervisor.phase !== 'idle');
  const runnerReady = account.status === 'running' && account.vendor !== undefined;
  const canMove = runnerReady && view.usable && view.khu !== null && validGeometry !== null && !autoActive
    && !isRunning(operation) && !requestPending;
  const coordinate = (x: number, y: number) => worldToMiniMap({ x, y }, validGeometry!, W, H);

  const lockReason = !view.usable
    ? describeContextBlock(view) ?? 'Map context chưa sẵn sàng'
    : getMoveToLockReason({
      runnerReady,
      contextUsable: true,
      khuKnown: view.khu !== null,
      geometryValid: validGeometry !== null,
      autoActive,
      operation,
      requestPending,
    });

  const handleMapClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!canMove || !validGeometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const scale = Math.min(rect.width / W, rect.height / H);
    const renderedWidth = W * scale;
    const renderedHeight = H * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    const localX = event.clientX - rect.left - offsetX;
    const localY = event.clientY - rect.top - offsetY;
    if (localX < 0 || localX > renderedWidth || localY < 0 || localY > renderedHeight) return;
    const miniPoint = {
      x: (localX / scale),
      y: (localY / scale),
    };
    const target = miniMapToWorld(miniPoint, validGeometry, W, H);
    setRequestPending(true);
    void onMoveTo(target)
      .then(setLocalOperation)
      .catch(() => undefined)
      .finally(() => setRequestPending(false));
  };

  const handleCancel = () => {
    if (!operation || !isRunning(operation) || requestPending) return;
    setRequestPending(true);
    void onCancelMoveTo(operation.operationId)
      .then(setLocalOperation)
      .catch(() => undefined)
      .finally(() => setRequestPending(false));
  };

  const mapStatus = !view.usable
    ? 'Chưa có map context authoritative'
    : !validGeometry ? 'Thiếu geometry map'
      : 'Bấm bản đồ để di chuyển';

  return <div className="mt-2">
    <div className="relative overflow-hidden rounded border border-slate-800 bg-slate-900" aria-label="Mini-map">
      {validGeometry ? <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className={`block h-40 w-full ${canMove ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
        role="img"
        aria-label={canMove ? 'Bấm để di chuyển nhân vật' : `Mini-map bị khóa: ${lockReason ?? 'chưa sẵn sàng'}`}
        onClick={handleMapClick}
      >
        <rect width={W} height={H} fill="#0f172a" />
        {portals.map((portal) => {
          const tileSize = validGeometry.tileSize ?? 32;
          const p = coordinate(portal.tx * tileSize + tileSize / 2, portal.ty * tileSize + tileSize / 2);
          return <g key={portal.portalId} aria-label={`Cổng tới ${portal.toMapId}`}><rect x={p.x - 9} y={p.y - 9} width="18" height="18" fill="#f59e0b" stroke="#fde68a" /><title>{portal.label || `${portal.fromMapId} → ${portal.toMapId}`}</title></g>;
        })}
        {playersValid && account.players.map((player) => { const p = coordinate(player.x, player.y); return <circle key={player.id} cx={p.x} cy={p.y} r="7" fill="#38bdf8"><title>{player.name || 'Người chơi'}</title></circle>; })}
        {monstersValid && account.monsters.map((monster) => { const p = coordinate(monster.x, monster.y); return <circle key={monster.id} cx={p.x} cy={p.y} r="7" fill="#fb7185" stroke="#fecdd3" strokeWidth="2"><title>Quái vật · chỉ là marker tọa độ</title></circle>; })}
        {view.usable && typeof account.x === 'number' && typeof account.y === 'number' && <path d={`M ${coordinate(account.x, account.y).x} ${coordinate(account.x, account.y).y - 10} L ${coordinate(account.x, account.y).x + 8} ${coordinate(account.x, account.y).y + 7} L ${coordinate(account.x, account.y).x - 8} ${coordinate(account.x, account.y).y + 7} Z`} fill="#34d399" stroke="#d1fae5" />}
        {operation?.resolvedTarget && <g aria-label="Đích đã snap"><circle cx={coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).x} cy={coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).y} r="12" fill="none" stroke="#facc15" strokeWidth="4" /><path d={`M ${coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).x - 16} ${coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).y} H ${coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).x + 16} M ${coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).x} ${coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).y - 16} V ${coordinate(operation.resolvedTarget.x, operation.resolvedTarget.y).y + 16}`} stroke="#facc15" strokeWidth="3" /></g>}
      </svg> : <div className="flex h-24 items-center justify-center text-slate-500">Chưa thể dựng tỷ lệ map</div>}
    </div>
    <div className="mt-1 flex items-center justify-between gap-2">
      <p role="status" className="text-[10px] text-amber-300">{lockReason ?? mapStatus}</p>
      <span className="text-[10px] text-slate-500">Cổng {portals.length}</span>
    </div>
    {operation && <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-cyan-200" role="status">
      <span>{formatMoveToStatus(operation)}</span>
      {isRunning(operation) && <button type="button" onClick={handleCancel} disabled={requestPending} className="rounded border border-rose-500/50 px-2 py-1 text-rose-200 disabled:opacity-40">Hủy di chuyển</button>}
    </div>}
    <p className="text-[10px] text-slate-500">Người chơi: {playersValid ? account.players.length : 'chưa fresh'} · Quái: {monstersValid ? account.monsters.length : 'stale/không có'}</p>
  </div>;
};
