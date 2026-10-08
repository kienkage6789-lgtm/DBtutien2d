const DAILY_STATUS: Record<string, number> = {
  NOT_IN_GAME: 409,
  VENDOR_MAP_NOT_READY: 409,
  CHARACTER_DOWN: 409,
  AUTO_ACTIVE: 409,
  OPERATION_IN_PROGRESS: 409,
  OTHER_SEED_TASK_ACTIVE: 409,
  ALREADY_DONE: 409,
  NO_RUNS_LEFT: 409,
  STAGE_TOO_LOW: 422,
  TASK_NOT_SUPPORTED: 422,
  INVALID_REQUEST: 400,
  TARGET_INVALID: 400,
  OPERATION_NOT_FOUND: 404,
  ENGINE_VENDOR_REQUIRED: 409,
  VENDOR_NOT_RUNNING: 409,
};

const RETRYABLE = new Set(['VENDOR_MAP_NOT_READY']);

function cleanMessage(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function dailyErrorResponse(error: unknown): {
  status: number;
  body: { success: false; error: string; errorCode: string; retryable: boolean };
} {
  const raw = error instanceof Error ? error.message : String(error);
  const explicitCode = error && typeof error === 'object' && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;
  const [candidate] = raw.split(':', 1);
  const errorCode = explicitCode && /^[A-Z][A-Z0-9_]{2,79}$/.test(explicitCode)
    ? explicitCode : /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate.trim()) ? candidate.trim() : 'DAILY_FAILED';
  const message = cleanMessage(errorCode) || errorCode;
  return {
    status: DAILY_STATUS[errorCode] ?? 500,
    body: { success: false, error: message, errorCode, retryable: RETRYABLE.has(errorCode) },
  };
}
