import assert from 'node:assert/strict';
import { OperationLedger } from '../dist/operation-ledger.js';

const ledger = new OperationLedger();
assert.equal(ledger.begin('attack', 'attack:m1', 1000).status, 'sent');
assert.equal(ledger.begin('attack', 'attack:m1', 1100), null, 'in-flight attacks are not retransmitted');
assert.equal(ledger.sweep(2200)[0].status, 'unconfirmed');
assert.equal(ledger.begin('attack', 'attack:m1', 1500), null, 'cooldown blocks a retry after an observed failure');
assert.equal(ledger.begin('attack', 'attack:m1', 2200).status, 'sent', 'a fresh decision can retry after confirmation window and cooldown');
ledger.confirm('attack:m1');
assert.equal(ledger.get('attack:m1').status, 'confirmed');
ledger.fail('attack:m1');
assert.equal(ledger.get('attack:m1').status, 'failed');
console.log('core-client operation ledger tests passed');
