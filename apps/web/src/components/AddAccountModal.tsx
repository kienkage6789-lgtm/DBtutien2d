import React, { useState } from 'react';
import { X, UserPlus, Eye, EyeOff, ShieldCheck, ShieldAlert, Sparkles } from 'lucide-react';
import { createAccount } from '../lib/api';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim() || !password) {
      setError('Vui lòng nhập Đạo hiệu và Mật khẩu.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await createAccount({
        accountName: accountName.trim(),
        password: password,
      });
      setAccountName('');
      setPassword('');
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Lỗi khi đăng nhập tài khoản');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#0c101a] border border-slate-800 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 font-title">Đăng Nhập Tài Khoản Game</h2>
              <p className="text-xs text-slate-400">Đăng nhập trực tiếp bằng Đạo Hiệu và Mật Khẩu</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info banner */}
        <div className="mt-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 shrink-0 text-indigo-400" />
          <span>
            Hệ thống tự động xác thực và <strong>làm mới phiên đăng nhập 24/7</strong>. Bạn không cần lấy hay dán chuỗi JWT thủ công nữa!
          </span>
        </div>

        {/* Error alert */}
        {error && (
          <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 my-5 text-xs text-slate-300">
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">
              Đạo Hiệu (Tên tài khoản hoặc Email):
            </label>
            <input
              type="text"
              placeholder="ví dụ: kienvit, thanhhuyen..."
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1.5 flex items-center justify-between">
              <span>Mật Khẩu Game:</span>
              <span className="text-[10px] text-emerald-400 font-normal">Mã hóa AES-256-GCM an toàn</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Nhập mật khẩu tài khoản"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono text-xs"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              Hủy
            </button>

            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{loading ? 'Đang xác thực...' : 'Đăng Nhập & Lưu'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
