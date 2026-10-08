import { confirmAction } from '../lib/dialogs';
import React, { useEffect, useMemo, useState } from 'react';
import type { AccountRuntime, DailyOperation, DailyStatus, MoveToOperation } from '../types';
import { cancelDaily, DailyApiError, startDailyCheckin, startDailySeed } from '../lib/api';

const active = (operation: DailyOperation | null): boolean => operation?.status === 'accepted' || operation?.status === 'running';

export function getDailyLockReason(input: {
  runnerReady: boolean;
  mapReady: boolean;
  autoActive: boolean;
  operation: DailyOperation | null;
  moveTo: MoveToOperation | null;
  stage: number | null;
  forSeed?: boolean;
}): string | null {
  if (!input.runnerReady) return 'Bot chưa chạy: bấm "Chạy" trước';
  if (!input.mapReady) return 'Map chưa sẵn sàng';
  if (input.autoActive) return 'Tắt Auto để làm nhiệm vụ';
  if (active(input.operation)) return 'Đang có nhiệm vụ hằng ngày';
  if (input.moveTo?.status === 'accepted' || input.moveTo?.status === 'running') return 'Đang có thao tác khác';
  if (input.forSeed && input.stage !== null && input.stage < 8) return 'Cần đạt tiến độ nhiệm vụ chính từ 8';
  return null;
}

function cleanWhy(value: unknown): string {
  if (typeof value !== 'string') return 'Không rõ lý do';
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Không rõ lý do';
}

function statusLabel(operation: DailyOperation | null): string {
  if (!operation) return '';
  const labels: Record<DailyOperation['status'], string> = {
    accepted: 'Đã nhận', running: 'Đang làm', done: 'Đã xong', failed: 'Thất bại', cancelled: 'Đã hủy',
  };
  return labels[operation.status] ?? operation.status;
}

export const DailyControl: React.FC<{ account: AccountRuntime }> = ({ account }) => {
  const [localOperation, setLocalOperation] = useState<DailyOperation | null>(account.daily);
  const [runs, setRuns] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vendor = account.vendor;
  const status: DailyStatus | null = account.dailyStatus ?? vendor?.dailyStatus ?? null;
  const operation = account.daily ?? localOperation;
  const runnerReady = account.status === 'running' && vendor !== undefined;
  const mapReady = runnerReady && vendor?.connection === 'IN_GAME' && vendor.mapId !== null;
  const autoActive = vendor?.autoRequested === true || vendor?.supervisor.phase !== undefined && vendor.supervisor.phase !== 'idle';
  const moveTo = account.moveTo ?? vendor?.moveTo ?? null;
  const checkinLock = getDailyLockReason({ runnerReady, mapReady, autoActive, operation, moveTo, stage: status?.stage ?? null });
  const seedLock = getDailyLockReason({ runnerReady, mapReady, autoActive, operation, moveTo, stage: status?.stage ?? null, forSeed: true });
  const supportedTasks = useMemo(() => status?.seedTasks.filter((item) => item.supported) ?? [], [status]);

  useEffect(() => {
    if (account.daily !== undefined) setLocalOperation(account.daily);
  }, [account.daily?.operationId, account.daily?.status, account.daily?.updatedAt]);

  useEffect(() => {
    const maxRuns = supportedTasks.reduce((max, item) => Math.max(max, item.runsLeft ?? 0), 0);
    if (maxRuns > 0) setRuns((previous) => Math.max(1, Math.min(previous, maxRuns, 3)));
  }, [supportedTasks]);

  const confirmStart = (): Promise<boolean> => confirmAction('Dùng lượt thật trong ngày; có thể đi qua map có quái. Tiếp tục?');

  const beginCheckin = async (): Promise<void> => {
    if (checkinLock || status?.checkin.done || busy) return;
    if (!(await confirmStart())) return;
    setBusy(true); setError(null);
    try { setLocalOperation(await startDailyCheckin(account.id)); }
    catch (reason: unknown) { setError(cleanWhy(reason instanceof DailyApiError ? reason.message : reason)); }
    finally { setBusy(false); }
  };

  const beginSeed = async (task: DailyStatus['seedTasks'][number]): Promise<void> => {
    if (seedLock || task.runsLeft === null || task.runsLeft < 1 || busy) return;
    if (!(await confirmStart())) return;
    const selectedRuns = Math.max(1, Math.min(runs, task.runsLeft, 3));
    setBusy(true); setError(null);
    try { setLocalOperation(await startDailySeed(account.id, task.id, { runs: selectedRuns })); }
    catch (reason: unknown) { setError(cleanWhy(reason instanceof DailyApiError ? reason.message : reason)); }
    finally { setBusy(false); }
  };

  const cancel = async (): Promise<void> => {
    if (!operation || !active(operation) || busy) return;
    setBusy(true); setError(null);
    try { setLocalOperation(await cancelDaily(account.id, operation.operationId)); }
    catch (reason: unknown) { setError(cleanWhy(reason instanceof DailyApiError ? reason.message : reason)); }
    finally { setBusy(false); }
  };

  return <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-950/10 px-3 py-2 text-xs">
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="font-semibold text-emerald-200">Nhiệm vụ hằng ngày</span>
      <span className="text-slate-400">Ngày VN: {status?.today ?? 'chưa biết'}</span>
    </div>
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-slate-300">
      <span>Stage: {status?.stage ?? 'chưa biết'}</span>
      <span>Linh Thạch: {status?.stones ?? 'chưa biết'}</span>
      <span>Dược Công: {status?.duocCong ?? 'chưa biết'}</span>
      <span>Cành Khô: {status?.canhKho ?? 'chưa biết'}</span>
      <span>Nấm Linh Chi Núi: {status?.namLinhChi ?? 'chưa biết'}</span>
    </div>
    {!status && <p role="status" className="mb-2 text-amber-300">Chưa đọc được trạng thái nhiệm vụ.</p>}
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => void beginCheckin()} disabled={!status || status.checkin.done || !!checkinLock || busy} className="rounded border border-emerald-500/40 bg-emerald-600/20 px-2.5 py-1.5 text-emerald-200 disabled:opacity-40">
        {status?.checkin.done ? 'Đã điểm danh hôm nay' : busy ? 'Đang gửi…' : 'Điểm danh'}
      </button>
      {checkinLock && !status?.checkin.done && <span className="text-amber-300">{checkinLock}</span>}
    </div>
    <ul className="mt-2 divide-y divide-slate-800/80 rounded border border-slate-800/80 text-[11px]">
      {status?.seedTasks.map((item) => <li key={item.id} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-1.5 ${item.supported ? 'text-slate-300' : 'text-slate-600'}`}>
        <div className="min-w-0 basis-40 flex-1">
          <div className="break-words">{item.name || item.id}{item.active ? ' · đang làm' : ''}</div>
          <div className="text-slate-500">Lượt còn: {item.runsLeft ?? 'chưa biết'}</div>
        </div>
        <div className="shrink-0">{item.supported
          ? <div className="flex items-center gap-1.5"><select aria-label={`Số lượt ${item.name || item.id}`} value={Math.min(runs, Math.max(1, Math.min(3, item.runsLeft ?? 1)))} onChange={(event) => setRuns(Math.max(1, Math.min(3, Number(event.target.value) || 1)))} disabled={!!seedLock || item.runsLeft === null || item.runsLeft < 1 || busy} className="rounded border border-slate-700 bg-slate-950 px-1 py-1 disabled:opacity-50">{Array.from({ length: Math.min(3, item.runsLeft ?? 0) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} lượt</option>)}</select><button type="button" onClick={() => void beginSeed(item)} disabled={!!seedLock || item.runsLeft === null || item.runsLeft < 1 || busy} className="rounded border border-emerald-500/40 bg-emerald-600/20 px-2 py-1 text-emerald-200 disabled:opacity-40">Làm</button></div>
          : <span>Chưa hỗ trợ</span>}</div>
      </li>)}
    </ul>
    {seedLock && supportedTasks.some((item) => item.runsLeft !== null && item.runsLeft > 0) && <p role="status" className="mt-2 text-amber-300">{seedLock}</p>}
    {operation && <div className="mt-2 flex items-center justify-between gap-2 rounded border border-cyan-500/25 bg-cyan-950/15 px-2 py-1.5 text-cyan-200">
      <span>{statusLabel(operation)} · {operation.step} · lượt {operation.runIndex}/{operation.runsTotal}{operation.progress?.itemId === 'nam_linh_chi' ? ` · nấm ${operation.progress.collected}/${operation.progress.required}` : ''}{operation.rewards ? ` · +${operation.rewards.stones} Linh Thạch, +${operation.rewards.duocCong} Dược Công` : ''}</span>
      {active(operation) && <button type="button" onClick={() => void cancel()} disabled={busy} className="rounded border border-rose-500/40 bg-rose-600/20 px-2 py-1 text-rose-200 disabled:opacity-40">Hủy</button>}
    </div>}
    {operation?.why && <p role="alert" className="mt-2 text-rose-300">{cleanWhy(operation.why)}</p>}
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
  </div>;
};
