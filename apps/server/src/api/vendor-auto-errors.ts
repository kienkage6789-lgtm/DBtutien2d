export function vendorAutoErrorResponse(error: string): {
  status: number;
  body: { success: false; error: string; errorCode: string; retryable: boolean };
} {
  const [candidate] = error.split(':', 1);
  const errorCode = /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate.trim()) ? candidate.trim() : 'VENDOR_AUTO_FAILED';
  const retryable = errorCode === 'VENDOR_NOT_IN_GAME'
    || errorCode === 'VENDOR_VITALS_UNKNOWN'
    || errorCode === 'VENDOR_NOT_RUNNING';
  const status = errorCode === 'VENDOR_CHARACTER_DOWN' ? 409
    : errorCode === 'VENDOR_NOT_RUNNING' || errorCode === 'VENDOR_NOT_IN_GAME'
      || errorCode === 'VENDOR_VITALS_UNKNOWN' || errorCode === 'ENGINE_VENDOR_REQUIRED' ? 409 : 400;
  return { status, body: { success: false, error: errorCode, errorCode, retryable } };
}
