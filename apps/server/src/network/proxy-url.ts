import net from 'node:net';
import { CONFIG } from '../config.js';

export type ProxyScheme = 'http' | 'socks5';

export interface ParsedProxyUrl {
  scheme: ProxyScheme;
  /** The URL protocol used by the transport. `http` may be `http` or `https`. */
  protocol: 'http' | 'https' | 'socks5' | 'socks5h';
  host: string;
  port: number;
  hasAuth: boolean;
  safeLabel: string;
  /** Stable identity used to reject the same endpoint and username twice. */
  identity: string;
}

const MAX_PROXY_URL_LENGTH = 2048;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

function cleanText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedHost(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateHost(host: string): boolean {
  const lower = normalizedHost(host).toLowerCase();
  if (lower === 'localhost' || lower === '0.0.0.0' || lower === '::' || lower === '::1') return true;
  if (net.isIP(lower) === 4) return isPrivateIpv4(lower);
  if (net.isIP(lower) === 6) return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
  return false;
}

function authorityPort(text: string, protocolLength: number): number | null {
  const authority = text.slice(protocolLength).split(/[/?#]/, 1)[0];
  const at = authority.lastIndexOf('@');
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  let portText = '';
  if (hostPort.startsWith('[')) {
    const closing = hostPort.indexOf(']');
    if (closing < 0 || hostPort[closing + 1] !== ':') return null;
    portText = hostPort.slice(closing + 2);
  } else {
    const colon = hostPort.lastIndexOf(':');
    if (colon < 0) return null;
    portText = hostPort.slice(colon + 1);
  }
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function parseProxyUrl(input: unknown, allowPrivate = CONFIG.ALLOW_PRIVATE_PROXY): ParsedProxyUrl {
  if (typeof input !== 'string') throw new Error('PROXY_URL_INVALID');
  if (input.length > MAX_PROXY_URL_LENGTH || CONTROL_CHARACTERS.test(input)) throw new Error('PROXY_URL_INVALID');
  const text = cleanText(input);
  if (!text || text.length > MAX_PROXY_URL_LENGTH) throw new Error('PROXY_URL_INVALID');

  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error('PROXY_URL_INVALID'); }
  const protocol = parsed.protocol.slice(0, -1).toLowerCase();
  if (protocol !== 'http' && protocol !== 'https' && protocol !== 'socks5' && protocol !== 'socks5h') {
    throw new Error('PROXY_SCHEME_UNSUPPORTED');
  }
  if (parsed.pathname && parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PROXY_URL_INVALID');
  const port = authorityPort(text, protocol.length + 3);
  if (port === null || parsed.port && Number(parsed.port) !== port) throw new Error('PROXY_PORT_INVALID');
  const host = normalizedHost(parsed.hostname);
  if (!host || isPrivateHost(host) && !allowPrivate) throw new Error('PROXY_PRIVATE_HOST');
  const scheme: ProxyScheme = protocol === 'socks5' || protocol === 'socks5h' ? 'socks5' : 'http';
  const displayHost = net.isIP(host) === 6 ? `[${host}]` : host;
  const safeLabel = `${protocol}://${displayHost}:${port}`;
  let username = '';
  try { username = parsed.username ? decodeURIComponent(parsed.username) : ''; } catch { throw new Error('PROXY_URL_INVALID'); }
  const identity = `${scheme}://${username}@${displayHost}:${port}`.toLowerCase();
  return { scheme, protocol: protocol as ParsedProxyUrl['protocol'], host, port, hasAuth: !!parsed.username || !!parsed.password, safeLabel, identity };
}

/** Redacts userinfo from arbitrary text without returning the original secret. */
export function redactProxyUrl(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  try {
    const parsed = parseProxyUrl(text, true);
    return parsed.safeLabel;
  } catch {
    return text
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1<redacted>@')
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }
}

export function redactProxyError(value: unknown): string {
  return redactProxyUrl(value).replace(/(password|passwd|secret|token)\s*[:=]\s*[^\s;]+/gi, '$1=<redacted>').slice(0, 240);
}
