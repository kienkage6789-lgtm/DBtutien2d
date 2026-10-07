import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly errorCode: string, message: string,
    public readonly retryable = false, public readonly details?: Record<string, unknown>) { super(message); }
}

export function sendError(res: Response, status: number, errorCode: string, message: string,
  extra: { retryable?: boolean; details?: Record<string, unknown> } = {}): void {
  res.status(status).json({ success: false, error: message, errorCode, requestId: res.locals.requestId,
    retryable: extra.retryable ?? false, ...(extra.details ? { details: extra.details } : {}) });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    sendError(res, err.status, err.errorCode, err.message, { retryable: err.retryable, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500;
  const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
  if (status >= 500) console.error(JSON.stringify({ event: 'unhandled_api_error', requestId: res.locals.requestId }));
  sendError(res, status, code, status >= 500 ? 'Lỗi máy chủ nội bộ.' : 'Yêu cầu không hợp lệ.');
}
