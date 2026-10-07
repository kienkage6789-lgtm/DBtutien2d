import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config.js';
import { decryptSecret, encryptSecret } from '../security/crypto.js';
import { BotConfig, DEFAULT_BOT_CONFIG } from '@tutien2d/automation-engine';

export interface DbUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface DbGameAccount {
  id: string;
  userId: string;
  accountName: string;
  /** AES-256-GCM encrypted password (đạo hiệu login). */
  encryptedPassword?: string | null;
  /** AES-256-GCM encrypted Supabase refresh token (rotated automatically). */
  encryptedRefreshToken?: string | null;
  /** Legacy: pasted JWT. Only used when no password is stored. */
  encryptedToken?: string | null;
  proxyUrl?: string | null;
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
  'encryptedPassword' | 'encryptedRefreshToken' | 'encryptedToken' | 'proxyUrl'
> & { hasPassword: boolean; hasLegacyToken: boolean };

export interface DbLog {
  id: string;
  accountId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  module: string;
  message: string;
}

export interface DatabaseSchema {
  users: DbUser[];
  accounts: DbGameAccount[];
  botConfigs: Record<string, BotConfig>; // accountId -> BotConfig
  logs: DbLog[];
}

export class DatabaseService {
  private dbPath: string;
  private data: DatabaseSchema;
  private maxLogs: number = 2000;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }
    this.dbPath = path.join(CONFIG.DATA_DIR, 'tutien_db.json');
    this.data = this.loadDatabase();
    this.seedDefaultsIfEmpty();
    this.migrate();
  }

  private loadDatabase(): DatabaseSchema {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        return JSON.parse(raw);
      } catch (err) {
        console.error('Failed to parse database file, initializing fresh:', err);
      }
    }

    return {
      users: [],
      accounts: [],
      botConfigs: {},
      logs: [],
    };
  }

  /** Debounced atomic write — state updates arrive many times per second. */
  private saveDatabase(immediate: boolean = true): void {
    if (!immediate) {
      if (this.saveTimer) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.writeFile();
      }, 500);
      this.saveTimer.unref?.();
      return;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writeFile();
  }

  private writeFile(): void {
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.dbPath);
  }

  /** Flush any pending debounced write (call on shutdown). */
  public flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeFile();
    }
  }

  private seedDefaultsIfEmpty(): void {
    if (this.data.users.length === 0) {
      this.data.users.push({
        id: 'usr_admin_default',
        email: 'admin@tutien2d.local',
        role: 'admin',
        createdAt: new Date().toISOString(),
      });
      this.saveDatabase();
    }
  }

  /**
   * Migrate legacy "pasted JWT" accounts. Those tokens expire after 1 hour and were encrypted
   * with an older key, so they are unusable; flag the account so the UI asks for a password.
   */
  private migrate(): void {
    let dirty = false;
    for (const acc of this.data.accounts) {
      if (!acc.encryptedPassword && acc.encryptedToken) {
        let usable = false;
        try {
          decryptSecret(acc.encryptedToken);
          usable = true;
        } catch {
          /* key changed — cannot decrypt */
        }
        if (!usable) {
          acc.encryptedToken = null;
          dirty = true;
        }
      }
      if (!acc.encryptedPassword && !acc.encryptedToken && !acc.authError) {
        acc.authError = 'Chưa lưu mật khẩu — hãy nhập mật khẩu để bot tự đăng nhập.';
        acc.status = 'stopped';
        dirty = true;
      }
    }
    if (dirty) this.saveDatabase();
  }

  // --- ACCOUNTS ---
  public toPublic(acc: DbGameAccount): PublicGameAccount {
    const { encryptedPassword, encryptedRefreshToken, encryptedToken, proxyUrl, ...rest } = acc;
    return { ...rest, hasPassword: !!encryptedPassword, hasLegacyToken: !!encryptedToken };
  }

  public getAccounts(): DbGameAccount[] {
    return [...this.data.accounts];
  }

  public getPublicAccounts(): PublicGameAccount[] {
    return this.data.accounts.map((a) => this.toPublic(a));
  }

  public getAccountById(id: string): DbGameAccount | undefined {
    return this.data.accounts.find((a) => a.id === id);
  }

  public findByName(accountName: string): DbGameAccount | undefined {
    const n = accountName.trim().toLowerCase();
    return this.data.accounts.find((a) => a.accountName.toLowerCase() === n);
  }

  public createAccount(
    accountName: string,
    credentials: { password?: string; refreshToken?: string; legacyToken?: string },
    proxyUrl?: string | null
  ): DbGameAccount {
    if (this.findByName(accountName)) {
      throw new Error(`Tài khoản "${accountName}" đã tồn tại trong hệ thống.`);
    }
    const id = `acc_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const newAccount: DbGameAccount = {
      id,
      userId: this.data.users[0]?.id || 'usr_admin_default',
      accountName: accountName.trim(),
      encryptedPassword: credentials.password ? encryptSecret(credentials.password) : null,
      encryptedRefreshToken: credentials.refreshToken ? encryptSecret(credentials.refreshToken) : null,
      encryptedToken: credentials.legacyToken ? encryptSecret(credentials.legacyToken) : null,
      proxyUrl: proxyUrl || null,
      status: 'stopped',
      authError: null,
      characterName: accountName.trim(),
      realm: 'Phàm Nhân',
      stones: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.data.accounts.push(newAccount);
    this.data.botConfigs[id] = { ...DEFAULT_BOT_CONFIG };
    this.saveDatabase();
    return newAccount;
  }

  public updateAccount(id: string, updates: Partial<DbGameAccount>): DbGameAccount | null {
    const acc = this.getAccountById(id);
    if (!acc) return null;

    Object.assign(acc, updates, { updatedAt: new Date().toISOString() });
    // High-frequency path (game state ticks) -> debounce disk writes.
    this.saveDatabase(false);
    return acc;
  }

  /** Persist new credentials (encrypted). Pass `null` to clear a field. */
  public updateCredentials(
    id: string,
    creds: { password?: string | null; refreshToken?: string | null }
  ): DbGameAccount | null {
    const acc = this.getAccountById(id);
    if (!acc) return null;

    if (creds.password !== undefined) {
      acc.encryptedPassword = creds.password ? encryptSecret(creds.password) : null;
      if (creds.password) acc.encryptedToken = null; // password supersedes legacy token
    }
    if (creds.refreshToken !== undefined) {
      acc.encryptedRefreshToken = creds.refreshToken ? encryptSecret(creds.refreshToken) : null;
    }
    acc.updatedAt = new Date().toISOString();
    this.saveDatabase(false);
    return acc;
  }

  /** Decrypt stored credentials for the worker. Never expose the result outside the server. */
  public getCredentials(id: string): { password?: string; refreshToken?: string; legacyToken?: string } {
    const acc = this.getAccountById(id);
    const out: { password?: string; refreshToken?: string; legacyToken?: string } = {};
    if (!acc) return out;
    const tryDecrypt = (v?: string | null): string | undefined => {
      if (!v) return undefined;
      try {
        return decryptSecret(v);
      } catch {
        return undefined;
      }
    };
    out.password = tryDecrypt(acc.encryptedPassword);
    out.refreshToken = tryDecrypt(acc.encryptedRefreshToken);
    out.legacyToken = tryDecrypt(acc.encryptedToken);
    return out;
  }

  public deleteAccount(id: string): boolean {
    const index = this.data.accounts.findIndex((a) => a.id === id);
    if (index === -1) return false;

    this.data.accounts.splice(index, 1);
    delete this.data.botConfigs[id];
    this.data.logs = this.data.logs.filter((l) => l.accountId !== id);
    this.saveDatabase();
    return true;
  }

  // --- BOT CONFIG ---
  public getBotConfig(accountId: string): BotConfig {
    if (!this.data.botConfigs[accountId]) {
      this.data.botConfigs[accountId] = { ...DEFAULT_BOT_CONFIG };
      this.saveDatabase();
    }
    const stored = this.data.botConfigs[accountId];
    return {
      ...DEFAULT_BOT_CONFIG,
      ...stored,
      // Never migrate legacy switches into an active quest automation.
      legacyAutomationEnabled: false,
      autoDailyQuest: stored.autoDailyQuest ?? false,
      autoCaveQuest: stored.autoCaveQuest ?? false,
      autoMainQuest: stored.autoMainQuest ?? false,
      autoDaily: false,
      autoCave: false,
      sellRules: {
        ...DEFAULT_BOT_CONFIG.sellRules,
        ...stored.sellRules,
        minRetain: { ...DEFAULT_BOT_CONFIG.sellRules.minRetain, ...stored.sellRules?.minRetain },
      },
      delayRangeMs: { ...DEFAULT_BOT_CONFIG.delayRangeMs, ...stored.delayRangeMs },
    };
  }

  public updateBotConfig(accountId: string, newConfig: Partial<BotConfig>): BotConfig {
    const current = this.getBotConfig(accountId);
    const updated = {
      ...current,
      ...newConfig,
      // Legacy quest/inventory/potion automation stays disabled until explicitly redesigned.
      legacyAutomationEnabled: false,
      autoDaily: false,
      autoCave: false,
      sellRules: newConfig.sellRules ? {
        ...current.sellRules,
        ...newConfig.sellRules,
        minRetain: { ...current.sellRules.minRetain, ...newConfig.sellRules.minRetain },
      } : current.sellRules,
      delayRangeMs: newConfig.delayRangeMs ? { ...current.delayRangeMs, ...newConfig.delayRangeMs } : current.delayRangeMs,
    };
    this.data.botConfigs[accountId] = updated;
    this.saveDatabase();
    return updated;
  }

  // --- LOGS ---
  public addLog(accountId: string, level: 'info' | 'warn' | 'error' | 'success', module: string, message: string): DbLog {
    const log: DbLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      accountId,
      timestamp: Date.now(),
      level,
      module,
      message,
    };

    this.data.logs.push(log);
    if (this.data.logs.length > this.maxLogs) {
      this.data.logs = this.data.logs.slice(-this.maxLogs);
    }
    this.saveDatabase(false);
    return log;
  }

  public getLogs(accountId?: string, limit: number = 100): DbLog[] {
    const safeLimit = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), 500) : 100;
    let filtered = this.data.logs;
    if (accountId) {
      filtered = filtered.filter((l) => l.accountId === accountId);
    }
    return filtered.slice(-safeLimit);
  }
}

export const db = new DatabaseService();
