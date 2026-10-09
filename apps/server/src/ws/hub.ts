import { WebSocket, WebSocketServer } from 'ws';
import { Server as HttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { db, type DbLog } from '../db/database.js';
import { resolveToken, verifyWsUpgrade, type Principal } from '../security/auth.js';
import { CONFIG } from '../config.js';

export interface WsMessage {
  type: 'initial_state' | 'account_updated' | 'account_log' | 'bot_activity' | 'system_alert';
  data: any;
}

interface ClientContext {
  principal: Principal;
  token: string;
  request: IncomingMessage;
}

export class WebSocketHub {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, ClientContext>();
  private sessionCheckTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly messageWindows = new Map<WebSocket, number[]>();

  public init(httpServer: HttpServer, getRuntimeAccounts: () => unknown[]): void {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      maxPayload: 64 * 1024,
      handleProtocols: (protocols) => protocols.has('bearer') ? 'bearer' : false,
      verifyClient: (info, done) => {
        const verdict = verifyWsUpgrade(info.req);
        if (!verdict.ok) { done(false, verdict.code, verdict.reason); return; }
        if (this.clients.size >= CONFIG.WS_MAX_CONNECTIONS_TOTAL) {
          done(false, 503, 'WebSocket connection limit reached');
          return;
        }
        if (verdict.principal.userId && this.countUserConnections(verdict.principal.userId) >= CONFIG.WS_MAX_CONNECTIONS_PER_USER) {
          done(false, 503, 'Per-user WebSocket connection limit reached');
          return;
        }
        done(true);
      },
    });

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const verdict = verifyWsUpgrade(request);
      if (!verdict.ok) {
        ws.close(4001, 'Unauthorized');
        return;
      }
      if (this.clients.size >= CONFIG.WS_MAX_CONNECTIONS_TOTAL) {
        ws.close(1013, 'WebSocket connection limit reached');
        return;
      }
      if (verdict.principal.userId && this.countUserConnections(verdict.principal.userId) >= CONFIG.WS_MAX_CONNECTIONS_PER_USER) {
        ws.close(1013, 'Per-user WebSocket connection limit reached');
        return;
      }
      const context: ClientContext = { principal: verdict.principal, token: verdict.token, request };
      this.clients.set(ws, context);
      this.messageWindows.set(ws, []);
      this.sendToClient(ws, {
        type: 'initial_state',
        data: {
          accounts: this.filterAccounts(getRuntimeAccounts(), context.principal),
          logs: this.filterLogs(db.getLogs(undefined, 50), context.principal),
        },
      });
      this.ensureSessionCheck();

      ws.on('close', () => {
        this.clients.delete(ws);
        this.messageWindows.delete(ws);
        this.stopSessionCheckIfIdle();
        this.stopHeartbeatIfIdle();
      });
      ws.on('error', () => {
        this.clients.delete(ws);
        this.messageWindows.delete(ws);
        this.stopSessionCheckIfIdle();
        this.stopHeartbeatIfIdle();
      });
      ws.on('pong', () => { (ws as WebSocket & { isAlive?: boolean }).isAlive = true; });
      ws.on('message', (data) => {
        const bytes = typeof data === 'string'
          ? Buffer.byteLength(data)
          : Array.isArray(data) ? data.reduce((total, part) => total + part.byteLength, 0) : data.byteLength;
        if (bytes > 64 * 1024 || !this.allowMessage(ws)) {
          ws.close(1008, 'WebSocket message rate limit exceeded');
        }
      });
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
      this.ensureHeartbeat();
    });
  }

  private countUserConnections(userId: string): number {
    let count = 0;
    for (const context of this.clients.values()) if (context.principal.userId === userId) count += 1;
    return count;
  }

  private allowMessage(ws: WebSocket): boolean {
    const now = Date.now();
    const window = (this.messageWindows.get(ws) ?? []).filter((at) => at > now - 60_000);
    if (window.length >= CONFIG.WS_MAX_MESSAGES_PER_MIN) {
      this.messageWindows.set(ws, window);
      return false;
    }
    window.push(now);
    this.messageWindows.set(ws, window);
    return true;
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.keys()) {
        const socket = client as WebSocket & { isAlive?: boolean };
        if (socket.isAlive === false) {
          client.terminate();
          continue;
        }
        socket.isAlive = false;
        client.ping();
      }
    }, 30_000);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeatIfIdle(): void {
    if (this.clients.size > 0 || !this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private ensureSessionCheck(): void {
    if (this.sessionCheckTimer) return;
    this.sessionCheckTimer = setInterval(() => {
      for (const [client, context] of this.clients) {
        const resolved = resolveToken(context.token, context.request, Date.now(), false);
        if (!resolved || (resolved.principal.sessionId !== context.principal.sessionId && !context.principal.legacyToken)) {
          client.close(4001, 'Session expired or revoked');
        }
      }
    }, 15_000);
    this.sessionCheckTimer.unref?.();
  }

  private stopSessionCheckIfIdle(): void {
    if (this.clients.size > 0 || !this.sessionCheckTimer) return;
    clearInterval(this.sessionCheckTimer);
    this.sessionCheckTimer = null;
  }

  private accountIdFromMessage(message: WsMessage): string | undefined {
    if (!message.data || typeof message.data !== 'object' || Array.isArray(message.data)) return undefined;
    const value = message.data as Record<string, unknown>;
    if (message.type === 'account_updated' && typeof value.id === 'string') return value.id;
    if (typeof value.accountId === 'string') return value.accountId;
    if (message.type === 'account_log' && typeof value.accountId === 'string') return value.accountId;
    return undefined;
  }

  private canSeeAccount(principal: Principal, accountId: string): boolean {
    return principal.role === 'admin' || (!!principal.userId && db.getOwnerId(accountId) === principal.userId);
  }

  private filterAccounts(accounts: unknown[], principal: Principal): unknown[] {
    if (principal.role === 'admin') return accounts;
    return accounts.filter((account) => {
      if (!account || typeof account !== 'object' || Array.isArray(account)) return false;
      const id = (account as Record<string, unknown>).id;
      return typeof id === 'string' && this.canSeeAccount(principal, id);
    });
  }

  private filterLogs(logs: DbLog[], principal: Principal): DbLog[] {
    if (principal.role === 'admin') return logs;
    return logs.filter((log) => this.canSeeAccount(principal, log.accountId));
  }

  private canSeeMessage(message: WsMessage, principal: Principal): boolean {
    if (message.type === 'system_alert') {
      const ownerId = message.data && typeof message.data === 'object' && !Array.isArray(message.data)
        ? (message.data as Record<string, unknown>).ownerId
        : undefined;
      return principal.role === 'admin' || (typeof ownerId === 'string' && ownerId === principal.userId);
    }
    const accountId = this.accountIdFromMessage(message);
    return !!accountId && this.canSeeAccount(principal, accountId);
  }

  public broadcast(msg: WsMessage): void {
    const raw = JSON.stringify(msg);
    for (const [client, context] of this.clients) {
      if (client.readyState === WebSocket.OPEN && this.canSeeMessage(msg, context.principal)) client.send(raw);
    }
  }

  public sendToClient(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  public broadcastLog(log: DbLog): void {
    this.broadcast({ type: 'account_log', data: log });
  }

  public broadcastAccountUpdate(accountData: any): void {
    this.broadcast({ type: 'account_updated', data: accountData });
  }

  public broadcastActivity(accountId: string, activity: string): void {
    this.broadcast({ type: 'bot_activity', data: { accountId, activity } });
  }

  public broadcastSystemAlertToOwner(ownerId: string, alert: { reason: string; message: string }): void {
    const message: WsMessage = { type: 'system_alert', data: { ownerId, reason: alert.reason, message: alert.message } };
    const raw = JSON.stringify(message);
    for (const [client, context] of this.clients) {
      if (client.readyState === WebSocket.OPEN && context.principal.userId === ownerId) {
        client.send(raw);
      }
    }
  }

  public closeSession(sessionId: string): void {
    for (const [client, context] of this.clients) {
      if (context.principal.sessionId === sessionId) client.close(4001, 'Session revoked');
    }
  }

  public closeUserSessions(userId: string, exceptSessionId?: string): void {
    for (const [client, context] of this.clients) {
      if (context.principal.userId === userId && context.principal.sessionId !== exceptSessionId) {
        client.close(4001, 'Session revoked');
      }
    }
  }

  public closeAll(): void {
    for (const client of this.clients.keys()) client.terminate();
    this.clients.clear();
    this.messageWindows.clear();
    this.stopSessionCheckIfIdle();
    this.stopHeartbeatIfIdle();
    this.wss?.close();
  }
}

export const wsHub = new WebSocketHub();
