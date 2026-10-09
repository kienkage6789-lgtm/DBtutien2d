import WebSocket from 'ws';
import { CONFIG } from '../config.js';
import { createProxyTransport, proxyErrorCode, type ProxyTransportErrorCode } from './proxy-transport.js';
import { redactProxyError } from './proxy-url.js';

export interface ProxyCheckResult {
  status: 'ok' | 'down';
  latencyMs: number | null;
  error: string | null;
  errorCode?: ProxyTransportErrorCode;
}

export interface ProxyCheckerOptions {
  supabaseUrl?: string;
  gameServerUrl?: string;
  timeoutMs?: number;
  now?: () => number;
  transportFactory?: (url: string) => ReturnType<typeof createProxyTransport>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PROXY_TIMEOUT')), timeoutMs);
    timer.unref?.();
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function healthUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/auth/v1/health`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export class ProxyChecker {
  private readonly options: Required<Pick<ProxyCheckerOptions, 'supabaseUrl' | 'gameServerUrl' | 'timeoutMs' | 'now' | 'transportFactory'>>;

  public constructor(options: ProxyCheckerOptions = {}) {
    this.options = {
      supabaseUrl: options.supabaseUrl ?? CONFIG.SUPABASE_URL,
      gameServerUrl: options.gameServerUrl ?? CONFIG.GAME_SERVER_URL,
      timeoutMs: options.timeoutMs ?? CONFIG.PROXY_CHECK_TIMEOUT_MS,
      now: options.now ?? (() => Date.now()),
      transportFactory: options.transportFactory ?? createProxyTransport,
    };
  }

  public async check(proxyUrl: string): Promise<ProxyCheckResult> {
    let transport: ReturnType<typeof createProxyTransport> | undefined;
    const startedAt = this.options.now();
    try {
      transport = this.options.transportFactory(proxyUrl);
      const response = await withTimeout(transport.fetch(healthUrl(this.options.supabaseUrl), {
        method: 'GET',
        headers: { Accept: 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY },
      }), this.options.timeoutMs);
      // Chỉ kiểm tra đường truyền: 2xx-4xx (kể cả 401 khi thiếu khóa) nghĩa là đã tới được Supabase qua proxy; 5xx coi là hỏng.
      if (response.status >= 500) throw new Error(`PROXY_HEALTH_HTTP_${response.status}`);
      await this.checkSocket(transport.WebSocketImpl, this.options.gameServerUrl);
      return { status: 'ok', latencyMs: Math.max(0, this.options.now() - startedAt), error: null };
    } catch (error) {
      const code = proxyErrorCode(error);
      const raw = error instanceof Error ? error.message : String(error);
      return {
        status: 'down',
        latencyMs: null,
        errorCode: code,
        error: code === 'PROXY_TIMEOUT' ? 'Proxy check timed out.' : redactProxyError(raw),
      };
    } finally {
      if (transport) await transport.close().catch(() => undefined);
    }
  }

  private checkSocket(SocketImpl: new (url: string) => WebSocket, url: string): Promise<void> {
    return withTimeout(new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try { socket = new SocketImpl(url); } catch (error) { reject(error); return; }
      const done = (error?: unknown) => {
        socket.removeAllListeners();
        try { socket.close(); } catch { /* already closed */ }
        if (error) reject(error); else resolve();
      };
      socket.once('open', () => done());
      socket.once('error', (error) => done(error));
    }), this.options.timeoutMs);
  }
}
