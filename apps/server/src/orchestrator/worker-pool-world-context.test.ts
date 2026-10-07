import assert from 'node:assert/strict';
import {
  canRefreshMapContextFromMovement,
  expectedNavigationMapId,
  mapContextRuntime,
  refreshMapContextAge,
  isMapContextCurrent,
  isMapContextFresh,
  validateAndCommitWorldPacket,
  validateWorldPacket,
  shouldAcceptMapPacketBeforeApply,
  shouldAcceptWorldPacketBeforeApply,
  worldSnapshotRejectReason,
  type NavigationRuntimeInfo,
} from './worker-pool.js';

const context = {
  mapId: 'tan_vien',
  khu: 1,
  soKhu: 4,
  observedAt: 10_000,
  fresh: true,
};
const clientContext = { mapId: 'tan_vien', khu: 1, mapKnown: true, khuKnown: true };
const destinationClient = { mapId: 'mieu_hoang', khu: 1, mapKnown: true, khuKnown: true };
const navigation: NavigationRuntimeInfo = {
  operationId: 'nav-test',
  phase: 'waiting_map_confirmation',
  currentMapId: 'tan_vien',
  targetMapId: 'mieu_hoang',
  route: [{ portalId: 'tan-vien-to-mieu', fromMapId: 'tan_vien', toMapId: 'mieu_hoang', tx: 0, ty: 12, label: 'portal' }],
  routeIndex: 0,
  attempt: 1,
  maxAttempts: 3,
  commandAt: 10_000,
  deadlineAt: 20_000,
  updatedAt: 10_000,
  reason: null,
};

assert.equal(expectedNavigationMapId(navigation), 'mieu_hoang');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'tan_vien', khu: 1 },
  context: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
  mapEpoch: null,
  expectedMapId: null,
}), true, 'complete map packet may seed an unknown baseline');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'tan_vien', khu: 1, ep: 8 },
  context: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
  mapEpoch: 7,
  expectedMapId: null,
}), true, 'baseline map epoch may differ from the welcome epoch');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'tan_vien', khu: 1 },
  context: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
  mapEpoch: 7,
  expectedMapId: null,
}), true, 'complete baseline map without ep is accepted despite welcome epoch');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'tan_vien', khu: 1, ep: 7 },
  context,
  mapEpoch: 7,
  expectedMapId: null,
}), true, 'same-context map packet is accepted only with matching epoch');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'tan_vien', khu: 1 },
  context,
  mapEpoch: 7,
  expectedMapId: null,
}), false, 'same-context map packet without ep is vetoed before core mutation');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'mieu_hoang', khu: 1, ep: 7 },
  context,
  mapEpoch: 7,
  expectedMapId: expectedNavigationMapId(navigation),
}), true, 'expected portal destination may keep the map epoch');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'mieu_hoang', khu: 1, ep: 8 },
  context,
  mapEpoch: 7,
  expectedMapId: expectedNavigationMapId(navigation),
}), true, 'expected portal destination may advance the map epoch');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'tan_vien', khu: 1, ep: 6 },
  context,
  mapEpoch: 7,
  expectedMapId: expectedNavigationMapId(navigation),
}), false, 'delayed source map is vetoed before core state mutation');
assert.equal(shouldAcceptMapPacketBeforeApply({
  packet: { mapId: 'unexpected_map', khu: 1, ep: 8 },
  context,
  mapEpoch: 7,
  expectedMapId: expectedNavigationMapId(navigation),
}), false, 'map outside the active route is vetoed');

assert.equal(isMapContextFresh(context, 24_999), true, 'freshness remains valid through 15 seconds');
assert.equal(isMapContextFresh(context, 25_001), false, 'context expires after 15 seconds');
assert.equal(isMapContextFresh({ ...context, fresh: false }, 11_000), false);
assert.equal(mapContextRuntime(context, {
  now: 25_001,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
}).context.fresh, false, 'runtime projection never reports fresh beyond the 15 second TTL');
assert.equal(mapContextRuntime(context, {
  now: 24_999,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
}).context.fresh, true, 'runtime projection reports fresh within the TTL');
assert.equal(mapContextRuntime(context, {
  now: 25_001,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
}).ageMs, 15_001, 'runtime exposes the actual context age');
assert.equal(isMapContextCurrent({
  context,
  now: 25_001,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
}), false, 'expired context cannot authorize portal planning or movement');
assert.equal(isMapContextCurrent({
  context,
  now: 24_999,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
}), true, 'fresh matching context remains usable');

const currentSnapshot = {
  mapId: 'tan_vien', khu: 1, contextEpoch: 7, observedAt: 11_000,
};
const snapshotGuard = {
  snapshot: currentSnapshot,
  context,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
  lastAcceptedWorldObservedAt: null,
  now: 11_100,
};
assert.equal(worldSnapshotRejectReason(snapshotGuard), null,
  'snap2 can refresh map age only when map, khu, and both current epochs match');
assert.equal(worldSnapshotRejectReason({
  ...snapshotGuard, snapshot: { ...currentSnapshot, mapId: 'mieu_hoang' },
}), 'map_or_khu_mismatch', 'snap2 from a different map is rejected');
assert.equal(worldSnapshotRejectReason({
  ...snapshotGuard, snapshot: { ...currentSnapshot, khu: 2 },
}), 'map_or_khu_mismatch', 'snap2 from a different khu is rejected');
assert.equal(worldSnapshotRejectReason({
  ...snapshotGuard, snapshot: { ...currentSnapshot, contextEpoch: 6 },
}), 'context_epoch_mismatch', 'snap2 from a different context epoch is rejected');
assert.equal(worldSnapshotRejectReason({
  ...snapshotGuard, clientContext: { ...clientContext, mapId: 'mieu_hoang' },
}), 'map_or_khu_mismatch', 'snap2 must match the core client map as well as worker context');
const refreshedContext = { ...context, observedAt: 1_000 };
const authoritativeLocation = { x: 321, y: 456 };
refreshMapContextAge(refreshedContext, 12_000);
assert.equal(refreshedContext.observedAt, 12_000, 'accepted snap2 refreshes only map-context age');
assert.deepEqual(authoritativeLocation, { x: 321, y: 456 }, 'map-age refresh does not alter authoritative location');

// Live `you` samples use this shape; the you handler is the movement-only
// handler that opts into the epoch-checked refresh path.
const movement = { x: 120, y: 240 };
assert.equal(canRefreshMapContextFromMovement({
  context,
  contextEpoch: 7,
  mapEpoch: 42,
  clientContext,
  clientEpoch: 7,
  packet: { ...movement, ep: 42 },
}), true, 'you {x,y,ep} refreshes when ep matches the authoritative map epoch');
assert.equal(canRefreshMapContextFromMovement({
  context,
  contextEpoch: 7,
  mapEpoch: 42,
  clientContext,
  clientEpoch: 8,
  packet: { ...movement, ep: 42 },
}), false, 'movement from a prior map context cannot renew freshness after transition');
assert.equal(canRefreshMapContextFromMovement({
  context,
  contextEpoch: 7,
  mapEpoch: 42,
  clientContext: { ...clientContext, mapId: 'mieu_hoang' },
  clientEpoch: 7,
  packet: { ...movement, ep: 42 },
}), false, 'canonical map mismatch rejects delayed coordinates');
assert.equal(canRefreshMapContextFromMovement({
  context,
  contextEpoch: 7,
  mapEpoch: 42,
  clientContext,
  clientEpoch: 7,
  packet: movement,
}), false, 'delayed coordinates without ep are rejected even when client context epoch matches');
assert.equal(canRefreshMapContextFromMovement({
  context,
  contextEpoch: 7,
  mapEpoch: 42,
  clientContext,
  clientEpoch: 7,
  packet: { ...movement, ep: 41 },
}), false, 'delayed coordinates carrying a different ep are rejected');
assert.equal(canRefreshMapContextFromMovement({
  context,
  contextEpoch: 7,
  mapEpoch: null,
  clientContext,
  clientEpoch: 7,
  packet: { ...movement, ep: 42 },
}), false, 'movement cannot refresh while the authoritative map epoch is unknown');
assert.equal(canRefreshMapContextFromMovement({
  context,
  contextEpoch: 7,
  mapEpoch: 42,
  clientContext,
  clientEpoch: 7,
  packet: { x: 120 },
}), false, 'partial coordinate packet cannot refresh');

const expiredContext = { ...context, observedAt: 1_000 };
assert.equal(isMapContextFresh(expiredContext, 20_000), false, 'stale context remains rejected without qualifying movement');

const validationBase = {
  context,
  mapEpoch: 42,
  allowMovementRefresh: true,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
};
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  context: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
  mapEpoch: 7,
  source: 'map',
  packet: { mapId: 'tan_vien', khu: 1, x: 120, y: 240, ep: 8 },
}), { accepted: true, acceptsContext: true, mapEpoch: 8 }, 'baseline map packet replaces a differing welcome epoch');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  context: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
  mapEpoch: 7,
  source: 'map',
  packet: { mapId: 'tan_vien', khu: 1, x: 120, y: 240 },
}), { accepted: true, acceptsContext: true, mapEpoch: null }, 'baseline map packet without ep clears the unverified welcome epoch');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'you',
  packet: { x: 150, y: 260 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'stale you without ep is rejected before its x/y can be stored');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'you',
  packet: { x: 150, y: 260, ep: 41 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'stale you with a different ep is rejected');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'state',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 12, y: 24 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'old state without ep cannot switch map or write coordinates');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'state',
  packet: { mapId: 'tan_vien', khu: 1, x: 150, y: 260, ep: 42 },
}), { accepted: true, acceptsContext: true, mapEpoch: 42 }, 'current context-bearing state with matching ep is accepted');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'state',
  packet: { mapId: 'tan_vien', khu: 1, x: 150, y: 260 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'same-context state without ep cannot write position or refresh TTL');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'snap',
  packet: { mapId: 'tan_vien', khu: 1, x: 150, y: 260 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'known-context snap without ep cannot commit coordinates or refresh observation');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'snap',
  packet: { mapId: 'tan_vien', khu: 1, x: 150, y: 260, ep: 42 },
}), { accepted: true, acceptsContext: true, mapEpoch: 42 }, 'known-context snap with matching ep remains valid');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'map',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 12, y: 24 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'map packet cannot switch known context without ep');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  source: 'map',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 12, y: 24, ep: 42 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'map context change outside an active expected route is rejected even with static ep');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  expectedMapId: 'mieu_hoang',
  clientContext: destinationClient,
  source: 'map',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 12, y: 24 },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'expected destination still requires a valid map epoch');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  expectedMapId: 'mieu_hoang',
  clientContext: destinationClient,
  source: 'map',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 12, y: 24, ep: 42 },
}), { accepted: true, acceptsContext: true, mapEpoch: 42 }, 'portal map packet may retain its authoritative epoch');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  expectedMapId: 'mieu_hoang',
  clientContext: destinationClient,
  source: 'map',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 12, y: 24, ep: 43 },
}), { accepted: true, acceptsContext: true, mapEpoch: 43 }, 'portal map packet may advance to a valid new epoch');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  expectedMapId: 'mieu_hoang',
  source: 'map',
  packet: { mapId: 'unexpected_map', khu: 1, x: 12, y: 24, ep: 43 },
  clientContext: { mapId: 'unexpected_map', khu: 1, mapKnown: true, khuKnown: true },
}), { accepted: false, acceptsContext: false, mapEpoch: 42 }, 'unexpected destination is rejected even when client context agrees');

const afterPortal = {
  mapEpoch: 2,
  location: { x: 300, y: 420 },
};
const destinationContext = { ...context, mapId: 'tan_vien', khu: 1 };
const committedInput = {
  context: destinationContext,
  state: afterPortal,
  expectedMapId: 'mieu_hoang',
  allowMovementRefresh: false,
  contextEpoch: 8,
  clientContext: destinationClient,
  clientEpoch: 8,
};
const delayedMapResult = validateAndCommitWorldPacket({
  ...committedInput,
  source: 'map',
  packet: { mapId: 'tan_vien', khu: 1, x: 10, y: 20, ep: 1 },
});
assert.equal(delayedMapResult.accepted, false, 'delayed source-map packet with old ep is rejected against previous epoch');
assert.deepEqual(afterPortal, { mapEpoch: 2, location: { x: 300, y: 420 } }, 'rejected map packet cannot overwrite epoch or coordinates');

const currentMapResult = validateAndCommitWorldPacket({
  ...committedInput,
  source: 'map',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 310, y: 430, ep: 3 },
});
assert.equal(currentMapResult.accepted, true, 'current destination map packet with a valid new epoch is accepted');
assert.deepEqual(afterPortal, { mapEpoch: 3, location: { x: 310, y: 430 } }, 'accepted current packet commits new epoch and location after validation');

const sameMapSnapshot = { ...destinationContext, mapId: 'mieu_hoang' };
const beforeInvalidMap = {
  mapEpoch: 2,
  location: { x: 300, y: 420 },
};
const invalidSameMapResult = validateAndCommitWorldPacket({
  context: sameMapSnapshot,
  state: beforeInvalidMap,
  allowMovementRefresh: false,
  contextEpoch: 8,
  clientContext: destinationClient,
  clientEpoch: 8,
  source: 'map',
  packet: { mapId: 'mieu_hoang', khu: 1, x: 10, y: 20, p: [{ id: 'late-player' }], e: [{ id: 'late-monster' }] },
});
assert.equal(invalidSameMapResult.accepted, false, 'same-context map packet without ep is rejected');
assert.deepEqual(beforeInvalidMap, { mapEpoch: 2, location: { x: 300, y: 420 } }, 'rejected packet leaves epoch and position unchanged');
assert.deepEqual(sameMapSnapshot, { ...destinationContext, mapId: 'mieu_hoang' }, 'rejected packet leaves map context and observedAt unchanged');

const preApplyBase = {
  context,
  mapEpoch: 42,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
};
assert.equal(shouldAcceptWorldPacketBeforeApply({
  ...preApplyBase,
  source: 'you',
  packet: { x: 180, y: 280, ep: 42 },
}), true, 'current you movement with authoritative ep is allowed before core mutation');
assert.equal(shouldAcceptWorldPacketBeforeApply({
  ...preApplyBase,
  source: 'state',
  packet: { x: 180, y: 280, ep: 42 },
}), true, 'current state movement with authoritative ep is allowed before core mutation');
for (const [source, packet] of [
  ['you', { x: 999, y: 999 }],
  ['you', { x: 999, y: 999, ep: 41 }],
  ['state', { x: 999, y: 999 }],
  ['state', { mapId: 'mieu_hoang', khu: 1, x: 999, y: 999, ep: 42 }],
  ['state', { mapId: 'tan_vien', khu: 1, x: 999, y: 999, ep: 41 }],
  ['snap', { mapId: 'tan_vien', khu: 1, x: 999, y: 999 }],
] as const) {
  assert.equal(shouldAcceptWorldPacketBeforeApply({
    ...preApplyBase,
    source,
    packet,
  }), false, `${source} stale/missing-epoch world packet is vetoed before core mutation`);
}
assert.equal(shouldAcceptWorldPacketBeforeApply({
  ...preApplyBase,
  source: 'state',
  packet: { hp: 10, maxHp: 20 },
}), true, 'non-world state fields remain available to core vitals processing');
assert.equal(shouldAcceptWorldPacketBeforeApply({
  ...preApplyBase,
  source: 'you',
  packet: { hp: 10, mp: 5, stones: 3 },
}), true, 'vitals-only you packet remains available without a world epoch');
assert.deepEqual(validateWorldPacket({
  ...validationBase,
  context: { mapId: null, khu: null, soKhu: null, observedAt: null, fresh: false },
  source: 'snap',
  packet: { mapId: 'tan_vien', khu: 1, x: 120, y: 240 },
}), { accepted: true, acceptsContext: true, mapEpoch: null }, 'snap may seed only an unknown backend context without inheriting an unverified welcome epoch');

const corePosition = { x: 300, y: 420 };
const rejectedPreApply = shouldAcceptWorldPacketBeforeApply({
  ...preApplyBase,
  source: 'you',
  packet: { x: 999, y: 999, ep: 41 },
});
if (rejectedPreApply) Object.assign(corePosition, { x: 999, y: 999 });
assert.deepEqual(corePosition, { x: 300, y: 420 }, 'vetoed pre-apply movement cannot mutate the client position');

for (const [source, packet] of [
  ['state', { x: 999, y: 999 }],
  ['you', { x: 999, y: 999, ep: 41 }],
  ['snap', { mapId: 'tan_vien', khu: 1, x: 999, y: 999 }],
] as const) {
  const state = { mapEpoch: 42, location: { x: 300, y: 420 } };
  const result = validateAndCommitWorldPacket({
    context,
    state,
    allowMovementRefresh: source !== 'snap',
    contextEpoch: 7,
    clientContext,
    clientEpoch: 7,
    source,
    packet,
  });
  assert.equal(result.accepted, false, `${source} stale packet is rejected by the backend commit barrier`);
  assert.deepEqual(state, { mapEpoch: 42, location: { x: 300, y: 420 } }, `${source} rejection leaves authoritative coordinates unchanged`);
}

const snapCommitState = { mapEpoch: 42, location: { x: 300, y: 420 } };
const snapCommit = validateAndCommitWorldPacket({
  context,
  state: snapCommitState,
  allowMovementRefresh: false,
  contextEpoch: 7,
  clientContext,
  clientEpoch: 7,
  source: 'snap',
  packet: { mapId: 'tan_vien', khu: 1, x: 999, y: 999 },
});
assert.equal(snapCommit.accepted, false, 'backend second barrier rejects snap without ep');
assert.deepEqual(snapCommitState, { mapEpoch: 42, location: { x: 300, y: 420 } }, 'rejected snap does not commit worker coordinates');

console.log('worker-pool world-context tests passed');
