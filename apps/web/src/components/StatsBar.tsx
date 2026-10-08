import React from 'react';
import { Activity, AlertTriangle, Bot, Users } from 'lucide-react';
import type { AccountRuntime } from '../types';

interface StatsBarProps {
  accounts: AccountRuntime[];
}

export const StatsBar: React.FC<StatsBarProps> = ({ accounts }) => {
  const runningCount = accounts.filter((account) => account.status === 'running').length;
  const autoCount = accounts.filter((account) => account.vendor?.autoRequested === true).length;
  const hurtCount = accounts.reduce((sum, account) => sum + (account.vendor?.hurtCount ?? 0), 0);
  const cards = [
    { label: 'Tài khoản', value: String(accounts.length), icon: Users, color: 'indigo' },
    { label: 'Vendor đang chạy', value: `${runningCount} / ${accounts.length}`, icon: Bot, color: 'emerald' },
    { label: 'Auto chính thức', value: String(autoCount), icon: Activity, color: 'cyan' },
    { label: 'Hurt đã nhận', value: String(hurtCount), icon: AlertTriangle, color: 'amber' },
  ] as const;
  const toneClasses = {
    indigo: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    cyan: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  } as const;

  return <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
    {cards.map(({ label, value, icon: Icon, color }) => <div key={label} className="glass-panel rounded-xl p-3.5 flex items-center gap-3.5 border border-slate-800">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${toneClasses[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">{label}</p>
        <p className="text-lg font-bold text-slate-100">{value}</p>
      </div>
    </div>)}
  </div>;
};
