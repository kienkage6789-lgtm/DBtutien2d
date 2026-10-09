import { fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent } from 'undici';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { parseProxyUrl, type ParsedProxyUrl, redactProxyError } from './proxy-url.js';

export type ProxyTransportErrorCode = 'PROXY_CONNECT_FAILED' | 'PROXY_AUTH_FAILED' | 'PROXY_TIMEOUT' | 'PROXY_PROTOCOL_ERROR' | 'PROXY_UNAVAILABLE';

export class ProxyTransportError extends Error {
  public constructor(public readonly code: ProxyTransportErrorCode, message: string = code) {
    super(message);
    this.name = 'ProxyTransportError';
  }
}

export interface ProxyTransport {
  fetch: typeof fetch;
  WebSocketImpl: new (url: string) => WebSocket;
  close(): Promise<void>;
  describe(): string;
}

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      const extra = current as Error & { code?: unknown; statusCode?: unknown; status?: unknown };
      if (typeof extra.code === 'string') parts.push(extra.code);
      if (typeof extra.statusCode === 'number' || typeof extra.status === 'number') parts.push(String(extra.statusCode ?? extra.status));
      current = (current as Error & { cause?: unknown }).cause;
    } else { parts.push(String(current)); break; }
  }
  return parts.join(' | ');
}

function classifyProxyError(error: unknown): ProxyTransportError {
  if (error instanceof ProxyTransportError) return error;
  const message = redactProxyError(errorChainText(error));
  const lower = message.toLowerCase();
  if (lower.includes('proxy_auth_failed')) return new ProxyTransportError('PROXY_AUTH_FAILED');
  if (lower.includes('proxy_timeout')) return new ProxyTransportError('PROXY_TIMEOUT');
  if (lower.includes('proxy_protocol_error')) return new ProxyTransportError('PROXY_PROTOCOL_ERROR');
  if (lower.includes('proxy_unavailable')) return new ProxyTransportError('PROXY_UNAVAILABLE');
  if (lower.includes('proxy_connect_failed')) return new ProxyTransportError('PROXY_CONNECT_FAILED');
  if (lower.includes('407') || lower.includes('authentication failed') || lower.includes('socks5_auth') || lower.includes('proxy authentication') || lower.includes('authentication required') || lower.includes('unauthorized')) {
    return new ProxyTransportError('PROXY_AUTH_FAILED', 'Proxy authentication failed.');
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
    return new ProxyTransportError('PROXY_TIMEOUT', 'Proxy connection timed out.');
  }
  if (lower.includes('protocol') || lower.includes('handshake') || lower.includes('invalid response')) {
    return new ProxyTransportError('PROXY_PROTOCOL_ERROR', 'Proxy protocol error.');
  }
  return new ProxyTransportError('PROXY_CONNECT_FAILED', 'Proxy connection failed.');
}

function throwIfProxyResponse(response: Response): Response {
  if (response.status === 407) throw new ProxyTransportError('PROXY_AUTH_FAILED', 'Proxy authentication failed.');
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > 4 * 1024 * 1024) throw new ProxyTransportError('PROXY_PROTOCOL_ERROR', 'Proxy response is too large.');
  return response;
}

export function createProxyTransport(proxyUrl: string): ProxyTransport {
  const parsed = parseProxyUrl(proxyUrl, true);
  const dispatcher = parsed.scheme === 'socks5'
    ? new Socks5ProxyAgent(proxyUrl)
    : new ProxyAgent({ uri: proxyUrl });
  const wsAgent = parsed.scheme === 'socks5'
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);
  let closed = false;

  const transportFetch: typeof fetch = async (input, init) => {
    if (closed) throw new ProxyTransportError('PROXY_UNAVAILABLE', 'Proxy transport is closed.');
    try {
      const response = await undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Record<string, unknown>), dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
      return throwIfProxyResponse(response);
    } catch (error) {
      throw classifyProxyError(error);
    }
  };

  class ProxiedWebSocket extends WebSocket {
    public constructor(url: string) {
      if (closed) throw new ProxyTransportError('PROXY_UNAVAILABLE', 'Proxy transport is closed.');
      super(url, { agent: wsAgent, handshakeTimeout: 15_000, maxPayload: 4 * 1024 * 1024 });
      this.on('error', (error) => {
        const mapped = classifyProxyError(error);
        if (error instanceof Error) error.message = mapped.code;
        this.emit('proxyError', mapped);
      });
    }
  }

  return {
    fetch: transportFetch,
    WebSocketImpl: ProxiedWebSocket,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try { await (dispatcher as unknown as { close?: () => Promise<void> }).close?.(); } catch { /* already closed */ }
      try { (dispatcher as unknown as { destroy?: () => void }).destroy?.(); } catch { /* already closed */ }
      try { (wsAgent as unknown as { destroy?: () => void }).destroy?.(); } catch { /* already closed */ }
    },
    describe: () => parsed.safeLabel,
  };
}

export function proxyErrorCode(error: unknown): ProxyTransportErrorCode {
  return classifyProxyError(error).code;
}

export function parseProxyTransportUrl(proxyUrl: string): ParsedProxyUrl {
  return parseProxyUrl(proxyUrl, true);
}
