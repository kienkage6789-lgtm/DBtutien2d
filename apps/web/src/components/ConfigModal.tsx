import React, { useState, useEffect } from 'react';
import { X, Save, Sliders, ShieldCheck } from 'lucide-react';
import { AccountRuntime, BotConfig, MapCatalog } from '../types';
import { fetchBotConfig, updateBotConfig } from '../lib/api';

interface ConfigModalProps {
  account: AccountRuntime | null;
  mapCatalog?: MapCatalog | null;
  onClose: () => void;
  onSaved: () => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({ account, mapCatalog, onClose, onSaved }) => {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) {
      setLoading(true);
      setLoadError(null);
      fetchBotConfig(account.id)
        .then((cfg) => {
          setConfig(cfg);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoadError(err.message || 'Không tải được cấu hình bot.');
          setLoading(false);
        });
    }
  }, [account]);

  if (!account) return null;

  const monsterTypeSuggestions = Array.from(new Set(
    (Array.isArray(account.monsters) ? account.monsters : [])
      .flatMap((monster) => [monster.name?.trim(), monster.id?.trim()])
      .filter((value): value is string => Boolean(value)),
  ));
  const monsterTypeDatalistId = `training-monster-types-${account.id}`;
  const mapIdSuggestions = Array.from(new Set(
    (Array.isArray(mapCatalog?.maps) ? mapCatalog.maps : [])
      .map((map) => map.id?.trim())
      .filter((mapId): mapId is string => Boolean(mapId)),
  )).sort((a, b) => a.localeCompare(b));
  const mapIdDatalistId = `farm-map-ids-${account.id}`;

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await updateBotConfig(account.id, config);
      onSaved();
      onClose();
    } catch (err: any) {
      alert(`Lỗi khi lưu cấu hình: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#0c101a] border border-slate-800 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 font-title">
                Cấu Hình Bot: {account.characterName || account.accountName}
              </h2>
              <p className="text-xs text-slate-400">Thiết lập tham số tự động hóa và cơ chế an toàn</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        {loading || !config ? (
          <div className="py-16 text-center text-slate-400 text-sm">{loadError || 'Đang tải cấu hình bot...'}</div>
        ) : (
          <div className="space-y-5 my-6 max-h-[60vh] overflow-y-auto pr-1 text-sm text-slate-200">
            {/* Auto Sell Section */}
            <div className="hidden p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-100">Tự Động Bán Đồ (Auto Sell)</h3>
                  <p className="text-xs text-slate-400">Dọn dẹp vật phẩm rác cho NPC Thương Nhân</p>
                </div>
                <input
                  type="checkbox"
                  checked={config.autoSell}
                  onChange={(e) => setConfig({ ...config, autoSell: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500/30 bg-slate-800 border-slate-700"
                />
              </div>

              {config.autoSell && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">Bán khi túi đạt (số loại đồ):</label>
                    <input
                      type="number"
                      value={config.sellRules.maxSlotsThreshold || 12}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          sellRules: {
                            ...config.sellRules,
                            maxSlotsThreshold: parseInt(e.target.value, 10) || 12,
                          },
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Auto HP & Potion Section */}
            <div className="hidden p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-100">Hồi Phục & Mua Đan Dược</h3>
                  <p className="text-xs text-slate-400">Tự uống đan khi tụt máu và mua thêm khi sắp hết</p>
                </div>
                <input
                  type="checkbox"
                  checked={config.autoEatHp}
                  onChange={(e) => setConfig({ ...config, autoEatHp: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500/30 bg-slate-800 border-slate-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Uống đan khi HP dưới (%):</label>
                  <input
                    type="number"
                    value={config.minHpPercent}
                    onChange={(e) => setConfig({ ...config, minHpPercent: parseInt(e.target.value, 10) || 50 })}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Loại đan dược sử dụng:</label>
                  <input
                    type="text"
                    value={config.hpRestockItem}
                    onChange={(e) => setConfig({ ...config, hpRestockItem: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div className="sm:col-span-2 flex items-center justify-between pt-2 border-t border-slate-800/60">
                  <span className="text-slate-300">Tự mua thêm khi túi còn ít hơn {config.minHpPotion} bình:</span>
                  <input
                    type="checkbox"
                    checked={config.autoBuyHpMp}
                    onChange={(e) => setConfig({ ...config, autoBuyHpMp: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500/30 bg-slate-800 border-slate-700"
                  />
                </div>
              </div>
            </div>

            {/* Farm & Quests */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <h3 className="font-semibold text-slate-100">Vị trí farm</h3>

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <input type="checkbox" checked={config.autoTraining ?? false} onChange={(e) => setConfig({ ...config, autoTraining: e.target.checked })} className="w-4 h-4 rounded text-emerald-500" />
                <span className="font-medium text-slate-200">Tự di chuyển đến bãi và auto đánh</span>
              </label>

              <div className="hidden grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={config.autoFarm}
                    onChange={(e) => setConfig({ ...config, autoFarm: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-500"
                  />
                  <span>Tự gieo & gặt Dược Điền</span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={config.autoDailyQuest ?? config.autoDaily}
                    onChange={(e) => setConfig({ ...config, autoDailyQuest: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-500"
                  />
                  <span>Điểm danh & nhiệm vụ ngày</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <input type="checkbox" checked={config.autoMainQuest ?? false} onChange={(e) => setConfig({ ...config, autoMainQuest: e.target.checked })} className="w-4 h-4 rounded text-emerald-500" />
                  <span>Quest chính tuyến (thử trả nhiệm vụ đang hoạt động)</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <input type="checkbox" checked={config.autoCaveQuest ?? config.autoCave} onChange={(e) => setConfig({ ...config, autoCaveQuest: e.target.checked })} className="w-4 h-4 rounded text-emerald-500" />
                  <span>Bí cảnh / hang động</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 sm:col-span-2">
                  <input type="checkbox" checked={config.autoTravelToFarm ?? false} onChange={(e) => setConfig({ ...config, autoTravelToFarm: e.target.checked })} className="w-4 h-4 rounded text-emerald-500" />
                  <span>Tự chuyển map và di chuyển đến điểm farm (tối đa 1 lệnh mỗi 30 giây; sai số cho phép 3)</span>
                </label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {([['farmMapId','Map ID'],['farmKhu','Khu'],['farmX','Tọa độ X'],['farmY','Tọa độ Y']] as const).map(([key,label]) => (
                  <label key={key} className="block text-slate-400">{label}
                    <input
                      type={key === 'farmMapId' ? 'text' : 'number'}
                      list={key === 'farmMapId' ? mapIdDatalistId : undefined}
                      value={config[key] ?? (key === 'farmMapId' ? '' : 0)}
                      placeholder={key === 'farmMapId' ? 'Chọn hoặc nhập Map ID' : undefined}
                      onChange={(e) => setConfig({ ...config, [key]: key === 'farmMapId' ? e.target.value : Number(e.target.value) || 0 })}
                      className="mt-1 w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
                    />
                    {key === 'farmMapId' && (
                      <>
                        <datalist id={mapIdDatalistId}>
                          {mapIdSuggestions.map((mapId) => <option key={mapId} value={mapId} />)}
                        </datalist>
                        <span className="mt-1 block text-[10px] text-slate-500">Gợi ý là map đã quan sát từ packet; danh sách có thể chưa đầy đủ. Catalog rỗng vẫn có thể nhập Map ID thủ công.</span>
                      </>
                    )}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="block text-slate-400 col-span-2">Loại quái mục tiêu (để trống = mọi loại)
                  <input
                    type="text"
                    list={monsterTypeDatalistId}
                    value={config.trainingMonsterType ?? ''}
                    onChange={(e) => setConfig({ ...config, trainingMonsterType: e.target.value })}
                    placeholder="Nhập chính xác tên hoặc ID quái"
                    className="mt-1 w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
                  />
                  <datalist id={monsterTypeDatalistId}>
                    {monsterTypeSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
                  </datalist>
                  <span className="mt-1 block text-[10px] text-slate-500">Lọc khớp chính xác theo tên hoặc ID; không tìm gần đúng. Gợi ý lấy từ snapshot quái hiện có, nhưng vẫn có thể nhập khi chưa có snapshot.</span>
                </label>
                <label className="block text-slate-400">Bán kính bãi (tọa độ)
                  <input type="number" min={1} value={config.trainingRadius ?? 80} onChange={(e) => setConfig({ ...config, trainingRadius: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
                </label>
                <label className="block text-slate-400">Khoảng đánh (ms)
                  <input type="number" min={250} step={100} value={config.trainingAttackIntervalMs ?? 1000} onChange={(e) => setConfig({ ...config, trainingAttackIntervalMs: Math.max(250, Number(e.target.value) || 250) })} className="mt-1 w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100" />
                </label>
              </div>
              <p className="text-[11px] text-amber-300/90">Lưu ý: giao thức chọn khu và hồi sinh chưa được xác minh/hỗ trợ. Khi nhân vật chết, bot chưa thể tự hồi sinh hoặc bảo đảm quay lại bãi.</p>
            </div>

            {/* Anti Detection Jitter */}
            <div className="hidden p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                <h3 className="font-semibold text-slate-100">Bộ Tạo Trễ Mô Phỏng Người Thật (Jitter)</h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Delay tối thiểu (ms):</label>
                  <input
                    type="number"
                    value={config.delayRangeMs.min}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        delayRangeMs: {
                          ...config.delayRangeMs,
                          min: parseInt(e.target.value, 10) || 200,
                        },
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Delay tối đa (ms):</label>
                  <input
                    type="number"
                    value={config.delayRangeMs.max}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        delayRangeMs: {
                          ...config.delayRangeMs,
                          max: parseInt(e.target.value, 10) || 800,
                        },
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Hủy
          </button>

          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Đang lưu...' : 'Lưu Thay Đổi'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
