import React from 'react';
import { Play, Square, Plus, RefreshCw, Radio } from 'lucide-react';

interface NavbarProps {
  isConnected: boolean;
  totalAccounts: number;
  runningCount: number;
  onStartAll: () => void;
  onStopAll: () => void;
  onRefresh: () => void;
  onOpenAddModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isConnected,
  totalAccounts,
  runningCount,
  onStartAll,
  onStopAll,
  onRefresh,
  onOpenAddModal,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0a0d14]/85 backdrop-blur-md px-4 lg:px-8 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Logo & Brand */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-indigo-500/20 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <span className="text-xl">⚔️</span>
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-75"></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-wider text-slate-100 font-title">
                TuTien<span className="text-emerald-400">2D</span>
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">
                v1.0 Pro
              </span>
            </div>
            <p className="text-xs text-slate-400">Bảng Điều Khiển Đa Tài Khoản & Tự Động Hóa</p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-4">
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
          <div className="flex items-center gap-2">
            <button
              hidden
              onClick={onStartAll}
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
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Thêm Tài Khoản</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
