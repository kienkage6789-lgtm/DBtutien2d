const KHU_STATUS: Record<string, number> = {
  NOT_IN_GAME: 409,
  VENDOR_MAP_NOT_READY: 409,
  CHARACTER_DOWN: 409,
  AUTO_ACTIVE: 409,
  OPERATION_IN_PROGRESS: 409,
  KHU_IN_PROGRESS: 409,
  KHU_ALREADY_HERE: 409,
  TARGET_INVALID: 400,
  MAP_NOT_SPLIT: 422,
  KHU_REJECTED: 422,
  KHU_COOLDOWN: 429,
  KHU_TIMEOUT: 504,
  ENGINE_VENDOR_REQUIRED: 409,
  VENDOR_NOT_RUNNING: 409,
};

const RETRYABLE = new Set([
  'VENDOR_MAP_NOT_READY',
  'KHU_IN_PROGRESS',
  'KHU_COOLDOWN',
  'KHU_TIMEOUT',
]);

export function khuErrorResponse(error: unknown): {
  status: number;
  body: {
    success: false;
    error: string;
    errorCode: string;
    retryable: boolean;
    retryAfterSec?: number;
  };
} {
  const raw = error instanceof Error ? error.message : String(error);
  const explicitCode = error && typeof error === 'object' && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;
  const [candidate] = raw.split(':', 1);
  const errorCode = explicitCode && /^[A-Z][A-Z0-9_]{2,79}$/.test(explicitCode)
    ? explicitCode : /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate.trim()) ? candidate.trim() : 'KHU_FAILED';
  const retryAfterSec = error && typeof error === 'object' && 'retryAfterSec' in error
    && Number.isInteger((error as { retryAfterSec?: unknown }).retryAfterSec)
    && Number((error as { retryAfterSec: number }).retryAfterSec) > 0
    ? Number((error as { retryAfterSec: number }).retryAfterSec) : undefined;
  const message = (errorCode === 'KHU_REJECTED' || errorCode === 'KHU_COOLDOWN' || errorCode === 'KHU_ALREADY_HERE')
    && error instanceof Error && error.message !== errorCode
    ? error.message.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || errorCode
    : errorCode;
  return {
    status: KHU_STATUS[errorCode] ?? 500,
    body: {
      success: false,
      error: message,
      errorCode,
      retryable: RETRYABLE.has(errorCode),
      ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
    },
  };
}
