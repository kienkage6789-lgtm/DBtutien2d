import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  AckPacket,
  ClientConfig,
  ClientHelloPacket,
  ConnectionStatus,
  GameInPacket,
  PingPacket,
  PongPacket
} from '../types.js';
import { AuthError } from '../auth/supabase-auth.js';
import { PacketTap } from '../debug/packet-tap.js';

interface PendingRpc {
  resolve: (ack: AckPacket) => void;
  reject: (err: Error) => void;
  timeoutTimer: NodeJS.Timeout;
  sentTime: number;
}

export class SocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: ClientConfig;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private shouldAutoReconnect: boolean = true;
  private lastPingSentAt: number = 0;
  private rpcIdSequence: number = 100;
  private pendingRpcs: Map<number, PendingRpc> = new Map();
  private connectSeq: number = 0;
  private authRetries: number = 0;
  private helloToken: string = '';
  private packetTap: PacketTap | null = null;

  constructor(config: ClientConfig) {
    super();
    this.config = {
      serverUrl: 'wss://game.tutien2d.online/',
      pingIntervalMs: 8000,
      reconnectMaxRetries: 10,
      reconnectBaseDelayMs: 2000,
      reconnectMaxDelayMs: 30000,
      ...config,
    };
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === ConnectionStatus.IN_GAME && this.ws?.readyState === WebSocket.OPEN;
  }

  public attachPacketTap(getSelfId: () => string): void {
    const seconds = Number(process.env.TUTIEN_PACKET_TAP);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.packetTap = new PacketTap(process.env.TUTIEN_PACKET_TAP_DIR || 'docs/evidence', seconds * 1000, getSelfId);
  }

  public recordOutboundMove(move: { seq: number; x: number; y: number; st?: string; ep?: number }): void {
    this.packetTap?.recordOutboundMove(move);
  }

  public beginStationaryProbeBatch(input: {
    label: string;
    st: string;
    x: number;
    y: number;
    positionBefore: { x: number; y: number };
  }): void {
    this.packetTap?.beginStationaryProbeBatch(input);
  }

  public endStationaryProbeBatch(input: {
    label: string;
    youCount: number;
    positionAfter: { x: number; y: number };
  }): void {
    this.packetTap?.endStationaryProbeBatch(input);
  }

  public recordStationaryProbeYou(label: string, packet: Record<string, unknown>): void {
    this.packetTap?.recordStationaryProbeYou(label, packet);
  }

  public recordStationaryProbeCancellation(reason: string): void {
    this.packetTap?.recordStationaryProbeCancellation(reason);
  }

  public connect(): void {
    this.shouldAutoReconnect = true;
    this.cleanupSocket();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setStatus(ConnectionStatus.CONNECTING);
    const seq = ++this.connectSeq;
    void this.openSocket(seq);
  }

  /** Resolve a valid token (login / refresh when needed), then open the WebSocket. */
  private async openSocket(seq: number): Promise<void> {
    try {
      if (this.config.tokenProvider) {
        this.helloToken = await this.config.tokenProvider.getAccessToken();
      } else if (this.config.token) {
        this.helloToken = this.config.token;
      } else {
        throw new AuthError('INVALID_CREDENTIALS', 'Thiếu mật khẩu hoặc token để đăng nhập.');
      }
    } catch (err: any) {
      if (seq !== this.connectSeq) return; // disconnected / superseded meanwhile
      this.handleAuthFailure(err);
      return;
    }
    if (seq !== this.connectSeq) return;

    this.emit('log', { level: 'info', message: `Connecting to ${this.config.serverUrl}...` });

    try {
      const options: WebSocket.ClientOptions = {};
      // If proxy is configured, socks-proxy-agent or http-proxy-agent can be attached if needed

      this.ws = new WebSocket(this.config.serverUrl!, options);

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));
      this.ws.on('error', (err: Error) => this.handleError(err));
      this.ws.on('close', (code: number, reason: Buffer) => this.handleClose(code, reason.toString()));
    } catch (err: any) {
      this.handleError(err);
    }
  }

  private handleAuthFailure(err: any): void {
    const authErr = err instanceof AuthError ? err : new AuthError('UNKNOWN', String(err?.message || err));
    if (authErr.retryable && this.shouldAutoReconnect) {
      this.emit('log', { level: 'warn', message: `Đăng nhập tạm thời thất bại: ${authErr.message}` });
      this.scheduleReconnect();
      return;
    }
    this.shouldAutoReconnect = false;
    this.setStatus(ConnectionStatus.DISCONNECTED);
    this.emit('log', { level: 'error', message: `Đăng nhập thất bại: ${authErr.message}. Đã dừng kết nối.` });
    this.emit('authFailed', authErr);
  }

  public disconnect(): void {
    this.shouldAutoReconnect = false;
    this.connectSeq++;
    this.clearTimers();
    this.rejectAllPendingRpcs(new Error('Client disconnected intentionally'));
    this.cleanupSocket();
    this.setStatus(ConnectionStatus.DISCONNECTED);
    this.emit('log', { level: 'info', message: 'Client disconnected by user.' });
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.setStatus(ConnectionStatus.HANDSHAKING);
    this.emit('log', { level: 'info', message: 'WebSocket connected! Sending hello handshake...' });

    const hello: ClientHelloPacket = {
      op: 'hello',
      proto: 10,
      snap: 2,
      name: this.config.accountName,
      token: this.helloToken,
      features: { formation: 1 },
    };

    this.sendRaw(hello);
  }

  private handleMessage(data: WebSocket.Data): void {
    let rawStr = '';
    if (typeof data === 'string') {
      rawStr = data;
    } else if (Buffer.isBuffer(data)) {
      rawStr = data.toString('utf-8');
    } else {
      rawStr = data.toString();
    }

    try {
      const packet = JSON.parse(rawStr) as GameInPacket;
      this.processPacket(packet);
    } catch (err) {
      this.emit('log', { level: 'warn', message: `Failed to parse incoming packet: ${rawStr.slice(0, 100)}` });
    }
  }

  private processPacket(packet: GameInPacket): void {
    this.packetTap?.record(packet);
    // Suppress heavy ticks like snap2 / hon unless needed
    if (packet.op !== 'snap2' && packet.op !== 'hon') {
      this.emit('packet', packet);
    }

    switch (packet.op) {
      case 'welcome':
        this.authRetries = 0;
        this.setStatus(ConnectionStatus.IN_GAME);
        this.emit('welcome', packet);
        this.startPingLoop();
        this.emit('log', { level: 'success', message: `Logged in successfully as [${packet.name}] (SelfId: ${packet.selfId})` });
        break;

      case 'pong': {
        const pong = packet as PongPacket;
        const latency = Date.now() - this.lastPingSentAt;
        this.emit('pong', { latency, serverTime: pong.serverTime });
        break;
      }

      case 'state':
        this.emit('state', packet);
        break;

      case 'map':
        this.emit('map', packet);
        break;

      case 'snap':
        // Some server revisions send the initial world baseline as legacy
        // snap, then continue with snap2 deltas. Keep this packet available to
        // the worker; dropping it leaves the snap2 reducer without a baseline.
        this.emit('snap', packet);
        break;

      case 'snap2':
        // snap2 is reduced by TuTienClient; never expose the raw wire packet.
        this.emit('snap2', packet);
        break;

      case 'status':
        this.emit('status', packet);
        break;

      case 'formation':
        this.emit('formation', packet);
        break;

      case 'you':
        this.emit('you', packet);
        break;

      case 'hurt':
        this.emit('hurt', packet);
        break;

      case 'revived':
        this.emit('revived', packet);
        break;

      case 'down':
        this.emit('down', packet);
        break;

      case 'mach':
        this.emit('mach', packet.l || []);
        break;

      case 'world_chat':
        this.emit('chat', packet);
        break;

      case 'ack': {
        const ack = packet as AckPacket;
        this.emit('ack', ack);
        const pending = this.pendingRpcs.get(ack.rid);
        if (pending) {
          clearTimeout(pending.timeoutTimer);
          this.pendingRpcs.delete(ack.rid);
          pending.resolve(ack);
        }
        break;
      }

      default:
        // Other custom packets
        break;
    }
  }

  private handleError(err: Error): void {
    // EventEmitter throws on an unhandled 'error' event — only emit when someone listens.
    if (this.listenerCount('error') > 0) this.emit('error', err);
    this.emit('log', { level: 'error', message: `WebSocket error: ${err.message}` });
  }

  private handleClose(code: number, reason: string): void {
    this.clearTimers();
    this.rejectAllPendingRpcs(new Error(`Connection closed: ${code} - ${reason}`));
    this.cleanupSocket();

    this.emit('log', { level: 'warn', message: `WebSocket closed (code: ${code}, reason: "${reason}")` });

    const lower = reason.toLowerCase();
    const isAuthError =
      lower.includes('vé không hợp lệ') || lower.includes('hết hạn') || lower.includes('token');

    if (isAuthError && this.shouldAutoReconnect) {
      const provider = this.config.tokenProvider;
      // Token rejected by the game: re-authenticate ONCE, then give up (avoid login storms).
      if (provider && provider.canReauth() && this.authRetries < 1) {
        this.authRetries++;
        provider.invalidate();
        this.emit('log', { level: 'warn', message: 'Game từ chối vé đăng nhập, đang đăng nhập lại để lấy token mới...' });
        this.scheduleReconnect();
        return;
      }
      this.shouldAutoReconnect = false;
      this.setStatus(ConnectionStatus.DISCONNECTED);
      const err = new AuthError('INVALID_CREDENTIALS', `Game từ chối đăng nhập ("${reason}").`);
      this.emit('log', { level: 'error', message: `${err.message} Đã dừng bot để bảo vệ tài khoản.` });
      this.emit('authFailed', err);
      return;
    }

    if (this.shouldAutoReconnect) {
      this.scheduleReconnect();
    } else {
      this.setStatus(ConnectionStatus.DISCONNECTED);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.config.reconnectMaxRetries ?? 10)) {
      this.setStatus(ConnectionStatus.DISCONNECTED);
      this.emit('log', { level: 'error', message: 'Exceeded maximum reconnect attempts. Stopping.' });
      return;
    }

    this.setStatus(ConnectionStatus.RECONNECTING);
    this.reconnectAttempts++;
    const delay = Math.min(
      (this.config.reconnectBaseDelayMs ?? 2000) * Math.pow(1.5, this.reconnectAttempts - 1),
      this.config.reconnectMaxDelayMs ?? 30000
    );

    this.emit('log', { level: 'info', message: `Reconnecting attempt #${this.reconnectAttempts} in ${Math.round(delay / 1000)}s...` });

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);

    const interval = this.config.pingIntervalMs ?? 8000;
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendPing();
      }
    }, interval);

    // Initial ping
    this.sendPing();
  }

  public sendPing(): void {
    this.lastPingSentAt = Date.now();
    const pingMsg: PingPacket = {
      op: 'ping',
      t: this.lastPingSentAt,
      ns: {
        v: 1,
        s: 15,
        u: 0,
        l: 0,
        d: 160,
        n: 6,
        q: 2,
      },
    };
    this.sendRaw(pingMsg);
  }

  public sendRaw(payload: any): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (err: any) {
      this.emit('log', { level: 'error', message: `Failed to send packet: ${err.message}` });
      return false;
    }
  }

  /**
   * Send RPC command and wait for server ack with rid matching
   */
  public sendCmd(cmd: string, params: Record<string, any> = {}, timeoutMs: number = 8000): Promise<AckPacket> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error(`Cannot send command "${cmd}": client is not connected (${this.status})`));
      }

      const rid = ++this.rpcIdSequence;
      const cmdPacket = {
        op: 'cmd',
        cmd,
        rid,
        ...params,
      };

      const timeoutTimer = setTimeout(() => {
        this.pendingRpcs.delete(rid);
        reject(new Error(`Command "${cmd}" (rid ${rid}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRpcs.set(rid, {
        resolve,
        reject,
        timeoutTimer,
        sentTime: Date.now(),
      });

      const sent = this.sendRaw(cmdPacket);
      if (!sent) {
        clearTimeout(timeoutTimer);
        this.pendingRpcs.delete(rid);
        reject(new Error(`Failed to transmit command "${cmd}"`));
      }
    });
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit('statusChange', status);
  }

  private clearTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPendingRpcs(err: Error): void {
    for (const [rid, pending] of this.pendingRpcs.entries()) {
      clearTimeout(pending.timeoutTimer);
      pending.reject(err);
    }
    this.pendingRpcs.clear();
  }

  private cleanupSocket(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (_) {}
      this.ws = null;
    }
  }
}
