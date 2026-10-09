import React, { useEffect, useState } from 'react';
import { Play, Square, Plus, RefreshCw, Radio, LogOut, Settings } from 'lucide-react';
import type { AuthUser } from '../types';
import { entitlementLockReason, formatRemaining } from '../lib/entitlement';

interface NavbarProps {
  isConnected: boolean;
  totalAccounts: number;
  runningCount: number;
  onStartAll: () => void;
  onStopAll: () => void;
  onRefresh: () => void;
  onOpenAddModal: () => void;
  user: AuthUser;
  onLogout: () => void;
  onOpenAccount: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isConnected,
  totalAccounts,
  runningCount,
  onStartAll,
  onStopAll,
  onRefresh,
  onOpenAddModal,
  user,
  onLogout,
  onOpenAccount,
}) => {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const regular = user.role !== 'admin';
  const lockReason = entitlementLockReason(user);
  const quotaFull = regular && user.usage !== undefined && user.usage.accounts >= user.usage.maxBots;
  const effectiveNow = clock + (user.serverClockOffsetMs ?? 0);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0a0d14]/85 backdrop-blur-md px-4 lg:px-8 py-3.5 transition-all">
      <div className="mx-auto flex min-w-0 max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
        {/* Logo & Brand */}
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-indigo-500/20 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <span className="text-xl">⚔️</span>
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-75"></div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-wider text-slate-100 font-title">
                TuTien<span className="text-emerald-400">2D</span>
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">
                v1.0 Pro
              </span>
            </div>
            <p className="truncate text-xs text-slate-400">Bảng Điều Khiển Đa Tài Khoản & Tự Động Hóa</p>
          </div>
        </div>

        {/* Status indicator */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <div className="flex max-w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
            <span className="max-w-24 truncate font-semibold text-slate-100">{user.username}</span>
            <span className="text-slate-500">·</span>
            <span className="text-emerald-400">{user.role === 'admin' ? 'quản trị' : 'người dùng'}</span>
          </div>
          {regular && <div className={`flex max-w-full flex-wrap items-center gap-x-2 rounded-lg border px-3 py-1.5 text-xs ${lockReason ? 'border-rose-500/40 bg-rose-950/40 text-rose-200' : 'border-slate-800 bg-slate-900/60 text-slate-300'}`}>
            <span>{lockReason ?? `Hạn dùng còn ${formatRemaining(user.entitlement.expiresAt, effectiveNow)}`}</span>
            <span className="text-slate-600">·</span>
            <span>Bot {user.usage?.accounts ?? totalAccounts}/{user.maxBots} · chạy {user.usage?.running ?? runningCount}</span>
          </div>}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs">
            <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-rose-500'}`} />
            <span className={isConnected ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>
              {isConnected ? 'Realtime Kết Nối' : 'Mất Kết Nối'}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
            <span>Đang chạy:</span>
            <span className="text-emerald-400 font-bold">{runningCount}</span>
            <span className="text-slate-600">/</span>
            <span>{totalAccounts}</span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              hidden
              onClick={onStartAll}
              disabled={!!lockReason}
              title="Bắt đầu toàn bộ bot"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 transition-colors shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-emerald-400" />
              <span>Bật Hết</span>
            </button>

            <button
              onClick={onStopAll}
              title="Dừng toàn bộ bot"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 transition-colors shadow-sm"
            >
              <Square className="w-3.5 h-3.5 fill-rose-400" />
              <span>Dừng Hết</span>
            </button>

            <button
              onClick={onRefresh}
              title="Tải lại danh sách"
              className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border border-slate-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={onOpenAddModal}
              disabled={quotaFull}
              title={quotaFull ? `Đã đủ ${user.maxBots} tài khoản` : 'Thêm tài khoản (nếu còn quota)'}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Thêm Tài Khoản</span>
            </button>
            <button onClick={onOpenAccount} title="Quản lý tài khoản" className="rounded-lg border border-slate-700 bg-slate-800/60 p-1.5 text-slate-300 hover:bg-slate-700"><Settings className="h-4 w-4" /></button>
            <button onClick={onLogout} title="Đăng xuất" className="rounded-lg border border-slate-700 bg-slate-800/60 p-1.5 text-slate-300 hover:bg-slate-700"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </header>
  );
};
