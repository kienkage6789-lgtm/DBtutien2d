import React, { FormEvent, useEffect, useState } from 'react';
import { KeyRound, ShieldAlert, UserRound } from 'lucide-react';
import { clearToken, onAuthRequired } from '../lib/auth';
import { ApiRequestError, login } from '../lib/api';
import type { AuthUser } from '../types';

interface LoginPanelProps {
  onLoggedIn: (user: AuthUser) => void;
}

function loginError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) return `Quá nhiều lần đăng nhập sai, thử lại sau ${error.retryAfterSec ?? 60} giây.`;
    if (error.errorCode === 'INVALID_CREDENTIALS') return 'Tên đăng nhập hoặc mật khẩu không đúng.';
    if (error.errorCode === 'USERNAME_INVALID') return 'Tên đăng nhập không hợp lệ.';
    if (error.errorCode === 'PASSWORD_TOO_SHORT') return 'Mật khẩu phải có ít nhất 6 ký tự.';
  }
  return 'Không thể đăng nhập. Vui lòng thử lại.';
}

export const LoginPanel: React.FC<LoginPanelProps> = ({ onLoggedIn }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => onAuthRequired(() => {
    clearToken();
    setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await login(username, password);
      setPassword('');
      onLoggedIn(result.user);
    } catch (reason) {
      setError(loginError(reason));
    } finally {
      setLoading(false);
    }
  };

  return <main className="min-h-screen flex items-center justify-center bg-[#07090e] px-4 py-8 text-slate-100">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-2xl">⚔️</div>
        <h1 className="font-title text-xl font-bold">TuTien<span className="text-emerald-400">2D</span></h1>
        <p className="mt-1 text-xs text-slate-400">Đăng nhập bảng điều khiển</p>
      </div>
      {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" /><span>{error}</span></div>}
      <label className="mb-1.5 block text-xs font-semibold text-slate-300" htmlFor="login-username">Tên đăng nhập</label>
      <div className="relative mb-4"><UserRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-emerald-500" /></div>
      <label className="mb-1.5 block text-xs font-semibold text-slate-300" htmlFor="login-password">Mật khẩu</label>
      <div className="relative mb-5"><KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-emerald-500" /></div>
      <button type="submit" disabled={loading || !username.trim() || password.length === 0} className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{loading ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
    </form>
  </main>;
};

