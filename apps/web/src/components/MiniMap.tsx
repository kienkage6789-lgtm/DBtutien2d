import React, { useEffect, useState } from 'react';
import type { AccountRuntime } from '../types';
import { isValidWorldBounds, worldToMiniMap } from '../lib/minimap';
import type { WorldBounds } from '../lib/minimap';
import { ENTITY_CONTEXT_TTL_MS, isEntityContextValid, resolveMapContext } from '../lib/context';

interface MiniMapProps {
  account: AccountRuntime;
  geometry?: WorldBounds | null;
}

const W = 1000;
const H = 600;

export const MiniMap: React.FC<MiniMapProps> = ({ account, geometry }) => {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const view = resolveMapContext(account, clock);
  const monstersValid = isEntityContextValid(account.monstersContext, view, ENTITY_CONTEXT_TTL_MS, clock);
  const playersValid = isEntityContextValid(account.playersContext, view, null, clock);
  const mapId = view.usable ? view.mapId : account.mapContext?.mapId;
  const portals = geometry?.portals?.filter((step) => step.fromMapId === mapId) ?? [];
  const coordinate = (x: number, y: number) => worldToMiniMap({ x, y }, geometry!, W, H);
  const status = !view.usable
    ? 'Chưa có map context authoritative'
    : !isValidWorldBounds(geometry) ? 'Thiếu geometry map'
      : 'Bản đồ chỉ hiển thị; di chuyển do Auto chính thức điều khiển';
  const canDisplay = isValidWorldBounds(geometry);

  return <div className="mt-2">
    <div className="relative overflow-hidden rounded border border-slate-800 bg-slate-900" aria-label="Mini-map">
      {canDisplay ? <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="block h-40 w-full" role="img" aria-label="Bản đồ hiển thị thực thể; không có thao tác di chuyển">
        <rect width={W} height={H} fill="#0f172a" />
        {portals.map((portal) => {
          const p = coordinate(portal.tx * (geometry?.tileSize ?? 32) + (geometry?.tileSize ?? 32) / 2, portal.ty * (geometry?.tileSize ?? 32) + (geometry?.tileSize ?? 32) / 2);
          return <g key={portal.portalId} aria-label={`Cổng tới ${portal.toMapId}`}><rect x={p.x - 9} y={p.y - 9} width="18" height="18" fill="#f59e0b" stroke="#fde68a" /><title>{portal.label || `${portal.fromMapId} → ${portal.toMapId}`}</title></g>;
        })}
        {playersValid && account.players.map((player) => { const p = coordinate(player.x, player.y); return <circle key={player.id} cx={p.x} cy={p.y} r="7" fill="#38bdf8"><title>{player.name || 'Người chơi'}</title></circle>; })}
        {monstersValid && account.monsters.map((monster) => { const p = coordinate(monster.x, monster.y); return <circle key={monster.id} cx={p.x} cy={p.y} r="7" fill="#fb7185" stroke="#fecdd3" strokeWidth="2"><title>{monster.name || 'Quái vật'} · chỉ là marker tọa độ</title></circle>; })}
        {view.usable && typeof account.x === 'number' && typeof account.y === 'number' && <path d={`M ${coordinate(account.x, account.y).x} ${coordinate(account.x, account.y).y - 10} L ${coordinate(account.x, account.y).x + 8} ${coordinate(account.x, account.y).y + 7} L ${coordinate(account.x, account.y).x - 8} ${coordinate(account.x, account.y).y + 7} Z`} fill="#34d399" stroke="#d1fae5" />}
      </svg> : <div className="flex h-24 items-center justify-center text-slate-500">Chưa thể dựng tỷ lệ map</div>}
    </div>
    <div className="mt-1 flex items-center justify-between gap-2">
      <p role="status" className="text-[10px] text-amber-300">{status}</p>
      <span className="text-[10px] text-slate-500">Cổng {portals.length}</span>
    </div>
    <p className="text-[10px] text-slate-500">Người chơi: {playersValid ? account.players.length : 'chưa fresh'} · Quái: {monstersValid ? account.monsters.length : 'stale/không có'}</p>
  </div>;
};
