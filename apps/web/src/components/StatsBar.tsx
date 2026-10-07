import React from 'react';
import { Users, Bot, Coins, Sparkles } from 'lucide-react';
import { AccountRuntime } from '../types';

interface StatsBarProps {
  accounts: AccountRuntime[];
}

export const StatsBar: React.FC<StatsBarProps> = ({ accounts }) => {
  const totalAccounts = accounts.length;
  const runningCount = accounts.filter((a) => a.status === 'running').length;
  const authoritativeStones = accounts
    .filter((account) => account.status === 'running'
      && account.stonesSnapshot?.status === 'fresh'
      && typeof account.stonesSnapshot.value === 'number'
      && Number.isFinite(account.stonesSnapshot.value));
  const totalStones = authoritativeStones.reduce((sum, account) => sum + account.stonesSnapshot!.value!, 0);
  const highestRealm = [...accounts].reverse().find((a) => typeof a.realm === 'string' && a.realm.trim())?.realm;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
      {/* Total Accounts */}
      <div className="glass-panel rounded-xl p-3.5 flex items-center gap-3.5 border border-slate-800">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Tài Khoản</p>
          <p className="text-lg font-bold text-slate-100">{totalAccounts}</p>
        </div>
      </div>

      {/* Active Bots */}
      <div className="glass-panel rounded-xl p-3.5 flex items-center gap-3.5 border border-slate-800">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
          <Bot className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Bot Hoạt Động</p>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-emerald-400">{runningCount}</span>
            <span className="text-xs text-slate-500">/ {totalAccounts}</span>
          </div>
        </div>
      </div>

      {/* Total Linh Thach */}
      <div className="glass-panel rounded-xl p-3.5 flex items-center gap-3.5 border border-slate-800">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
          <Coins className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Tổng Linh Thạch</p>
          <p className="text-lg font-bold text-amber-300">
            {authoritativeStones.length > 0 ? totalStones.toLocaleString() : 'Đang chờ dữ liệu'}
          </p>
        </div>
      </div>

      {/* Highest Realm */}
      <div className="glass-panel rounded-xl p-3.5 flex items-center gap-3.5 border border-slate-800">
        <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Cảnh Giới Đỉnh</p>
          <p className="text-sm font-bold text-purple-300 capitalize truncate max-w-[130px]">
            {highestRealm ? highestRealm.replace(/_/g, ' ') : 'Chưa có dữ liệu'}
          </p>
        </div>
      </div>
    </div>
  );
};
