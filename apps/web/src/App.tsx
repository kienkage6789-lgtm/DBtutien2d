import React, { useEffect, useRef, useState } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { Navbar } from './components/Navbar';
import { StatsBar } from './components/StatsBar';
import { AccountCard } from './components/AccountCard';
import { InventoryModal } from './components/InventoryModal';
import { ConfigModal } from './components/ConfigModal';
import { AddAccountModal } from './components/AddAccountModal';
import { UpdatePasswordModal } from './components/UpdatePasswordModal';
import { ApiTokenPanel } from './components/ApiTokenPanel';
import { LogTerminal } from './components/LogTerminal';
import { AccountRuntime, MapCatalog } from './types';
import {
  startBot,
  stopBot,
  startAllBots,
  stopAllBots,
  deleteAccount,
  fetchBotConfig,
  updateBotConfig,
  fetchObservedMaps,
  fetchMapGeometry,
  cancelMoveTo,
  requestMoveTo,
  requestMapEntry,
} from './lib/api';
import type { WorldBounds } from './lib/minimap';
import { describeContextBlock, resolveMapContext } from './lib/context';

export const App: React.FC = () => {
  const { accounts, logs, isConnected, refreshAccounts, setLogs } = useRealtime();
  const [mapCatalog, setMapCatalog] = useState<MapCatalog>({ source: 'unavailable', status: 'unavailable', maps: [] });
  const [mapCatalogLoading, setMapCatalogLoading] = useState(false);
  const [mapCatalogError, setMapCatalogError] = useState<string | null>(null);
  const [mapGeometryById, setMapGeometryById] = useState<Record<string, WorldBounds>>({});
  const geometryRequestsRef = useRef(new Set<string>());
  const geometryFailedAtRef = useRef(new Map<string, number>());

  const [activeInventoryAccount, setActiveInventoryAccount] = useState<AccountRuntime | null>(null);
  const [activeConfigAccount, setActiveConfigAccount] = useState<AccountRuntime | null>(null);
  const [activePasswordAccount, setActivePasswordAccount] = useState<AccountRuntime | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

  const runningCount = accounts.filter((a) => a.status === 'running').length;

  const loadMapCatalog = async () => {
    setMapCatalogLoading(true);
    try {
      const catalog = await fetchObservedMaps();
      setMapCatalog(catalog);
      setMapCatalogError(null);
    } catch (error) {
      setMapCatalog({ source: 'unavailable', status: 'unavailable', maps: [] });
      setMapCatalogError(error instanceof Error ? error.message : 'Không tải được danh sách map đã phát hiện.');
    } finally {
      setMapCatalogLoading(false);
    }
  };

  useEffect(() => {
    void loadMapCatalog();
  }, []);

  useEffect(() => {
    const now = Date.now();
    const mapIds = new Set<string>();
    for (const account of accounts) {
      const view = resolveMapContext(account, now);
      const mapId = view.usable ? view.mapId : account.mapId;
      if (typeof mapId === 'string' && mapId.trim().length > 0) mapIds.add(mapId);
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
        .catch(() => { geometryFailedAtRef.current.set(mapId, Date.now()); })
        .finally(() => geometryRequestsRef.current.delete(mapId));
    }
  }, [accounts, mapGeometryById]);

  const handleRefresh = async () => {
    await refreshAccounts();
    await loadMapCatalog();
  };

  const handleRequestMap = async (accountId: string, mapId: string) => {
    const receipt = await requestMapEntry(accountId, mapId);
    await refreshAccounts();
    await loadMapCatalog();
    return receipt;
  };

  const handleMoveTo = async (account: AccountRuntime, target: { x: number; y: number }) => {
    const view = resolveMapContext(account);
    if (!view.usable) throw new Error(describeContextBlock(view) ?? 'Map context không hợp lệ.');
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error('Tọa độ đích không hợp lệ.');
    await requestMoveTo(account.id, {
      requestId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `move-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mapId: view.mapId,
      khu: view.khu,
      x: target.x,
      y: target.y,
      arrivalRadius: 20,
    });
  };

  const handleCancelMoveTo = async (account: AccountRuntime, operationId: string) => {
    try {
      await cancelMoveTo(account.id, operationId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Không thể hủy di chuyển.');
    }
  };

  const handleStartBot = async (id: string) => {
    try {
      const config = await fetchBotConfig(id);
      await updateBotConfig(id, {
        autoSell: false,
        autoEatHp: false,
        autoBuyHpMp: false,
        autoDaily: false,
        autoCave: false,
        autoDailyQuest: false,
        autoMainQuest: false,
        autoCaveQuest: false,
        autoTravelToFarm: config.autoFarm === true,
      });
      await startBot(id);
      refreshAccounts();
    } catch (err: any) {
      alert(`Lỗi khi khởi chạy bot: ${err.message}`);
    }
  };

  const handleStopBot = async (id: string) => {
    try {
      await stopBot(id);
      refreshAccounts();
    } catch (err: any) {
      alert(`Lỗi khi dừng bot: ${err.message}`);
    }
  };

  const handleStartAll = async () => {
    try {
      await startAllBots();
      refreshAccounts();
    } catch (err: any) {
      alert(`Lỗi khi bắt đầu tất cả: ${err.message}`);
    }
  };

  const handleStopAll = async () => {
    try {
      await stopAllBots();
      refreshAccounts();
    } catch (err: any) {
      alert(`Lỗi khi dừng tất cả: ${err.message}`);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa tài khoản này khỏi Dashboard?')) {
      try {
        await deleteAccount(id);
        refreshAccounts();
      } catch (err: any) {
        alert(`Lỗi khi xóa tài khoản: ${err.message}`);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#07090e] text-slate-100">
      {/* Top Header */}
      <Navbar
        isConnected={isConnected}
        totalAccounts={accounts.length}
        runningCount={runningCount}
        onStartAll={handleStartAll}
        onStopAll={handleStopAll}
        onRefresh={handleRefresh}
        onOpenAddModal={() => setIsAddModalOpen(true)}
      />

      <ApiTokenPanel onTokenChanged={() => { void refreshAccounts(); void loadMapCatalog(); }} />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* KPI Stats Bar */}
        <StatsBar accounts={accounts} />

        {/* Multi-Account Matrix View */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold uppercase tracking-wider text-slate-200 font-title">
                Ma Trận Tài Khoản ({accounts.length})
              </h2>
              <span className="text-xs text-slate-500 font-normal">
                | Điều khiển đồng bộ & tự động đăng nhập 24/7
              </span>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className="glass-panel rounded-2xl p-12 text-center border border-dashed border-slate-800">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-3xl mx-auto mb-4">
                ⚔️
              </div>
              <h3 className="text-lg font-bold text-slate-200 font-title mb-1">
                Chưa có tài khoản nào được kết nối
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mb-5">
                Bấm vào nút "Thêm Tài Khoản" để đăng nhập bằng Đạo Hiệu và Mật Khẩu của bạn.
              </p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-5 py-2.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all"
              >
                + Thêm Tài Khoản Ngay
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((acc) => (
                <AccountCard
                  key={acc.id}
                  account={acc}
                  mapCatalog={mapCatalog}
                  mapCatalogLoading={mapCatalogLoading}
                  mapCatalogError={mapCatalogError}
                  onRequestMap={handleRequestMap}
                  mapGeometry={(() => { const view = resolveMapContext(acc); return view.usable ? mapGeometryById[view.mapId] ?? null : null; })()}
                  onMoveTo={(target) => handleMoveTo(acc, target)}
                  onCancelMoveTo={(operationId) => { void handleCancelMoveTo(acc, operationId); }}
                  onStart={handleStartBot}
                  onStop={handleStopBot}
                  onOpenInventory={setActiveInventoryAccount}
                  onOpenConfig={setActiveConfigAccount}
                  onUpdatePassword={setActivePasswordAccount}
                  onDelete={handleDeleteAccount}
                />
              ))}
            </div>
          )}
        </section>

        {/* Real-time Terminal Stream */}
        <section className="pt-2">
          <LogTerminal
            logs={logs}
            accounts={accounts}
            onClearLogs={() => setLogs([])}
          />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-black/40 py-4 px-4 text-center text-xs text-slate-600">
        <p>TuTien2D Automation & Multi-Account Platform • Tự động đăng nhập & duy trì phiên 24/7</p>
      </footer>

      {/* Modals */}
      <InventoryModal
        account={activeInventoryAccount}
        onClose={() => setActiveInventoryAccount(null)}
        onRefreshNeeded={refreshAccounts}
      />

      <ConfigModal
        account={activeConfigAccount}
        mapCatalog={mapCatalog}
        onClose={() => setActiveConfigAccount(null)}
        onSaved={refreshAccounts}
      />

      <UpdatePasswordModal
        account={activePasswordAccount}
        onClose={() => setActivePasswordAccount(null)}
        onUpdated={refreshAccounts}
      />

      <AddAccountModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCreated={refreshAccounts}
      />
    </div>
  );
};
