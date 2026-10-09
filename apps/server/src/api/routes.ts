import { NextFunction, Router, Request, Response } from 'express';
import { AuthError } from '@tutien2d/core-client';
import { db } from '../db/database.js';
import { CONFIG } from '../config.js';
import { workerPool } from '../orchestrator/worker-pool.js';
import { authenticate, authenticatePassword, loginRateLimiter, publicUser, requestIp, SESSION_TTL_MS } from '../security/auth.js';
import { hashPassword, validatePassword, validateUsername, verifyPassword } from '../security/password.js';
import { sendError } from '../security/errors.js';
import { wsHub } from '../ws/hub.js';
import { getWalkGrid, WALK_TILE_SIZE } from '../config/walk-grid.js';
import { VERIFIED_PORTAL_EDGES } from '../config/portal-catalog.js';
import type { AutoAnchor } from '../headless/auto-supervisor.js';
import { vendorAutoErrorResponse } from './vendor-auto-errors.js';
import { moveToErrorResponse } from './move-to-errors.js';
import { khuErrorResponse } from './khu-errors.js';
import { dailyErrorResponse } from './daily-errors.js';
import { entitlement } from '../security/entitlement.js';
import { entitlementWatcher } from '../orchestrator/entitlement-runtime.js';

export const apiRouter: Router = Router();

const principalUserId = (req: Request): string | undefined => req.principal?.userId ?? undefined;
const isAdmin = (req: Request): boolean => req.principal?.role === 'admin';
const ownerScope = (req: Request): string | undefined => isAdmin(req) ? undefined : principalUserId(req) ?? '__invalid_principal__';

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdmin(req)) {
    sendError(res, 403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
    return;
  }
  next();
}

function loadOwnedAccount(req: Request, res: Response, next: NextFunction): void {
  const id = String(req.params.id);
  const account = db.getAccountById(id);
  if (!account || (!isAdmin(req) && account.ownerId !== principalUserId(req))) {
    sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản.');
    return;
  }
  req.ownedAccount = { id: account.id, ownerId: account.ownerId };
  next();
}

function entitlementFailure(userId: string): { status: 403; code: string; message: string; expiresAt: number | null } | null {
  const user = db.getUserById(userId);
  if (!user || user.role === 'admin') return null;
  const current = entitlement(user, Date.now());
  if (current.state === 'active') return null;
  const code = current.state === 'disabled' ? 'USER_DISABLED' : current.state === 'none' ? 'ENTITLEMENT_NONE' : 'ENTITLEMENT_EXPIRED';
  const message = current.state === 'disabled'
    ? 'Tài khoản người dùng đã bị khóa.'
    : current.state === 'none'
      ? 'Tài khoản chưa được cấp hạn sử dụng.'
      : 'Hạn sử dụng đã hết. Liên hệ admin để gia hạn.';
  return { status: 403, code, message, expiresAt: current.expiresAt };
}

export function requireEntitlement(req: Request, res: Response, next: NextFunction): void {
  const userId = principalUserId(req);
  if (!userId || isAdmin(req)) { next(); return; }
  const failure = entitlementFailure(userId);
  if (!failure) { next(); return; }
  sendError(res, failure.status, failure.code, failure.message, { details: { expiresAt: failure.expiresAt } });
}

function requireStartCapacity(req: Request, res: Response, next: NextFunction): void {
  const accountId = typeof req.params.id === 'string' ? req.params.id : undefined;
  if (accountId && workerPool.getRunningAccountIdsForOwner(principalUserId(req) ?? '').includes(accountId)) { next(); return; }
  const ownerId = principalUserId(req);
  const account = accountId ? db.getAccountById(accountId) : undefined;
  const owner = ownerId ? db.getUserById(ownerId) : undefined;
  const allRunning = new Set(db.getAccounts().flatMap((item) => workerPool.getRunningAccountIdsForOwner(item.ownerId).includes(item.id) ? [item.id] : []));
  const candidates = (ownerId ? db.getAccounts(ownerId) : db.getAccounts()).filter((item) => !allRunning.has(item.id));
  if (owner?.role === 'user') {
    const running = workerPool.getRunningAccountIdsForOwner(owner.id).length;
    const quotaReached = running >= owner.maxBots && (!accountId || candidates.length > 0 || !!account);
    if (quotaReached) {
      sendError(res, 409, 'BOT_LIMIT_REACHED', `Đã đạt giới hạn bot ${running}/${owner.maxBots}.`);
      return;
    }
  }
  const needsRunner = accountId ? !!account && !workerPool.getRunningAccountIdsForOwner(account.ownerId).includes(accountId) : candidates.length > 0;
  if (needsRunner && CONFIG.MAX_TOTAL_RUNNERS > 0 && workerPool.getActiveAccountCount() >= CONFIG.MAX_TOTAL_RUNNERS) {
    sendError(res, 503, 'SERVER_CAPACITY', 'Máy chủ đã đạt số runner tối đa, hãy thử lại sau.', { retryable: true });
    return;
  }
  next();
}

function sendControlError(res: Response, error: unknown): void {
  const raw = error instanceof Error ? error.message : String(error);
  const code = raw.split(':', 1)[0].trim();
  const known: Record<string, { status: number; message: string; retryable?: boolean }> = {
    ENTITLEMENT_EXPIRED: { status: 403, message: 'Hạn sử dụng đã hết. Liên hệ admin để gia hạn.' },
    ENTITLEMENT_NONE: { status: 403, message: 'Tài khoản chưa được cấp hạn sử dụng.' },
    USER_DISABLED: { status: 403, message: 'Tài khoản người dùng đã bị khóa.' },
    BOT_LIMIT_REACHED: { status: 409, message: 'Đã đạt giới hạn bot của người dùng.' },
    SERVER_CAPACITY: { status: 503, message: 'Máy chủ đã đạt số runner tối đa, hãy thử lại sau.', retryable: true },
  };
  const response = known[code];
  if (response) {
    sendError(res, response.status, code, response.message, { retryable: response.retryable });
    return;
  }
  sendError(res, 500, 'INTERNAL_ERROR', 'Không thể thực hiện thao tác bot.');
}

function requireAccountQuota(req: Request, res: Response, next: NextFunction): void {
  if (isAdmin(req)) { next(); return; }
  const userId = principalUserId(req);
  const user = userId ? db.getUserById(userId) : undefined;
  if (!user || user.status === 'disabled') {
    sendError(res, 403, 'USER_DISABLED', 'Tài khoản người dùng đã bị khóa.');
    return;
  }
  const usage = db.getUserUsage(user.id);
  if (usage.accounts >= user.maxBots) {
    sendError(res, 403, 'QUOTA_BOTS', `Đã có ${usage.accounts}/${user.maxBots} tài khoản, không thể thêm tài khoản mới.`);
    return;
  }
  next();
}

function publicUserList() {
  return db.getUsers().map(publicUser);
}

// Login is the only unauthenticated /api route. The auth middleware is deliberately
// mounted before every existing control-plane route so a missing token cannot fall
// through to a legacy handler.
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const username = typeof body.username === 'string' ? body.username : '';
  const ip = requestIp(req);
  const retryAfter = loginRateLimiter.retryAfter(ip, username);
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Quá nhiều lần đăng nhập sai.');
    return;
  }
  try {
    const normalized = validateUsername(username);
    const result = await authenticatePassword(normalized, body.password, {
      ip,
      userAgent: req.get('user-agent') ?? '',
    });
    if (!result.user || !result.token || !result.session) {
      loginRateLimiter.recordFailure(ip, normalized);
      const blockedFor = loginRateLimiter.retryAfter(ip, normalized);
      if (blockedFor > 0) {
        res.setHeader('Retry-After', String(blockedFor));
        sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Quá nhiều lần đăng nhập sai.');
        return;
      }
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng.');
      return;
    }
    loginRateLimiter.clear(ip, normalized);
    res.json({
      success: true,
      token: result.token,
      user: publicUser(result.user),
      sessionExpiresAt: result.session.expiresAt,
      serverNow: Date.now(),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    const message = code === 'PASSWORD_TOO_SHORT' ? 'Mật khẩu phải có ít nhất 6 ký tự.' : 'Tên đăng nhập không hợp lệ.';
    sendError(res, 400, code === 'PASSWORD_TOO_SHORT' ? 'PASSWORD_TOO_SHORT' : 'USERNAME_INVALID', message);
  }
});

apiRouter.use(authenticate);

apiRouter.post('/auth/logout', (req: Request, res: Response) => {
  if (req.session) {
    db.deleteSession(req.session.id);
    wsHub.closeSession(req.session.id);
  }
  res.json({ success: true });
});

apiRouter.get('/auth/me', (req: Request, res: Response) => {
  if (req.principal?.legacyToken) {
    const admin = db.getUsers().find((user) => user.role === 'admin');
    if (!admin) { sendError(res, 401, 'UNAUTHORIZED', 'Unauthorized'); return; }
    res.json({ success: true, user: publicUser(admin), sessionExpiresAt: null, serverNow: Date.now() });
    return;
  }
  const user = req.principal?.userId ? db.getUserById(req.principal.userId) : undefined;
  if (!user || !req.session) { sendError(res, 401, 'UNAUTHORIZED', 'Unauthorized'); return; }
  res.json({ success: true, user: publicUser(user), sessionExpiresAt: req.session.expiresAt, serverNow: Date.now() });
});

apiRouter.post('/auth/password', (req: Request, res: Response) => {
  const userId = req.principal?.userId;
  if (!userId || !req.session) {
    sendError(res, 403, 'PASSWORD_CHANGE_REQUIRES_SESSION', 'Phiên API cũ không thể đổi mật khẩu.');
    return;
  }
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;
  const hash = db.getPasswordHash(userId);
  if (!hash || typeof currentPassword !== 'string' || !verifyPassword(currentPassword, hash)) {
    sendError(res, 401, 'INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng.');
    return;
  }
  try {
    const nextPassword = validatePassword(newPassword);
    db.setPassword(userId, hashPassword(nextPassword), false);
    db.revokeUserSessions(userId, req.session.id);
    const now = Date.now();
    db.touchSession(req.session.id, now, now + SESSION_TTL_MS);
    wsHub.closeUserSessions(userId, req.session.id);
    const user = db.getUserById(userId)!;
    res.json({ success: true, user: publicUser(user), sessionExpiresAt: now + SESSION_TTL_MS, serverNow: now });
  } catch {
    sendError(res, 400, 'PASSWORD_TOO_SHORT', 'Mật khẩu mới phải có ít nhất 6 ký tự.');
  }
});

apiRouter.use('/accounts/:id', loadOwnedAccount);

apiRouter.use('/accounts/:id/start', requireEntitlement, requireStartCapacity);
apiRouter.use('/accounts/:id/restart', requireEntitlement, requireStartCapacity);
apiRouter.use('/accounts/:id/auto/start', requireEntitlement, requireStartCapacity);
apiRouter.use('/accounts/:id/move-to', requireEntitlement);
apiRouter.use('/orchestrator/start-all', requireEntitlement, requireStartCapacity);

apiRouter.get('/admin/users', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: publicUserList() });
});

apiRouter.post('/admin/users', requireAdmin, (req: Request, res: Response) => {
  try {
    const username = validateUsername(req.body?.username);
    const password = validatePassword(req.body?.password);
    const maxBots = req.body?.maxBots === undefined ? 3 : req.body.maxBots;
    if (!Number.isInteger(maxBots) || Number(maxBots) < 0 || Number(maxBots) > 1000) {
      sendError(res, 400, 'MAX_BOTS_INVALID', 'maxBots phải là số nguyên trong khoảng 0..1000.');
      return;
    }
    const user = db.createUser(username, hashPassword(password), {
      maxBots: Number(maxBots),
      createdBy: req.principal?.userId ?? null,
    });
    db.addAuditLog({ actorId: req.principal?.userId ?? null, action: 'user_created', targetType: 'user', targetId: user.id });
    res.status(201).json({ success: true, data: publicUser(user) });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.includes('UNIQUE') || raw.includes('constraint')) {
      sendError(res, 409, 'USERNAME_TAKEN', 'Tên đăng nhập đã tồn tại.');
      return;
    }
    sendError(res, 400, raw === 'PASSWORD_TOO_SHORT' ? raw : 'INVALID_REQUEST', raw === 'PASSWORD_TOO_SHORT' ? 'Mật khẩu phải có ít nhất 6 ký tự.' : 'Thông tin người dùng không hợp lệ.');
  }
});

apiRouter.patch('/admin/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.params.id);
  const target = db.getUserById(userId);
  if (!target) { sendError(res, 404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.'); return; }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'status' && key !== 'maxBots')) {
    sendError(res, 400, 'INVALID_REQUEST', 'Trường cập nhật không hợp lệ.');
    return;
  }
  const nextStatus: 'active' | 'disabled' | undefined = body.status === undefined
    ? undefined
    : body.status === 'active' ? 'active' : body.status === 'disabled' ? 'disabled' : undefined;
  const maxBots = body.maxBots;
  if (body.status !== undefined && nextStatus === undefined) {
    sendError(res, 400, 'INVALID_STATUS', 'Trạng thái không hợp lệ.');
    return;
  }
  if (maxBots !== undefined && (!Number.isInteger(maxBots) || Number(maxBots) < 0 || Number(maxBots) > 1000)) {
    sendError(res, 400, 'MAX_BOTS_INVALID', 'maxBots phải là số nguyên trong khoảng 0..1000.');
    return;
  }
  if (nextStatus === 'disabled' && req.principal?.userId === userId) {
    sendError(res, 409, 'SELF_MODIFICATION_FORBIDDEN', 'Không thể khóa chính mình.');
    return;
  }
  if (nextStatus === 'disabled' && target.role === 'admin' && db.countAdmins() <= 1) {
    sendError(res, 409, 'LAST_ADMIN_FORBIDDEN', 'Không thể khóa admin cuối cùng.');
    return;
  }
  if (nextStatus === 'disabled') {
    const stopped = await workerPool.stopAccountsForOwner(userId);
    if (!stopped) { sendError(res, 409, 'RUNNER_NOT_STOPPED', 'Không thể dừng hết runner của người dùng.'); return; }
    db.revokeUserSessions(userId);
    wsHub.closeUserSessions(userId);
  }
  const user = db.updateUser(userId, {
    ...(nextStatus === undefined ? {} : { status: nextStatus }),
    ...(maxBots === undefined ? {} : { maxBots: Number(maxBots) }),
  })!;
  db.addAuditLog({ actorId: req.principal?.userId ?? null, action: nextStatus === 'disabled' ? 'user_disabled' : 'user_updated', targetType: 'user', targetId: userId });
  await entitlementWatcher.sweepNow();
  res.json({ success: true, data: publicUser(user) });
});

apiRouter.post('/admin/users/:id/grant', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.params.id);
  const duration = req.body?.duration;
  if (duration !== '1d' && duration !== '7d' && duration !== '30d') {
    sendError(res, 400, 'INVALID_REQUEST', 'duration phải là 1d, 7d hoặc 30d.');
    return;
  }
  try {
    const grantedBy = req.principal?.userId ?? db.getUsers().find((user) => user.role === 'admin')?.id;
    if (!grantedBy) { sendError(res, 500, 'INTERNAL_ERROR', 'Không thể xác định admin cấp hạn.'); return; }
    const granted = db.grantUser(userId, grantedBy, duration, Date.now());
    db.addAuditLog({ actorId: req.principal?.userId ?? null, action: 'user_granted', targetType: 'user', targetId: userId, detail: `duration=${duration}; to=${granted.grant.toAt}` });
    await entitlementWatcher.sweepNow();
    res.json({ success: true, data: publicUser(granted.user) });
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === 'USER_NOT_FOUND') { sendError(res, 404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.'); return; }
    if (code === 'ADMIN_NOT_EXPIRING') { sendError(res, 409, code, 'Admin không dùng thời hạn sử dụng.'); return; }
    if (code === 'USER_DISABLED') { sendError(res, 409, code, 'Không thể cấp hạn cho người dùng đã bị khóa.'); return; }
    sendError(res, 500, 'INTERNAL_ERROR', 'Không thể cấp hạn sử dụng.');
  }
});

apiRouter.post('/admin/users/:id/expiry', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.params.id);
  const expiresAt = req.body?.expiresAt;
  if (expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || !Number.isInteger(expiresAt) || expiresAt < 0)) {
    sendError(res, 400, 'INVALID_REQUEST', 'expiresAt phải là số nguyên không âm hoặc null.');
    return;
  }
  const target = db.getUserById(userId);
  if (!target) { sendError(res, 404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.'); return; }
  if (target.role === 'admin') { sendError(res, 409, 'ADMIN_NOT_EXPIRING', 'Admin không dùng thời hạn sử dụng.'); return; }
  const user = db.setUserExpiry(userId, expiresAt as number | null);
  db.addAuditLog({ actorId: req.principal?.userId ?? null, action: 'user_expiry_set', targetType: 'user', targetId: userId, detail: `expiresAt=${expiresAt === null ? 'null' : expiresAt}` });
  await entitlementWatcher.sweepNow();
  res.json({ success: true, data: publicUser(user!) });
});

apiRouter.post('/admin/users/:id/password', requireAdmin, (req: Request, res: Response) => {
  const userId = String(req.params.id);
  const target = db.getUserById(userId);
  if (!target) { sendError(res, 404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.'); return; }
  try {
    const password = validatePassword(req.body?.newPassword ?? req.body?.password);
    db.setPassword(userId, hashPassword(password), true);
    db.revokeUserSessions(userId);
    wsHub.closeUserSessions(userId);
    db.addAuditLog({ actorId: req.principal?.userId ?? null, action: 'user_password_reset', targetType: 'user', targetId: userId });
    res.json({ success: true, data: publicUser(db.getUserById(userId)!) });
  } catch {
    sendError(res, 400, 'PASSWORD_TOO_SHORT', 'Mật khẩu mới phải có ít nhất 6 ký tự.');
  }
});

apiRouter.delete('/admin/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.params.id);
  const target = db.getUserById(userId);
  if (!target) { sendError(res, 404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.'); return; }
  if (req.principal?.userId === userId) { sendError(res, 409, 'SELF_MODIFICATION_FORBIDDEN', 'Không thể xóa chính mình.'); return; }
  if (target.role === 'admin' && db.countAdmins() <= 1) { sendError(res, 409, 'LAST_ADMIN_FORBIDDEN', 'Không thể xóa admin cuối cùng.'); return; }
  if (!(await workerPool.stopAccountsForOwner(userId))) {
    sendError(res, 409, 'RUNNER_NOT_STOPPED', 'Không thể dừng hết runner của người dùng.');
    return;
  }
  db.addAuditLog({ actorId: req.principal?.userId ?? null, action: 'user_deleted', targetType: 'user', targetId: userId });
  db.deleteUserCascade(userId);
  wsHub.closeUserSessions(userId);
  await entitlementWatcher.sweepNow();
  res.json({ success: true });
});

export function parseLimit(raw: unknown, fallback = 100, max = 500): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function parseVendorAutoAnchor(raw: unknown): AutoAnchor | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_AUTO_ANCHOR');
  const anchor = raw as Record<string, unknown>;
  if (typeof anchor.mapId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(anchor.mapId)
    || typeof anchor.x !== 'number' || !Number.isFinite(anchor.x)
    || typeof anchor.y !== 'number' || !Number.isFinite(anchor.y)) {
    throw new Error('INVALID_AUTO_ANCHOR');
  }
  if (anchor.khu !== undefined && (!Number.isInteger(anchor.khu) || (anchor.khu as number) < 1)) {
    throw new Error('INVALID_AUTO_ANCHOR');
  }
  return { mapId: anchor.mapId, khu: anchor.khu as number | undefined, x: anchor.x, y: anchor.y };
}

apiRouter.get('/accounts', (_req: Request, res: Response) => {
  res.json({ success: true, data: workerPool.getAllRuntimes(ownerScope(_req)) });
});

// Map catalog and geometry are read-only dashboard display data.
apiRouter.get('/maps', (_req: Request, res: Response) => {
  const data = workerPool.getMapCatalog();
  res.json({
    success: true,
    source: 'public_client_catalog',
    status: data.length > 0 ? 'available' : 'empty',
    data,
  });
});

apiRouter.get('/maps/:mapId/geometry', (req: Request, res: Response) => {
  const mapId = String(req.params.mapId);
  const grid = getWalkGrid(mapId);
  if (!grid) {
    res.status(404).json({ success: false, error: 'map_geometry_unavailable', mapId });
    return;
  }
  res.json({
    success: true,
    data: {
      mapId,
      tileSize: WALK_TILE_SIZE,
      widthPx: grid.width * WALK_TILE_SIZE,
      heightPx: grid.height * WALK_TILE_SIZE,
      bounds: {
        minX: 0,
        minY: 0,
        maxX: grid.width * WALK_TILE_SIZE,
        maxY: grid.height * WALK_TILE_SIZE,
      },
      grid: { width: grid.width, height: grid.height },
      portals: VERIFIED_PORTAL_EDGES
        .filter((portal) => portal.fromMapId === mapId)
        .map((portal) => ({
          portalId: portal.portalId,
          fromMapId: portal.fromMapId,
          toMapId: portal.toMapId,
          tx: portal.tx,
          ty: portal.ty,
          ...(portal.label ? { label: portal.label } : {}),
        })),
    },
  });
});

apiRouter.post('/accounts', requireAccountQuota, async (req: Request, res: Response) => {
  try {
    const { accountName, password, token, proxyUrl } = req.body;
    if (!accountName || (!password && !token)) {
      sendError(res, 400, 'INVALID_REQUEST', 'Cần accountName và password hoặc token.');
      return;
    }

    let initialRefreshToken: string | undefined;
    if (password) {
      try {
        const session = await workerPool.verifyLogin(accountName, password);
        initialRefreshToken = session.refreshToken;
      } catch (error) {
        const message = error instanceof AuthError ? error.message : `Authentication failed: ${String(error)}`;
        sendError(res, 400, 'GAME_LOGIN_FAILED', message);
        return;
      }
    }

    // verifyLogin awaits external authentication. Re-check here and enforce the
    // final check + INSERT atomically so two concurrent requests cannot exceed maxBots.
    if (!isAdmin(req)) {
      const userId = principalUserId(req);
      const user = userId ? db.getUserById(userId) : undefined;
      if (!user || user.status === 'disabled') { sendError(res, 403, 'USER_DISABLED', 'Tài khoản người dùng đã bị khóa.'); return; }
      const usage = db.getUserUsage(user.id);
      if (usage.accounts >= user.maxBots) {
        sendError(res, 403, 'QUOTA_BOTS', `Đã có ${usage.accounts}/${user.maxBots} tài khoản, không thể thêm tài khoản mới.`);
        return;
      }
    }

    const created = db.createAccount(accountName, {
      password: password || undefined,
      refreshToken: initialRefreshToken,
      legacyToken: token || undefined,
    }, proxyUrl, ownerScope(req), { enforceQuota: !isAdmin(req) });
    res.json({ success: true, data: workerPool.getRuntimeInfo(created.id) });
  } catch (error) {
    if (error instanceof Error && error.message === 'QUOTA_BOTS') {
      const usage = principalUserId(req) ? db.getUserUsage(principalUserId(req)!) : { accounts: 0, maxBots: 0 };
      sendError(res, 403, 'QUOTA_BOTS', `Đã có ${usage.accounts}/${usage.maxBots} tài khoản, không thể thêm tài khoản mới.`);
      return;
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'Không thể tạo tài khoản.');
  }
});

apiRouter.put('/accounts/:id/password', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const account = db.getAccountById(id);
    const password = req.body?.password;
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found.' });
      return;
    }
    if (typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ success: false, error: 'A new password is required.' });
      return;
    }
    const session = await workerPool.verifyLogin(account.accountName, password);
    db.updateCredentials(id, { password, refreshToken: session.refreshToken });
    db.updateAccount(id, { authError: null });
    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (error) {
    const message = error instanceof AuthError ? error.message : error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: message });
  }
});

apiRouter.get('/accounts/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!db.getAccountById(id)) {
    res.status(404).json({ success: false, error: 'Account not found' });
    return;
  }
  res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
});

apiRouter.delete('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.stopAccount(id);
    if (!db.deleteAccount(id)) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

apiRouter.post('/accounts/:id/start', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.startAccount(id);
    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (error) {
    sendControlError(res, error);
  }
});

apiRouter.post('/accounts/:id/stop', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.stopAccount(id);
    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

apiRouter.post('/accounts/:id/restart', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.restartAccount(id);
    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (error) {
    sendControlError(res, error);
  }
});

apiRouter.post('/accounts/:id/auto/start', async (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown> : {};
    if (Object.keys(body).some((key) => key !== 'anchor')) throw new Error('INVALID_REQUEST');
    await workerPool.startVendorAuto(accountId, parseVendorAutoAnchor(body.anchor));
    res.json({ success: true, data: workerPool.getRuntimeInfo(accountId) });
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (['ENTITLEMENT_EXPIRED', 'ENTITLEMENT_NONE', 'USER_DISABLED', 'BOT_LIMIT_REACHED', 'SERVER_CAPACITY'].includes(code)) {
      sendControlError(res, error);
      return;
    }
    const response = code === 'INVALID_REQUEST' || code === 'INVALID_AUTO_ANCHOR'
      ? { status: 400, body: { success: false, error: code, errorCode: code, retryable: false } }
      : vendorAutoErrorResponse(code);
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/auto/stop', (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    workerPool.stopVendorAuto(accountId);
    res.json({ success: true, data: workerPool.getRuntimeInfo(accountId) });
  } catch (error) {
    const response = vendorAutoErrorResponse(error instanceof Error ? error.message : String(error));
    res.status(response.status).json(response.body);
  }
});

apiRouter.get('/accounts/:id/khu', async (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    const data = await workerPool.getKhu(accountId, req.query.refresh === '1');
    res.json({ success: true, data });
  } catch (error) {
    const response = khuErrorResponse(error);
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/khu', requireEntitlement, async (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : null;
  if (!body || Object.keys(body).length !== 1 || !Number.isInteger(body.khu)) {
    res.status(400).json({ success: false, error: 'INVALID_REQUEST', errorCode: 'INVALID_REQUEST', retryable: false });
    return;
  }
  try {
    const data = await workerPool.changeKhu(accountId, Number(body.khu));
    const response = { success: true, data };
    res.json(response);
  } catch (error) {
    const response = khuErrorResponse(error);
    if (response.body.retryAfterSec !== undefined) res.setHeader('Retry-After', String(response.body.retryAfterSec));
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/move-to', (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : null;
  const validKeys = new Set(['x', 'y', 'mapId', 'abortOnHurt', 'maxHurt']);
  const hasX = !!body && Object.prototype.hasOwnProperty.call(body, 'x');
  const hasY = !!body && Object.prototype.hasOwnProperty.call(body, 'y');
  const hasMapId = !!body && Object.prototype.hasOwnProperty.call(body, 'mapId');
  const validBody = !!body
    && Object.keys(body).every((key) => validKeys.has(key))
    && hasX === hasY
    && (!hasX || (typeof body.x === 'number' && Number.isFinite(body.x)
      && typeof body.y === 'number' && Number.isFinite(body.y)))
    && (!hasMapId || (typeof body.mapId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(body.mapId)))
    && (!Object.prototype.hasOwnProperty.call(body, 'abortOnHurt') || typeof body.abortOnHurt === 'boolean')
    && (!Object.prototype.hasOwnProperty.call(body, 'maxHurt') || (Number.isInteger(body.maxHurt) && Number(body.maxHurt) >= 1 && Number(body.maxHurt) <= 50))
    && (hasX || hasMapId);
  if (!validBody) {
    res.status(400).json({ success: false, error: 'TARGET_INVALID', errorCode: 'TARGET_INVALID', retryable: false });
    return;
  }
  try {
    const data = workerPool.moveTo(accountId, {
      ...(hasX ? { target: { x: body?.x as number, y: body?.y as number } } : {}),
      ...(hasMapId ? { targetMapId: body?.mapId as string } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'abortOnHurt') ? { abortOnHurt: body?.abortOnHurt as boolean } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'maxHurt') ? { maxHurt: body?.maxHurt as number } : {}),
      requester: 'user',
    });
    res.status(202).json({ success: true, data });
  } catch (error) {
    const response = moveToErrorResponse(error instanceof Error ? error.message : String(error));
    res.status(response.status).json(response.body);
  }
});

// THỬ NGHIỆM đo giao thức nhiệm vụ hàng ngày (docs/RESEARCH_DAILY_QUESTS.md).
apiRouter.post('/accounts/:id/quest-probe', requireAdmin, (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    if (typeof body.act !== 'string') throw new Error('TARGET_INVALID');
    res.json({ success: true, data: workerPool.questProbe(accountId, body.act, {
      ...(typeof body.taskId === 'string' ? { taskId: body.taskId } : {}),
      ...(typeof body.propId === 'string' ? { propId: body.propId } : {}),
    }) });
  } catch (error) {
    const response = moveToErrorResponse(error instanceof Error ? error.message : String(error));
    res.status(response.status).json(response.body);
  }
});

// THỬ NGHIỆM đo giao thức đổi khu; giữ nguyên song song với API có kiểm tra an toàn (docs/RESEARCH_KHU_CHANGE.md).
apiRouter.get('/accounts/:id/khu-probe', requireAdmin, (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    res.json({ success: true, data: workerPool.getKhuProbe(accountId) });
  } catch (error) {
    const response = moveToErrorResponse(error instanceof Error ? error.message : String(error));
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/khu-probe', requireAdmin, (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    if (body.act !== 'xem' && body.act !== 'chon') throw new Error('TARGET_INVALID');
    res.json({ success: true, data: workerPool.khuProbe(accountId, body.act, typeof body.khu === 'number' ? body.khu : undefined) });
  } catch (error) {
    const response = moveToErrorResponse(error instanceof Error ? error.message : String(error));
    res.status(response.status).json(response.body);
  }
});

apiRouter.get('/accounts/:id/reachable-maps', (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    res.json({ success: true, data: workerPool.getReachableMaps(accountId) });
  } catch (error) {
    const response = moveToErrorResponse(error instanceof Error ? error.message : String(error));
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/move-to/cancel', (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : null;
  const operationId = body?.operationId;
  if (!body || Object.keys(body).length !== 1 || typeof operationId !== 'string'
    || operationId.length === 0 || operationId.length > 128) {
    res.status(400).json({ success: false, error: 'OPERATION_ID_INVALID', errorCode: 'OPERATION_ID_INVALID', retryable: false });
    return;
  }
  try {
    const data = workerPool.cancelMoveTo(accountId, operationId);
    res.json({ success: true, data });
  } catch (error) {
    const response = moveToErrorResponse(error instanceof Error ? error.message : String(error));
    res.status(response.status).json(response.body);
  }
});

apiRouter.get('/accounts/:id/daily', (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    const data = workerPool.getDaily(accountId);
    res.json({ success: true, data: { ...data.status, current: data.current } });
  } catch (error) {
    const response = dailyErrorResponse(error);
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/daily/checkin', requireEntitlement, (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  const body = req.body;
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as object).length !== 0)) {
    res.status(400).json({ success: false, error: 'INVALID_REQUEST', errorCode: 'INVALID_REQUEST', retryable: false });
    return;
  }
  try {
    res.status(202).json({ success: true, data: workerPool.startDailyCheckin(accountId) });
  } catch (error) {
    const response = dailyErrorResponse(error);
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/daily/seed', requireEntitlement, (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : null;
  const allowed = new Set(['taskId', 'runs', 'abortOnHurt', 'maxHurt']);
  const valid = !!body
    && Object.keys(body).every((key) => allowed.has(key))
    && typeof body.taskId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(body.taskId)
    && (body.runs === undefined || (Number.isInteger(body.runs) && Number(body.runs) >= 1 && Number(body.runs) <= 3))
    && (body.abortOnHurt === undefined || typeof body.abortOnHurt === 'boolean')
    && (body.maxHurt === undefined || (Number.isInteger(body.maxHurt) && Number(body.maxHurt) >= 1 && Number(body.maxHurt) <= 50));
  if (!valid) {
    res.status(400).json({ success: false, error: 'INVALID_REQUEST', errorCode: 'INVALID_REQUEST', retryable: false });
    return;
  }
  try {
    const runs = body.runs === undefined ? 1 : Number(body.runs);
    const data = workerPool.startDailySeed(accountId, body.taskId as string, runs, {
      ...(body.abortOnHurt === undefined ? {} : { abortOnHurt: body.abortOnHurt as boolean }),
      ...(body.maxHurt === undefined ? {} : { maxHurt: body.maxHurt as number }),
    });
    res.status(202).json({ success: true, data });
  } catch (error) {
    const response = dailyErrorResponse(error);
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/daily/cancel', requireEntitlement, (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : null;
  if (!body || Object.keys(body).length !== 1 || typeof body.operationId !== 'string' || body.operationId.length < 1 || body.operationId.length > 128) {
    res.status(400).json({ success: false, error: 'INVALID_REQUEST', errorCode: 'INVALID_REQUEST', retryable: false });
    return;
  }
  try {
    res.json({ success: true, data: workerPool.cancelDaily(accountId, body.operationId) });
  } catch (error) {
    const response = dailyErrorResponse(error);
    res.status(response.status).json(response.body);
  }
});

apiRouter.get('/accounts/:id/logs', (req: Request, res: Response) => {
  res.json({ success: true, data: db.getLogs(String(req.params.id), parseLimit(req.query.limit)) });
});

apiRouter.get('/logs', (req: Request, res: Response) => {
  res.json({ success: true, data: db.getLogs(undefined, parseLimit(req.query.limit), ownerScope(req)) });
});

apiRouter.post('/orchestrator/start-all', async (req: Request, res: Response) => {
  try {
    await workerPool.startAll(ownerScope(req));
    res.json({ success: true, data: workerPool.getAllRuntimes(ownerScope(req)) });
  } catch (error) {
    sendControlError(res, error);
  }
});

apiRouter.post('/orchestrator/stop-all', async (req: Request, res: Response) => {
  try {
    await workerPool.stopAll(ownerScope(req));
    res.json({ success: true, data: workerPool.getAllRuntimes(ownerScope(req)) });
  } catch (error) {
    sendError(res, 500, 'INTERNAL_ERROR', 'Không thể dừng toàn bộ bot.');
  }
});

apiRouter.get('/system/status', (req: Request, res: Response) => {
  const accounts = workerPool.getAllRuntimes(ownerScope(req));
  if (!isAdmin(req)) {
    res.json({
      success: true,
      data: {
        totalAccounts: accounts.length,
        runningBots: accounts.filter((account) => account.status === 'running').length,
        timestamp: Date.now(),
      },
    });
    return;
  }
  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      totalAccounts: accounts.length,
      runningBots: accounts.filter((account) => account.status === 'running').length,
      timestamp: Date.now(),
    },
  });
});
