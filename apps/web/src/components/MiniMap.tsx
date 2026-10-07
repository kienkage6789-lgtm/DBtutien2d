import React, { useEffect, useState } from 'react';
import type { AccountRuntime } from '../types';
import { isValidWorldBounds, miniMapToWorld, worldToMiniMap } from '../lib/minimap';
import type { WorldBounds } from '../lib/minimap';
import { MoveToApiError } from '../lib/api';
import { ENTITY_CONTEXT_TTL_MS, describeContextBlock, isEntityContextValid, resolveMapContext } from '../lib/context';

interface MiniMapProps {
  account: AccountRuntime;
  geometry?: WorldBounds | null;
  onMoveTo?: (target: { x: number; y: number }) => Promise<void> | void;
  onCancelMoveTo?: (operationId: string) => void;
}

const W = 1000;
const H = 600;
const describeMoveToError = (error: unknown): string => error instanceof MoveToApiError
  ? `${error.code} (HTTP ${error.httpStatus}): ${error.message}`
  : error instanceof Error ? error.message : 'Không thể bắt đầu di chuyển.';

export const MiniMap: React.FC<MiniMapProps> = ({ account, geometry, onMoveTo, onCancelMoveTo }) => {
  const [moveError, setMoveError] = useState<{ message: string; acceptedTarget?: { x: number; y: number } } | null>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const view = resolveMapContext(account, clock);
  const contextValid = view.usable;
  const monstersValid = isEntityContextValid(account.monstersContext, view, ENTITY_CONTEXT_TTL_MS, clock);
  const playersValid = isEntityContextValid(account.playersContext, view, null, clock);
  const monstersAge = account.monstersContext?.observedAt != null
    ? Math.max(0, clock - account.monstersContext.observedAt) : null;
  const activeMove = account.moveTo && ['accepted', 'running'].includes(account.moveTo.status) ? account.moveTo : null;
  const activeNavigation = account.navigation && ['planning', 'moving_to_portal', 'waiting_map_confirmation'].includes(account.navigation.phase);
  const movementLocked = !!activeMove || !!activeNavigation;
  const enabled = contextValid && isValidWorldBounds(geometry) && typeof onMoveTo === 'function' && !movementLocked;
  const contextBlock = describeContextBlock(view);
  const status = contextBlock
    ? contextBlock
    : movementLocked ? activeMove ? 'Đang có lệnh di chuyển; hủy lệnh để chọn tọa độ khác' : 'Đang điều hướng qua cổng; chờ hoàn tất trước khi chọn tọa độ'
    : !isValidWorldBounds(geometry) ? 'Thiếu geometry map; thao tác bị khóa'
      : !onMoveTo ? 'Chưa kết nối API di chuyển; thao tác bị khóa' : 'Bấm bản đồ để chọn tọa độ di chuyển';
  const moveAt = (event: React.MouseEvent<SVGElement>) => {
    if (!enabled || !isValidWorldBounds(geometry) || !onMoveTo) return;
    const svg = event.currentTarget.closest('svg');
    if (!svg) return;
    const point = miniMapToWorld({ x: event.clientX, y: event.clientY }, svg.getBoundingClientRect(), geometry, W, H);
    if (point) {
      setMoveError(null);
      Promise.resolve(onMoveTo(point)).catch((error: unknown) => {
        setMoveError({
          message: describeMoveToError(error),
          ...(error instanceof MoveToApiError && error.acceptedTarget ? { acceptedTarget: error.acceptedTarget } : {}),
        });
      });
    }
  };
  const coordinate = (x: number, y: number) => worldToMiniMap({ x, y }, geometry!, W, H);
  const mapId = view.usable ? view.mapId : account.mapContext?.mapId;
  const portals = geometry?.portals?.filter((step) => step.fromMapId === mapId)
    ?? account.navigation?.route.filter((step) => step.fromMapId === mapId)
    ?? [];
  const tileSize = geometry?.tileSize ?? 32;

  return <div className="mt-2">
    <div className="relative overflow-hidden rounded border border-slate-800 bg-slate-900" aria-label="Mini-map">
      {isValidWorldBounds(geometry) ? <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className={`block h-40 w-full ${enabled ? 'cursor-crosshair' : 'cursor-not-allowed'}`} role="img" aria-label="Bản đồ thực thể; click để di chuyển tới tọa độ, không chọn mục tiêu tấn công" aria-disabled={!enabled} onClick={enabled ? (event) => moveAt(event) : undefined}>
        <rect width={W} height={H} fill="#0f172a" />
        {portals.map((portal) => { const p = coordinate(portal.tx * tileSize + tileSize / 2, portal.ty * tileSize + tileSize / 2); return <g key={portal.portalId} aria-label={`Cổng tới ${portal.toMapId}`}><rect x={p.x - 9} y={p.y - 9} width="18" height="18" fill="#f59e0b" stroke="#fde68a" /><title>{portal.label || `${portal.fromMapId} → ${portal.toMapId}`}</title></g>; })}
        {playersValid && account.players.map((player) => { const p = coordinate(player.x, player.y); return <circle key={player.id} cx={p.x} cy={p.y} r="7" fill="#38bdf8"><title>{player.name || player.id}</title></circle>; })}
        {monstersValid && account.monsters.map((monster) => { const p = coordinate(monster.x, monster.y); return <circle key={monster.id} cx={p.x} cy={p.y} r="7" fill="#fb7185" stroke="#fecdd3" strokeWidth="2"><title>{monster.name || `Quái vật ${monster.id}`} · chỉ là marker tọa độ, click di chuyển chứ không chọn/đánh mục tiêu</title></circle>; })}
        {moveError?.acceptedTarget && <circle cx={coordinate(moveError.acceptedTarget.x, moveError.acceptedTarget.y).x} cy={coordinate(moveError.acceptedTarget.x, moveError.acceptedTarget.y).y} r="11" fill="none" stroke="#fbbf24" strokeWidth="3" strokeDasharray="4 3"><title>Vị trí gợi ý từ máy chủ</title></circle>}
        {contextValid && Number.isFinite(account.x) && Number.isFinite(account.y) && <path d={`M ${coordinate(account.x, account.y).x} ${coordinate(account.x, account.y).y - 10} L ${coordinate(account.x, account.y).x + 8} ${coordinate(account.x, account.y).y + 7} L ${coordinate(account.x, account.y).x - 8} ${coordinate(account.x, account.y).y + 7} Z`} fill="#34d399" stroke="#d1fae5" />}
      </svg> : <div className="flex h-24 items-center justify-center text-slate-500">Chưa thể dựng tỷ lệ map</div>}
    </div>
    <div className="mt-1 flex items-center justify-between gap-2">
      <p role="status" className={`text-[10px] ${enabled ? 'text-slate-500' : 'text-amber-300'}`}>{status}</p>
      {activeMove && onCancelMoveTo && <button type="button" onClick={() => onCancelMoveTo(activeMove.operationId)} className="shrink-0 rounded border border-rose-500/40 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10">Hủy di chuyển</button>}
    </div>
    {moveError && <div role="alert" className="mt-1 rounded border border-rose-500/30 bg-rose-950/30 px-2 py-1 text-[10px] text-rose-200">
      <span>{moveError.message}</span>
      {moveError.acceptedTarget && onMoveTo && <button type="button" disabled={!enabled} className="ml-2 underline text-amber-200 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { if (!enabled) return; const target = moveError.acceptedTarget!; setMoveError(null); Promise.resolve(onMoveTo(target)).catch((error: unknown) => setMoveError({ message: describeMoveToError(error) })); }}>Thử tọa độ máy chủ đề xuất ({Math.round(moveError.acceptedTarget.x)}, {Math.round(moveError.acceptedTarget.y)})</button>}
    </div>}
    {account.moveTo && <p className="text-[10px] text-slate-400">Di chuyển: {account.moveTo.status === 'accepted' ? 'đã nhận' : account.moveTo.status === 'running' ? 'đang chạy' : account.moveTo.status === 'arrived' ? 'đã tới' : account.moveTo.status === 'blocked' ? 'bị chặn' : account.moveTo.status === 'failed' ? 'thất bại' : 'đã hủy'} · cập nhật {new Date(account.moveTo.updatedAt).toLocaleTimeString()} ({Math.max(0, Math.floor((clock - account.moveTo.updatedAt) / 1000))}s trước){account.moveTo.reason ? ` · ${account.moveTo.reason}` : ''}</p>}
    <p className="text-[10px] text-slate-500">Click vào marker quái chỉ di chuyển tới tọa độ; API hiện chưa nhận target quái nên không chọn hoặc kích hoạt đánh quái.</p>
    <p className="text-[10px] text-slate-500">Nhân vật · {playersValid ? `Người chơi ${account.players.length}` : 'người chơi chưa fresh'} · {monstersValid ? `Quái ${account.monsters.length}` : 'quái stale/không có'}{account.monstersContext?.observedAt != null ? ` · snapshot ${new Date(account.monstersContext.observedAt).toLocaleTimeString()} (${Math.floor((monstersAge ?? 0) / 1000)}s)` : ''} · Cổng {portals.length}</p>
  </div>;
};
