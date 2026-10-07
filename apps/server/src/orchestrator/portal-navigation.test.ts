import assert from 'node:assert/strict';
import { VERIFIED_PORTAL_EDGES } from '../config/portal-catalog.js';
import {
  confirmObservedMap,
  createNavigationState,
  expireMapConfirmation,
  findPortalRoute,
  markWaitingForMapConfirmation,
  planNavigation,
  portalCenter,
} from './portal-navigation.js';

const route = findPortalRoute('tan_vien', 'vuon_ca_nhan');
assert.ok(route);
assert.deepEqual(route.map((edge) => edge.toMapId), ['thanh_truc_lam', 'duoc_vien', 'vuon_ca_nhan']);
assert.deepEqual(portalCenter(VERIFIED_PORTAL_EDGES[0]), { x: 240, y: 944 });
assert.equal(findPortalRoute('tan_vien', 'not_in_graph'), null);

let state = planNavigation(createNavigationState('tan_vien', 'mieu_hoang', { now: 100 }));
assert.equal(state.phase, 'moving_to_portal');
state = markWaitingForMapConfirmation(state, 200);
assert.equal(state.phase, 'waiting_map_confirmation');
assert.equal(confirmObservedMap(state, { mapId: 'mieu_hoang', observedAt: 200 }), state, 'stale map observation must not confirm');
state = confirmObservedMap(state, { mapId: 'mieu_hoang', observedAt: 201 });
assert.equal(state.phase, 'arrived', 'only a fresh map observation confirms arrival');

state = planNavigation(createNavigationState('tan_vien', 'not_in_graph', { now: 100 }));
assert.equal(state.phase, 'blocked');
state = planNavigation(createNavigationState('tan_vien', 'mieu_hoang', { now: 100, maxAttempts: 1, timeoutMs: 50 }));
state = markWaitingForMapConfirmation(state, 200);
state = expireMapConfirmation(state, 250);
assert.equal(state.phase, 'failed');
assert.equal(state.reason, 'map_confirmation_timeout');

console.log('portal-navigation tests passed');
