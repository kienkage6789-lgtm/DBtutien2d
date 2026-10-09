import { CONFIG } from '../config.js';
import { db } from '../db/database.js';
import { workerPool } from './worker-pool.js';
import { wsHub } from '../ws/hub.js';
import { EntitlementWatcher } from './entitlement-watcher.js';

export const entitlementWatcher = new EntitlementWatcher({
  now: () => Date.now(),
  getUsers: () => db.getUsers(),
  getRunningAccountIdsForOwner: (ownerId: string) => workerPool.getRunningAccountIdsForOwner(ownerId),
  stopAccountsForOwner: (ownerId: string) => workerPool.stopAccountsForOwner(ownerId),
  audit: (input) => db.addAuditLog(input),
  log: (accountId, level, module, message) => {
    const saved = db.addLog(accountId, level, module, message);
    wsHub.broadcastLog(saved);
    wsHub.broadcastAccountUpdate(workerPool.getRuntimeInfo(accountId));
  },
  notify: (ownerId, alert) => wsHub.broadcastSystemAlertToOwner(ownerId, alert),
  intervalMs: CONFIG.ENTITLEMENT_SWEEP_MS,
});
