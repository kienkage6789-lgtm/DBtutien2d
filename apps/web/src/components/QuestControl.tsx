import React from 'react';
import { ApiRequestError, fetchQuest } from '../lib/api';
import type { AccountRuntime, QuestSnapshot } from '../types';

const realmNames: Record<string, string> = {
  pham_nhan: 'Phàm Nhân', luyen_khi_1: 'Luyện Khí Tầng 1', luyen_khi_2: 'Luyện Khí Tầng 2',
  luyen_khi_3: 'Luyện Khí Tầng 3', luyen_khi_4: 'Luyện Khí Tầng 4', luyen_khi_5: 'Luyện Khí Tầng 5',
  luyen_khi_6: 'Luyện Khí Tầng 6', luyen_khi_7: 'Luyện Khí Tầng 7', luyen_khi_8: 'Luyện Khí Tầng 8',
  luyen_khi_9: 'Luyện Khí Tầng 9', luyen_khi_10: 'Luyện Khí Tầng 10', luyen_khi_11: 'Luyện Khí Tầng 11',
  luyen_khi_12: 'Luyện Khí Tầng 12', luyen_khi_13: 'Luyện Khí Tầng 13', truc_co_1: 'Trúc Cơ Sơ Kỳ',
};
const format = (value: number | null): string => value === null ? '—' : value.toLocaleString('vi-VN');
const percent = (current: number, target: number): number => target > 0 ? Math.max(0, Math.min(100, Math.round(current / target * 100))) : 0;

export const QuestControl: React.FC<{ account: AccountRuntime }> = ({ account }) => {
  const [quest, setQuest] = React.useState<QuestSnapshot | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    setBusy(true); setError('');
    try { setQuest(await fetchQuest(account.id)); }
    catch (cause) { setError(cause instanceof ApiRequestError && cause.errorCode === 'VENDOR_DATA_STALE' ? 'Dữ liệu runner đã cũ; hãy làm mới.' : 'Chưa đọc được trạng thái nhiệm vụ.'); }
    finally { setBusy(false); }
  }, [account.id]);
  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return <QuestStatus account={account} quest={quest} error={error} busy={busy} onRefresh={() => void load()} />;
};

export const QuestStatus: React.FC<{ account: AccountRuntime; quest: QuestSnapshot | null; error?: string; busy?: boolean; onRefresh?: () => void }> =
  ({ account, quest, error = '', busy = false, onRefresh = () => {} }) => {
  const known = quest?.known === true && !account.dataStale;
  const stage = known ? quest.stage : null;
  const level = known ? quest.realm.level : null;
  const goal = 18;
  const gate = known ? quest.nextGate : null;
  const stageOk = gate?.stageOk === true ? 'Đạt' : gate?.stageOk === false ? 'Chưa đạt' : 'chưa biết';
  const expText = gate ? `${format(gate.exp)} / ${format(gate.expMax)}` : '—';
  return <div className="min-w-0 space-y-3 text-sm">
    {error && <p role="status" className="break-words rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-200">{error}</p>}
    <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-100">Giai đoạn hiện tại</h3><button type="button" onClick={onRefresh} disabled={busy} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 disabled:opacity-50">{busy ? 'Đang đọc…' : 'Làm mới'}</button></div>
      {!known ? <p className="mt-2 text-slate-400">Chưa biết trạng thái nhiệm vụ.</p> : <>
        <p className="mt-2 break-words font-medium text-slate-100">Giai đoạn {stage === null ? '—/34' : `${stage}/34`} — {quest.stageName ?? 'chưa biết'}</p>
        {quest.hint && <p className="mt-1 break-words text-xs text-slate-300">{quest.hint}</p>}
        {quest.objectives === null ? <p className="mt-2 text-xs text-slate-400">Mục tiêu: chưa biết</p> : quest.objectives.length > 0 && <ul className="mt-2 space-y-1">{quest.objectives.map((objective, i) => <li key={`${i}-${objective.text}`} className="flex min-w-0 gap-2 text-xs"><span aria-label={objective.done ? 'Đã xong' : 'Chưa xong'} className={objective.done ? 'shrink-0 text-emerald-300' : 'shrink-0 text-slate-500'}>{objective.done ? '✓' : '○'}</span><span className="min-w-0 break-words text-slate-300">{objective.text}</span></li>)}</ul>}
        {quest.turnInNpc && <p className="mt-2 break-words text-xs text-amber-200">NPC cần giao: {quest.turnInNpc}</p>}
      </>}
    </section>

    <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <h3 className="font-semibold text-slate-100">Tiến độ tới Luyện Khí 7</h3>
      {known && quest.target.reachedTarget === true && <p className="mt-2 text-sm font-semibold text-emerald-300">Đã tới Luyện Khí 7</p>}
      {level !== null && <Progress label="Cảnh giới" value={`${Math.min(level, 7)}/7`} percent={percent(level, 7)} />}
      {stage !== null && <Progress label="Nhiệm vụ" value={`${Math.min(stage, goal)}/${goal}`} percent={percent(stage, goal)} />}
      {known && level === null && stage === null && <p className="mt-2 text-xs text-slate-400">Chưa biết tiến độ.</p>}
    </section>

    <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <h3 className="font-semibold text-slate-100">Lần đột phá kế tiếp</h3>
      {!known || !gate ? <p className="mt-2 text-slate-400">— / chưa biết</p> : <div className="mt-2 min-w-0 space-y-1.5 text-xs text-slate-300">
        <p className="break-words">{realmNames[gate.fromRealmId] ?? gate.fromRealmId} → {realmNames[gate.toRealmId] ?? gate.toRealmId}</p>
        <p className="break-words">Đan: {gate.item ? `${gate.item.name} (${format(gate.item.have)}/${format(gate.item.qty)})` : '—'}</p>
        <p>Giai đoạn tối thiểu: {gate.questStageRequired === null ? '—' : `${gate.questStageRequired} · ${stageOk}`}</p>
        <p>Đạo Hạnh đầy: {expText} · {gate.expFull === true ? 'Đạt' : gate.expFull === false ? 'Chưa đạt' : 'chưa biết'}</p>
        {gate.ready === true && <p className="inline-flex rounded bg-emerald-500/15 px-2 py-1 font-bold tracking-wide text-emerald-300">SẴN SÀNG</p>}
        {gate.ready === null && <p className="text-slate-400">Sẵn sàng: chưa biết</p>}
      </div>}
    </section>
  </div>;
};

const Progress: React.FC<{ label: string; value: string; percent: number }> = ({ label, value, percent: amount }) => <div className="mt-2 min-w-0">
  <div className="flex justify-between gap-2 text-xs"><span className="text-slate-300">{label}</span><span className="font-mono text-slate-100">{value}</span></div>
  <div className="mt-1 h-2 overflow-hidden rounded bg-slate-800"><div role="progressbar" aria-label={label} aria-valuenow={amount} aria-valuemin={0} aria-valuemax={100} className="h-full rounded bg-emerald-500" style={{ width: `${amount}%` }} /></div>
</div>;
