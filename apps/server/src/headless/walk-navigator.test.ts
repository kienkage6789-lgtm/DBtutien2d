import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WalkError,
  WalkNavigator,
  type WalkMap,
  type WalkNavigatorClient,
  type WalkPathfinder,
  type WalkPlayer,
} from './walk-navigator.js';

class FakePlayer implements WalkPlayer {
  public x = 48;
  public y = 48;
  public path: unknown[] = [];
  public state = 'idle';
  public downed = false;
  public stopCount = 0;

  public setPath(route: unknown[]): void { this.path = route; }
  public stop(): void { this.path = []; this.stopCount += 1; }
}

class FakeWalkClient implements WalkNavigatorClient {
  public now = 0;
  public inGame = true;
  public mapReady = true;
  public transitioning = false;
  public mapId: string | null = 'map-a';
  public autoRequested = false;
  public supervisorPhase = 'idle';
  public readonly player = new FakePlayer();
  public readonly map: WalkMap = { width: 10, height: 10, pxWidth: 320, pxHeight: 320 };
  public portals: Array<{ tx: number; ty: number }> = [];
  public routeResult: unknown[] = [{ x: 112, y: 112 }];
  public routeCalls: unknown[][] = [];
  public logs: Array<{ code: string; reasonCode?: string; at: number }> = [];
  public readonly pathfinder: WalkPathfinder = {
    route: (...args) => {
      this.routeCalls.push(args);
      return this.routeResult;
    },
  };

  public nowMs(): number { return this.now; }
  public isInGame(): boolean { return this.inGame; }
  public isMapReady(): boolean { return this.mapReady; }
  public isTransitioning(): boolean { return this.transitioning; }
  public getMapId(): string | null { return this.mapId; }
  public getMap(): WalkMap | null { return this.mapReady ? this.map : null; }
  public getPlayer(): WalkPlayer | null { return this.inGame ? this.player : null; }
  public isDown(player: WalkPlayer): boolean { return player.downed === true || player.state === 'down'; }
  public isAutoRequested(): boolean { return this.autoRequested; }
  public getSupervisorPhase(): string { return this.supervisorPhase; }
  public getPathfinder(): WalkPathfinder | null { return this.mapReady ? this.pathfinder : null; }
  public getHitbox(): { width: number; height: number } { return { width: 16, height: 12 }; }
  public getPortals(): Array<{ tx: number; ty: number }> { return this.portals; }
  public recordLog(event: { code: string; reasonCode?: string; at: number }): void { this.logs.push(event); }
}

const request = { target: { x: 112, y: 112 }, requester: 'user' as const };

function expectWalkError(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => error instanceof WalkError && error.code === code);
}

test('walk navigator routes through the vendor pathfinder and arrives at the snapped waypoint', () => {
  const client = new FakeWalkClient();
  client.routeResult = [{ x: 80, y: 48 }, { x: 112, y: 112 }];
  const navigator = new WalkNavigator(client, { createOperationId: () => 'operation-test' });

  const accepted = navigator.walkTo(request);
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(accepted.resolvedTarget, { x: 112, y: 112 });
  assert.deepEqual(client.routeCalls[0]?.slice(1), [48, 48, 112, 112, 8, 12]);
  assert.deepEqual(client.player.path, client.routeResult);

  client.now = 100;
  navigator.tick();
  assert.equal(navigator.getOperation()?.status, 'running');
  client.player.x = 112;
  client.player.y = 112;
  client.player.path = [];
  client.now = 200;
  navigator.tick();
  assert.equal(navigator.getOperation()?.status, 'arrived');
  assert.equal(client.player.stopCount, 1);
  assert.deepEqual(client.logs.map((log) => log.code), ['move_to_accepted', 'move_to_arrived']);
});

test('walk navigator rejects the specified start gates', () => {
  const cases: Array<[string, (client: FakeWalkClient) => void]> = [
    ['NOT_IN_GAME', (client) => { client.inGame = false; }],
    ['VENDOR_MAP_NOT_READY', (client) => { client.mapReady = false; }],
    ['CHARACTER_DOWN', (client) => { client.player.downed = true; }],
    ['AUTO_ACTIVE', (client) => { client.autoRequested = true; }],
    ['AUTO_ACTIVE', (client) => { client.supervisorPhase = 'traveling'; }],
    ['TARGET_INVALID', () => {}],
    ['TARGET_UNREACHABLE', (client) => { client.routeResult = []; }],
    ['TARGET_ON_PORTAL', (client) => { client.portals = [{ tx: 3, ty: 3 }]; }],
  ];

  for (const [code, setup] of cases) {
    const client = new FakeWalkClient();
    setup(client);
    const target = code === 'TARGET_INVALID' ? { target: { x: 320, y: 112 }, requester: 'user' } : request;
    expectWalkError(() => new WalkNavigator(client).walkTo(target), code);
  }

  const inProgressClient = new FakeWalkClient();
  const navigator = new WalkNavigator(inProgressClient);
  navigator.walkTo(request);
  expectWalkError(() => navigator.walkTo({ ...request, target: { x: 144, y: 112 } }), 'OPERATION_IN_PROGRESS');
});

test('cancel stops the player and preserves a cancelled operation', () => {
  const client = new FakeWalkClient();
  const navigator = new WalkNavigator(client);
  const operation = navigator.walkTo(request);
  assert.equal(navigator.cancel(operation.operationId, 'user_cancelled'), true);
  assert.equal(navigator.getOperation()?.status, 'cancelled');
  assert.equal(navigator.getOperation()?.reason, 'user_cancelled');
  assert.equal(client.player.stopCount, 1);
  assert.equal(navigator.cancel(operation.operationId, 'again'), false);
});

test('stuck and timeout are distinct terminal outcomes', () => {
  const stuckClient = new FakeWalkClient();
  const stuckNavigator = new WalkNavigator(stuckClient);
  stuckNavigator.walkTo(request);
  stuckClient.now = 5_000;
  stuckNavigator.tick();
  assert.deepEqual(stuckNavigator.getOperation(), {
    operationId: stuckNavigator.getOperation()?.operationId,
    target: request.target,
    resolvedTarget: { x: 112, y: 112 },
    status: 'blocked',
    reason: 'stuck',
    requester: 'user',
    startedAt: 0,
    updatedAt: 5_000,
  });
  assert.equal(stuckClient.player.stopCount, 1);

  const timeoutClient = new FakeWalkClient();
  const timeoutNavigator = new WalkNavigator(timeoutClient);
  timeoutNavigator.walkTo({ ...request, timeoutMs: 1_000 });
  timeoutClient.now = 1_001;
  timeoutNavigator.tick();
  assert.equal(timeoutNavigator.getOperation()?.status, 'failed');
  assert.equal(timeoutNavigator.getOperation()?.reason, 'timeout');
  assert.equal(timeoutClient.player.stopCount, 1);
});

test('context changes and Auto activation cancel a running walk', () => {
  const client = new FakeWalkClient();
  const navigator = new WalkNavigator(client);
  const operation = navigator.walkTo(request);
  client.now = 10;
  client.autoRequested = true;
  navigator.tick();
  assert.equal(navigator.getOperation()?.operationId, operation.operationId);
  assert.equal(navigator.getOperation()?.status, 'cancelled');
  assert.equal(navigator.getOperation()?.reason, 'auto_started');

  const mapClient = new FakeWalkClient();
  const mapNavigator = new WalkNavigator(mapClient);
  mapNavigator.walkTo(request);
  mapClient.mapId = 'map-b';
  mapClient.now = 10;
  mapNavigator.tick();
  assert.equal(mapNavigator.getOperation()?.status, 'cancelled');
  assert.equal(mapNavigator.getOperation()?.reason, 'map_changed');
});
