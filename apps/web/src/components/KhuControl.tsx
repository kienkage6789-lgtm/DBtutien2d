import React, { useEffect, useRef, useState } from 'react';
import type { AccountRuntime, KhuList } from '../types';
import { changeKhu, fetchKhu, MoveToApiError } from '../lib/api';
import { getKhuLockReason, isKhuFull, khuCooldownRemainingSec } from '../lib/khu';
import { resolveMapContext } from '../lib/context';

const KHU_REQUEST_MIN_INTERVAL_MS = 2_500;
const KHU_SUCCESS_COOLDOWN_MS = 5_000;

export function KhuControl({ account, controlsDisabled = false, controlLockReason = null }: { account: AccountRuntime; controlsDisabled?: boolean; controlLockReason?: string | null }): React.ReactElement {
  const [list, setList] = useState<KhuList | null>(account.khuList);
  const [selected, setSelected] = useState<number | ''>('');
  const [localKhu, setLocalKhu] = useState<number | null>(account.khu);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastRequestAtRef = useRef(0);
  const requestRef = useRef<Promise<void> | null>(null);

  const context = resolveMapContext(account);
  const mapId = context.usable ? context.mapId : account.mapId || null;
  const soKhu = account.soKhu ?? account.mapContext.soKhu;
  const operation = account.moveTo ?? account.vendor?.moveTo ?? null;
  const autoActive = account.vendor?.autoRequested === true
    || (account.vendor?.supervisor.phase !== undefined && account.vendor.supervisor.phase !== 'idle');
  const runnerReady = account.status === 'running' && account.vendor !== undefined;
  const cooldownRemainingSec = khuCooldownRemainingSec(cooldownUntil, now);
  const lockReason = controlLockReason ?? getKhuLockReason({
    runnerReady,
    contextUsable: context.usable,
    soKhu,
    autoActive,
    operation,
    khuRequestPending: pending,
    cooldownRemainingSec,
  });

  useEffect(() => {
    setLocalKhu(account.khu);
    setSelected('');
    if (account.khuList?.mapId === mapId) setList(account.khuList);
    else if (account.khuList === null || account.khuList?.mapId !== mapId) setList(null);
  }, [account.khu, account.khuList?.mapId, account.khuList?.observedAt, mapId]);

  useEffect(() => {
    if (cooldownUntil === null) return undefined;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= cooldownUntil) setCooldownUntil(null);
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const loadList = (refresh: boolean): void => {
    if (!runnerReady || !context.usable || soKhu === null || soKhu <= 1) return;
    const timestamp = Date.now();
    if (requestRef.current || timestamp - lastRequestAtRef.current < KHU_REQUEST_MIN_INTERVAL_MS) return;
    lastRequestAtRef.current = timestamp;
    setLoading(true);
    setError(null);
    const request = fetchKhu(account.id, refresh)
      .then((data) => {
        if (data.mapId === mapId) setList(data.list);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        requestRef.current = null;
        setLoading(false);
      });
    requestRef.current = request;
  };

  useEffect(() => {
    if (account.khuList?.mapId === mapId && account.khuList !== null) return;
    loadList(true);
    // Tải lại khi vào game hoặc map/khu đổi; loadList có lock chống dồn request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, account.status, account.vendor?.connection, mapId, localKhu, soKhu]);

  const choose = async (): Promise<void> => {
    if (selected === '' || lockReason || !list || isKhuFull(list, selected - 1) || selected === localKhu) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const runtime = await changeKhu(account.id, selected);
      setLocalKhu(runtime.khu);
      if (runtime.khuList?.mapId === mapId) setList(runtime.khuList);
      setCooldownUntil(Date.now() + KHU_SUCCESS_COOLDOWN_MS);
      setNow(Date.now());
      setMessage('Đã đổi khu.');
      setSelected('');
    } catch (reason: unknown) {
      const apiError = reason instanceof MoveToApiError ? reason : null;
      if (apiError?.code === 'KHU_COOLDOWN') {
        const retryAfterSec = apiError.retryAfterSec ?? 5;
        setCooldownUntil(Date.now() + retryAfterSec * 1000);
        setNow(Date.now());
      }
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };

  const currentLabel = localKhu === null || soKhu === null ? 'Khu chưa biết' : `Khu ${localKhu}/${soKhu}`;

  return <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-950/10 px-3 py-2 text-xs">
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="font-semibold text-amber-200">Đổi khu</span>
      <span className="text-slate-400">{currentLabel}</span>
    </div>
    {lockReason && <p role="status" className="mb-2 text-amber-300">{lockReason}</p>}
    {loading && <p className="mb-2 text-slate-400">Đang đọc danh sách khu…</p>}
    <div className="flex items-center gap-2">
      <select
        aria-label="Khu đích"
        value={selected}
        onChange={(event) => setSelected(event.target.value ? Number(event.target.value) : '')}
        disabled={!!lockReason || loading || !list}
        className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200 disabled:opacity-50"
      >
        <option value="">{list ? 'Chọn khu…' : 'Chưa có danh sách khu…'}</option>
        {soKhu !== null && Array.from({ length: soKhu }, (_, index) => index + 1).map((khu) => {
          const count = list?.dem[khu - 1];
          const capacity = list?.tran[khu - 1] ?? list?.toiDa;
          const full = isKhuFull(list, khu - 1);
          const isCurrent = khu === localKhu;
          const label = count === undefined
            ? `Khu ${khu} · chưa biết`
            : `Khu ${khu} · ${count}/${capacity ?? '—'} người${full ? ' · đầy' : ''}`;
          return <option key={khu} value={khu} disabled={full || isCurrent}>{isCurrent ? `${label} · đang ở đây` : label}</option>;
        })}
      </select>
      <button type="button" onClick={() => void choose()} disabled={selected === '' || !!lockReason || loading || pending || !list} className="rounded border border-amber-500/40 bg-amber-600/20 px-2.5 py-1.5 text-amber-200 disabled:opacity-40">{pending ? 'Đang đổi…' : 'Đổi khu'}</button>
      <button type="button" onClick={() => loadList(true)} disabled={controlsDisabled || loading || pending || !runnerReady || !context.usable} className="rounded border border-slate-600 bg-slate-800/60 px-2.5 py-1.5 text-slate-200 disabled:opacity-40">Làm mới</button>
    </div>
    {cooldownRemainingSec > 0 && <p className="mt-2 text-amber-300">Đang hồi: còn {cooldownRemainingSec}s</p>}
    {message && <p role="status" className="mt-2 text-emerald-300">{message}</p>}
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
  </div>;
}
