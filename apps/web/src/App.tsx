import React, { useEffect, useRef, useState } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { Navbar } from './components/Navbar';
import { StatsBar } from './components/StatsBar';
import { AccountCard } from './components/AccountCard';
import { AddAccountModal } from './components/AddAccountModal';
import { UpdatePasswordModal } from './components/UpdatePasswordModal';
import { ApiTokenPanel } from './components/ApiTokenPanel';
import { LogTerminal } from './components/LogTerminal';
import type { AccountRuntime, MoveToOperation } from './types';
import { cancelMoveTo, fetchMapGeometry, moveTo, startBot, stopBot, startVendorAuto, stopVendorAuto, startAllBots, stopAllBots, deleteAccount } from './lib/api';
import type { WorldBounds } from './lib/minimap';
import { resolveMapContext } from './lib/context';

export const App: React.FC = () => {
  const { accounts, logs, isConnected, refreshAccounts, setLogs } = useRealtime();
  const [mapGeometryById, setMapGeometryById] = useState<Record<string, WorldBounds>>({});
  const geometryRequestsRef = useRef(new Set<string>());
  const geometryFailedAtRef = useRef(new Map<string, number>());
  const [activePasswordAccount, setActivePasswordAccount] = useState<AccountRuntime | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const runningCount = accounts.filter((account) => account.status === 'running').length;

  useEffect(() => {
    const now = Date.now();
    const mapIds = new Set<string>();
    for (const account of accounts) {
      const view = resolveMapContext(account, now);
      const mapId = view.usable ? view.mapId : account.mapId;
      if (mapId) mapIds.add(mapId);
    }
    for (const mapId of mapIds) {
      if (mapGeometryById[mapId] || geometryRequestsRef.current.has(mapId)) continue;
      const failedAt = geometryFailedAtRef.current.get(mapId);
      if (failedAt !== undefined && now - failedAt < 30_000) continue;
      geometryRequestsRef.current.add(mapId);
      fetchMapGeometry(mapId)
        .then((geometry) => {
          geometryFailedAtRef.current.delete(mapId);
          setMapGeometryById((previous) => ({ ...previous, [mapId]: geometry }));
        })
        .catch(() => geometryFailedAtRef.current.set(mapId, Date.now()))
        .finally(() => geometryRequestsRef.current.delete(mapId));
    }
  }, [accounts, mapGeometryById]);

  const handleStart = async (id: string) => { try { await startBot(id); await refreshAccounts(); } catch (error) { alert(error instanceof Error ? error.message : String(error)); } };
  const handleStop = async (id: string) => { try { await stopBot(id); await refreshAccounts(); } catch (error) { alert(error instanceof Error ? error.message : String(error)); } };
  const handleStartAuto = async (account: AccountRuntime) => {
    try {
      const view = resolveMapContext(account);
      const anchor = view.usable && account.x !== null && account.y !== null
        ? { mapId: view.mapId, khu: view.khu, x: account.x, y: account.y } : undefined;
      await startVendorAuto(account.id, anchor);
      await refreshAccounts();
    } catch (error) { alert(error instanceof Error ? error.message : String(error)); }
  };
  const handleStopAuto = async (id: string) => { try { await stopVendorAuto(id); await refreshAccounts(); } catch (error) { alert(error instanceof Error ? error.message : String(error)); } };
  const handleMoveTo = async (id: string, target: { x: number; y: number }): Promise<MoveToOperation> => {
    try {
      const operation = await moveTo(id, target);
      await refreshAccounts();
      return operation;
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const handleCancelMoveTo = async (id: string, operationId: string): Promise<MoveToOperation> => {
    try {
      const operation = await cancelMoveTo(id, operationId);
      await refreshAccounts();
      return operation;
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa tài khoản này khỏi Dashboard?')) return;
    try { await deleteAccount(id); await refreshAccounts(); } catch (error) { alert(error instanceof Error ? error.message : String(error)); }
  };
  const handleStartAll = async () => { try { await startAllBots(); await refreshAccounts(); } catch (error) { alert(error instanceof Error ? error.message : String(error)); } };
  const handleStopAll = async () => { try { await stopAllBots(); await refreshAccounts(); } catch (error) { alert(error instanceof Error ? error.message : String(error)); } };
  const handleRefresh = async () => { await refreshAccounts(); };

  return <div className="min-h-screen flex flex-col bg-[#07090e] text-slate-100">
    <Navbar isConnected={isConnected} totalAccounts={accounts.length} runningCount={runningCount} onStartAll={handleStartAll} onStopAll={handleStopAll} onRefresh={handleRefresh} onOpenAddModal={() => setIsAddModalOpen(true)} />
    <ApiTokenPanel onTokenChanged={() => { void refreshAccounts(); }} />
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6 space-y-6">
      <StatsBar accounts={accounts} />
      <section>
        <h2 className="text-base font-bold uppercase tracking-wider text-slate-200 font-title mb-4">Ma trận tài khoản ({accounts.length})</h2>
        {accounts.length === 0
          ? <div className="glass-panel rounded-2xl p-12 text-center border border-dashed border-slate-800"><h3 className="text-lg font-bold text-slate-200 mb-2">Chưa có tài khoản nào được kết nối</h3><button onClick={() => setIsAddModalOpen(true)} className="px-5 py-2.5 text-xs font-semibold rounded-xl bg-emerald-600 text-white">+ Thêm tài khoản</button></div>
          : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{accounts.map((account) => <AccountCard key={account.id} account={account} mapGeometry={(() => { const view = resolveMapContext(account); return view.usable ? mapGeometryById[view.mapId] ?? null : null; })()} onStart={handleStart} onStop={handleStop} onStartVendorAuto={handleStartAuto} onStopVendorAuto={handleStopAuto} onMoveTo={handleMoveTo} onCancelMoveTo={handleCancelMoveTo} onUpdatePassword={setActivePasswordAccount} onDelete={handleDelete} />)}</div>}
      </section>
      <section className="pt-2"><LogTerminal logs={logs} accounts={accounts} onClearLogs={() => setLogs([])} /></section>
    </main>
    <footer className="border-t border-slate-900 bg-black/40 py-4 px-4 text-center text-xs text-slate-600">TuTien2D Automation · client chính thức headless</footer>
    <UpdatePasswordModal account={activePasswordAccount} onClose={() => setActivePasswordAccount(null)} onUpdated={refreshAccounts} />
    <AddAccountModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onCreated={refreshAccounts} />
  </div>;
};
