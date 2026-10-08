import { describe, expect, it } from 'vitest';
import { formatMoveToStatus, getMoveToLockReason } from './MiniMap';
import type { MoveToOperation } from '../types';

const operation: MoveToOperation = {
  operationId: 'operation-test',
  target: { x: 100, y: 100 },
  resolvedTarget: { x: 112, y: 112 },
  status: 'running',
  requester: 'user',
  startedAt: 1,
  updatedAt: 2,
};

describe('MiniMap move-to gates and status', () => {
  const base = {
    runnerReady: true,
    contextUsable: true,
    khuKnown: true,
    geometryValid: true,
    autoActive: false,
    operation: null,
    requestPending: false,
  };

  it('explains the Auto lock and running-operation lock', () => {
    expect(getMoveToLockReason({ ...base, autoActive: true })).toBe('Tắt Auto để di chuyển bằng tay');
    expect(getMoveToLockReason({ ...base, operation })).toBe('Đang có thao tác di chuyển');
    expect(getMoveToLockReason(base)).toBeNull();
  });

  it('renders terminal status and reason', () => {
    expect(formatMoveToStatus({ ...operation, status: 'arrived' })).toBe('Đã tới đích');
    expect(formatMoveToStatus({ ...operation, status: 'blocked', reason: 'stuck' })).toBe('Bị chặn · stuck');
  });
});
