import React, { FormEvent, useEffect, useState } from 'react';
import { clearToken, getToken, notifyAuthChanged, onAuthRequired, setToken } from '../lib/auth';

interface ApiTokenPanelProps {
  onTokenChanged: () => void;
}

export const ApiTokenPanel: React.FC<ApiTokenPanelProps> = ({ onTokenChanged }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [hasToken, setHasToken] = useState(() => !!getToken());
  const [prompted, setPrompted] = useState(false);

  useEffect(() => onAuthRequired(() => {
    setPrompted(true);
    setOpen(true);
    setHasToken(!!getToken());
  }), []);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setToken(value);
    setValue('');
    setHasToken(true);
    setPrompted(false);
    setOpen(false);
    onTokenChanged();
  };

  const retry = () => {
    setPrompted(false);
    notifyAuthChanged();
    onTokenChanged();
  };

  const remove = () => {
    clearToken();
    setHasToken(false);
    setPrompted(false);
    setOpen(false);
    onTokenChanged();
  };

  return <div className="mx-auto w-full max-w-7xl px-4 pt-3 lg:px-8">
    {!open ? <button type="button" onClick={() => setOpen(true)} className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">
      API token · {hasToken ? 'đã lưu trong phiên' : 'chưa cấu hình'}
    </button> : <form onSubmit={save} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
      <div className="min-w-48 flex-1">
        <label htmlFor="api-token" className="mb-1 block text-xs font-medium text-slate-200">Token API</label>
        <input id="api-token" type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" spellCheck={false} placeholder={hasToken ? 'Nhập token mới để thay thế' : 'Dán API token'} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500" />
        <p className="mt-1 text-[10px] text-slate-500">Token chỉ được lưu trong sessionStorage và tự mất khi đóng tab.</p>
      </div>
      <button type="submit" disabled={!value.trim()} className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">Lưu và kết nối</button>
      {hasToken && <button type="button" onClick={retry} className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300">Thử lại token hiện tại</button>}
      {hasToken && <button type="button" onClick={remove} className="rounded border border-rose-800 px-3 py-1.5 text-xs text-rose-300">Xóa token</button>}
      <button type="button" onClick={() => { setOpen(false); setPrompted(false); }} className="rounded px-2 py-1.5 text-xs text-slate-400">Đóng</button>
      {prompted && <p role="status" className="basis-full text-xs text-amber-300">Kết nối realtime bị từ chối: kiểm tra API token và origin được phép.</p>}
    </form>}
  </div>;
};
