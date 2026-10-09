import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Trash2, Search, ArrowDown, ChevronDown, ChevronUp } from 'lucide-react';
import { LogEntry, AccountRuntime } from '../types';

interface LogTerminalProps {
  logs: LogEntry[];
  accounts: AccountRuntime[];
  onClearLogs: () => void;
  initialAccountId?: string | null;
}

export const LogTerminal: React.FC<LogTerminalProps> = ({ logs, accounts, onClearLogs, initialAccountId = null }) => {
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isOpen, setIsOpen] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  useEffect(() => {
    if (!initialAccountId) return;
    setSelectedAccount(initialAccountId);
    setIsOpen(true);
  }, [initialAccountId]);

  const filteredLogs = logs.filter((log) => {
    if (selectedAccount !== 'all' && log.accountId !== selectedAccount) return false;
    if (selectedLevel !== 'all' && log.level !== selectedLevel) return false;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      return (
        String(log.message ?? '').toLowerCase().includes(lower) ||
        String(log.module ?? '').toLowerCase().includes(lower)
      );
    }
    return true;
  });

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'success':
        return 'text-emerald-400';
      case 'warn':
        return 'text-amber-400';
      case 'error':
        return 'text-rose-400';
      default:
        return 'text-sky-300';
    }
  };

  const getAccountLabel = (accountId: string) => {
    const acc = accounts.find((a) => a.id === accountId);
    return acc ? acc.characterName || acc.accountName : accountId;
  };

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-2xl flex flex-col">
      {/* Terminal Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/80 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-200">
            <span>Nhật ký ({logs.length})</span>
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {!isOpen && <span className="font-normal normal-case tracking-normal text-slate-500">Đang ẩn</span>}
          </button>
        </div>

        {/* Filter Controls */}
        {isOpen && <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Account Filter */}
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Tất cả tài khoản</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.characterName || a.accountName}
              </option>
            ))}
          </select>

          {/* Level Filter */}
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Mọi mức độ</option>
            <option value="success">Thành công</option>
            <option value="info">Thông tin</option>
            <option value="warn">Cảnh báo</option>
            <option value="error">Lỗi</option>
          </select>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-500" />
            <input
              type="text"
              placeholder="Tìm kiếm log..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-7 pr-2.5 py-1 w-36 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Auto Scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded-lg border transition-colors ${
              autoScroll
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
            title="Tự động cuộn theo log mới"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Clear Logs */}
          <button
            onClick={onClearLogs}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 transition-colors"
            title="Xóa màn hình nhật ký"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>}
      </div>

      {/* Terminal Output Body */}
      {isOpen && <div className="h-[380px] p-3.5 bg-black/60 overflow-y-auto font-mono text-xs space-y-1.5 selection:bg-emerald-500/30">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600">
            Chưa có sự kiện nhật ký nào phát sinh...
          </div>
        ) : (
          filteredLogs.map((log) => {
            const parsedTime = Number(log.timestamp);
            const timeStr = Number.isFinite(parsedTime) ? new Date(parsedTime).toLocaleTimeString() : '--:--:--';
            return (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed hover:bg-slate-900/40 px-1 py-0.5 rounded">
                <span className="text-slate-500 shrink-0">[{timeStr}]</span>
                <span className="text-slate-400 font-semibold shrink-0">
                  [{getAccountLabel(log.accountId)}]
                </span>
                <span className="text-indigo-400 shrink-0">[{log.module}]</span>
                <span className={`${getLevelColor(log.level)} break-all`}>
                  {log.message}
                </span>
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>}
    </div>
  );
};
