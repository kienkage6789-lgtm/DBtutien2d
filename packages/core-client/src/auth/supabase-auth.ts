/**
 * Supabase Auth (GoTrue) REST client — mirrors the login flow of the real game client
 * (`src/net/auth.js`): `signInWithPassword` with email `<username>@players.phamnhan.game`.
 *
 * The anon ("publishable") key is PUBLIC by design — the game ships it in `runtime-config.js`.
 */

export const DEFAULT_SUPABASE_URL = 'https://qrheujgqeplgozswcsun.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_v4IGMcr9d15bJCrzq83itw_JfwhpjcZ';
export const PLAYER_EMAIL_DOMAIN = 'players.phamnhan.game';

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS' // wrong username/password — never retry
  | 'REFRESH_INVALID' // refresh token revoked/used — fall back to password login
  | 'RATE_LIMITED' // HTTP 429 — retry later with backoff
  | 'NETWORK' // timeout / 5xx / DNS — retry
  | 'UNKNOWN';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
  /** token lifetime in ms */
  ttlMs: number;
  email: string;
}

export interface SupabaseAuthOptions {
  url?: string;
  anonKey?: string;
  /** HTTP base of the game server, used for the `tim-dang-nhap` email fallback */
  gameApiBase?: string;
  requestTimeoutMs?: number;
}

/** `kienvit` -> `kienvit@players.phamnhan.game`; input that already has `@` is kept. */
export function toEmail(identifier: string): string {
  const v = String(identifier || '').trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${PLAYER_EMAIL_DOMAIN}`;
}

export class SupabaseAuth {
  private readonly url: string;
  private readonly anonKey: string;
  private readonly gameApiBase?: string;
  private readonly timeoutMs: number;

  constructor(options: SupabaseAuthOptions = {}) {
    this.url = (options.url || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    this.anonKey = options.anonKey || DEFAULT_SUPABASE_ANON_KEY;
    this.gameApiBase = options.gameApiBase?.replace(/\/+$/, '');
    this.timeoutMs = options.requestTimeoutMs ?? 15000;
  }

  /** Login with username (đạo hiệu) or real email + password. */
  public async signInWithPassword(identifier: string, password: string): Promise<AuthSession> {
    const email = toEmail(identifier);
    try {
      return await this.tokenRequest('password', { email, password }, email);
    } catch (err) {
      // Real-email accounts: the game resolves the internal login email via the server.
      if (err instanceof AuthError && err.code === 'INVALID_CREDENTIALS' && identifier.includes('@')) {
        const resolved = await this.resolveLoginEmail(email);
        if (resolved && resolved !== email) {
          return await this.tokenRequest('password', { email: resolved, password }, resolved);
        }
      }
      throw err;
    }
  }

  public async refreshSession(refreshToken: string): Promise<AuthSession> {
    return this.tokenRequest('refresh_token', { refresh_token: refreshToken }, '');
  }

  private async resolveLoginEmail(email: string): Promise<string | null> {
    if (!this.gameApiBase) return null;
    try {
      const res = await this.fetchWithTimeout(`${this.gameApiBase}/api/account/tim-dang-nhap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) return null;
      const data: any = await res.json().catch(() => ({}));
      return data?.email ? String(data.email).toLowerCase() : null;
    } catch {
      return null;
    }
  }

  private async tokenRequest(
    grantType: 'password' | 'refresh_token',
    body: Record<string, string>,
    fallbackEmail: string
  ): Promise<AuthSession> {
    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.url}/auth/v1/token?grant_type=${grantType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      throw new AuthError('NETWORK', `Không kết nối được máy chủ xác thực: ${err?.message || err}`, true);
    }

    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw this.mapError(res.status, data, grantType);
    }

    if (!data.access_token || !data.refresh_token) {
      throw new AuthError('UNKNOWN', 'Máy chủ xác thực trả về dữ liệu phiên không hợp lệ.');
    }

    const ttlMs = Math.max(60, Number(data.expires_in) || 3600) * 1000;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      ttlMs,
      expiresAt: data.expires_at ? Number(data.expires_at) * 1000 : Date.now() + ttlMs,
      email: data.user?.email || fallbackEmail,
    };
  }

  private mapError(status: number, data: any, grantType: string): AuthError {
    const code = String(data?.error_code || data?.error || '').toLowerCase();
    const msg = String(data?.msg || data?.error_description || data?.message || `HTTP ${status}`);

    if (status === 429 || code.includes('rate_limit')) {
      return new AuthError('RATE_LIMITED', 'Đăng nhập quá nhiều lần, máy chủ đang giới hạn tốc độ.', true);
    }
    if (status >= 500) {
      return new AuthError('NETWORK', `Máy chủ xác thực đang lỗi (${status}).`, true);
    }
    if (grantType === 'refresh_token') {
      return new AuthError('REFRESH_INVALID', `Refresh token không còn hiệu lực: ${msg}`);
    }
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
      return new AuthError('INVALID_CREDENTIALS', 'Sai đạo hiệu hoặc mật khẩu.');
    }
    if (code === 'email_not_confirmed') {
      return new AuthError('INVALID_CREDENTIALS', 'Tài khoản chưa xác nhận email.');
    }
    return new AuthError('UNKNOWN', msg);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
