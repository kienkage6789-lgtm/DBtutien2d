import { EventEmitter } from 'events';
import { SocketClient } from './connection/socket-client.js';
import { GameStateStore } from './state/game-state.js';
import { Snap2Reducer, Snap2Packet } from './state/snap2-reducer.js';
import { AntiDetectionManager, JitterOptions } from './anti-detection/jitter.js';
import { SupabaseAuth } from './auth/supabase-auth.js';
import { TokenManager } from './auth/token-manager.js';
import { OperationLedger } from './operation-ledger.js';
import {
  AckPacket,
  CharacterOverview,
  ClientConfig,
  ConnectionStatus,
  Direction,
  MovePacket,
  MoveState,
  MapPacket
} from './types.js';

export interface TuTienClientOptions extends ClientConfig {
  jitter?: JitterOptions;
  /** Synchronous validation hook. Return false to ignore a map packet before any client state changes. */
  mapPacketGuard?: (packet: MapPacket, state: GameStateStore) => boolean;
  /**
   * Synchronous validation hook for world state and self packets. Returning
   * false (or throwing) rejects world fields; valid canonical vitals on state
   * and you packets are still applied through the vitals-only path.
   */
  worldPacketGuard?: (source: 'state' | 'you' | 'snap', packet: Record<string, unknown>, state: GameStateStore) => boolean;
}

export interface Snap2RuntimeStats {
  received: number;
  accepted: number;
  resyncs: number;
  legacyReceived: number;
  fullReceived: number;
  fullRejected: number;
  lastSequence: number | null;
  lastReceivedAt: number | null;
  lastAcceptedAt: number | null;
  lastLegacyReceivedAt: number | null;
  lastPacketFull: boolean | number | string | null;
  lastPacketKeys: string[];
  lastFullSequence: number | string | null;
  lastFullEpoch: number | string | null;
  lastFullShape: {
    players: number;
    monsters: number;
    playerIdType: string | null;
    monsterIdType: string | null;
    playerKeys: string[];
    monsterKeys: string[];
  } | null;
  lastFullRejectReason: string | null;
  lastRejectReason: string | null;
  monsterRowsSeen: number;
  monsterPatchRowsSeen: number;
  lastMonsterRowsAt: number | null;
}

export class TuTienClient extends EventEmitter {
  public readonly socket: SocketClient;
  public readonly state: GameStateStore;
  public readonly antiDetection: AntiDetectionManager;
  public readonly tokens: TokenManager;
  // The public client starts movement sequence numbers at 1. Keep this as the
  // last successfully transmitted sequence so the first packet is seq=1.
  private moveSeq: number = 0;
  public readonly operationLedger = new OperationLedger();
  /** Latest server map epoch. A stale/static epoch causes move packets to be ignored. */
  private mapEpoch: number | undefined;
  private readonly snap2Reducer = new Snap2Reducer();
  private readonly mapPacketGuard?: TuTienClientOptions['mapPacketGuard'];
  private readonly worldPacketGuard?: TuTienClientOptions['worldPacketGuard'];
  /** A snap2 packet can precede map/khu; request a full snapshot after context is known. */
  private snap2ResyncPending = false;
  /** Match the public client: do not flood the server with resync requests. */
  private lastSnap2ResyncAt = 0;
  /** Keep the initial full packet if it races the authoritative map packet. */
  private pendingSnap2Full: Snap2Packet | null = null;
  private snap2Stats: Snap2RuntimeStats = {
    received: 0,
    accepted: 0,
    resyncs: 0,
    legacyReceived: 0,
    fullReceived: 0,
    fullRejected: 0,
    lastSequence: null,
    lastReceivedAt: null,
    lastAcceptedAt: null,
    lastLegacyReceivedAt: null,
    lastPacketFull: null,
    lastPacketKeys: [],
    lastFullSequence: null,
    lastFullEpoch: null,
    lastFullShape: null,
    lastFullRejectReason: null,
    lastRejectReason: null,
    monsterRowsSeen: 0,
    monsterPatchRowsSeen: 0,
    lastMonsterRowsAt: null,
  };

  constructor(options: TuTienClientOptions) {
    super();
    this.mapPacketGuard = options.mapPacketGuard;
    this.worldPacketGuard = options.worldPacketGuard;
    const serverUrl = options.serverUrl || 'wss://game.tutien2d.online/';
    const auth = new SupabaseAuth({
      url: options.supabaseUrl,
      anonKey: options.supabaseAnonKey,
      gameApiBase: serverUrl.replace(/^ws/i, 'http'),
    });
    this.tokens = new TokenManager({
      auth,
      identifier: options.accountName,
      password: options.password,
      refreshToken: options.refreshToken,
      staticToken: options.password ? undefined : options.token,
    });

    this.socket = new SocketClient({ ...options, serverUrl, tokenProvider: this.tokens });
    this.state = new GameStateStore(options.accountName);
    this.socket.attachPacketTap(() => this.state.selfId);
    this.antiDetection = new AntiDetectionManager(options.jitter);

    this.bindSocketEvents();
  }

  private bindSocketEvents(): void {
    // Without a listener, EventEmitter would throw on socket errors; they are already logged.
    this.socket.on('error', () => {});

    this.tokens.on('log', (l) => this.emit('log', { ...l, timestamp: Date.now() }));
    this.tokens.on('sessionUpdated', (s) => this.emit('sessionUpdated', s));
    this.tokens.on('tokenRefreshed', (exp) => this.emit('tokenRefreshed', exp));
    // authFailed is surfaced once, via the socket (it carries the final decision to stop).
    this.socket.on('authFailed', (err) => this.emit('authFailed', err));

    this.socket.on('statusChange', (status: ConnectionStatus) => {
      this.state.setConnectionStatus(status);
      this.emit('statusChange', status);
    });

    this.socket.on('welcome', (welcome) => {
      this.operationLedger.reset();
      this.mapEpoch = typeof welcome.ep === 'number' && Number.isInteger(welcome.ep) ? welcome.ep : undefined;
      this.snap2Reducer.reset();
      this.snap2ResyncPending = false;
      this.lastSnap2ResyncAt = 0;
      this.pendingSnap2Full = null;
      this.resetSnap2Stats();
      this.state.updateWelcome(welcome);
      this.emit('welcome', welcome);
    });

    this.socket.on('state', (state) => {
      if (this.worldPacketGuard && !this.acceptWorldPacket('state', state)) {
        this.state.updateVitalsOnly(state, 'state');
        return;
      }
      const previousContext = this.state.contextEpoch;
      this.state.updateState(state);
      if (this.state.contextEpoch !== previousContext) this.snap2Reducer.reset();
      this.emit('state', state);
    });

    this.socket.on('map', (map) => {
      if (this.mapPacketGuard && !this.acceptMapPacket(map)) return;
      this.mapEpoch = typeof map.ep === 'number' && Number.isInteger(map.ep) ? map.ep : this.mapEpoch;
      this.snap2Reducer.reset();
      this.state.updateMap(map);
      this.emit('map', map);
      const pendingFull = this.pendingSnap2Full;
      this.pendingSnap2Full = null;
      if (pendingFull) this.processSnap2Packet(pendingFull, false);
      this.flushSnap2Resync();
    });

    this.socket.on('snap', (packet: Record<string, unknown>) => {
      const receivedAt = Date.now();
      this.snap2Stats.legacyReceived += 1;
      this.snap2Stats.lastLegacyReceivedAt = receivedAt;
      this.state.worldUpdatedAt = receivedAt;
      this.emit('snap', packet);
    });

    this.socket.on('snap2', (packet: Snap2Packet) => {
      this.processSnap2Packet(packet);
    });

    this.socket.on('status', (status) => {
      this.state.updateStatus(status);
      this.emit('status', status);
    });

    this.socket.on('formation', (formation) => {
      this.state.updateFormation(formation);
      this.emit('formation', formation);
    });

    this.socket.on('you', (packet) => {
      if (this.worldPacketGuard && !this.acceptWorldPacket('you', packet)) {
        this.state.updateVitalsOnly(packet, 'you');
        return;
      }
      this.state.updateYou(packet);
      this.emit('you', packet);
    });

    this.socket.on('hurt', (packet) => {
      this.state.updateSelfVitals(packet, 'hurt');
      this.emit('hurt', packet);
    });

    this.socket.on('revived', (packet) => {
      this.state.updateSelfVitals(packet, 'revived');
      this.emit('revived', packet);
    });

    this.socket.on('down', (packet) => {
      this.state.updateDown();
      this.emit('down', packet);
    });

    this.socket.on('mach', (mach) => {
      this.state.updateHerbs(mach);
      this.emit('mach', mach);
    });

    this.socket.on('pong', ({ latency }) => {
      this.state.setLatency(latency);
      this.emit('latency', latency);
    });

    this.socket.on('log', (logEntry) => {
      this.emit('log', logEntry);
    });

    this.socket.on('chat', (chat) => {
      this.emit('chat', chat);
    });

    this.state.on('change', () => {
      this.emit('stateChange', this.state.toOverview());
    });
    this.state.on('log', (logEntry) => {
      this.emit('log', { ...logEntry, timestamp: Date.now() });
    });
  }

  private acceptMapPacket(packet: MapPacket): boolean {
    try {
      return this.mapPacketGuard?.(packet, this.state) !== false;
    } catch (error) {
      this.emit('mapPacketGuardError', error, packet);
      return false;
    }
  }

  private acceptWorldPacket(source: 'state' | 'you' | 'snap', packet: Record<string, unknown>): boolean {
    try {
      return this.worldPacketGuard?.(source, packet, this.state) !== false;
    } catch (error) {
      this.emit('worldPacketGuardError', error, source, packet);
      return false;
    }
  }

  private processSnap2Packet(packet: Snap2Packet, recordReceived = true): void {
      if (recordReceived) {
        const receivedAt = Date.now();
        this.snap2Stats.received += 1;
        this.snap2Stats.lastReceivedAt = receivedAt;
        if (Number.isSafeInteger(packet.sq)) this.snap2Stats.lastSequence = packet.sq as number;
        this.snap2Stats.lastPacketFull = ['boolean', 'number', 'string'].includes(typeof packet.full)
          ? packet.full as boolean | number | string : null;
        this.snap2Stats.lastPacketKeys = Object.keys(packet).sort().slice(0, 24);
        const fullMonsterRows = Array.isArray(packet.ef) ? packet.ef.length : 0;
        const patchMonsterRows = Array.isArray(packet.e) ? packet.e.length : 0;
        this.snap2Stats.monsterRowsSeen += fullMonsterRows;
        this.snap2Stats.monsterPatchRowsSeen += patchMonsterRows;
        if (fullMonsterRows + patchMonsterRows > 0) this.snap2Stats.lastMonsterRowsAt = receivedAt;
        if (packet.full === true || packet.full === 1 || packet.full === '1') this.snap2Stats.fullReceived += 1;
        if (packet.full === true || packet.full === 1 || packet.full === '1') {
          const players = Array.isArray(packet.pf) ? packet.pf : [];
          const monsters = Array.isArray(packet.ef) ? packet.ef : [];
          const player = players[0] && typeof players[0] === 'object' ? players[0] as Record<string, unknown> : null;
          const monster = monsters[0] && typeof monsters[0] === 'object' ? monsters[0] as Record<string, unknown> : null;
          this.snap2Stats.lastFullShape = {
            players: players.length,
            monsters: monsters.length,
            playerIdType: player && player.id !== undefined ? typeof player.id : null,
            monsterIdType: monster && monster.id !== undefined ? typeof monster.id : null,
            playerKeys: player ? Object.keys(player).sort().slice(0, 16) : [],
            monsterKeys: monster ? Object.keys(monster).sort().slice(0, 16) : [],
          };
          this.snap2Stats.lastFullSequence = typeof packet.sq === 'number' || typeof packet.sq === 'string'
            ? packet.sq : null;
          this.snap2Stats.lastFullEpoch = typeof packet.ep === 'number' || typeof packet.ep === 'string'
            ? packet.ep : null;
        }
      }
      const receivedAt = Date.now();
      if (!this.state.mapKnown || !this.state.khuKnown) {
        // Do not lose the recovery signal when the first full snapshot races
        // the map packet during login or a portal transition.
        if (packet.full === true) this.pendingSnap2Full = packet;
        this.snap2ResyncPending = true;
        this.snap2Stats.lastRejectReason = 'context_pending';
        return;
      }
      const result = this.snap2Reducer.apply(packet, {
        mapId: this.state.mapId,
        khu: this.state.khu,
        contextEpoch: this.state.contextEpoch,
        ...(this.mapEpoch === undefined ? {} : { mapEpoch: this.mapEpoch }),
      });
      if (result.ok) {
        this.snap2Stats.accepted += 1;
        this.snap2Stats.lastAcceptedAt = receivedAt;
        this.snap2Stats.lastRejectReason = null;
        this.snap2ResyncPending = false;
        this.state.worldUpdatedAt = result.snapshot.observedAt;
        this.state.applySelfEntry(result.snapshot.players, result.snapshot.observedAt);
        this.emit('worldSnapshot', result.snapshot);
      } else if (result.reason === 'gap' || result.reason === 'invalid' || result.reason === 'needs_full') {
        this.snap2Stats.lastRejectReason = result.reason;
        if (packet.full === true || packet.full === 1 || packet.full === '1') {
          this.snap2Stats.fullRejected += 1;
          this.snap2Stats.lastFullRejectReason = result.reason;
        }
        this.requestSnap2Resync(result.reason);
      } else {
        this.snap2Stats.lastRejectReason = result.reason;
        if (packet.full === true || packet.full === 1 || packet.full === '1') {
          this.snap2Stats.fullRejected += 1;
          this.snap2Stats.lastFullRejectReason = result.reason;
        }
      }
  }

  private requestSnap2Resync(reason: 'gap' | 'invalid' | 'needs_full'): void {
    this.emit('worldSnapshotResync', { reason });
    this.snap2ResyncPending = true;
    this.flushSnap2Resync();
  }

  private flushSnap2Resync(): void {
    if (!this.snap2ResyncPending || !this.state.mapKnown || !this.state.khuKnown || !this.socket.isConnected()) return;
    const now = Date.now();
    if (now - this.lastSnap2ResyncAt < 1_000) return;
    if (!this.socket.sendRaw({ op: 'resync' })) return;
    this.lastSnap2ResyncAt = now;
    this.snap2ResyncPending = false;
    this.snap2Stats.resyncs += 1;
  }

  private resetSnap2Stats(): void {
    this.snap2Stats = {
      received: 0,
      accepted: 0,
      resyncs: 0,
      legacyReceived: 0,
      fullReceived: 0,
      fullRejected: 0,
      lastSequence: null,
      lastReceivedAt: null,
      lastAcceptedAt: null,
      lastLegacyReceivedAt: null,
      lastPacketFull: null,
      lastPacketKeys: [],
      lastFullSequence: null,
      lastFullEpoch: null,
      lastFullShape: null,
      lastFullRejectReason: null,
      lastRejectReason: null,
      monsterRowsSeen: 0,
      monsterPatchRowsSeen: 0,
      lastMonsterRowsAt: null,
    };
  }

  public connect(): void {
    this.socket.connect();
  }

  public disconnect(): void {
    this.socket.disconnect();
  }

  /** Disconnect and release timers (token refresh). The instance must not be reused afterwards. */
  public dispose(): void {
    this.socket.disconnect();
    this.tokens.stop();
  }

  public isConnected(): boolean {
    return this.socket.isConnected();
  }

  public getSnap2Stats(): Snap2RuntimeStats {
    return { ...this.snap2Stats };
  }

  public getOverview(): CharacterOverview {
    return this.state.toOverview();
  }

  public log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    this.emit('log', { level, message, timestamp: Date.now() });
  }

  // ===================== GAME ACTIONS WITH JITTER ===================== //

  /**
   * Bán đồ cho NPC Thương Nhân (item.sell)
   */
  public async sellItem(itemId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Thương Nhân] Đang bán vật phẩm: ${itemId}`);
      const ack = await this.socket.sendCmd('item.sell', { itemId });
      if (ack.ok) {
        this.log('success', `[Thương Nhân] Bán thành công ${itemId}. ${ack.toast || ''}`);
      } else {
        this.log('warn', `[Thương Nhân] Không thể bán ${itemId}: ${ack.why || 'Từ chối'}`);
      }
      return ack;
    });
  }

  /**
   * Mua Dược phẩm / Đan dược (food.buy)
   */
  public async buyFood(itemId: string, quantity: number = 1): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Tiệm Thuốc] Đang mua ${quantity}x ${itemId}`);
      const ack = await this.socket.sendCmd('food.buy', { itemId, n: quantity });
      if (ack.ok) {
        this.log('success', `[Tiệm Thuốc] Mua thành công ${quantity}x ${itemId}`);
      } else {
        this.log('warn', `[Tiệm Thuốc] Mua ${itemId} thất bại: ${ack.why || 'Lỗi'}`);
      }
      return ack;
    });
  }

  /**
   * Dùng dược phẩm hồi phục (food.eat hoặc bag.useItem)
   */
  public async eatFood(itemId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Hồi Phục] Đang dùng dược phẩm: ${itemId}`);
      const ack = await this.socket.sendCmd('food.eat', { itemId });
      return ack;
    });
  }

  public async useBagItem(itemId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Túi Đồ] Sử dụng vật phẩm: ${itemId}`);
      return await this.socket.sendCmd('bag.useItem', { itemId });
    });
  }

  /**
   * Mua Phù Chú (talisman.buy)
   */
  public async buyTalisman(id: string, quantity: number = 1): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Phù Chú] Mua ${quantity}x phù ${id}`);
      return await this.socket.sendCmd('talisman.buy', { id, n: quantity });
    });
  }

  /**
   * Trang bị / Tháo đồ (item.equip / item.unequip)
   */
  public async equipItem(itemId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Trang Bị] Mặc trang bị: ${itemId}`);
      return await this.socket.sendCmd('item.equip', { itemId });
    });
  }

  public async unequipItem(slotId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Trang Bị] Tháo trang bị ô: ${slotId}`);
      return await this.socket.sendCmd('item.unequip', { slotId });
    });
  }

  /**
   * Vứt bỏ vật phẩm (item.discard)
   */
  public async discardItem(itemId: string, qty: number = 1): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Túi Đồ] Vứt bỏ ${qty}x ${itemId}`);
      return await this.socket.sendCmd('item.discard', { itemId, qty });
    });
  }

  /**
   * Mở rộng ô túi đồ (bag.expand)
   */
  public async expandBag(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Túi Đồ] Yêu cầu mở rộng ô túi đồ...`);
      return await this.socket.sendCmd('bag.expand');
    });
  }

  /**
   * Tọa thiền / Đứng dậy (meditate)
   */
  public async meditate(on: boolean = true): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Tu Luyện] ${on ? 'Bắt đầu ngồi thiền' : 'Đứng dậy'}`);
      return await this.socket.sendCmd('meditate', { on: on ? 1 : 0 });
    });
  }

  /**
   * Đột phá cảnh giới (breakthrough)
   */
  public async breakthrough(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Cảnh Giới] Đang tiến hành đột phá cảnh giới!`);
      const ack = await this.socket.sendCmd('breakthrough');
      if (ack.ok) {
        this.log('success', `[Cảnh Giới] Đột phá thành công! ${ack.toast || ''}`);
      } else {
        this.log('warn', `[Cảnh Giới] Đột phá chưa thành: ${ack.why || ''}`);
      }
      return ack;
    });
  }

  /**
   * Dược Điền: Gieo hạt (farm.sow)
   */
  public async farmSow(plot: number, seed: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Dược Điền] Gieo hạt "${seed}" vào luống ${plot}`);
      return await this.socket.sendCmd('farm.sow', { plot, seed });
    });
  }

  /**
   * Dược Điền: Tưới nước (farm.water)
   */
  public async farmWater(plot: number): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Dược Điền] Tưới nước luống ${plot}`);
      return await this.socket.sendCmd('farm.water', { plot });
    });
  }

  /**
   * Dược Điền: Thu hoạch (farm.harvest)
   */
  public async farmHarvest(plot: number): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Dược Điền] Thu hoạch luống ${plot}`);
      return await this.socket.sendCmd('farm.harvest', { plot });
    });
  }

  /**
   * Điểm danh hàng ngày (diemdanh)
   */
  public async dailyCheckin(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Phúc Lợi] Thực hiện điểm danh hàng ngày...`);
      const ack = await this.socket.sendCmd('diemdanh');
      if (ack.ok) {
        this.log('success', `[Phúc Lợi] Điểm danh thành công! ${ack.toast || ''}`);
      } else {
        this.log('warn', `[Phúc Lợi] Điểm danh: ${ack.why || 'Đã nhận hôm nay'}`);
      }
      return ack;
    });
  }

  /**
   * Đóng góp Tông Môn (sect.dongGop)
   */
  public async sectDonate(stones: number = 100): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Tông Môn] Đóng góp ${stones} linh thạch`);
      return await this.socket.sendCmd('sect.dongGop', { stones });
    });
  }

  /**
   * Chặt cây Tông Môn (sect.nv.chatCay)
   */
  public async sectChopTree(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Tông Môn] Thực hiện nhiệm vụ chặt cây`);
      return await this.socket.sendCmd('sect.nv.chatCay');
    });
  }

  /**
   * Nói chuyện / Flag NPC (talk)
   */
  public async talkNpc(flag: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Nhiệm Vụ] Tương tác NPC cờ hội thoại: "${flag}"`);
      return await this.socket.sendCmd('talk', { flag });
    });
  }

  /**
   * Trả nhiệm vụ chính tuyến (quest.turnIn)
   */
  public async questTurnIn(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Nhiệm Vụ] Trả nhiệm vụ chính tuyến nhận thưởng...`);
      const ack = await this.socket.sendCmd('quest.turnIn');
      if (ack.ok) {
        this.log('success', `[Nhiệm Vụ] Đã trả xong quest! ${ack.toast || ''}`);
      }
      return ack;
    });
  }

  /**
   * Nhiệm vụ Ngày: Bắt đầu (seed.start)
   */
  public async seedStart(taskId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Nhiệm Vụ Ngày] Bắt đầu tác vụ: ${taskId}`);
      return await this.socket.sendCmd('seed.start', { taskId });
    });
  }

  /**
   * Nhiệm vụ Ngày: Thu thập đạo cụ (seed.collect)
   */
  public async seedCollect(propId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Nhiệm Vụ Ngày] Thu thập đạo cụ: ${propId}`);
      return await this.socket.sendCmd('seed.collect', { propId });
    });
  }

  /**
   * Nhiệm vụ Ngày: Hoàn thành (seed.complete)
   */
  public async seedComplete(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Nhiệm Vụ Ngày] Nộp hoàn thành nhiệm vụ ngày`);
      return await this.socket.sendCmd('seed.complete');
    });
  }

  /**
   * Hang Động: Bắt đầu (cave.start)
   */
  public async caveStart(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Bí Cảnh] Bước vào hang động bí cảnh`);
      return await this.socket.sendCmd('cave.start');
    });
  }

  /**
   * Hang Động: Mở rương (cave.chest)
   */
  public async caveChest(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Bí Cảnh] Mở rương báu hang động`);
      return await this.socket.sendCmd('cave.chest');
    });
  }

  /**
   * Tấn công quái thường (attack opcode)
   */
  public attackMob(targetId: string): boolean {
    const key = `attack:${targetId}`;
    const entry = this.operationLedger.begin('attack', key);
    if (!entry) return false;
    const sent = this.socket.sendRaw({
      op: 'attack',
      targetId,
    });
    if (!sent) this.operationLedger.fail(key);
    return sent;
  }

  /**
   * Xuất chiêu / Kỹ năng (skill opcode)
   */
  public castSkill(skillId: string, targetId: string): boolean {
    const key = `skill:${skillId}:${targetId}`;
    const entry = this.operationLedger.begin('skill', key);
    if (!entry) return false;
    const sent = this.socket.sendRaw({
      op: 'skill',
      skillId,
      targetId,
    });
    if (!sent) this.operationLedger.fail(key);
    return sent;
  }

  /**
   * Nhặt vật phẩm rơi trên đất (loot.pick)
   */
  public async pickLoot(lootId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      return await this.socket.sendCmd('loot.pick', { lootId });
    });
  }

  /**
   * Thu hái thảo dược mạch linh (resource.harvest)
   */
  public async harvestResource(resId: string): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('info', `[Thu Thập] Đang hái linh mộc/linh chi: ${resId}`);
      return await this.socket.sendCmd('resource.harvest', { resId });
    });
  }

  /**
   * Câu cá (fishing.catch)
   */
  public async catchFish(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      return await this.socket.sendCmd('fishing.catch');
    });
  }

  /**
   * Di chuyển nhân vật (move opcode)
   */
  public async sendMove(
    x: number,
    y: number,
    dir: Direction = 2,
    st: MoveState = 'walk',
    shouldSend: () => boolean = () => true
  ): Promise<boolean> {
    // Movement is a continuous game stream, unlike inventory/combat actions.
    // Sending it through the human-action jitter queue (300–700ms) makes the
    // stream unlike the official client (~10Hz) and can leave the server's
    // movement validator with stale position/sequence state. Build and send
    // the packet at transmission time, and consume seq only on success.
    if (!shouldSend()) return false;
    const nextSeq = this.moveSeq + 1;
    const movePkt: MovePacket = {
      op: 'move',
      seq: nextSeq,
      x: Math.round(x),
      y: Math.round(y),
      dir,
      st,
      fly: 0,
      fs: 0,
      ...(this.mapEpoch === undefined ? {} : { ep: this.mapEpoch }),
    };
    const sent = this.socket.sendRaw(movePkt);
    if (sent) {
      this.moveSeq = nextSeq;
      this.socket.recordOutboundMove({ seq: movePkt.seq, x: movePkt.x, y: movePkt.y, ep: movePkt.ep });
    }
    return sent;
  }

  /** Request entry into another map. The game protocol does not expose a khu/area selector. */
  public async enterMap(mapId: string, shouldSend: () => boolean = () => true): Promise<boolean> {
    return this.antiDetection.enqueue(async () => {
      if (!shouldSend()) return false;
      this.log('info', `[Bản Đồ] Yêu cầu chuyển tới map: ${mapId}`);
      return this.socket.sendRaw({ op: 'enter', mapId });
    });
  }

  /**
   * Thoát kẹt map (thoatKet)
   */
  public async escapeStuck(): Promise<AckPacket> {
    return this.antiDetection.enqueue(async () => {
      this.log('warn', `[Cứu Kẹt] Gửi lệnh thoát kẹt map`);
      return await this.socket.sendCmd('thoatKet');
    });
  }

  /**
   * Gửi tin nhắn thế giới (chat)
   */
  public sendWorldChat(text: string): boolean {
    return this.socket.sendRaw({
      op: 'chat',
      text,
      channel: 'world',
    });
  }
}
