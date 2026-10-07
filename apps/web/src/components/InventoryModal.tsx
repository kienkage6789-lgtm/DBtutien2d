import React, { useState, useEffect } from 'react';
import { X, Lock, DollarSign, ShieldAlert, Sparkles, AlertCircle } from 'lucide-react';
import { AccountRuntime, BotConfig } from '../types';
import { fetchBotConfig, updateBotConfig } from '../lib/api';

interface InventoryModalProps {
  account: AccountRuntime | null;
  onClose: () => void;
  onRefreshNeeded: () => void;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  account,
  onClose,
  onRefreshNeeded,
}) => {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) {
      fetchBotConfig(account.id).then(setConfig).catch(console.error);
    }
  }, [account]);

  if (!account) return null;

  const bag = account.bag || {};
  const itemKeys = Object.keys(bag);

  const getItemIcon = (name: string) => {
    if (name.startsWith('bi_tich')) return '📜';
    if (name.includes('kiem') || name.includes('vu_khi')) return '⚔️';
    if (name.includes('ao') || name.includes('giap')) return '🥋';
    if (name.includes('duoc') || name.includes('thao')) return '🌿';
    if (name.includes('phu')) return '🧧';
    if (name.includes('ca')) return '🐟';
    if (name.includes('hat')) return '🌱';
    return '📦';
  };

  const isWhitelisted = (name: string) => {
    if (!config) return false;
    return config.sellRules.whitelist.some((w) =>
      w.endsWith('*') ? name.startsWith(w.slice(0, -1)) : w === name
    );
  };

  const isBlacklisted = (name: string) => {
    if (!config) return false;
    return config.sellRules.blacklist.includes(name);
  };

  const toggleWhitelist = async (itemId: string) => {
    if (!config) return;
    setSaving(true);
    try {
      const currentWhitelist = [...config.sellRules.whitelist];
      const currentBlacklist = config.sellRules.blacklist.filter((b) => b !== itemId);

      const existsIdx = currentWhitelist.indexOf(itemId);
      if (existsIdx >= 0) {
        currentWhitelist.splice(existsIdx, 1);
      } else {
        currentWhitelist.push(itemId);
      }

      const updated = await updateBotConfig(account.id, {
        sellRules: {
          ...config.sellRules,
          whitelist: currentWhitelist,
          blacklist: currentBlacklist,
        },
      });
      setConfig(updated);
      onRefreshNeeded();
    } finally {
      setSaving(false);
    }
  };

  const toggleBlacklist = async (itemId: string) => {
    if (!config) return;
    setSaving(true);
    try {
      const currentBlacklist = [...config.sellRules.blacklist];
      const currentWhitelist = config.sellRules.whitelist.filter((w) => w !== itemId);

      const existsIdx = currentBlacklist.indexOf(itemId);
      if (existsIdx >= 0) {
        currentBlacklist.splice(existsIdx, 1);
      } else {
        currentBlacklist.push(itemId);
      }

      const updated = await updateBotConfig(account.id, {
        sellRules: {
          ...config.sellRules,
          whitelist: currentWhitelist,
          blacklist: currentBlacklist,
        },
      });
      setConfig(updated);
      onRefreshNeeded();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-2xl bg-[#0c101a] border border-slate-800 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 font-title">
                Túi Đồ: {account.characterName || account.accountName}
              </h2>
              <p className="text-xs text-slate-400">
                Tổng số loại: <span className="text-emerald-400 font-semibold">{itemKeys.length}</span> vật phẩm
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content: Inventory Grid + Detail Inspector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6 max-h-[60vh] overflow-y-auto pr-1">
          {/* 2D RPG Grid */}
          <div className="md:col-span-2">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
              Ô Lưới Túi Trữ Vật
            </h4>
            {itemKeys.length === 0 ? (
              <div className="py-12 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                Túi đồ hiện đang trống hoặc nhân vật chưa kết nối.
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                {itemKeys.map((itemId) => {
                  const qty = bag[itemId];
                  const locked = isWhitelisted(itemId);
                  const trash = isBlacklisted(itemId);
                  const isSelected = selectedItem === itemId;

                  return (
                    <button
                      key={itemId}
                      onClick={() => setSelectedItem(itemId)}
                      className={`relative flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all text-center aspect-square ${
                        isSelected
                          ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                          : locked
                          ? 'border-amber-500/40 bg-amber-500/10 hover:border-amber-500'
                          : trash
                          ? 'border-rose-500/40 bg-rose-500/10 hover:border-rose-500'
                          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-2xl mb-1">{getItemIcon(itemId)}</span>
                      <span className="text-[11px] font-medium text-slate-200 truncate w-full px-1">
                        {itemId.replace(/_/g, ' ')}
                      </span>
                      <span className="absolute bottom-1 right-1.5 text-[10px] font-mono font-bold text-amber-300 bg-black/60 px-1 rounded">
                        x{qty}
                      </span>

                      {/* Rule Badge */}
                      {locked && (
                        <span className="absolute top-1 left-1 p-0.5 rounded bg-amber-500/80 text-black">
                          <Lock className="w-2.5 h-2.5" />
                        </span>
                      )}
                      {trash && (
                        <span className="absolute top-1 left-1 p-0.5 rounded bg-rose-500/80 text-white">
                          <DollarSign className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Item Detail & Rule Inspector */}
          <div className="glass-panel rounded-xl p-4 border border-slate-800 flex flex-col justify-between">
            {selectedItem ? (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">{getItemIcon(selectedItem)}</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 capitalize">
                      {selectedItem.replace(/_/g, ' ')}
                    </h3>
                    <p className="text-xs text-amber-400 font-mono">
                      Số lượng: x{bag[selectedItem] || 0}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 mb-6 text-xs text-slate-300">
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1.5">
                    <p className="font-semibold text-slate-400">Trạng thái lọc bán:</p>
                    {isWhitelisted(selectedItem) ? (
                      <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                        <Lock className="w-3.5 h-3.5" /> Đã Khóa (Không bao giờ bán)
                      </span>
                    ) : isBlacklisted(selectedItem) ? (
                      <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                        <DollarSign className="w-3.5 h-3.5" /> Tự động bán khi dọn túi
                      </span>
                    ) : (
                      <span className="text-slate-400">Chưa gán quy tắc riêng</span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={() => toggleWhitelist(selectedItem)}
                    disabled={saving}
                    className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                      isWhitelisted(selectedItem)
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30'
                        : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{isWhitelisted(selectedItem) ? 'Bỏ Khóa Vật Phẩm' : 'Khóa (Whitelist)'}</span>
                  </button>

                  <button
                    onClick={() => toggleBlacklist(selectedItem)}
                    disabled={saving}
                    className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                      isBlacklisted(selectedItem)
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 hover:bg-rose-500/30'
                        : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>{isBlacklisted(selectedItem) ? 'Bỏ Tự Bán' : 'Tự Động Bán (Blacklist)'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 text-xs py-10">
                <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                <p>Click vào một vật phẩm bên trái để xem chi tiết và cấu hình quy tắc bán.</p>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500">
              💡 Quy tắc lọc đồ được đồng bộ thời gian thực vào engine bot.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
