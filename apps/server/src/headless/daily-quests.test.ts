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

class FakeDailyClient implements DailyClient {
  public now = 0;
  public inGame = true;
  public ready = true;
  public down = false;
  public auto = false;
  public hurt = 0;
  public walk: WalkOperation | null = null;
  public command = '';
  public commandCount = 0;
  public resourceProps: DailyProp[] = [
    { id: 'linh_chi_1', type: 'ling_chi_prop', x: 100, y: 100 },
    { id: 'linh_chi_2', type: 'ling_chi_prop', x: 200, y: 100 },
    { id: 'linh_chi_3', type: 'ling_chi_prop', x: 300, y: 100 },
  ];
  public resolveAck: ((ack: DailyAck) => void) | null = null;
  public state: DailyClientState = {
    today: '2026-10-08', stage: 21, checkin: { done: false, total: 0 }, seedTasks: [task], activeSeedTask: null,
    stones: 100, duocCong: 4, canhKho: 0, namLinhChi: 0, activeCollected: 0, activeRequired: null, drops: [],
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
    this.walk = { operationId: `walk-${this.now}`, target: request.target ?? null, resolvedTarget: request.target ?? null, status: 'accepted', requester: 'daily', startedAt: this.now, updatedAt: this.now };
    return this.walk;
  }
  public readDailyState(): DailyClientState { return { ...this.state, checkin: { ...this.state.checkin }, seedTasks: this.state.seedTasks.map((item) => ({ ...item })), drops: this.state.drops.map((item) => ({ ...item })) }; }
  public getProp(_mapId: string, propId: string): DailyProp | null { return { id: propId, x: 100, y: 100, r: 58 }; }
  public startChopping(_prop: DailyProp): boolean { return true; }
  public invokeCheckin(): unknown { return true; }
  public listProps(_mapId: string, type: string): DailyProp[] { return this.resourceProps.filter((prop) => prop.type === type).map((prop) => ({ ...prop })); }
  public getPosition(): { mapId: string; x: number; y: number } { return { mapId: 'tan_vien', x: 100, y: 100 }; }
  public harvestResource(_propId: string): unknown { this.commandCount += 1; return true; }
  public startSeedQuest(taskId: string): unknown { this.commandCount += 1; this.state.activeSeedTask = taskId; this.state.activeRequired = taskId === 'linh_chi' ? 3 : 5; return true; }
  public completeSeedQuest(): unknown {
    this.commandCount += 1;
    const taskId = this.state.activeSeedTask;
    this.state.activeSeedTask = null;
    this.state.activeCollected = 0;
    this.state.namLinhChi = taskId === 'linh_chi' ? 0 : this.state.namLinhChi;
    this.state.activeRequired = null;
    this.state.stones = (this.state.stones ?? 0) + (taskId === 'linh_chi' ? 10 : 20);
    this.state.duocCong = (this.state.duocCong ?? 0) + (taskId === 'linh_chi' ? 1 : 3);
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
