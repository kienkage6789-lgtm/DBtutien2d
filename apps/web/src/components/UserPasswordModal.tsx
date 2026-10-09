import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { changeOwnPassword } from '../lib/api';
import { notify } from '../lib/dialogs';
import type { AuthUser } from '../types';

interface UserPasswordModalProps {
  user: AuthUser | null;
  onClose: () => void;
  onUpdated: (user: AuthUser) => void;
}

export const UserPasswordModal: React.FC<UserPasswordModalProps> = ({ user, onClose, onUpdated }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  if (!user) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 6) { notify('Mật khẩu mới phải có ít nhất 6 ký tự.'); return; }
    setLoading(true);
    try {
      const nextUser = await changeOwnPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      onUpdated(nextUser);
      onClose();
    } catch (error) {
      notify(error);
    } finally {
      setLoading(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
    <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0c101a] p-6 shadow-2xl">
      <div className="mb-5 flex items-center justify-between border-b border-slate-800 pb-4"><div className="flex items-center gap-3"><div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-400"><KeyRound className="h-5 w-5" /></div><div><h2 className="font-title text-base font-bold">Quản lý tài khoản</h2><p className="text-xs text-slate-400">Đổi mật khẩu cho {user.username}</p></div></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><X className="h-5 w-5" /></button></div>
      <label className="mb-1.5 block text-xs font-semibold text-slate-300" htmlFor="current-password">Mật khẩu hiện tại</label>
      <input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500" />
      <label className="mb-1.5 block text-xs font-semibold text-slate-300" htmlFor="new-password">Mật khẩu mới</label>
      <input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" className="mb-5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500" />
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700">Hủy</button><button type="submit" disabled={loading || !currentPassword || !newPassword} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{loading ? 'Đang lưu…' : 'Đổi mật khẩu'}</button></div>
    </form>
  </div>;
};

