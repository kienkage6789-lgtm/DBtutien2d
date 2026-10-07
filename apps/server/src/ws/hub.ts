import { WebSocket, WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { db, DbLog } from '../db/database.js';
import { verifyWsUpgrade } from '../security/auth.js';

export interface WsMessage {
  type: 'initial_state' | 'account_updated' | 'account_log' | 'bot_activity' | 'system_alert';
  data: any;
}

export class WebSocketHub {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  public init(httpServer: HttpServer, getRuntimeAccounts: () => unknown[]): void {
    this.wss = new WebSocketServer({
      server: httpServer, path: '/ws', maxPayload: 64 * 1024,
      handleProtocols: (protocols) => protocols.has('bearer') ? 'bearer' : false,
      verifyClient: (info, done) => {
        const verdict = verifyWsUpgrade(info.req);
        if (verdict.ok) done(true);
        else done(false, verdict.code, verdict.reason);
      },
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      // Send initial snapshot
      this.sendToClient(ws, {
        type: 'initial_state',
        data: {
          accounts: getRuntimeAccounts(),
          logs: db.getLogs(undefined, 50),
        },
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  public broadcast(msg: WsMessage): void {
    const raw = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  public sendToClient(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  public broadcastLog(log: DbLog): void {
    this.broadcast({
      type: 'account_log',
      data: log,
    });
  }

  public broadcastAccountUpdate(accountData: any): void {
    this.broadcast({
      type: 'account_updated',
      data: accountData,
    });
  }

  public broadcastActivity(accountId: string, activity: string): void {
    this.broadcast({
      type: 'bot_activity',
      data: { accountId, activity },
    });
  }
}

export const wsHub = new WebSocketHub();
