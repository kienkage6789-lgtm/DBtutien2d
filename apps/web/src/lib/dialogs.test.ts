import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanMessage,
  confirmAction,
  dismissNotice,
  friendlyErrorMessage,
  getDialogState,
  notify,
  resetDialogsForTest,
  resolveConfirm,
  subscribeDialogs,
} from './dialogs';

describe('dialogs', () => {
  beforeEach(() => { vi.useFakeTimers(); resetDialogsForTest(); });
  afterEach(() => { resetDialogsForTest(); vi.useRealTimers(); });

  it('cleans control characters into spaces before collapsing whitespace', () => {
    expect(cleanMessage('Từ chối\nngắn\u0007 thôi')).toBe('Từ chối ngắn thôi');
    expect(cleanMessage('x'.repeat(500)).length).toBe(240);
    expect(cleanMessage(null)).toBe('');
  });

  it('turns known technical codes into readable Vietnamese and keeps unknown text', () => {
    expect(friendlyErrorMessage('TARGET_ON_PORTAL (HTTP 422): x')).toContain('ô cổng');
    expect(friendlyErrorMessage(new Error('AUTO_ACTIVE'))).toContain('Auto');
    expect(friendlyErrorMessage('không đứng cạnh Đại Phu')).toBe('không đứng cạnh Đại Phu');
    expect(friendlyErrorMessage('')).toBe('Có lỗi không rõ.');
  });

  it('shows a notice, de-duplicates the same message and auto-dismisses it', () => {
    const first = notify('TARGET_UNREACHABLE');
    const second = notify('TARGET_UNREACHABLE');
    expect(second).toBe(first);
    expect(getDialogState().notices).toHaveLength(1);
    expect(getDialogState().notices[0].message).toContain('Không có đường');
    vi.advanceTimersByTime(8_100);
    expect(getDialogState().notices).toHaveLength(0);
  });

  it('keeps at most four notices and can dismiss one by id', () => {
    const ids = [1, 2, 3, 4, 5].map((n) => notify(`lỗi ${n}`, 'info'));
    expect(getDialogState().notices.map((notice) => notice.message)).toEqual(['lỗi 2', 'lỗi 3', 'lỗi 4', 'lỗi 5']);
    dismissNotice(ids[3]);
    expect(getDialogState().notices.map((notice) => notice.message)).toEqual(['lỗi 2', 'lỗi 3', 'lỗi 5']);
  });

  it('resolves confirmations true or false and queues concurrent requests in order', async () => {
    const a = confirmAction('Câu hỏi A');
    const b = confirmAction('Câu hỏi B', { confirmLabel: 'Xóa', danger: true });
    expect(getDialogState().confirm?.message).toBe('Câu hỏi A');
    resolveConfirm(true);
    await expect(a).resolves.toBe(true);
    expect(getDialogState().confirm?.message).toBe('Câu hỏi B');
    expect(getDialogState().confirm?.danger).toBe(true);
    expect(getDialogState().confirm?.confirmLabel).toBe('Xóa');
    resolveConfirm(false);
    await expect(b).resolves.toBe(false);
    expect(getDialogState().confirm).toBeNull();
  });

  it('notifies subscribers on every change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDialogs(listener);
    notify('thông báo', 'success');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notify('thông báo khác', 'success');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
