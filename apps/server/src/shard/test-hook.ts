import type { AuthSession } from '@tutien2d/core-client';
import type { VendorSocketLike } from '../headless/vendor-env.js';

/** Fixed offline fixture. It exposes no module/path loading and is selected only by the test-only env gate. */
export class ShardTestWebSocket implements VendorSocketLike {
  public static readonly CONNECTING = 0; public static readonly OPEN = 1; public static readonly CLOSING = 2; public static readonly CLOSED = 3;
  public readyState = 0;
  public onopen?: (event: unknown) => void; public onmessage?: (event: { data: string }) => void;
  public onerror?: (event: unknown) => void; public onclose?: (event: { code?: number; reason?: string }) => void;
  public constructor(_url: string) { queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
  public send(data: string): void {
    const packet = JSON.parse(data) as { op?: string };
    if (packet.op !== 'hello') return;
    queueMicrotask(() => {
      this.emit({ op: 'welcome', serverTime: Date.now(), hasChar: true, snap: 2, ep: 1 });
      setTimeout(() => {
        this.emit({ op: 'state', save: { realm: 'luyen_khi_8', exp: 0, equipment: {} } });
        this.emit({ op: 'map', mapId: 'tan_vien', khu: 1, soKhu: 1, ep: 1, x: 240, y: 192, dir: 0, p: [] });
        this.emit({ op: 'snap2', full: true, ep: 1, seq: 1, p: [], m: [] });
        this.emit({ op: 'you', seq: 10, x: 240, y: 192, hp: 100, mp: 50, dn: false, fix: true });
      }, 5);
    });
  }
  public close(): void { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000, reason: 'fixture_close' }); }
  private emit(packet: Record<string, unknown>): void { this.onmessage?.({ data: JSON.stringify(packet) }); }
}
export const shardTestTokenManager = {
  getAccessToken: async () => 'offline-fixture-token',
  getSession: (): AuthSession => ({ accessToken: 'offline-fixture-token', refreshToken: 'offline-fixture-refresh', expiresAt: Date.now() + 60_000, ttlMs: 60_000, email: 'fixture@example.invalid' }),
  stop: () => undefined,
  on: () => undefined,
};
