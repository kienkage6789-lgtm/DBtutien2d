import assert from 'node:assert/strict';
import { readStatePacketRealm } from './worker-pool.js';

assert.equal(readStatePacketRealm({ realm: 'top', save: { realm: 'saved' } }), 'top');
assert.equal(readStatePacketRealm({ save: { realm: 'saved' } }), 'saved');
assert.equal(readStatePacketRealm({ realm: '', save: { realm: 'saved' } }), 'saved');
assert.equal(readStatePacketRealm({ realm: 42, save: { realm: 'saved' } }), 'saved');
assert.equal(readStatePacketRealm({ save: { realm: 42 } }), null);
assert.equal(readStatePacketRealm({ save: ['saved'] }), null);
assert.equal(readStatePacketRealm({ save: null }), null);
