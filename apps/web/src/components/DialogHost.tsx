import React, { useEffect, useSyncExternalStore } from 'react';
import { dismissNotice, getDialogState, resolveConfirm, subscribeDialogs } from '../lib/dialogs';

const kindClass: Record<string, string> = {
  error: 'border-rose-500/40 bg-rose-950/90 text-rose-100',
  info: 'border-cyan-500/40 bg-cyan-950/90 text-cyan-100',
  success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100',
};

/** Hiển thị thông báo và hộp xác nhận trong trang (thay cho alert/confirm gốc bị trình duyệt nhúng chặn). */
export const DialogHost: React.FC = () => {
  const state = useSyncExternalStore(subscribeDialogs, getDialogState, getDialogState);
  const confirm = state.confirm;

  useEffect(() => {
    if (!confirm) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') resolveConfirm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm?.id]);

  return <>
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-2 px-4">
      {state.notices.map((notice) => <div key={notice.id} role={notice.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs shadow-lg ${kindClass[notice.kind] ?? kindClass.info}`}>
        <span className="min-w-0 break-words">{notice.message}</span>
        <button type="button" aria-label="Đóng thông báo" onClick={() => dismissNotice(notice.id)} className="shrink-0 rounded px-1 text-slate-300 hover:text-white">✕</button>
      </div>)}
    </div>
    {confirm && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4" onClick={(event) => { if (event.target === event.currentTarget) resolveConfirm(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Xác nhận" className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-100 shadow-2xl">
        <p className="mb-4 break-words">{confirm.message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => resolveConfirm(false)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700">{confirm.cancelLabel}</button>
          <button type="button" autoFocus onClick={() => resolveConfirm(true)} className={`rounded-lg border px-3 py-1.5 font-semibold ${confirm.danger ? 'border-rose-500/50 bg-rose-600/30 text-rose-100 hover:bg-rose-600/40' : 'border-emerald-500/50 bg-emerald-600/30 text-emerald-100 hover:bg-emerald-600/40'}`}>{confirm.confirmLabel}</button>
        </div>
      </div>
    </div>}
  </>;
};
