import { EventEmitter } from 'events';
import { AuthError, AuthSession, SupabaseAuth } from './supabase-auth.js';

export interface TokenProvider {
  /** Returns a token that is valid right now (refreshing / re-logging-in when needed). */
  getAccessToken(): Promise<string>;
  /** Mark the current token as rejected by the game server so the next call re-authenticates. */
  invalidate(): void;
  /** True when we can obtain a new token on our own (password or refresh token available). */
  canReauth(): boolean;
}

export interface TokenManagerOptions {
  auth: SupabaseAuth;
  /** username (đạo hiệu) or email */
  identifier: string;
  password?: string;
  /** Previously persisted refresh token — avoids a password login on every restart. */
  refreshToken?: string;
  /** Legacy mode: a fixed JWT pasted by the user (no refresh possible). */
  staticToken?: string;
  /** Refresh when this fraction of the lifetime has elapsed (default 0.8). */
  refreshRatio?: number;
  /** Treat a token as expired this long before the real expiry (default 2 min). */
  skewMs?: number;
  maxNetworkRetries?: number;
}

/**
 * Keeps a valid access token for one account.
 * Events: `sessionUpdated(AuthSession)`, `tokenRefreshed(expiresAt)`, `authFailed(AuthError)`, `log({level,message})`.
 */
export class TokenManager extends EventEmitter implements TokenProvider {
  private session: AuthSession | null = null;
  private inflight: Promise<AuthSession> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private fatal: AuthError | null = null;
  private stopped = false;

  private readonly refreshRatio: number;
  private readonly skewMs: number;
  private readonly maxNetworkRetries: number;
  private refreshToken?: string;

  constructor(private readonly opts: TokenManagerOptions) {
    super();
    this.refreshRatio = opts.refreshRatio ?? 0.8;
    this.skewMs = opts.skewMs ?? 120_000;
    this.maxNetworkRetries = opts.maxNetworkRetries ?? 3;
    this.refreshToken = opts.refreshToken;
  }

  public canReauth(): boolean {
    if (this.fatal?.code === 'INVALID_CREDENTIALS') return false;
    return !!(this.opts.password || this.refreshToken);
  }

  public getSession(): AuthSession | null {
    return this.session;
  }

  public invalidate(): void {
    if (this.opts.staticToken) return;
    if (this.session) this.session = { ...this.session, expiresAt: 0 };
  }

  public async getAccessToken(): Promise<string> {
    if (this.opts.staticToken) return this.opts.staticToken;
    if (this.fatal?.code === 'INVALID_CREDENTIALS') throw this.fatal;

    if (this.session && Date.now() < this.session.expiresAt - this.skewMs) {
      return this.session.accessToken;
    }
    const s = await this.renew();
    return s.accessToken;
  }

  /** Explicitly (re)authenticate now, e.g. when a new password was saved. */
  public async login(): Promise<AuthSession> {
    this.fatal = null;
    this.session = null;
    return this.renew(true);
  }

  public stop(): void {
    this.stopped = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  // ---------------------------------------------------------------- internals

  /** Single-flight so concurrent callers share one network round-trip. */
  private renew(forcePassword = false): Promise<AuthSession> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRenew(forcePassword)
      .then((s) => {
        this.applySession(s);
        return s;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async doRenew(forcePassword: boolean): Promise<AuthSession> {
    // 1) cheap path: refresh token
    if (!forcePassword && this.refreshToken) {
      try {
        return await this.withRetry(() => this.opts.auth.refreshSession(this.refreshToken!));
      } catch (err) {
        if (!(err instanceof AuthError) || (err.code !== 'REFRESH_INVALID' && !err.retryable)) throw err;
        this.log('warn', 'Refresh token không dùng được, đăng nhập lại bằng mật khẩu...');
        this.refreshToken = undefined;
      }
    }

    // 2) password login
    if (!this.opts.password) {
      const e = new AuthError('REFRESH_INVALID', 'Phiên đã hết hạn và chưa lưu mật khẩu để đăng nhập lại.');
      this.fatal = e;
      this.emit('authFailed', e);
      throw e;
    }

    try {
      this.log('info', 'Đang đăng nhập bằng đạo hiệu và mật khẩu...');
      return await this.withRetry(() => this.opts.auth.signInWithPassword(this.opts.identifier, this.opts.password!));
    } catch (err) {
      if (err instanceof AuthError && err.code === 'INVALID_CREDENTIALS') {
        this.fatal = err;
        this.emit('authFailed', err);
      }
      throw err;
    }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        const retryable = err instanceof AuthError && err.retryable;
        if (!retryable || attempt >= this.maxNetworkRetries) throw err;
        const base = err instanceof AuthError && err.code === 'RATE_LIMITED' ? 5000 : 1500;
        const delay = base * 2 ** attempt + Math.floor(Math.random() * 800);
        attempt++;
        this.log('warn', `Xác thực tạm lỗi, thử lại sau ${Math.round(delay / 1000)}s (lần ${attempt})...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private applySession(s: AuthSession): void {
    this.session = s;
    this.refreshToken = s.refreshToken;
    this.fatal = null;
    this.emit('sessionUpdated', s);
    this.scheduleRefresh(s);
  }

  private scheduleRefresh(s: AuthSession): void {
    if (this.stopped) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const delay = Math.max(30_000, Math.floor(s.ttlMs * this.refreshRatio));
    this.refreshTimer = setTimeout(() => {
      this.renew()
        .then((n) => {
          this.log('info', `Đã làm mới token (hết hạn lúc ${new Date(n.expiresAt).toLocaleTimeString()}).`);
          this.emit('tokenRefreshed', n.expiresAt);
        })
        .catch((e) => this.log('warn', `Làm mới token thất bại: ${e?.message || e}`));
    }, delay);
    this.refreshTimer.unref?.();
  }

  private log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    this.emit('log', { level, message });
  }
}
