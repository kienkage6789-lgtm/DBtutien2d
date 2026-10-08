import type { KhuList, MoveToOperation } from '../types';

const MAP_ID = /^[a-zA-Z0-9_-]{1,64}$/;

const isFiniteInteger = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);

export function sanitizeKhuList(value: unknown): KhuList | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const readCounts = (counts: unknown): number[] | undefined => {
    if (!Array.isArray(counts) || counts.length > 100 || !counts.every((count) => isFiniteInteger(count) && count >= 0)) return undefined;
    return [...counts] as number[];
  };
  const dem = readCounts(item.dem);
  const tran = readCounts(item.tran);
  if (typeof item.mapId !== 'string' || !MAP_ID.test(item.mapId)
    || !isFiniteInteger(item.khu) || Number(item.khu) < 1
    || !isFiniteInteger(item.toiDa) || Number(item.toiDa) < 0
    || dem === undefined || tran === undefined
    || !isFiniteInteger(item.observedAt) || Number(item.observedAt) < 0) return undefined;
  return {
    mapId: item.mapId,
    khu: Number(item.khu),
    dem,
    toiDa: Number(item.toiDa),
    tran,
    observedAt: Number(item.observedAt),
  };
}

export function isKhuFull(list: KhuList | null | undefined, index: number): boolean {
  if (!list || !Number.isInteger(index) || index < 0) return false;
  const count = list.dem[index];
  if (!isFiniteInteger(count)) return false;
  const capacity = list.tran[index];
  return (isFiniteInteger(capacity) && count >= capacity) || (list.toiDa > 0 && count >= list.toiDa);
}

const activeOperation = (operation: MoveToOperation | null): boolean => operation?.status === 'accepted' || operation?.status === 'running';

export function getKhuLockReason(input: {
  runnerReady: boolean;
  contextUsable: boolean;
  soKhu: number | null;
  autoActive: boolean;
  operation: MoveToOperation | null;
  khuRequestPending: boolean;
  cooldownRemainingSec: number;
}): string | null {
  if (!input.runnerReady) return 'Bot chưa chạy: bấm "Chạy" trước';
  if (!input.contextUsable) return 'Map chưa sẵn sàng';
  if (input.soKhu === null || input.soKhu <= 1) return 'Map này không chia khu';
  if (input.autoActive) return 'Tắt Auto để đổi khu';
  if (activeOperation(input.operation)) return 'Đang đi bộ';
  if (input.khuRequestPending) return 'Đang đổi khu';
  if (input.cooldownRemainingSec > 0) return `Đang hồi: còn ${input.cooldownRemainingSec}s`;
  return null;
}

export function khuCooldownRemainingSec(until: number | null, now = Date.now()): number {
  if (until === null || !Number.isFinite(until)) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}
