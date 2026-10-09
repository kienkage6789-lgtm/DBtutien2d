import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { decryptSecret, encryptSecret } from '../security/crypto.js';
import { hashPassword, normalizeUsername } from '../security/password.js';
import { DEFAULT_BOT_CONFIG, normalizeBotConfig } from './bot-config.js';
import type { BotConfig } from './bot-config.js';
import { computeGrant, type GrantDuration } from '../security/entitlement.js';
import { redactProxyUrl, type ProxyScheme } from '../network/proxy-url.js';

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

export interface DbUser {
  id: string;
  username: string;
  /** Kept for compatibility with the old JSON shape; new users do not need an email. */
  email?: string | null;
  role: UserRole;
  status: UserStatus;
  expiresAt: number | null;
  maxBots: number;
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string | null;
  lastLoginAt: string | null;
}

export interface PublicDbUser extends Omit<DbUser, 'createdBy'> {
  createdBy?: string | null;
}

export interface DbSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  ip: string | null;
  userAgent: string | null;
}

export interface DbGameAccount {
  id: string;
  /** Owner id. `userId` remains as a source-compatible alias for old callers. */
  userId: string;
  ownerId: string;
  accountName: string;
  /** AES-256-GCM encrypted password (đạo hiệu login). */
  encryptedPassword?: string | null;
  /** AES-256-GCM encrypted Supabase refresh token (rotated automatically). */
  encryptedRefreshToken?: string | null;
  /** Legacy: pasted JWT. Only used when no password is stored. */
  encryptedToken?: string | null;
  proxyId: string | null;
  status: 'stopped' | 'running' | 'error';
  /** Last authentication error shown on the dashboard (null when fine). */
  authError?: string | null;
  characterName?: string | null;
  realm?: string | null;
  stones: number;
  createdAt: string;
  updatedAt: string;
}

/** Account shape that is safe to send to the browser — never contains secrets. */
export type PublicGameAccount = Omit<
  DbGameAccount,
  'encryptedPassword' | 'encryptedRefreshToken' | 'encryptedToken' | 'proxyId'
> & { hasPassword: boolean; hasLegacyToken: boolean };

export type ProxyStatus = 'unknown' | 'ok' | 'down';

export interface DbProxy {
  id: string;
  label: string;
  scheme: ProxyScheme;
  urlEncrypted: string;
  maxAccounts: number;
  enabled: boolean;
  status: ProxyStatus;
  lastCheckAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface DbProxyAccount {
  id: string;
  accountName: string;
  ownerUsername: string;
  running: boolean;
}

export interface PublicProxy extends Omit<DbProxy, 'urlEncrypted' | 'createdBy'> {
  endpoint: string;
  hasAuth: boolean;
  assigned: number;
  accounts: DbProxyAccount[];
  createdBy?: string | null;
}

export interface DbLog {
  id: string;
  accountId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  module: string;
  message: string;
}

export interface AuditLogInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  detail?: string;
  at?: number;
}

export interface DbAuditLog {
  id: string;
  at: number;
  action: string;
  actor: { id: string; username: string } | null;
  targetType: string;
  targetId: string | null;
  targetName?: string;
  detail: string;
}

export interface DbGrant {
  id: string;
  userId: string;
  grantedBy: string;
  duration: GrantDuration;
  fromAt: number;
  toAt: number;
  createdAt: number;
}

export interface DbUsage {
  accounts: number;
  running: number;
  maxBots: number;
}

export interface UserUpdates {
  status?: UserStatus;
  maxBots?: number;
  mustChangePassword?: boolean;
  expiresAt?: number | null;
  lastLoginAt?: number | null;
}

const USER_COLUMNS = `
  id, username, email, role, status, expires_at, max_bots,
  must_change_password, created_at, created_by, last_login_at
`;

const cleanText = (value: unknown, maxLength: number): string => {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

const toMs = (value: unknown, fallback = Date.now()): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const iso = (value: unknown): string => new Date(toMs(value)).toISOString();

export class DatabaseService {
  private readonly dataDir: string;
  private readonly dbPath: string;
  private readonly legacyPath: string;
  private readonly sqlite: DatabaseSync;
  private readonly maxLogs = 2000;

  constructor(dataDir: string = CONFIG.DATA_DIR) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
    try { fs.chmodSync(this.dataDir, 0o700); } catch { /* Windows does not enforce Unix modes. */ }
    this.dbPath = path.join(this.dataDir, 'tutien_db.sqlite');
    this.legacyPath = path.join(this.dataDir, 'tutien_db.json');
    this.sqlite = new DatabaseSync(this.dbPath);
    try { fs.chmodSync(this.dbPath, 0o600); } catch { /* Windows does not enforce Unix modes. */ }
    this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.createSchema();
    this.ensureInitialAdmin();
    this.migrateLegacyJson();
    this.resetRunningAccountStatuses();
  }

  private createSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        expires_at INTEGER,
        max_bots INTEGER NOT NULL DEFAULT 3,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        last_login_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_user_created_idx ON sessions(user_id, created_at);
      CREATE TABLE IF NOT EXISTS game_accounts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        encrypted_password TEXT,
        encrypted_refresh_token TEXT,
        encrypted_token TEXT,
        proxy_url_encrypted TEXT,
        proxy_id TEXT REFERENCES proxies(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('stopped', 'running', 'error')),
        auth_error TEXT,
        character_name TEXT,
        realm TEXT,
        stones INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS game_accounts_owner_idx ON game_accounts(owner_id);
      CREATE TABLE IF NOT EXISTS proxies (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        scheme TEXT NOT NULL CHECK (scheme IN ('http', 'socks5')),
        url_encrypted TEXT NOT NULL,
        max_accounts INTEGER NOT NULL DEFAULT 1 CHECK (max_accounts BETWEEN 1 AND 1000),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'ok', 'down')),
        last_check_at INTEGER,
        last_latency_ms INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS proxies_enabled_idx ON proxies(enabled, status);
      CREATE TABLE IF NOT EXISTS bot_configs (
        account_id TEXT PRIMARY KEY REFERENCES game_accounts(id) ON DELETE CASCADE,
        config_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'success')),
        module TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS logs_account_timestamp_idx ON logs(account_id, timestamp);
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        detail TEXT,
        at INTEGER NOT NULL,
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log(at);
      CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        duration TEXT NOT NULL CHECK (duration IN ('1d', '7d', '30d', 'custom')),
        from_at INTEGER NOT NULL,
        to_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS grants_user_created_idx ON grants(user_id, created_at);
    `);
    const accountColumns = this.queryAll<{ name: string }>('PRAGMA table_info(game_accounts)');
    if (!accountColumns.some((column) => column.name === 'proxy_id')) {
      this.sqlite.exec('ALTER TABLE game_accounts ADD COLUMN proxy_id TEXT REFERENCES proxies(id) ON DELETE RESTRICT');
    }
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS game_accounts_proxy_idx ON game_accounts(proxy_id)');
    const legacyProxyCount = this.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM game_accounts WHERE proxy_url_encrypted IS NOT NULL AND TRIM(proxy_url_encrypted) <> ''",
    )?.count ?? 0;
    if (Number(legacyProxyCount) > 0) {
      console.warn(`[TuTien2D DB] Bỏ qua ${legacyProxyCount} giá trị proxy legacy; không tự động tạo proxy.`);
    }
  }

  private queryOne<T>(sql: string, ...params: Array<string | number | null>): T | undefined {
    return this.sqlite.prepare(sql).get(...params) as T | undefined;
  }

  private queryAll<T>(sql: string, ...params: Array<string | number | null>): T[] {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, ...params: Array<string | number | null>): void {
    this.sqlite.prepare(sql).run(...params);
  }

  private transaction<T>(fn: () => T): T {
    this.sqlite.exec('BEGIN');
    try {
      const result = fn();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  private mapUser(row: Record<string, unknown>): DbUser {
    return {
      id: String(row.id),
      username: String(row.username),
      email: row.email === null || row.email === undefined ? null : String(row.email),
      role: row.role === 'admin' ? 'admin' : 'user',
      status: row.status === 'disabled' ? 'disabled' : 'active',
      expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
      maxBots: Number.isInteger(row.max_bots) ? Number(row.max_bots) : 3,
      mustChangePassword: Number(row.must_change_password) === 1,
      createdAt: iso(row.created_at),
      createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
      lastLoginAt: row.last_login_at === null || row.last_login_at === undefined ? null : iso(row.last_login_at),
    };
  }

  private mapAccount(row: Record<string, unknown>): DbGameAccount {
    const ownerId = String(row.owner_id);
    return {
      id: String(row.id),
      userId: ownerId,
      ownerId,
      accountName: String(row.account_name),
      encryptedPassword: row.encrypted_password === null ? null : String(row.encrypted_password ?? ''),
      encryptedRefreshToken: row.encrypted_refresh_token === null ? null : String(row.encrypted_refresh_token ?? ''),
      encryptedToken: row.encrypted_token === null ? null : String(row.encrypted_token ?? ''),
      proxyId: row.proxy_id === null || row.proxy_id === undefined ? null : String(row.proxy_id),
      status: row.status === 'running' || row.status === 'error' ? row.status : 'stopped',
      authError: row.auth_error === null ? null : String(row.auth_error ?? ''),
      characterName: row.character_name === null ? null : String(row.character_name ?? ''),
      realm: row.realm === null ? null : String(row.realm ?? ''),
      stones: Number.isFinite(Number(row.stones)) ? Number(row.stones) : 0,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  private ensureInitialAdmin(): void {
    const existing = this.queryOne<Record<string, unknown>>("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
    if (!existing) {
      const now = Date.now();
      this.run(
        `INSERT INTO users (id, username, password_hash, role, status, expires_at, max_bots, must_change_password, created_at)
         VALUES (?, ?, ?, 'admin', 'active', NULL, 3, 1, ?)`,
        `usr_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
        normalizeUsername(CONFIG.ADMIN_USERNAME),
        hashPassword(CONFIG.ADMIN_PASSWORD),
        now,
      );
    }
    const admin = this.queryOne<Record<string, unknown>>(`SELECT ${USER_COLUMNS} FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
    if (admin && Number(admin.must_change_password) === 1) {
      console.warn('[TuTien2D Server] Tài khoản quản trị vẫn yêu cầu đổi mật khẩu ban đầu.');
    }
  }

  private migrateLegacyJson(): void {
    if (!fs.existsSync(this.legacyPath) || fs.existsSync(`${this.legacyPath}.migrated`)) return;
    const hasRows = this.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM game_accounts')?.count ?? 0;
    if (Number(hasRows) > 0) return;

    let parsed: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(this.legacyPath, 'utf8');
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      parsed = value as Record<string, unknown>;
    } catch {
      console.error('[TuTien2D Server] Không thể di chuyển tutien_db.json; file cũ được giữ nguyên.');
      return;
    }

    const admin = this.queryOne<{ id: string }>("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
    if (!admin) return;
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    const botConfigs = parsed.botConfigs && typeof parsed.botConfigs === 'object' && !Array.isArray(parsed.botConfigs)
      ? parsed.botConfigs as Record<string, unknown> : {};
    const logs = Array.isArray(parsed.logs) ? parsed.logs : [];
    const legacyProxyFields = accounts.filter((item) => item && typeof item === 'object' && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).proxyUrl === 'string'
      && String((item as Record<string, unknown>).proxyUrl).trim().length > 0).length;
    if (legacyProxyFields > 0) {
      console.warn(`[TuTien2D DB] Bỏ qua ${legacyProxyFields} trường proxy legacy trong JSON; không tự động tạo proxy.`);
    }


    try {
      this.transaction(() => {
        for (const rawAccount of accounts) {
          if (!rawAccount || typeof rawAccount !== 'object' || Array.isArray(rawAccount)) continue;
          const source = rawAccount as Record<string, unknown>;
          const accountName = cleanText(source.accountName, 128);
          if (!accountName) continue;
          const id = typeof source.id === 'string' && source.id ? source.id : `acc_${crypto.randomUUID().slice(0, 8)}`;

          this.run(
            `INSERT OR IGNORE INTO game_accounts
             (id, owner_id, account_name, encrypted_password, encrypted_refresh_token, encrypted_token,
              status, auth_error, character_name, realm, stones, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            admin.id,
            accountName,
            typeof source.encryptedPassword === 'string' ? source.encryptedPassword : null,
            typeof source.encryptedRefreshToken === 'string' ? source.encryptedRefreshToken : null,
            typeof source.encryptedToken === 'string' ? source.encryptedToken : null,
             source.status === 'running' || source.status === 'error' ? source.status : 'stopped',
            typeof source.authError === 'string' ? cleanText(source.authError, 240) : null,
            typeof source.characterName === 'string' ? cleanText(source.characterName, 128) : null,
            typeof source.realm === 'string' ? cleanText(source.realm, 128) : null,
            Number.isFinite(Number(source.stones)) ? Number(source.stones) : 0,
            toMs(source.createdAt),
            toMs(source.updatedAt),
          );
          const config = normalizeBotConfig(botConfigs[id]);
          this.run('INSERT OR IGNORE INTO bot_configs (account_id, config_json) VALUES (?, ?)', id, JSON.stringify(config));
        }
        for (const rawLog of logs) {
          if (!rawLog || typeof rawLog !== 'object' || Array.isArray(rawLog)) continue;
          const source = rawLog as Record<string, unknown>;
          const accountId = typeof source.accountId === 'string' ? source.accountId : '';
          const message = cleanText(source.message, 500);
          if (!accountId || !message) continue;
          this.run(
            'INSERT OR IGNORE INTO logs (id, account_id, timestamp, level, module, message) VALUES (?, ?, ?, ?, ?, ?)',
            typeof source.id === 'string' && source.id ? source.id : `log_${crypto.randomUUID()}`,
            accountId,
            toMs(source.timestamp),
            source.level === 'warn' || source.level === 'error' || source.level === 'success' ? source.level : 'info',
            cleanText(source.module, 80),
            message,
          );
        }
        this.trimLogs();
      });
      try {
        fs.renameSync(this.legacyPath, `${this.legacyPath}.migrated`);
      } catch {
        console.warn('[TuTien2D Server] Đã nhập dữ liệu cũ nhưng chưa đổi tên được tutien_db.json.');
      }
    } catch {
      console.error('[TuTien2D Server] Di chuyển tutien_db.json thất bại; file cũ được giữ nguyên.');
    }
  }

  private trimLogs(): void {
    this.run(`DELETE FROM logs WHERE id IN (
      SELECT id FROM logs ORDER BY timestamp DESC, rowid DESC LIMIT -1 OFFSET ?
    )`, this.maxLogs);
  }

  private resetRunningAccountStatuses(): void {
    // Vendor sessions are never restored from SQLite after a process restart.
    // Clear the persisted display state so usage does not count stale runners.
    this.run("UPDATE game_accounts SET status = 'stopped', updated_at = ? WHERE status = 'running'", Date.now());
  }

  public flush(): void {
    this.sqlite.exec('PRAGMA wal_checkpoint(PASSIVE);');
  }

  /** Test/process hook; normal shutdown uses `flush()` and lets the process close SQLite. */
  public close(): void {
    this.sqlite.close();
  }

  /** Safe operational metrics; never returns the database path or stored values. */
  public getDatabaseSizeBytes(): number {
    try { return fs.statSync(this.dbPath).size; } catch { return 0; }
  }

  public getUserCount(): number {
    return Number(this.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0);
  }

  public getAccountCount(): number {
    return Number(this.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM game_accounts')?.count ?? 0);
  }

  // --- USERS / SESSIONS ---
  public getUsers(): DbUser[] {
    return this.queryAll<Record<string, unknown>>(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at, id`).map((row) => this.mapUser(row));
  }

  public getUserById(id: string): DbUser | undefined {
    const row = this.queryOne<Record<string, unknown>>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, id);
    return row ? this.mapUser(row) : undefined;
  }

  public getUserByUsername(username: string): DbUser | undefined {
    const row = this.queryOne<Record<string, unknown>>(`SELECT ${USER_COLUMNS} FROM users WHERE username = ? COLLATE NOCASE`, normalizeUsername(username));
    return row ? this.mapUser(row) : undefined;
  }

  public getPasswordHash(userId: string): string | undefined {
    return this.queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId)?.password_hash;
  }

  public createUser(username: string, passwordHash: string, options: { role?: UserRole; maxBots?: number; createdBy?: string | null } = {}): DbUser {
    const normalized = normalizeUsername(username);
    if (!normalized || normalized.length > 64) throw new Error('USERNAME_INVALID');
    const id = `usr_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const maxBots = options.maxBots ?? 3;
    if (!Number.isInteger(maxBots) || maxBots < 0 || maxBots > 1000) throw new Error('MAX_BOTS_INVALID');
    this.run(
      `INSERT INTO users (id, username, password_hash, role, status, expires_at, max_bots, must_change_password, created_at, created_by)
       VALUES (?, ?, ?, ?, 'active', NULL, ?, 0, ?, ?)`,
      id, normalized, passwordHash, options.role ?? 'user', maxBots, Date.now(), options.createdBy ?? null,
    );
    return this.getUserById(id)!;
  }

  public updateUser(userId: string, updates: UserUpdates): DbUser | undefined {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
    if (updates.maxBots !== undefined) {
      if (!Number.isInteger(updates.maxBots) || updates.maxBots < 0 || updates.maxBots > 1000) throw new Error('MAX_BOTS_INVALID');
      sets.push('max_bots = ?'); params.push(updates.maxBots);
    }
    if (updates.mustChangePassword !== undefined) { sets.push('must_change_password = ?'); params.push(updates.mustChangePassword ? 1 : 0); }
    if (updates.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(updates.expiresAt); }
    if (updates.lastLoginAt !== undefined) { sets.push('last_login_at = ?'); params.push(updates.lastLoginAt); }
    if (sets.length > 0) {
      params.push(userId);
      this.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params);
    }
    return this.getUserById(userId);
  }

  public setPassword(userId: string, passwordHash: string, mustChangePassword = false): void {
    this.run('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', passwordHash, mustChangePassword ? 1 : 0, userId);
  }

  public countAdmins(): number {
    return Number(this.queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'")?.count ?? 0);
  }

  public createSession(session: DbSession): void {
    this.transaction(() => {
      this.run(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt, session.lastSeenAt, session.ip, session.userAgent,
      );
      const old = this.queryAll<{ id: string }>('SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET 5', session.userId);
      for (const row of old) this.run('DELETE FROM sessions WHERE id = ?', row.id);
    });
  }

  public getSessionByHash(tokenHash: string): DbSession | undefined {
    const row = this.queryOne<Record<string, unknown>>('SELECT id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent FROM sessions WHERE token_hash = ?', tokenHash);
    if (!row) return undefined;
    return {
      id: String(row.id), userId: String(row.user_id), tokenHash: String(row.token_hash), createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at), lastSeenAt: Number(row.last_seen_at),
      ip: row.ip === null ? null : String(row.ip), userAgent: row.user_agent === null ? null : String(row.user_agent),
    };
  }

  public touchSession(id: string, now: number, expiresAt: number): void {
    this.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', now, expiresAt, id);
  }

  public deleteSession(id: string): void {
    this.run('DELETE FROM sessions WHERE id = ?', id);
  }

  public revokeUserSessions(userId: string, exceptSessionId?: string): void {
    if (exceptSessionId) this.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, exceptSessionId);
    else this.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  public getActiveSessionCount(userId: string, now = Date.now()): number {
    return Number(this.queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND expires_at > ?',
      userId, now,
    )?.count ?? 0);
  }

  public getSessionCount(userId: string): number {
    return Number(this.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', userId)?.count ?? 0);
  }

  public getOwnerId(accountId: string): string | undefined {
    return this.queryOne<{ owner_id: string }>('SELECT owner_id FROM game_accounts WHERE id = ?', accountId)?.owner_id;
  }

  public addAuditLog(input: AuditLogInput): void {
    this.run(
      'INSERT INTO audit_log (id, actor_id, action, target_type, target_id, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `audit_${crypto.randomUUID()}`,
      input.actorId,
      cleanText(input.action, 80),
      cleanText(input.targetType, 80),
      input.targetId ? cleanText(input.targetId, 128) : null,
      input.detail ? cleanText(input.detail, 500) : null,
      input.at ?? Date.now(),
    );
  }

  public getAuditLogs(limit = 50, before?: number): DbAuditLog[] {
    const safeLimit = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 200) : 50;
    const rows = before === undefined
      ? this.queryAll<Record<string, unknown>>(`
          SELECT a.id, a.at, a.action, a.actor_id, actor.username AS actor_username,
                 a.target_type, a.target_id, target_user.username AS target_user_name,
                 target_account.account_name AS target_account_name, a.detail
          FROM audit_log a
          LEFT JOIN users actor ON actor.id = a.actor_id
          LEFT JOIN users target_user ON a.target_type = 'user' AND target_user.id = a.target_id
          LEFT JOIN game_accounts target_account ON a.target_type = 'account' AND target_account.id = a.target_id
          ORDER BY a.at DESC, a.rowid DESC
          LIMIT ?`, safeLimit)
      : this.queryAll<Record<string, unknown>>(`
          SELECT a.id, a.at, a.action, a.actor_id, actor.username AS actor_username,
                 a.target_type, a.target_id, target_user.username AS target_user_name,
                 target_account.account_name AS target_account_name, a.detail
          FROM audit_log a
          LEFT JOIN users actor ON actor.id = a.actor_id
          LEFT JOIN users target_user ON a.target_type = 'user' AND target_user.id = a.target_id
          LEFT JOIN game_accounts target_account ON a.target_type = 'account' AND target_account.id = a.target_id
          WHERE a.at < ?
          ORDER BY a.at DESC, a.rowid DESC
          LIMIT ?`, before, safeLimit);

    return rows.map((row) => {
      const actorId = row.actor_id === null || row.actor_id === undefined ? null : String(row.actor_id);
      const actorUsername = row.actor_username === null || row.actor_username === undefined ? null : cleanText(row.actor_username, 64);
      const userTargetName = row.target_user_name === null || row.target_user_name === undefined ? undefined : cleanText(row.target_user_name, 64);
      const accountTargetName = row.target_account_name === null || row.target_account_name === undefined ? undefined : cleanText(row.target_account_name, 128);
      return {
        id: cleanText(row.id, 128),
        at: Number(row.at),
        action: cleanText(row.action, 80),
        actor: actorId && actorUsername ? { id: actorId, username: actorUsername } : null,
        targetType: cleanText(row.target_type, 80),
        targetId: row.target_id === null || row.target_id === undefined ? null : cleanText(row.target_id, 128),
        ...(userTargetName ? { targetName: userTargetName } : accountTargetName ? { targetName: accountTargetName } : {}),
        detail: row.detail === null || row.detail === undefined ? '' : cleanText(row.detail, 500),
      } satisfies DbAuditLog;
    });
  }

  public grantUser(userId: string, grantedBy: string, duration: GrantDuration, now: number): { user: DbUser; grant: DbGrant } {
    return this.transaction(() => {
      const row = this.queryOne<{ expires_at: number | null; role: string; status: string }>('SELECT expires_at, role, status FROM users WHERE id = ?', userId);
      if (!row) throw new Error('USER_NOT_FOUND');
      if (row.role === 'admin') throw new Error('ADMIN_NOT_EXPIRING');
      if (row.status === 'disabled') throw new Error('USER_DISABLED');
      const computed = computeGrant(row.expires_at === null ? null : Number(row.expires_at), now, duration);
      const grant: DbGrant = {
        id: `grant_${crypto.randomUUID()}`,
        userId,
        grantedBy,
        duration,
        fromAt: computed.from,
        toAt: computed.to,
        createdAt: now,
      };
      this.run(
        'INSERT INTO grants (id, user_id, granted_by, duration, from_at, to_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        grant.id, grant.userId, grant.grantedBy, grant.duration, grant.fromAt, grant.toAt, grant.createdAt,
      );
      this.run('UPDATE users SET expires_at = ? WHERE id = ?', grant.toAt, userId);
      return { user: this.getUserById(userId)!, grant };
    });
  }

  public setUserExpiry(userId: string, expiresAt: number | null): DbUser | undefined {
    this.run('UPDATE users SET expires_at = ? WHERE id = ?', expiresAt, userId);
    return this.getUserById(userId);
  }

  public getGrants(userId?: string): DbGrant[] {
    const rows = userId
      ? this.queryAll<Record<string, unknown>>('SELECT id, user_id, granted_by, duration, from_at, to_at, created_at FROM grants WHERE user_id = ? ORDER BY created_at, id', userId)
      : this.queryAll<Record<string, unknown>>('SELECT id, user_id, granted_by, duration, from_at, to_at, created_at FROM grants ORDER BY created_at, id');
    return rows.map((row) => ({
      id: String(row.id), userId: String(row.user_id), grantedBy: String(row.granted_by),
      duration: row.duration as GrantDuration, fromAt: Number(row.from_at), toAt: Number(row.to_at), createdAt: Number(row.created_at),
    }));
  }

  public getUserUsage(userId: string): DbUsage {
    const user = this.getUserById(userId);
    const row = this.queryOne<{ accounts: number; running: number }>(
      "SELECT COUNT(*) AS accounts, SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running FROM game_accounts WHERE owner_id = ?",
      userId,
    );
    return {
      accounts: Number(row?.accounts ?? 0),
      running: Number(row?.running ?? 0),
      maxBots: user?.maxBots ?? 0,
    };
  }

  public deleteUserCascade(userId: string): boolean {
    return this.transaction(() => {
      const exists = this.queryOne<{ id: string }>('SELECT id FROM users WHERE id = ?', userId);
      if (!exists) return false;
      this.run('DELETE FROM users WHERE id = ?', userId);
      return true;
    });
  }

  // --- ACCOUNTS ---
  public toPublic(acc: DbGameAccount): PublicGameAccount {
    const { encryptedPassword, encryptedRefreshToken, encryptedToken, proxyId, ...rest } = acc;
    return { ...rest, hasPassword: !!encryptedPassword, hasLegacyToken: !!encryptedToken };
  }

  public getAccounts(ownerId?: string): DbGameAccount[] {
    const rows = ownerId
      ? this.queryAll<Record<string, unknown>>('SELECT * FROM game_accounts WHERE owner_id = ? ORDER BY created_at, id', ownerId)
      : this.queryAll<Record<string, unknown>>('SELECT * FROM game_accounts ORDER BY created_at, id');
    return rows.map((row) => this.mapAccount(row));
  }

  public getPublicAccounts(ownerId?: string): PublicGameAccount[] {
    return this.getAccounts(ownerId).map((account) => this.toPublic(account));
  }

  public getAccountById(id: string): DbGameAccount | undefined {
    const row = this.queryOne<Record<string, unknown>>('SELECT * FROM game_accounts WHERE id = ?', id);
    return row ? this.mapAccount(row) : undefined;
  }

  public findByName(accountName: string): DbGameAccount | undefined {
    const normalized = cleanText(accountName, 128);
    const row = this.queryOne<Record<string, unknown>>('SELECT * FROM game_accounts WHERE account_name = ? COLLATE NOCASE', normalized);
    return row ? this.mapAccount(row) : undefined;
  }

  public createAccount(
    accountName: string,
    credentials: { password?: string; refreshToken?: string; legacyToken?: string },
    legacyIgnoredProxyUrlOrOwnerId?: string | null,
    ownerId?: string,
    options: { enforceQuota?: boolean; proxyId?: string | null; requireProxy?: boolean } = {},
  ): DbGameAccount {
    const normalizedName = cleanText(accountName, 128);
    if (!normalizedName) throw new Error('ACCOUNT_NAME_REQUIRED');
    if (this.findByName(normalizedName)) throw new Error(`Tài khoản "${normalizedName}" đã tồn tại trong hệ thống.`);
    const owner = ownerId || (legacyIgnoredProxyUrlOrOwnerId && !legacyIgnoredProxyUrlOrOwnerId.startsWith('http') && !legacyIgnoredProxyUrlOrOwnerId.startsWith('socks')
      ? legacyIgnoredProxyUrlOrOwnerId : undefined)
      || this.queryOne<{ id: string }>("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")?.id;
    if (!owner) throw new Error('OWNER_NOT_FOUND');
    const id = `acc_${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const assignedProxyId = this.transaction(() => {
      if (options.enforceQuota) {
        const quota = this.queryOne<{ max_bots: number; accounts: number }>(
          'SELECT u.max_bots, COUNT(a.id) AS accounts FROM users u LEFT JOIN game_accounts a ON a.owner_id = u.id WHERE u.id = ? GROUP BY u.id',
          owner,
        );
        if (!quota) throw new Error('OWNER_NOT_FOUND');
        if (Number(quota.accounts) >= Number(quota.max_bots)) throw new Error('QUOTA_BOTS');
      }
      let selectedProxyId = options.proxyId ?? null;
      if (selectedProxyId === null && options.proxyId === undefined && CONFIG.AUTO_ASSIGN_PROXY) {
        const candidate = this.queryOne<{ id: string }>(
          `SELECT p.id FROM proxies p
           WHERE p.enabled = 1 AND p.status <> 'down'
             AND (SELECT COUNT(*) FROM game_accounts a WHERE a.proxy_id = p.id) < p.max_accounts
           ORDER BY (SELECT COUNT(*) FROM game_accounts a WHERE a.proxy_id = p.id), p.id LIMIT 1`,
        );
        selectedProxyId = candidate?.id ?? null;
      }
      if (options.requireProxy && !selectedProxyId) throw new Error('NO_PROXY_AVAILABLE');
      if (selectedProxyId) {
        const proxy = this.queryOne<{ id: string; enabled: number; status: string; max_accounts: number }>('SELECT id, enabled, status, max_accounts FROM proxies WHERE id = ?', selectedProxyId);
        if (!proxy) throw new Error('PROXY_NOT_FOUND');
        if (Number(proxy.enabled) !== 1) throw new Error('PROXY_DISABLED');
        if (proxy.status === 'down') throw new Error('NO_PROXY_AVAILABLE');
        const used = Number(this.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM game_accounts WHERE proxy_id = ?', selectedProxyId)?.count ?? 0);
        if (used >= Number(proxy.max_accounts)) throw new Error('NO_PROXY_AVAILABLE');
      }
      this.run(
        `INSERT INTO game_accounts
         (id, owner_id, account_name, encrypted_password, encrypted_refresh_token, encrypted_token,
          proxy_id, status, auth_error, character_name, realm, stones, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'stopped', NULL, ?, ?, 0, ?, ?)`,
        id,
        owner,
        normalizedName,
        credentials.password ? encryptSecret(credentials.password) : null,
        credentials.refreshToken ? encryptSecret(credentials.refreshToken) : null,
        credentials.legacyToken ? encryptSecret(credentials.legacyToken) : null,
        selectedProxyId,
        normalizedName,
        'Phàm Nhân',
        now,
        now,
      );
      this.run('INSERT INTO bot_configs (account_id, config_json) VALUES (?, ?)', id, JSON.stringify(DEFAULT_BOT_CONFIG));
      return selectedProxyId;
    });
    return this.getAccountById(id)!;
  }

  public updateAccount(id: string, updates: Partial<DbGameAccount>): DbGameAccount | null {
    const existing = this.getAccountById(id);
    if (!existing) return null;
    const columns: Array<[string, string, unknown]> = [
      ['status', 'status', updates.status], ['authError', 'auth_error', updates.authError],
      ['characterName', 'character_name', updates.characterName], ['realm', 'realm', updates.realm],
      ['stones', 'stones', updates.stones], ['proxyId', 'proxy_id', updates.proxyId],
    ];
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    for (const [key, column, value] of columns) {
      if (value === undefined || key === 'proxyId' && value === existing.proxyId) continue;
      sets.push(`${column} = ?`);
      const safeValue = typeof value === 'string'
        ? cleanText(value, key === 'authError' ? 240 : 128)
        : value as string | number | null;
      params.push(safeValue);
    }
    if (sets.length > 0) {
      params.push(Date.now(), id);
      this.run(`UPDATE game_accounts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params);
    }
    return this.getAccountById(id) ?? null;
  }

  /** Persist new credentials (encrypted). Pass `null` to clear a field. */
  public updateCredentials(
    id: string,
    creds: { password?: string | null; refreshToken?: string | null },
  ): DbGameAccount | null {
    const acc = this.getAccountById(id);
    if (!acc) return null;
    const sets: string[] = [];
    const params: Array<string | null> = [];
    if (creds.password !== undefined) {
      sets.push('encrypted_password = ?', 'encrypted_token = ?');
      params.push(creds.password ? encryptSecret(creds.password) : null, creds.password ? null : acc.encryptedToken ?? null);
    }
    if (creds.refreshToken !== undefined) {
      sets.push('encrypted_refresh_token = ?');
      params.push(creds.refreshToken ? encryptSecret(creds.refreshToken) : null);
    }
    if (sets.length > 0) {
      params.push(String(Date.now()), id);
      this.run(`UPDATE game_accounts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params);
    }
    return this.getAccountById(id) ?? null;
  }

  /** Decrypt stored credentials for the worker. Never expose the result outside the server. */
  public getCredentials(id: string): { password?: string; refreshToken?: string; legacyToken?: string } {
    const acc = this.getAccountById(id);
    const out: { password?: string; refreshToken?: string; legacyToken?: string } = {};
    if (!acc) return out;
    const tryDecrypt = (value?: string | null): string | undefined => {
      if (!value) return undefined;
      try { return decryptSecret(value); } catch { return undefined; }
    };
    out.password = tryDecrypt(acc.encryptedPassword);
    out.refreshToken = tryDecrypt(acc.encryptedRefreshToken);
    out.legacyToken = tryDecrypt(acc.encryptedToken);
    return out;
  }

  public deleteAccount(id: string): boolean {
    const before = this.getAccountById(id);
    if (!before) return false;
    this.run('DELETE FROM game_accounts WHERE id = ?', id);
    return true;
  }

  // --- PROXIES ---
  private mapProxy(row: Record<string, unknown>): DbProxy {
    return {
      id: String(row.id),
      label: cleanText(row.label, 64),
      scheme: row.scheme === 'socks5' ? 'socks5' : 'http',
      urlEncrypted: String(row.url_encrypted ?? ''),
      maxAccounts: Number(row.max_accounts),
      enabled: Number(row.enabled) === 1,
      status: row.status === 'ok' || row.status === 'down' ? row.status : 'unknown',
      lastCheckAt: row.last_check_at === null || row.last_check_at === undefined ? null : Number(row.last_check_at),
      lastLatencyMs: row.last_latency_ms === null || row.last_latency_ms === undefined ? null : Number(row.last_latency_ms),
      lastError: row.last_error === null || row.last_error === undefined ? null : cleanText(row.last_error, 240),
      createdAt: iso(row.created_at),
      createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    };
  }

  public getProxies(): DbProxy[] {
    return this.queryAll<Record<string, unknown>>('SELECT * FROM proxies ORDER BY id').map((row) => this.mapProxy(row));
  }

  public getProxyById(id: string): DbProxy | undefined {
    const row = this.queryOne<Record<string, unknown>>('SELECT * FROM proxies WHERE id = ?', id);
    return row ? this.mapProxy(row) : undefined;
  }

  /** Decrypts a proxy URL only for the server network layer. */
  public getProxySecret(id: string): string | undefined {
    const proxy = this.getProxyById(id);
    if (!proxy?.urlEncrypted) return undefined;
    try { return decryptSecret(proxy.urlEncrypted); } catch { return undefined; }
  }

  public getAccountProxy(accountId: string): (DbProxy & { url: string }) | undefined {
    const row = this.queryOne<Record<string, unknown>>(
      'SELECT p.* FROM proxies p JOIN game_accounts a ON a.proxy_id = p.id WHERE a.id = ?', accountId,
    );
    if (!row) return undefined;
    const proxy = this.mapProxy(row);
    const url = this.getProxySecret(proxy.id);
    return url ? { ...proxy, url } : undefined;
  }

  public getProxyAccounts(proxyId: string): DbProxyAccount[] {
    return this.queryAll<Record<string, unknown>>(
      `SELECT a.id, a.account_name, u.username AS owner_username, a.status
       FROM game_accounts a JOIN users u ON u.id = a.owner_id
       WHERE a.proxy_id = ? ORDER BY a.account_name COLLATE NOCASE, a.id`, proxyId,
    ).map((row) => ({
      id: String(row.id), accountName: cleanText(row.account_name, 128), ownerUsername: cleanText(row.owner_username, 64), running: row.status === 'running',
    }));
  }

  public getProxyAssignedCount(proxyId: string): number {
    return Number(this.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM game_accounts WHERE proxy_id = ?', proxyId)?.count ?? 0);
  }

  public getAvailableProxy(): DbProxy | undefined {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT p.* FROM proxies p
       WHERE p.enabled = 1 AND p.status <> 'down'
         AND (SELECT COUNT(*) FROM game_accounts a WHERE a.proxy_id = p.id) < p.max_accounts
       ORDER BY (SELECT COUNT(*) FROM game_accounts a WHERE a.proxy_id = p.id), p.id LIMIT 1`,
    );
    return row ? this.mapProxy(row) : undefined;
  }

  public createProxy(input: { label: string; scheme: ProxyScheme; url: string; maxAccounts: number; createdBy: string | null }): DbProxy {
    const id = `prx_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const label = cleanText(input.label, 64);
    if (!label) throw new Error('PROXY_LABEL_INVALID');
    if (!Number.isInteger(input.maxAccounts) || input.maxAccounts < 1 || input.maxAccounts > 1000) throw new Error('PROXY_CAPACITY_INVALID');
    const duplicate = this.getProxies().some((proxy) => {
      const url = this.getProxySecret(proxy.id);
      return url && proxy.scheme === input.scheme && url.toLowerCase() === input.url.toLowerCase();
    });
    if (duplicate) throw new Error('PROXY_DUPLICATE');
    this.run(
      `INSERT INTO proxies (id, label, scheme, url_encrypted, max_accounts, enabled, status, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 1, 'unknown', ?, ?)`,
      id, label, input.scheme, encryptSecret(input.url), input.maxAccounts, Date.now(), input.createdBy,
    );
    return this.getProxyById(id)!;
  }

  public updateProxy(id: string, updates: { label?: string; maxAccounts?: number; enabled?: boolean; url?: string; scheme?: ProxyScheme }): DbProxy | undefined {
    const existing = this.getProxyById(id);
    if (!existing) return undefined;
    if (updates.label !== undefined && !cleanText(updates.label, 64)) throw new Error('PROXY_LABEL_INVALID');
    if (updates.maxAccounts !== undefined && (!Number.isInteger(updates.maxAccounts) || updates.maxAccounts < 1 || updates.maxAccounts > 1000)) throw new Error('PROXY_CAPACITY_INVALID');
    const assigned = this.getProxyAssignedCount(id);
    if (updates.maxAccounts !== undefined && updates.maxAccounts < assigned) throw new Error('PROXY_FULL');
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (updates.label !== undefined) { sets.push('label = ?'); params.push(cleanText(updates.label, 64)); }
    if (updates.maxAccounts !== undefined) { sets.push('max_accounts = ?'); params.push(updates.maxAccounts); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
    if (updates.url !== undefined) { sets.push('url_encrypted = ?', "status = 'unknown'", 'last_check_at = NULL', 'last_latency_ms = NULL', 'last_error = NULL'); params.push(encryptSecret(updates.url)); }
    if (updates.scheme !== undefined) { sets.push('scheme = ?'); params.push(updates.scheme); }
    if (sets.length) { params.push(id); this.run(`UPDATE proxies SET ${sets.join(', ')} WHERE id = ?`, ...params); }
    return this.getProxyById(id);
  }

  public updateProxyCheck(id: string, result: { status: ProxyStatus; latencyMs: number | null; error: string | null; checkedAt: number }): { proxy: DbProxy; previousStatus: ProxyStatus } | undefined {
    const current = this.getProxyById(id);
    if (!current) return undefined;
    this.run(
      'UPDATE proxies SET status = ?, last_check_at = ?, last_latency_ms = ?, last_error = ? WHERE id = ?',
      result.status, result.checkedAt, result.latencyMs, result.error ? redactProxyUrl(result.error) : null, id,
    );
    return { proxy: this.getProxyById(id)!, previousStatus: current.status };
  }

  public setAccountProxy(accountId: string, proxyId: string | null): DbGameAccount {
    return this.transaction(() => {
      const account = this.getAccountById(accountId);
      if (!account) throw new Error('ACCOUNT_NOT_FOUND');
      if (proxyId === account.proxyId) return account;
      if (proxyId !== null) {
        const proxy = this.getProxyById(proxyId);
        if (!proxy) throw new Error('PROXY_NOT_FOUND');
        if (!proxy.enabled) throw new Error('PROXY_DISABLED');
        if (this.getProxyAssignedCount(proxyId) >= proxy.maxAccounts) throw new Error('PROXY_FULL');
      }
      this.run('UPDATE game_accounts SET proxy_id = ?, updated_at = ? WHERE id = ?', proxyId, Date.now(), accountId);
      return this.getAccountById(accountId)!;
    });
  }

  public deleteProxy(id: string): boolean {
    if (!this.getProxyById(id)) return false;
    if (this.getProxyAssignedCount(id) > 0) throw new Error('PROXY_IN_USE');
    this.run('DELETE FROM proxies WHERE id = ?', id);
    return true;
  }

  // --- BOT CONFIG ---
  public getBotConfig(accountId: string): BotConfig {
    const row = this.queryOne<{ config_json: string }>('SELECT config_json FROM bot_configs WHERE account_id = ?', accountId);
    if (!row) {
      const value = { ...DEFAULT_BOT_CONFIG };
      this.run('INSERT OR IGNORE INTO bot_configs (account_id, config_json) VALUES (?, ?)', accountId, JSON.stringify(value));
      return value;
    }
    try { return normalizeBotConfig(JSON.parse(row.config_json) as unknown); } catch { return { ...DEFAULT_BOT_CONFIG }; }
  }

  public updateBotConfig(accountId: string, newConfig: Partial<BotConfig>): BotConfig {
    const updated = normalizeBotConfig({ ...this.getBotConfig(accountId), ...newConfig });
    this.run(
      `INSERT INTO bot_configs (account_id, config_json) VALUES (?, ?)
       ON CONFLICT(account_id) DO UPDATE SET config_json = excluded.config_json`,
      accountId, JSON.stringify(updated),
    );
    return updated;
  }

  // --- LOGS ---
  public addLog(accountId: string, level: 'info' | 'warn' | 'error' | 'success', module: string, message: string): DbLog {
    const log: DbLog = {
      id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      accountId,
      timestamp: Date.now(),
      level,
      module: cleanText(module, 80),
      message: cleanText(message, 500),
    };
    this.run(
      'INSERT INTO logs (id, account_id, timestamp, level, module, message) VALUES (?, ?, ?, ?, ?, ?)',
      log.id, log.accountId, log.timestamp, log.level, log.module, log.message,
    );
    this.trimLogs();
    return log;
  }

  public getLogs(accountId?: string, limit: number = 100, ownerId?: string): DbLog[] {
    const safeLimit = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 500) : 100;
    const rows = accountId
      ? this.queryAll<Record<string, unknown>>('SELECT id, account_id, timestamp, level, module, message FROM logs WHERE account_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?', accountId, safeLimit)
      : ownerId
        ? this.queryAll<Record<string, unknown>>(`SELECT l.id, l.account_id, l.timestamp, l.level, l.module, l.message
          FROM logs l JOIN game_accounts a ON a.id = l.account_id WHERE a.owner_id = ? ORDER BY l.timestamp DESC, l.rowid DESC LIMIT ?`, ownerId, safeLimit)
        : this.queryAll<Record<string, unknown>>('SELECT id, account_id, timestamp, level, module, message FROM logs ORDER BY timestamp DESC, rowid DESC LIMIT ?', safeLimit);
    return rows.reverse().map((row) => ({
      id: String(row.id), accountId: String(row.account_id), timestamp: Number(row.timestamp),
      level: row.level === 'warn' || row.level === 'error' || row.level === 'success' ? row.level : 'info',
      module: String(row.module), message: String(row.message),
    }));
  }
}

export const db = new DatabaseService();
