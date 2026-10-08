import assert from 'node:assert/strict';
import test from 'node:test';
import { DailyError, DailyQuests, type DailyAck, type DailyClient, type DailyClientState, type DailyProp } from './daily-quests.js';
import type { WalkOperation, WalkRequest } from './walk-navigator.js';

const task = {
  id: 'duoc_moc', name: 'Việc Dược Công', kind: 'collect', limit: 3, runsToday: 0, runsLeft: 3, supported: true, active: false,
};
const linhChiTask = {
  id: 'linh_chi', name: 'Hái Nấm Linh Chi Núi', kind: 'collect', limit: 3, runsToday: 0, runsLeft: 3, supported: true, active: false,
};
const trucGiaTask = {
  id: 'truc_gia', name: 'Chặt Trúc Tâm', kind: 'collect', limit: 3, runsToday: 0, runsLeft: 3, supported: true, active: false,
};

class FakeDailyClient implements DailyClient {
  public now = 0;
  public inGame = true;
  public ready = true;
  public down = false;
  public auto = false;
  public hurt = 0;
  public walk: WalkOperation | null = null;
  /** Map mà nhân vật đang đứng; null = không mô hình hóa vị trí (hành vi cũ của các test đầu tiên). */
  public positionMapId: string | null = null;
  public walkRequests: WalkRequest[] = [];
  public command = '';
  public commandCount = 0;
  public resourceProps: DailyProp[] = [
    { id: 'linh_chi_1', type: 'ling_chi_prop', x: 100, y: 100 },
    { id: 'linh_chi_2', type: 'ling_chi_prop', x: 200, y: 100 },
    { id: 'linh_chi_3', type: 'ling_chi_prop', x: 300, y: 100 },
  ];
  public bambooProps: DailyProp[] = [
    { id: 'truc_gia_1', type: 'seed_bamboo_prop', seedTask: 'truc_gia', x: 120, y: 120, r: 44 },
    { id: 'truc_gia_2', type: 'seed_bamboo_prop', seedTask: 'truc_gia', x: 220, y: 120, r: 44 },
    { id: 'truc_gia_3', type: 'seed_bamboo_prop', seedTask: 'truc_gia', x: 320, y: 120, r: 44 },
    { id: 'truc_gia_4', type: 'seed_bamboo_prop', seedTask: 'truc_gia', x: 420, y: 120, r: 44 },
  ];
  public lastChopPropId: string | null = null;
  public chopMapIds: string[] = [];
  public resolveAck: ((ack: DailyAck) => void) | null = null;
  public state: DailyClientState = {
    today: '2026-10-08', stage: 21, checkin: { done: false, total: 0 }, seedTasks: [task], activeSeedTask: null,
    stones: 100, duocCong: 4, canhKho: 0, namLinhChi: 0, activeCollected: 0, activeCollectedIds: [], activeRequired: null, drops: [],
  };

  public nowMs(): number { return this.now; }
  public isInGame(): boolean { return this.inGame; }
  public isMapReady(): boolean { return this.ready; }
  public isDown(): boolean { return this.down; }
  public isAutoActive(): boolean { return this.auto; }
  public getSupervisorPhase(): string { return 'idle'; }
  public getHurtCount(): number { return this.hurt; }
  public getWalkOperation(): WalkOperation | null { return this.walk; }
  public walkTo(request: WalkRequest): WalkOperation {
    this.walkRequests.push(request);
    if (this.positionMapId !== null && request.targetMapId) this.positionMapId = request.targetMapId;
    this.walk = { operationId: `walk-${this.now}`, target: request.target ?? null, resolvedTarget: request.target ?? null, status: 'accepted', requester: 'daily', startedAt: this.now, updatedAt: this.now };
    return this.walk;
  }
  public readDailyState(): DailyClientState { return { ...this.state, checkin: { ...this.state.checkin }, seedTasks: this.state.seedTasks.map((item) => ({ ...item })), activeCollectedIds: [...this.state.activeCollectedIds], drops: this.state.drops.map((item) => ({ ...item })) }; }
  public getProp(_mapId: string, propId: string): DailyProp | null { return { id: propId, x: 100, y: 100, r: 58 }; }
  public startChopping(prop: DailyProp, mapId: string = 'duoc_vien'): boolean { this.lastChopPropId = prop.id; this.chopMapIds.push(mapId); return true; }
  public invokeCheckin(): unknown { return true; }
  public listProps(mapId: string, type: string): DailyProp[] {
    // Mô hình đúng client: cây Linh Chi chỉ đọc được từ map đang tải.
    if (this.positionMapId !== null && mapId !== this.positionMapId) return [];
    const source = type === 'seed_bamboo_prop' ? this.bambooProps : this.resourceProps;
    return source.filter((prop) => prop.type === type).map((prop) => ({ ...prop }));
  }
  public getPosition(): { mapId: string; x: number; y: number } | null { return this.positionMapId ? { mapId: this.positionMapId, x: 100, y: 100 } : null; }
  public harvestResource(_propId: string): unknown { this.commandCount += 1; return true; }
  public startSeedQuest(taskId: string): unknown { this.commandCount += 1; this.state.activeSeedTask = taskId; this.state.activeRequired = taskId === 'linh_chi' ? 3 : 5; return true; }
  public completeSeedQuest(): unknown {
    this.commandCount += 1;
    const taskId = this.state.activeSeedTask;
    this.state.activeSeedTask = null;
    this.state.activeCollected = 0;
    this.state.activeCollectedIds = [];
    this.state.namLinhChi = taskId === 'linh_chi' ? 0 : this.state.namLinhChi;
    this.state.activeRequired = null;
    // Phần thưởng thật đã đo: linh_chi 10 Linh Thạch + 1 Dược Công, truc_gia 15 + 1, duoc_moc 20 + 3.
    const reward = taskId === 'linh_chi' ? { stones: 10, duocCong: 1 } : taskId === 'truc_gia' ? { stones: 15, duocCong: 1 } : { stones: 20, duocCong: 3 };
    this.state.stones = (this.state.stones ?? 0) + reward.stones;
    this.state.duocCong = (this.state.duocCong ?? 0) + reward.duocCong;
    return true;
  }
  public issueCommand(command: string, action: () => unknown): Promise<DailyAck> {
    this.command = command;
    this.commandCount += 1;
    action();
    return new Promise<DailyAck>((resolve) => { this.resolveAck = resolve; });
  }
  public watchCommand(command: string): Promise<DailyAck> {
    this.command = command;
    return new Promise<DailyAck>((resolve) => { this.resolveAck = resolve; });
  }
  public cancelPendingCommand(): void { this.resolveAck = null; }
  public collectSeedMaterial(): unknown { return true; }
  public cancelSeedQuest(): unknown { this.state.activeSeedTask = null; return true; }
  public recordLog(): void {}
  public ack(ack: DailyAck): void { this.resolveAck?.(ack); this.resolveAck = null; }
}

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

test('DailyQuests điểm danh thành công qua walk và ACK theo cmd', async () => {
  const client = new FakeDailyClient();
  const daily = new DailyQuests(client);
  const operation = daily.startCheckin();
  assert.equal(operation.status, 'accepted');
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.command, 'diemdanh');
  client.state.checkin = { done: true, total: 1 };
  client.state.stones = 110;
  client.ack({ cmd: 'diemdanh', ok: true });
  await flush();
  daily.tick();
  assert.equal(daily.getOperation()?.status, 'done');
  assert.deepEqual(daily.getOperation()?.rewards, { stones: 10, duocCong: 0 });
});

test('DailyQuests không retry ACK bị từ chối và giữ why server', async () => {
  const client = new FakeDailyClient();
  const daily = new DailyQuests(client);
  daily.startCheckin();
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  client.ack({ cmd: 'diemdanh', ok: false, why: 'không đứng cạnh Mạnh ShopT1' });
  await flush();
  daily.tick();
  assert.equal(client.commandCount, 1);
  assert.equal(daily.getOperation()?.status, 'failed');
  assert.equal(daily.getOperation()?.why, 'không đứng cạnh Mạnh ShopT1');
});

test('DailyQuests từ chối stage thấp, việc khác đang hoạt động và đã điểm danh', () => {
  const client = new FakeDailyClient();
  const daily = new DailyQuests(client);
  client.state.checkin.done = true;
  assert.throws(() => daily.startCheckin(), (error: unknown) => error instanceof DailyError && error.code === 'ALREADY_DONE');
  client.state.checkin.done = false;
  client.state.stage = 7;
  assert.throws(() => daily.startSeedTask('duoc_moc'), (error: unknown) => error instanceof DailyError && error.code === 'STAGE_TOO_LOW');
  client.state.stage = 21;
  client.state.activeSeedTask = 'linh_chi';
  assert.throws(() => daily.startSeedTask('duoc_moc'), (error: unknown) => error instanceof DailyError && error.code === 'OTHER_SEED_TASK_ACTIVE');
});

test('DailyQuests chặn Auto, gục, thao tác đang chạy, hết lượt và việc chưa hỗ trợ', () => {
  const client = new FakeDailyClient();
  const daily = new DailyQuests(client);
  client.auto = true;
  assert.throws(() => daily.startCheckin(), (error: unknown) => error instanceof DailyError && error.code === 'AUTO_ACTIVE');
  client.auto = false;
  client.walk = { operationId: 'user-walk', target: { x: 1, y: 1 }, resolvedTarget: { x: 1, y: 1 }, status: 'running', requester: 'user', startedAt: 0, updatedAt: 0 };
  assert.throws(() => daily.startCheckin(), (error: unknown) => error instanceof DailyError && error.code === 'OPERATION_IN_PROGRESS');
  client.walk = null;
  client.state.seedTasks = [{ ...task, runsLeft: 0 }, { ...task, id: 'linh_chi', name: 'Việc khác', supported: false }];
  assert.throws(() => daily.startSeedTask('duoc_moc'), (error: unknown) => error instanceof DailyError && error.code === 'NO_RUNS_LEFT');
  assert.throws(() => daily.startSeedTask('linh_chi'), (error: unknown) => error instanceof DailyError && error.code === 'TASK_NOT_SUPPORTED');

  const downClient = new FakeDailyClient();
  const downDaily = new DailyQuests(downClient);
  const operation = downDaily.startCheckin();
  downClient.down = true;
  downDaily.tick();
  assert.equal(downDaily.getOperation()?.status, 'cancelled');
  assert.equal(downDaily.getOperation()?.reason, 'character_down');
  assert.equal(downDaily.cancel(operation.operationId, 'again'), false);
});

test('DailyQuests tiếp tục duoc_moc đang hoạt động mà không gọi seed.start lại', () => {
  const client = new FakeDailyClient();
  client.state.activeSeedTask = 'duoc_moc';
  client.state.activeCollected = 2;
  const daily = new DailyQuests(client);
  const operation = daily.startSeedTask('duoc_moc');
  assert.equal(operation.step, 'seed_walk_tree');
  daily.tick();
  assert.notEqual(client.command, 'seed.start');
  assert.equal(client.walk?.requester, 'daily');
});

test('DailyQuests hủy khi Auto bật hoặc bị gục và hủy không gửi lại lệnh', () => {
  const client = new FakeDailyClient();
  const daily = new DailyQuests(client);
  const operation = daily.startCheckin();
  client.auto = true;
  daily.tick();
  assert.equal(daily.getOperation()?.status, 'cancelled');
  assert.equal(daily.getOperation()?.reason, 'auto_started');
  assert.equal(daily.cancel(operation.operationId, 'again'), false);
});

test('DailyQuests giới hạn ACK timeout mà không retry mù', () => {
  const client = new FakeDailyClient();
  const daily = new DailyQuests(client);
  daily.startCheckin();
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.commandCount, 1);
  client.now = 6_000;
  daily.tick();
  assert.equal(daily.getOperation()?.status, 'failed');
  assert.equal(daily.getOperation()?.reason, 'ACK_TIMEOUT');
});

test('DailyQuests duoc_moc dùng ACK seed.collect do client tự nhặt và hoàn tất nhiều lượt', async () => {
  const client = new FakeDailyClient();
  const daily = new DailyQuests(client);
  daily.startSeedTask('duoc_moc', 2);

  const arrive = (): void => {
    daily.tick();
    client.walk!.status = 'arrived';
    daily.tick();
  };

  const acceptSeed = async (): Promise<void> => {
    arrive();
    daily.tick();
    assert.equal(client.command, 'seed.start');
    client.ack({ cmd: 'seed.start', ok: true });
    await flush();
    daily.tick();
  };

  const collectBranch = async (index: number): Promise<void> => {
    arrive();
    daily.tick();
    client.state.drops = [{ task: 'duoc_moc', materialId: `canh_kho_${index}`, state: 'ground', x: 110, y: 110 }];
    daily.tick();
    daily.tick();
    client.walk!.status = 'arrived';
    daily.tick();
    daily.tick();
    assert.equal(client.command, 'seed.collect');
    client.state.drops = [];
    client.state.activeCollected = index;
    client.ack({ cmd: 'seed.collect', ok: true });
    await flush();
    daily.tick();
    daily.tick();
  };

  await acceptSeed();
  for (let index = 1; index <= 5; index += 1) await collectBranch(index);
  arrive();
  daily.tick();
  assert.equal(client.command, 'seed.complete');
  client.ack({ cmd: 'seed.complete', ok: true });
  await flush();
  daily.tick();
  daily.tick();
  assert.equal(daily.getOperation()?.runIndex, 2);

  await acceptSeed();
  for (let index = 1; index <= 5; index += 1) await collectBranch(index);
  arrive();
  daily.tick();
  assert.equal(client.command, 'seed.complete');
  client.ack({ cmd: 'seed.complete', ok: true });
  await flush();
  daily.tick();
  assert.equal(daily.getOperation()?.status, 'done');
  assert.deepEqual(daily.getOperation()?.rewards, { stones: 40, duocCong: 6 });
});

async function startLinhChi(client: FakeDailyClient, daily: DailyQuests): Promise<void> {
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.command, 'seed.start');
  client.ack({ cmd: 'seed.start', ok: true });
  await flush();
  daily.tick();
}

async function harvestOne(client: FakeDailyClient, daily: DailyQuests, propId: string, du = false): Promise<void> {
  client.resourceProps = client.resourceProps.map((prop) => prop.id === propId ? { ...prop, x: 100, y: 100 } : prop);
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.command, 'resource.harvest');
  client.state.namLinhChi = (client.state.namLinhChi ?? 0) + 1;
  client.ack({ cmd: 'resource.harvest', ok: true, du, regrowAfter: 12 });
  await flush();
  daily.tick();
}

async function completeLinhChiRun(client: FakeDailyClient, daily: DailyQuests): Promise<void> {
  await startLinhChi(client, daily);
  await harvestOne(client, daily, 'linh_chi_1');
  await harvestOne(client, daily, 'linh_chi_2');
  await harvestOne(client, daily, 'linh_chi_3', true);
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.command, 'seed.complete');
  client.ack({ cmd: 'seed.complete', ok: true, stones: 10, duocCong: 1 });
  await flush();
  daily.tick();
}

test('DailyQuests linh_chi hoàn tất một lượt bằng 3 resource.harvest và phần thưởng đo được', async () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi');
  await startLinhChi(client, daily);
  await harvestOne(client, daily, 'linh_chi_1');
  await harvestOne(client, daily, 'linh_chi_2');
  await harvestOne(client, daily, 'linh_chi_3', true);
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.command, 'seed.complete');
  client.ack({ cmd: 'seed.complete', ok: true, stones: 10, duocCong: 1 });
  await flush();
  daily.tick();
  assert.equal(daily.getOperation()?.status, 'done');
  assert.deepEqual(daily.getOperation()?.rewards, { stones: 10, duocCong: 1 });
  assert.deepEqual(daily.getOperation()?.progress, { itemId: 'nam_linh_chi', collected: 0, required: 3 });
});

test('DailyQuests linh_chi tiếp tục việc dở khi kho đã đủ, không gọi seed.start lại', async () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [task, { ...linhChiTask, active: true }];
  client.state.activeSeedTask = 'linh_chi';
  client.state.namLinhChi = 3;
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi');
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.command, 'seed.complete');
  assert.equal(client.commandCount, 2);
});

test('DailyQuests linh_chi lặp đủ số lượt yêu cầu và reset theo trạng thái server', async () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi', 2);
  await completeLinhChiRun(client, daily);
  assert.equal(daily.getOperation()?.runIndex, 1);
  daily.tick();
  assert.equal(daily.getOperation()?.runIndex, 2);
  await completeLinhChiRun(client, daily);
  assert.equal(daily.getOperation()?.status, 'done');
  assert.deepEqual(daily.getOperation()?.rewards, { stones: 20, duocCong: 2 });
});

test('DailyQuests linh_chi chọn prop khác khi prop đầu đang hồi và không gửi lặp mù', async () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi');
  await startLinhChi(client, daily);
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.command, 'resource.harvest');
  client.ack({ cmd: 'resource.harvest', ok: false, why: 'tài nguyên chưa mọc lại', retryAfter: 2 });
  await flush();
  daily.tick();
  assert.equal(daily.getOperation()?.step, 'seed_walk_resource');
  assert.equal(client.commandCount, 4);
  await harvestOne(client, daily, 'linh_chi_2');
  assert.equal(client.commandCount, 6);
});

test('DailyQuests linh_chi chờ retryAfter khi mọi prop hồi rồi kết thúc NO_HARVESTABLE_PROP sau vài vòng', async () => {
  const client = new FakeDailyClient();
  client.resourceProps = [{ id: 'linh_chi_1', type: 'ling_chi_prop', x: 100, y: 100 }];
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi');
  await startLinhChi(client, daily);
  for (let round = 0; round < 4; round += 1) {
    daily.tick();
    client.walk!.status = 'arrived';
    daily.tick();
    daily.tick();
    client.ack({ cmd: 'resource.harvest', ok: false, why: 'tài nguyên chưa mọc lại', retryAfter: 1 });
    await flush();
    daily.tick();
    client.now += 1_000;
    daily.tick();
  }
  assert.equal(daily.getOperation()?.status, 'failed');
  assert.equal(daily.getOperation()?.reason, 'NO_HARVESTABLE_PROP');
  assert.equal(client.commandCount, 10);
});

test('DailyQuests linh_chi thử đi sát hơn một lần rồi giữ why khi server vẫn từ chối', async () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi');
  await startLinhChi(client, daily);
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  client.ack({ cmd: 'resource.harvest', ok: false, why: 'không đứng cạnh tài nguyên ấy' });
  await flush();
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  client.ack({ cmd: 'resource.harvest', ok: false, why: 'không đứng cạnh tài nguyên ấy' });
  await flush();
  daily.tick();
  assert.equal(daily.getOperation()?.reason, 'ACK_REFUSED');
  assert.equal(daily.getOperation()?.why, 'không đứng cạnh tài nguyên ấy');
  assert.equal(client.commandCount, 6);
});

test('DailyQuests linh_chi không retry harvest khi ACK timeout và Auto bật hủy', async () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi');
  await startLinhChi(client, daily);
  daily.tick();
  client.walk!.status = 'arrived';
  daily.tick();
  daily.tick();
  assert.equal(client.commandCount, 4);
  client.now = 6_000;
  daily.tick();
  assert.equal(daily.getOperation()?.reason, 'ACK_TIMEOUT');

  const autoClient = new FakeDailyClient();
  autoClient.state.seedTasks = [task, linhChiTask];
  const autoDaily = new DailyQuests(autoClient);
  autoDaily.startSeedTask('linh_chi');
  autoClient.auto = true;
  autoDaily.tick();
  assert.equal(autoDaily.getOperation()?.reason, 'auto_started');
});

test('DailyQuests linh_chi hủy giữa chừng không gửi thêm harvest', () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  const operation = daily.startSeedTask('linh_chi');
  daily.tick();
  assert.equal(daily.cancel(operation.operationId, 'user_cancelled'), true);
  assert.equal(daily.getOperation()?.status, 'cancelled');
  const count = client.commandCount;
  daily.tick();
  assert.equal(client.commandCount, count);
});

function drive(client: FakeDailyClient, daily: DailyQuests, until: () => boolean, max = 60): void {
  for (let i = 0; i < max && !until(); i += 1) {
    daily.tick();
    if (client.walk && (client.walk.status === 'accepted' || client.walk.status === 'running')) client.walk.status = 'arrived';
  }
}

test('DailyQuests linh_chi đi theo map trước (duoc_vien -> tan_vien -> duoc_vien) rồi mới đi bộ tới cây và Đại Phu', async () => {
  const client = new FakeDailyClient();
  client.positionMapId = 'duoc_vien';
  client.state.seedTasks = [task, linhChiTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('linh_chi');

  // Nhận việc ở Đại Phu (đã ở duoc_vien: chỉ đi bộ trong map).
  drive(client, daily, () => client.command === 'seed.start');
  assert.equal(client.command, 'seed.start');
  client.ack({ cmd: 'seed.start', ok: true });
  await flush();

  // Chưa ở tan_vien: phải đi theo map (không kèm đích) TRƯỚC khi chọn cây.
  const before = client.walkRequests.length;
  drive(client, daily, () => client.walkRequests.length > before);
  const toMap = client.walkRequests[before];
  assert.equal(toMap.targetMapId, 'tan_vien');
  assert.equal(toMap.target, undefined, 'đi theo map, không kèm toạ độ');

  // Tới tan_vien rồi mới liệt kê cây (map đã tải) và đi bộ tới cây.
  drive(client, daily, () => client.walkRequests.length > before + 1);
  const toProp = client.walkRequests[before + 1];
  assert.ok(toProp.target, 'sau khi ở tan_vien phải đi bộ tới một cây Linh Chi');
  assert.equal(client.getPosition()?.mapId, 'tan_vien');

  // Hái đủ 3 cây.
  for (const id of ['linh_chi_1', 'linh_chi_2', 'linh_chi_3']) {
    drive(client, daily, () => client.command === 'resource.harvest');
    assert.equal(client.command, 'resource.harvest');
    client.state.namLinhChi = (client.state.namLinhChi ?? 0) + 1;
    client.command = '';
    client.ack({ cmd: 'resource.harvest', ok: true, du: id === 'linh_chi_3', regrowAfter: 12 });
    await flush();
  }

  // Về Đại Phu: đi theo map về duoc_vien trước, rồi đi bộ tới NPC trong map đã tải, rồi mới giao việc.
  const beforeReturn = client.walkRequests.length;
  drive(client, daily, () => client.walkRequests.length > beforeReturn);
  assert.equal(client.walkRequests[beforeReturn].targetMapId, 'duoc_vien');
  assert.equal(client.walkRequests[beforeReturn].target, undefined);
  drive(client, daily, () => client.walkRequests.length > beforeReturn + 1);
  assert.ok(client.walkRequests[beforeReturn + 1].target, 'trong duoc_vien phải đi bộ tới sát Đại Phu');
  drive(client, daily, () => client.command === 'seed.complete');
  assert.equal(client.command, 'seed.complete');
});

test('DailyQuests điểm danh từ map khác đi theo map tới tan_vien trước rồi đi bộ tới NPC', async () => {
  const client = new FakeDailyClient();
  client.positionMapId = 'duoc_vien';
  const daily = new DailyQuests(client);
  daily.startCheckin();
  drive(client, daily, () => client.walkRequests.length >= 2);
  assert.equal(client.walkRequests[0].targetMapId, 'tan_vien');
  assert.equal(client.walkRequests[0].target, undefined);
  assert.ok(client.walkRequests[1].target);
  drive(client, daily, () => client.command === 'diemdanh');
  assert.equal(client.command, 'diemdanh');
});

async function acceptTrucGia(client: FakeDailyClient, daily: DailyQuests): Promise<void> {
  drive(client, daily, () => client.command === 'seed.start');
  assert.equal(client.command, 'seed.start');
  client.ack({ cmd: 'seed.start', ok: true });
  await flush();
  daily.tick();
  client.command = '';
}

function chopTrucGia(client: FakeDailyClient, daily: DailyQuests, collect: boolean): string {
  client.lastChopPropId = null;
  drive(client, daily, () => client.lastChopPropId !== null);
  const propId = client.lastChopPropId;
  assert.ok(propId);
  if (collect) {
    client.state.activeCollectedIds.push(propId);
    daily.tick();
  } else {
    client.now += 6_000;
    daily.tick();
  }
  return propId;
}

async function completeTrucGiaRun(client: FakeDailyClient, daily: DailyQuests): Promise<void> {
  await acceptTrucGia(client, daily);
  for (let i = 0; i < 4; i += 1) chopTrucGia(client, daily, true);
  drive(client, daily, () => client.command === 'seed.complete');
  assert.equal(client.command, 'seed.complete');
  client.ack({ cmd: 'seed.complete', ok: true, stones: 15, duocCong: 1 });
  await flush();
  daily.tick();
}

test('DailyQuests truc_gia đi theo map, chọn 4 cây đã tải và giao Đại Phu đúng thứ tự', async () => {
  const client = new FakeDailyClient();
  client.positionMapId = 'duoc_vien';
  client.state.seedTasks = [trucGiaTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('truc_gia');
  await acceptTrucGia(client, daily);
  for (let i = 0; i < 4; i += 1) chopTrucGia(client, daily, true);
  drive(client, daily, () => client.command === 'seed.complete');
  assert.equal(client.command, 'seed.complete');
  assert.deepEqual(client.chopMapIds, ['thanh_truc_lam', 'thanh_truc_lam', 'thanh_truc_lam', 'thanh_truc_lam']);
  const mapOnly = client.walkRequests.filter((request) => request.target === undefined).map((request) => request.targetMapId);
  assert.deepEqual(mapOnly, ['thanh_truc_lam', 'duoc_vien']);
  const bambooWalk = client.walkRequests.find((request) => request.targetMapId === 'thanh_truc_lam' && request.target);
  assert.deepEqual(bambooWalk?.target, { x: 120, y: 136 });
  assert.deepEqual(daily.getOperation()?.progress, { itemId: 'truc_tam', collected: 4, required: 4 });
});

test('DailyQuests truc_gia tiếp tục việc dở từ các prop đã thu và lặp đủ runs', async () => {
  const client = new FakeDailyClient();
  client.positionMapId = 'thanh_truc_lam';
  client.state.seedTasks = [{ ...trucGiaTask, runsLeft: 3 }];
  client.state.activeSeedTask = 'truc_gia';
  client.state.activeCollectedIds = ['truc_gia_1', 'truc_gia_2'];
  const daily = new DailyQuests(client);
  daily.startSeedTask('truc_gia', 2);
  assert.equal(daily.getOperation()?.step, 'seed_walk_tree');
  const first = chopTrucGia(client, daily, true);
  assert.equal(first, 'truc_gia_3');
  const second = chopTrucGia(client, daily, true);
  assert.equal(second, 'truc_gia_4');
  assert.notEqual(client.command, 'seed.start');
  drive(client, daily, () => client.command === 'seed.complete');
  client.ack({ cmd: 'seed.complete', ok: true, stones: 15, duocCong: 1 });
  await flush();
  daily.tick();
  daily.tick();
  assert.equal(daily.getOperation()?.runIndex, 2);
  assert.equal(daily.getOperation()?.step, 'seed_walk_npc');
});

test('DailyQuests truc_gia chạy nhiều lượt và cộng đúng phần thưởng', async () => {
  const client = new FakeDailyClient();
  client.positionMapId = 'duoc_vien';
  client.state.seedTasks = [trucGiaTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('truc_gia', 2);
  await completeTrucGiaRun(client, daily);
  await completeTrucGiaRun(client, daily);
  assert.equal(daily.getOperation()?.status, 'done');
  assert.deepEqual(daily.getOperation()?.rewards, { stones: 30, duocCong: 2 });
  assert.equal(client.chopMapIds.length, 8);
});

test('DailyQuests truc_gia áp sát/chặt lại tối đa 3 lần rồi CHOP_NO_PROGRESS', async () => {
  const client = new FakeDailyClient();
  client.positionMapId = 'thanh_truc_lam';
  client.state.seedTasks = [trucGiaTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('truc_gia');
  await acceptTrucGia(client, daily);
  chopTrucGia(client, daily, false);
  chopTrucGia(client, daily, false);
  chopTrucGia(client, daily, false);
  assert.equal(daily.getOperation()?.status, 'failed');
  assert.equal(daily.getOperation()?.reason, 'CHOP_NO_PROGRESS');
  assert.match(daily.getOperation()?.why ?? '', /distance=/);
  assert.equal(client.chopMapIds.length, 3);
});

test('DailyQuests truc_gia hủy giữa chừng và hủy ngay khi Auto bật', () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [trucGiaTask];
  const daily = new DailyQuests(client);
  const operation = daily.startSeedTask('truc_gia');
  daily.tick();
  assert.equal(daily.cancel(operation.operationId, 'user_cancelled'), true);
  const commandCount = client.commandCount;
  daily.tick();
  assert.equal(client.commandCount, commandCount);

  const autoClient = new FakeDailyClient();
  autoClient.state.seedTasks = [trucGiaTask];
  const autoDaily = new DailyQuests(autoClient);
  autoDaily.startSeedTask('truc_gia');
  autoClient.auto = true;
  autoDaily.tick();
  assert.equal(autoDaily.getOperation()?.status, 'cancelled');
  assert.equal(autoDaily.getOperation()?.reason, 'auto_started');
});

test('DailyQuests truc_gia timeout ACK seed.start không retry mù', () => {
  const client = new FakeDailyClient();
  client.state.seedTasks = [trucGiaTask];
  const daily = new DailyQuests(client);
  daily.startSeedTask('truc_gia');
  drive(client, daily, () => client.command === 'seed.start');
  assert.equal(client.commandCount, 2);
  client.now = 6_000;
  daily.tick();
  assert.equal(daily.getOperation()?.status, 'failed');
  assert.equal(daily.getOperation()?.reason, 'ACK_TIMEOUT');
  assert.equal(client.commandCount, 2);
});
