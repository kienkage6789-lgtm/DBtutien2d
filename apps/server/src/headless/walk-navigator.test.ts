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
  public portals: Array<{ tx: number; ty: number; toMapId?: string }> = [];
  public mapIds = ['map-a', 'map-b', 'map-c'];
  public hurtCount = 0;
  public routeResult: unknown[] = [{ x: 112, y: 112 }];
  public routeCalls: unknown[][] = [];
  public logs: Array<{ code: string; reasonCode?: string; detail?: string; at: number }> = [];
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
  public getPortals(_mapId?: string): Array<{ tx: number; ty: number; toMapId?: string }> { return this.portals; }
  public getMapIds(): string[] { return this.mapIds; }
  public getHurtCount(): number { return this.hurtCount; }
  public recordLog(event: { code: string; reasonCode?: string; detail?: string; at: number }): void { this.logs.push(event); }
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

test('same-map route crossing an automatic portal is rejected when no detour is available', () => {
  const client = new FakeWalkClient();
  client.portals = [{ tx: 3, ty: 3, toMapId: 'map-b' }];
  client.routeResult = [{ x: 112, y: 112 }, { x: 208, y: 112 }];
  expectWalkError(() => new WalkNavigator(client).walkTo({
    target: { x: 208, y: 112 },
    requester: 'user',
  }), 'PATH_CROSSES_PORTAL');
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

test('multi-map walk advances through planned gates and finishes at the destination map', () => {
  const client = new FakeWalkClient();
  client.player.x = 48;
  client.player.y = 48;
  client.getPortals = (mapId: string) => mapId === 'map-a'
    ? [{ tx: 3, ty: 3, toMapId: 'map-b' }]
    : mapId === 'map-b' ? [{ tx: 2, ty: 2, toMapId: 'map-c' }] : [];
  const navigator = new WalkNavigator(client, { createOperationId: () => 'multi-operation' });
  const accepted = navigator.walkTo({ targetMapId: 'map-c', requester: 'user' });
  assert.deepEqual(accepted.route, ['map-a', 'map-b', 'map-c']);
  assert.deepEqual(accepted.leg, { index: 0, fromMapId: 'map-a', toMapId: 'map-b', phase: 'walking_to_gate' });

  client.player.x = 112;
  client.player.y = 112;
  client.player.path = [];
  client.now = 100;
  navigator.tick();
  assert.equal(navigator.getOperation()?.leg?.phase, 'on_gate');
  client.now = 200;
  navigator.tick();
  assert.equal(navigator.getOperation()?.leg?.phase, 'waiting_map');
  client.transitioning = true;
  client.mapId = null;
  client.now = 300;
  navigator.tick();
  client.transitioning = false;
  client.mapId = 'map-b';
  client.player.x = 80;
  client.player.y = 80;
  client.player.path = client.routeResult;
  client.now = 400;
  navigator.tick();
  assert.deepEqual(navigator.getOperation()?.leg, { index: 1, fromMapId: 'map-b', toMapId: 'map-c', phase: 'walking_to_gate' });

  client.player.x = 80;
  client.player.y = 80;
  client.player.path = [];
  client.now = 500;
  navigator.tick();
  client.now = 600;
  navigator.tick();
  client.transitioning = true;
  client.mapId = null;
  client.now = 700;
  navigator.tick();
  client.transitioning = false;
  client.mapId = 'map-c';
  client.now = 800;
  navigator.tick();
  assert.equal(navigator.getOperation()?.status, 'arrived');
  assert.equal(navigator.getOperation()?.leg?.phase, 'walking_to_target');
  assert.equal(client.player.stopCount, 5);
});

test('multi-map walk fails on an unexpected destination and on portal timeout', () => {
  const unexpectedClient = new FakeWalkClient();
  unexpectedClient.getPortals = () => [{ tx: 3, ty: 3, toMapId: 'map-b' }];
  const unexpected = new WalkNavigator(unexpectedClient);
  unexpected.walkTo({ targetMapId: 'map-b', requester: 'user' });
  unexpectedClient.mapId = 'map-c';
  unexpectedClient.now = 100;
  unexpected.tick();
  assert.deepEqual([unexpected.getOperation()?.status, unexpected.getOperation()?.reason], ['failed', 'unexpected_map']);

  const timeoutClient = new FakeWalkClient();
  timeoutClient.getPortals = () => [{ tx: 3, ty: 3, toMapId: 'map-b' }];
  const timeout = new WalkNavigator(timeoutClient);
  timeout.walkTo({ targetMapId: 'map-b', requester: 'user' });
  timeoutClient.player.x = 112;
  timeoutClient.player.y = 112;
  timeoutClient.player.path = [];
  timeoutClient.now = 100;
  timeout.tick();
  timeoutClient.now = 200;
  timeout.tick();
  timeoutClient.now = 8_201;
  timeout.tick();
  assert.deepEqual([timeout.getOperation()?.status, timeout.getOperation()?.reason], ['failed', 'portal_no_transition']);
});

test('multi-map hurt abort uses the configured threshold and can be disabled', () => {
  const abortClient = new FakeWalkClient();
  abortClient.getPortals = () => [{ tx: 3, ty: 3, toMapId: 'map-b' }];
  const abortNavigator = new WalkNavigator(abortClient);
  abortNavigator.walkTo({ targetMapId: 'map-b', requester: 'user', maxHurt: 2 });
  abortClient.hurtCount = 1;
  abortClient.now = 100;
  abortNavigator.tick();
  assert.equal(abortNavigator.getOperation()?.status, 'running');
  abortClient.hurtCount = 2;
  abortClient.now = 200;
  abortNavigator.tick();
  assert.deepEqual([abortNavigator.getOperation()?.status, abortNavigator.getOperation()?.reason], ['cancelled', 'hurt_abort']);

  const continueClient = new FakeWalkClient();
  continueClient.getPortals = () => [{ tx: 3, ty: 3, toMapId: 'map-b' }];
  const continueNavigator = new WalkNavigator(continueClient);
  continueNavigator.walkTo({ targetMapId: 'map-b', requester: 'user', abortOnHurt: false });
  continueClient.hurtCount = 4;
  continueClient.now = 100;
  continueNavigator.tick();
  assert.equal(continueNavigator.getOperation()?.status, 'running');
});

const gateClient = (): FakeWalkClient => {
  const client = new FakeWalkClient();
  client.getPortals = (mapId: string) => mapId === 'map-a' ? [{ tx: 3, ty: 3, toMapId: 'map-b' }] : [];
  return client;
};

test('a transient transition far from the gate is not mistaken for arriving at the gate; the path is re-planned', () => {
  const client = gateClient();
  const navigator = new WalkNavigator(client);
  navigator.walkTo({ targetMapId: 'map-b', requester: 'user' });
  const plannedCalls = client.routeCalls.length;

  // Server resync / stun clears the path while the character is ~90 px from the gate and the client flickers a transition.
  client.player.path = [];
  client.transitioning = true;
  client.mapId = null;
  client.now = 100;
  navigator.tick();
  assert.equal(navigator.getOperation()?.leg?.phase, 'walking_to_gate', 'far from the gate must not enter waiting_map');
  assert.ok(['accepted', 'running'].includes(String(navigator.getOperation()?.status)), 'the operation stays active');

  client.transitioning = false;
  client.mapId = 'map-a';
  client.now = 200;
  navigator.tick();
  assert.equal(navigator.getOperation()?.leg?.phase, 'walking_to_gate');
  assert.equal(client.routeCalls.length, plannedCalls + 1, 'the cleared path is planned again with the same pathfinder');
  assert.ok(client.player.path.length > 0);
  const replan = client.logs.find((log) => log.code === 'move_to_replan');
  assert.ok(replan, 'replan is logged');
  assert.match(String(replan?.detail), /pos=\(48,48\) goal=\(112,112\)/);
});

test('a transition close to the gate still enters waiting_map and records why', () => {
  const client = gateClient();
  const navigator = new WalkNavigator(client);
  navigator.walkTo({ targetMapId: 'map-b', requester: 'user' });
  client.player.x = 100;
  client.player.y = 112;
  client.player.path = [];
  client.transitioning = true;
  client.mapId = null;
  client.now = 100;
  navigator.tick();
  assert.equal(navigator.getOperation()?.leg?.phase, 'waiting_map');
  const waiting = client.logs.find((log) => log.code === 'move_to_waiting_map');
  assert.equal(waiting?.reasonCode, 'near_gate_transition');
  assert.match(String(waiting?.detail), /pos=\(100,112\)/);
});

test('a stopped-short near-gate wait with no map change resumes walking to the gate, bounded, then fails', () => {
  const client = gateClient();
  const navigator = new WalkNavigator(client, { portalWaitTimeoutMs: 1_000 });
  navigator.walkTo({ targetMapId: 'map-b', requester: 'user' });
  client.player.x = 100;
  client.player.y = 112;
  client.player.path = [];
  client.transitioning = true;
  client.mapId = null;
  client.now = 100;
  navigator.tick();
  assert.equal(navigator.getOperation()?.leg?.phase, 'waiting_map');
  client.transitioning = false;
  client.mapId = 'map-a';
  client.player.path = [];
  client.now = 1_200;
  navigator.tick();
  assert.equal(navigator.getOperation()?.leg?.phase, 'walking_to_gate', 'resumes instead of failing');
  assert.ok(client.player.path.length > 0, 'a path to the gate is set again');
  assert.ok(client.logs.some((log) => log.code === 'move_to_gate_resume'));

  for (let i = 0; i < 2; i += 1) {
    client.transitioning = true;
    client.mapId = null;
    client.player.path = [];
    client.now += 100;
    navigator.tick();
    client.transitioning = false;
    client.mapId = 'map-a';
    client.player.path = [];
    client.now += 1_200;
    navigator.tick();
  }
  assert.deepEqual([navigator.getOperation()?.status, navigator.getOperation()?.reason], ['failed', 'portal_no_transition']);
});

test('a transition that lasts too long far from the gate fails as unexpected_map', () => {
  const client = gateClient();
  const navigator = new WalkNavigator(client, { portalWaitTimeoutMs: 1_000 });
  navigator.walkTo({ targetMapId: 'map-b', requester: 'user' });
  client.transitioning = true;
  client.mapId = null;
  client.now = 100;
  navigator.tick();
  assert.ok(['accepted', 'running'].includes(String(navigator.getOperation()?.status)));
  client.now = 1_300;
  navigator.tick();
  assert.equal(navigator.getOperation()?.status, 'failed');
  assert.equal(navigator.getOperation()?.reason, 'unexpected_map');
});

test('re-planning a cleared path is bounded, then the normal stuck rule applies', () => {
  const client = new FakeWalkClient();
  const navigator = new WalkNavigator(client);
  navigator.walkTo(request);
  const plannedCalls = client.routeCalls.length;
  for (let i = 1; i <= 6; i += 1) {
    client.player.path = [];
    client.now = i * 100;
    navigator.tick();
  }
  assert.equal(client.routeCalls.length, plannedCalls + 3, 'at most three re-plans');
  client.player.path = [];
  client.now = 7_000;
  navigator.tick();
  assert.equal(navigator.getOperation()?.status, 'blocked');
  assert.equal(navigator.getOperation()?.reason, 'stuck');
  assert.match(String(client.logs.at(-1)?.detail), /replans=3/);
});
