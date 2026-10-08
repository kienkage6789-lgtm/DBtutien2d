const MOVE_TO_STATUS: Record<string, number> = {
  NOT_IN_GAME: 409,
  VENDOR_MAP_NOT_READY: 409,
  CHARACTER_DOWN: 409,
  AUTO_ACTIVE: 409,
  OPERATION_IN_PROGRESS: 409,
  TARGET_INVALID: 400,
  TARGET_UNREACHABLE: 422,
  TARGET_ON_PORTAL: 422,
  ROUTE_UNAVAILABLE: 422,
  PATH_CROSSES_PORTAL: 422,
  ENGINE_VENDOR_REQUIRED: 409,
  VENDOR_NOT_RUNNING: 409,
  OPERATION_NOT_FOUND: 404,
  OPERATION_ID_INVALID: 400,
};

const RETRYABLE = new Set([
  'NOT_IN_GAME',
  'VENDOR_MAP_NOT_READY',
  'ENGINE_VENDOR_REQUIRED',
  'VENDOR_NOT_RUNNING',
]);

export function moveToErrorResponse(error: string): {
  status: number;
  body: { success: false; error: string; errorCode: string; retryable: boolean };
} {
  const [candidate] = error.split(':', 1);
  const errorCode = /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate.trim()) ? candidate.trim() : 'MOVE_TO_FAILED';
  return {
    status: MOVE_TO_STATUS[errorCode] ?? 500,
    body: {
      success: false,
      error: errorCode,
      errorCode,
      retryable: RETRYABLE.has(errorCode),
    },
  };
}
