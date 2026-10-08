export const KHU_COOLDOWN_MS = 5_000;
export const KHU_CHANGE_TIMEOUT_MS = 4_000;
export const KHU_LIST_TIMEOUT_MS = 3_000;

export type KhuErrorCode =
  | 'NOT_IN_GAME'
  | 'VENDOR_MAP_NOT_READY'
  | 'CHARACTER_DOWN'
  | 'AUTO_ACTIVE'
  | 'OPERATION_IN_PROGRESS'
  | 'KHU_IN_PROGRESS'
  | 'MAP_NOT_SPLIT'
  | 'TARGET_INVALID'
  | 'KHU_ALREADY_HERE'
  | 'KHU_COOLDOWN'
  | 'KHU_REJECTED'
  | 'KHU_TIMEOUT';

export class KhuError extends Error {
  public readonly code: KhuErrorCode;
  public readonly retryAfterSec?: number;

  public constructor(code: KhuErrorCode, message: string = code, retryAfterSec?: number) {
    super(message);
    this.name = 'KhuError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface KhuList {
  mapId: string;
  khu: number;
  dem: number[];
  toiDa: number;
  tran: number[];
  observedAt: number;
}

export interface KhuInfo {
  mapId: string | null;
  khu: number | null;
  soKhu: number | null;
  list: KhuList | null;
}

export interface KhuChangeResult {
  mapId: string;
  khu: number;
  soKhu: number | null;
  list: KhuList | null;
}

export function cleanKhuToast(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned || null;
}

export function toastText(packet: Record<string, unknown>): string | null {
  const direct = cleanKhuToast(packet.text);
  if (direct) return direct;
  const toast = packet.toast;
  if (typeof toast === 'string') return cleanKhuToast(toast);
  if (toast && typeof toast === 'object' && !Array.isArray(toast)) {
    return cleanKhuToast((toast as Record<string, unknown>).text);
  }
  return null;
}

export function cooldownSecondsFromToast(message: string): number | null {
  const match = /^Vừa đổi khu, chờ (\d+) giây nữa\.$/.exec(message);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}
