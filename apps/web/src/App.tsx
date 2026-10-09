import React, { useEffect, useRef, useState } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { Navbar } from './components/Navbar';
import { StatsBar } from './components/StatsBar';
import { AccountCard } from './components/AccountCard';
import { AddAccountModal } from './components/AddAccountModal';
import { DialogHost } from './components/DialogHost';
import { UpdatePasswordModal } from './components/UpdatePasswordModal';
import { UserPasswordModal } from './components/UserPasswordModal';
import { AdminPanel } from './components/AdminPanel';
import { LoginPanel } from './components/LoginPanel';
import { LogTerminal } from './components/LogTerminal';
import type { AccountRuntime, MoveToOperation } from './types';
import { cancelMoveTo, fetchCurrentUser, fetchMapCatalog, fetchMapGeometry, logout, moveTo, startBot, stopBot, startVendorAuto, stopVendorAuto, startAllBots, stopAllBots, deleteAccount } from './lib/api';
import type { MapCatalogItem } from './lib/api';
import type { WorldBounds } from './lib/minimap';
import { resolveMapContext } from './lib/context';
import { confirmAction, notify } from './lib/dialogs';
import { entitlementLockReason } from './lib/entitlement';
import { clearToken, getToken, onAuthRequired } from './lib/auth';
import type { AuthUser } from './types';

export const App: React.FC = () => {
  const { accounts, logs, isConnected, refreshAccounts, setLogs } = useRealtime();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(() => !!getToken());
  const [mapGeometryById, setMapGeometryById] = useState<Record<string, WorldBounds>>({});
  const [mapCatalog, setMapCatalog] = useState<MapCatalogItem[]>([]);
  const geometryRequestsRef = useRef(new Set<string>());
  const geometryFailedAtRef = useRef(new Map<string, number>());
  const [activePasswordAccount, setActivePasswordAccount] = useState<AccountRuntime | null>(null);
  const [isUserPasswordOpen, setIsUserPasswordOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeView, setActiveView] = useState<'dashboard' | 'admin'>('dashboard');
  const [logAccountId, setLogAccountId] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const runningCount = accounts.filter((account) => account.status === 'running').length;
  const entitlementLock = user ? entitlementLockReason(user, clock) : null;
  const quotaFull = user?.role === 'user' && user.usage !== undefined && user.usage.accounts >= user.usage.maxBots;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') { setActiveView('dashboard'); return; }
    try {
      const saved = window.sessionStorage.getItem('tutien2d.activeView');
      if (saved === 'admin' || saved === 'dashboard') setActiveView(saved);
    } catch { /* sessionStorage có thể bị chặn trong trình duyệt nhúng. */ }
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    try { window.sessionStorage.setItem('tutien2d.activeView', activeView); } catch { /* không làm hỏng dashboard nếu storage lỗi. */ }
  }, [activeView, user?.role]);

  useEffect(() => {
    let mounted = true;
    const handleAuthRequired = () => {
      clearToken();
      if (mounted) { setUser(null); setAuthLoading(false); }
    };
    const unsubscribe = onAuthRequired(handleAuthRequired);
    if (!getToken()) {
      setAuthLoading(false);
    } else {
      fetchCurrentUser()
        .then((result) => { if (mounted) setUser(result.user); })
        .catch(() => { if (mounted) handleAuthRequired(); })
        .finally(() => { if (mounted) setAuthLoading(false); });
    }
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    void fetchMapCatalog().then(setMapCatalog).catch(() => setMapCatalog([]));
  }, []);

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

  const handleStart = async (id: string) => { try { await startBot(id); await refreshAccounts(); } catch (error) { notify(error); } };
  const handleStop = async (id: string) => { try { await stopBot(id); await refreshAccounts(); } catch (error) { notify(error); } };
  const handleStartAuto = async (account: AccountRuntime) => {
    try {
      const view = resolveMapContext(account);
      const anchor = view.usable && account.x !== null && account.y !== null
        ? { mapId: view.mapId, khu: view.khu, x: account.x, y: account.y } : undefined;
      await startVendorAuto(account.id, anchor);
      await refreshAccounts();
    } catch (error) { notify(error); }
  };
  const handleStopAuto = async (id: string) => { try { await stopVendorAuto(id); await refreshAccounts(); } catch (error) { notify(error); } };
  const handleMoveTo = async (
    id: string,
    target?: { x: number; y: number },
    options: { targetMapId?: string; abortOnHurt?: boolean; maxHurt?: number } = {},
  ): Promise<MoveToOperation> => {
    try {
      const operation = await moveTo(id, target, options);
      await refreshAccounts();
      return operation;
    } catch (error) {
      notify(error);
      throw error;
    }
  };
  const handleCancelMoveTo = async (id: string, operationId: string): Promise<MoveToOperation> => {
    try {
      const operation = await cancelMoveTo(id, operationId);
      await refreshAccounts();
      return operation;
    } catch (error) {
      notify(error);
      throw error;
    }
  };
  const handleDelete = async (id: string) => {
    if (!(await confirmAction('Bạn có chắc chắn muốn xóa tài khoản này khỏi Dashboard?', { confirmLabel: 'Xóa', danger: true }))) return;
    try { await deleteAccount(id); await refreshAccounts(); } catch (error) { notify(error); }
  };
  const handleStartAll = async () => { try { await startAllBots(); await refreshAccounts(); } catch (error) { notify(error); } };
  const handleStopAll = async () => { try { await stopAllBots(); await refreshAccounts(); } catch (error) { notify(error); } };
  const handleRefresh = async () => { await refreshAccounts(); };
  const handleOpenAccountLog = (accountId: string) => { setLogAccountId(accountId); setActiveView('dashboard'); };

  const handleLogout = async () => {
    try { await logout(); } catch { /* local token is cleared even when the server session is already gone */ }
    clearToken();
    setUser(null);
  };

  if (authLoading) return <div className="flex min-h-screen items-center justify-center bg-[#07090e] text-sm text-slate-400">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <LoginPanel onLoggedIn={setUser} />;

  return <div className="min-h-screen flex flex-col bg-[#07090e] text-slate-100">
    <Navbar user={user} onLogout={handleLogout} onOpenAccount={() => setIsUserPasswordOpen(true)} isConnected={isConnected} totalAccounts={accounts.length} runningCount={runningCount} onStartAll={handleStartAll} onStopAll={handleStopAll} onRefresh={handleRefresh} onOpenAddModal={() => setIsAddModalOpen(true)} activeView={activeView} onViewChange={setActiveView} />
    {user.mustChangePassword && <div className="sticky top-[5.5rem] z-30 border-b border-rose-500/40 bg-rose-950/95 px-4 py-2 text-center text-xs font-semibold text-rose-100">Bạn đang dùng mật khẩu mặc định. Hãy đổi mật khẩu (nút Quản lý tài khoản) trước khi mở ra internet.</div>}
    {user.role !== 'admin' && entitlementLock && <div role="alert" className="sticky top-[5.5rem] z-30 border-b border-rose-500/40 bg-rose-950/95 px-4 py-2 text-center text-xs font-semibold text-rose-100">{entitlementLock}. Các điều khiển bot đã khóa; bạn vẫn có thể dừng, xóa tài khoản và đổi mật khẩu.</div>}
    <main className="min-w-0 flex-1 w-full max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
      {activeView === 'admin' && user.role === 'admin'
        ? <AdminPanel currentUserId={user.id} accounts={accounts} onRefreshAccounts={refreshAccounts} onOpenAccountLog={handleOpenAccountLog} />
        : <><StatsBar accounts={accounts} />
          <section>
            <h2 className="text-base font-bold uppercase tracking-wider text-slate-200 font-title mb-4">Ma trận tài khoản ({accounts.length})</h2>
            {accounts.length === 0
              ? <div className="glass-panel rounded-2xl p-12 text-center border border-dashed border-slate-800"><h3 className="text-lg font-bold text-slate-200 mb-2">Chưa có tài khoản nào được kết nối</h3><button onClick={() => setIsAddModalOpen(true)} disabled={quotaFull} title={quotaFull ? `Đã đủ ${user.maxBots} tài khoản` : undefined} className="px-5 py-2.5 text-xs font-semibold rounded-xl bg-emerald-600 text-white disabled:cursor-not-allowed disabled:opacity-40">+ Thêm tài khoản</button></div>
              : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{accounts.map((account) => <AccountCard key={account.id} account={account} ownerLabel={user.role === 'admin' && account.ownerId !== user.id ? account.ownerUsername ?? account.ownerId ?? 'chưa biết' : null} controlsDisabled={!!entitlementLock} controlLockReason={entitlementLock} mapCatalog={mapCatalog} mapGeometry={(() => { const view = resolveMapContext(account); return view.usable ? mapGeometryById[view.mapId] ?? null : null; })()} onStart={handleStart} onStop={handleStop} onStartVendorAuto={handleStartAuto} onStopVendorAuto={handleStopAuto} onMoveTo={handleMoveTo} onCancelMoveTo={handleCancelMoveTo} onUpdatePassword={setActivePasswordAccount} onDelete={handleDelete} />)}</div>}
          </section>
          <section className="pt-2"><LogTerminal logs={logs} accounts={accounts} onClearLogs={() => setLogs([])} initialAccountId={logAccountId} /></section></>}
    </main>
    <footer className="border-t border-slate-900 bg-black/40 py-4 px-4 text-center text-xs text-slate-600">TuTien2D Automation · client chính thức headless</footer>
    <UpdatePasswordModal account={activePasswordAccount} onClose={() => setActivePasswordAccount(null)} onUpdated={refreshAccounts} />
    <UserPasswordModal user={isUserPasswordOpen ? user : null} onClose={() => setIsUserPasswordOpen(false)} onUpdated={setUser} />
    <DialogHost />
    <AddAccountModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onCreated={refreshAccounts} />
  </div>;
};
