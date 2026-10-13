const STATUS: Record<string, number> = {
  NOT_IN_GAME: 409, VENDOR_NOT_RUNNING: 409, NOT_IN_GARDEN: 409, GARDEN_LOCKED: 422,
  CHARACTER_DOWN: 409, AUTO_ACTIVE: 409, OPERATION_IN_PROGRESS: 409, PACK_LOCKED: 409,
  INSUFFICIENT_DUOC_CONG: 409, NO_SEEDS: 409, PLOT_NOT_EMPTY: 409, PLOT_NOT_READY: 409,
  GARDEN_COUNT_MISMATCH: 409, OPERATION_NOT_FOUND: 404, GARDEN_DATA_UNKNOWN: 409,
  NO_EMPTY_PLOTS: 409, NO_READY_PLOTS: 409, HURT: 409, RECONNECTED: 409, CANCELLED: 409,
  WALK_FAILED: 409, WALK_TIMEOUT: 409, WALK_CANCELLED: 409, GARDEN_TARGET_NOT_FOUND: 409,
  COMMAND_REFUSED: 409, PACK_INVALID: 400, INVALID_REQUEST: 400, VENDOR_DATA_STALE: 503,
};
export function gardenErrorResponse(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const candidate = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : raw.split(':', 1)[0].trim();
  const code = /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : 'GARDEN_FAILED';
  return { status: STATUS[code] ?? 500, body: { success: false as const, error: code, errorCode: code, retryable: code === 'VENDOR_DATA_STALE' } };
}
