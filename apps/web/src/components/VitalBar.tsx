import React from 'react';
import { vitalPercent } from './account-dashboard';

type VitalColor = 'rose' | 'sky' | 'violet' | 'amber' | 'emerald';
const colors: Record<VitalColor, string> = { rose: 'bg-rose-500', sky: 'bg-sky-500', violet: 'bg-violet-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500' };

export const VitalBar: React.FC<{ label: string; value: number | null; max: number | null; fresh?: boolean; color: VitalColor; compact?: boolean; showLabel?: boolean }> = ({ label, value, max, fresh = true, color, compact = true, showLabel = true }) => {
  const percent = vitalPercent(value, max, fresh);
  const accessible = value === null || max === null ? `${label} chưa biết` : `${label} ${value.toLocaleString()} trên ${max.toLocaleString()}`;
  return <div className={`min-w-0 ${compact ? '' : 'space-y-2'}`} role="img" aria-label={accessible}>
    {showLabel && <div className={`flex min-w-0 items-center justify-between gap-1 ${compact ? 'text-[9px]' : 'text-xs'}`}><span className="truncate text-slate-400">{label}</span><span className="shrink-0 font-mono text-slate-200">{value === null ? '—' : value.toLocaleString()}{compact ? '' : ` / ${max === null ? '—' : max.toLocaleString()}`}</span></div>}
    <div className={`w-full overflow-hidden rounded-full bg-slate-800 ${compact ? 'mt-0.5 h-1' : 'h-2'}`}><div className={`h-full ${colors[color]}`} style={{ width: `${percent ?? 0}%` }} /></div>
  </div>;
};
