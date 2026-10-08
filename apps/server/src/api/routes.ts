import { Router, Request, Response } from 'express';
import { db } from '../db/database.js';
import { workerPool } from '../orchestrator/worker-pool.js';
import type { VitalsRefreshResult } from '../orchestrator/vitals-refresh.js';
import { AuthError } from '@tutien2d/core-client';
import { type BotConfig } from '@tutien2d/automation-engine';
import { getWalkGrid, WALK_TILE_SIZE } from '../config/walk-grid.js';
import { VERIFIED_PORTAL_EDGES } from '../config/portal-catalog.js';
import { findNearestWalkableTarget } from '../orchestrator/walk-path.js';

export const apiRouter: Router = Router();

export function parseLimit(raw: unknown, fallback = 100, max = 500): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function moveToErrorResponse(error: string, nearestTarget?: { x: number; y: number } | null): {
  status: number;
  body: Record<string, unknown>;
} {
  const code = error === 'target_out_of_bounds' || error === 'target_blocked' ? error : undefined;
  const status = error === 'target_out_of_bounds' || error === 'target_blocked' ? 422
    : error === 'operation_in_progress' || error === 'world_context_stale_or_mismatch'
      || error === 'vitals_unknown' || error === 'character_down' || error.includes('kết nối') || error.includes('chạy')
      || error === 'request_id_conflict' ? 409 : 400;
  return {
    status,
    body: {
      success: false,
      error,
      errorCode: error,
      retryable: error === 'vitals_unknown',
      ...(code ? { code } : {}),
      ...(error === 'target_blocked' ? { acceptedTarget: nearestTarget ?? null, nearestTarget: nearestTarget ?? null } : {}),
    },
  };
}

export function vitalsRefreshErrorResponse(reason: string): {
  status: 409;
  body: { success: false; error: string; errorCode: string; retryable: boolean };
} {
  const retryable = reason === 'refresh_rate_limited'
    || reason === 'refresh_in_progress'
    || reason === 'disconnected';
  const errorCode = reason === 'refresh_rate_limited'
    ? 'VITALS_REFRESH_RATE_LIMITED'
    : reason === 'refresh_in_progress'
      ? 'VITALS_REFRESH_IN_PROGRESS'
      : reason === 'disconnected'
        ? 'VITALS_REFRESH_NOT_CONNECTED'
        : 'VITALS_REFRESH_NOT_ALLOWED';
  return { status: 409, body: { success: false, error: reason, errorCode, retryable } };
}

// GET all accounts with runtime stats
apiRouter.get('/accounts', (req: Request, res: Response) => {
  try {
    const accounts = workerPool.getAllRuntimes();
    res.json({ success: true, data: accounts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Catalog combines public-client display metadata with maps seen in live packets.
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

// POST add new account with Đạo Hiệu + Mật Khẩu
apiRouter.post('/accounts', async (req: Request, res: Response) => {
  try {
    const { accountName, password, token, proxyUrl } = req.body;
    if (!accountName || (!password && !token)) {
      res.status(400).json({
        success: false,
        error: 'Vui lòng nhập Đạo hiệu (tên tài khoản) và Mật khẩu.',
      });
      return;
    }

    let initialRefreshToken: string | undefined;

    // Verify password if provided
    if (password) {
      try {
        const session = await workerPool.verifyLogin(accountName, password);
        initialRefreshToken = session.refreshToken;
      } catch (err: any) {
        const msg = err instanceof AuthError ? err.message : `Xác thực thất bại: ${err?.message || err}`;
        res.status(400).json({ success: false, error: msg });
        return;
      }
    }

    const created = db.createAccount(
      accountName,
      {
        password: password || undefined,
        refreshToken: initialRefreshToken,
        legacyToken: token || undefined,
      },
      proxyUrl
    );

    res.json({ success: true, data: workerPool.getRuntimeInfo(created.id) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update account password
apiRouter.put('/accounts/:id/password', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { password } = req.body;
    const account = db.getAccountById(id);
    if (!account) {
      res.status(404).json({ success: false, error: 'Tài khoản không tồn tại.' });
      return;
    }
    if (!password) {
      res.status(400).json({ success: false, error: 'Vui lòng cung cấp mật khẩu mới.' });
      return;
    }

    // Verify new password
    const session = await workerPool.verifyLogin(account.accountName, password);
    db.updateCredentials(id, { password, refreshToken: session.refreshToken });
    db.updateAccount(id, { authError: null });

    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (err: any) {
    const msg = err instanceof AuthError ? err.message : err.message;
    res.status(400).json({ success: false, error: msg });
  }
});

// GET single account
apiRouter.get('/accounts/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const account = db.getAccountById(id);
  if (!account) {
    res.status(404).json({ success: false, error: 'Account not found' });
    return;
  }

  const runtime = workerPool.getRuntimeInfo(account.id);
  const config = db.getBotConfig(account.id);
  res.json({ success: true, data: { ...runtime, config } });
});

apiRouter.post('/accounts/:id/vitals/refresh', async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : {};
  const unknown = Object.keys(body).filter((key) => key !== 'allowNearMonsters');
  if (unknown.length > 0 || body.allowNearMonsters !== undefined && typeof body.allowNearMonsters !== 'boolean') {
    res.status(400).json({ success: false, error: 'invalid_request', errorCode: 'INVALID_REQUEST', retryable: false });
    return;
  }
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  try {
    const result: VitalsRefreshResult = await workerPool.refreshVitals(accountId, {
      allowNearMonsters: body.allowNearMonsters === true,
    });
    if (result.status === 'skipped') {
      const error = vitalsRefreshErrorResponse(result.reason ?? 'refresh_not_allowed');
      res.status(error.status).json({ ...error.body, requestId: res.locals.requestId });
      return;
    }
    res.json({ success: true, data: result });
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ.', errorCode: 'INTERNAL_ERROR', retryable: false });
  }
});

// Request map entry. The current game protocol does not provide a khu selector.
apiRouter.post('/accounts/:id/map/enter', async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  if (Object.prototype.hasOwnProperty.call(body, 'khu')) {
    res.status(400).json({
      success: false,
      error: 'Protocol hiện chưa hỗ trợ chọn khu; chỉ gửi mapId, yêu cầu khu đã bị từ chối.',
      khuSupported: false,
    });
    return;
  }

  const mapId = typeof body.mapId === 'string' ? body.mapId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(mapId)) {
    res.status(400).json({
      success: false,
      error: 'mapId không hợp lệ. Chỉ chấp nhận 1–64 ký tự chữ, số, gạch dưới hoặc gạch ngang.',
      khuSupported: false,
    });
    return;
  }

  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'Tài khoản không tồn tại.' });
    return;
  }

  try {
    const receipt = await workerPool.requestMapEntry(accountId, mapId);
    res.status(202).json({
      success: true,
      data: {
        ...receipt,
        khuSupported: false,
        message: receipt.status === 'already_at_destination'
          ? 'Nhân vật đã ở map đích theo snapshot authoritative.'
          : 'Đã lập tuyến qua portal; bot chỉ gửi enter khi nhân vật đã đứng trên ô cổng và chỉ hoàn tất sau packet map mới.',
      },
    });
  } catch (err: any) {
    const message = String(err?.message || err);
    const status = message.includes('Bot chưa chạy') || message.includes('chưa kết nối') ? 409
      : message.includes('Vui lòng chờ') ? 429
        : 400;
    res.status(status).json({ success: false, error: message, mapId, khuSupported: false });
  }
});

// Walk to a pixel position on the current authoritative map. This endpoint
// never emits raw packets; the worker uses the server's walk grid and client.
apiRouter.post('/accounts/:id/navigation/move-to', (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : {};
  const allowed = new Set(['requestId', 'mapId', 'khu', 'x', 'y', 'arrivalRadius']);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (unknown.length || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.requestId)
    || typeof body.mapId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.mapId)
    || !finite(body.khu) || !Number.isInteger(body.khu) || body.khu < 1
    || !finite(body.x) || !finite(body.y)
    || (body.arrivalRadius !== undefined && (!finite(body.arrivalRadius) || body.arrivalRadius < 1 || body.arrivalRadius > 128))) {
    res.status(400).json({ success: false, error: 'invalid_request', message: 'Body yêu cầu không hợp lệ.' });
    return;
  }
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found' });
    return;
  }
  try {
    const data = workerPool.requestMoveTo(accountId, {
      requestId: body.requestId, mapId: body.mapId, khu: body.khu,
      x: body.x, y: body.y,
      ...(body.arrivalRadius === undefined ? {} : { arrivalRadius: body.arrivalRadius }),
    });
    res.status(202).json({ success: true, data });
  } catch (err: any) {
    const error = String(err?.message || err);
    const nearestTarget = error === 'target_blocked'
      ? findNearestWalkableTarget(body.mapId as string, body.x as number, body.y as number)
      : undefined;
    const response = moveToErrorResponse(error, nearestTarget);
    console.warn(JSON.stringify({
      event: 'move_to_rejected', accountId, requestId: body.requestId,
      reason: error, status: response.status,
      mapId: body.mapId, khu: body.khu,
    }));
    res.status(response.status).json(response.body);
  }
});

apiRouter.post('/accounts/:id/navigation/move-to/cancel', (req: Request, res: Response) => {
  const operationId = typeof req.body?.operationId === 'string' ? req.body.operationId : '';
  if (!operationId || operationId.length > 128) {
    res.status(400).json({ success: false, error: 'invalid_operation_id' });
    return;
  }
  try {
    const data = workerPool.cancelMoveTo(String(req.params.id), operationId);
    res.json({ success: true, data });
  } catch (err: any) {
    const error = String(err?.message || err);
    res.status(error === 'move_to_not_found' ? 404 : 409).json({ success: false, error });
  }
});

// DELETE account
apiRouter.delete('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.stopAccount(id);
    const deleted = db.deleteAccount(id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }
    res.json({ success: true, message: 'Account deleted' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bot Control: Start
apiRouter.post('/accounts/:id/start', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.startAccount(id);
    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bot Control: Stop
apiRouter.post('/accounts/:id/stop', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.stopAccount(id);
    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bot Control: Restart
apiRouter.post('/accounts/:id/restart', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await workerPool.restartAccount(id);
    res.json({ success: true, data: workerPool.getRuntimeInfo(id) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger Manual Action
apiRouter.post('/accounts/:id/action', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const action = typeof req.body?.action === 'string' ? req.body.action : '';
    if (action === 'sell' || action === 'checkin') {
      res.status(400).json({
        success: false,
        error: `Action '${action}' is temporarily disabled; only 'farm' is currently available.`,
      });
      return;
    }
    if (action !== 'farm') {
      res.status(400).json({
        success: false,
        error: `Unsupported action '${action}'. Only 'farm' is currently available.`,
      });
      return;
    }
    const result = await workerPool.triggerAction(id, action);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET Bot Config
apiRouter.get('/accounts/:id/config', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const config = db.getBotConfig(id);
    res.json({ success: true, data: config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Bot Config
apiRouter.put('/accounts/:id/config', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!db.getAccountById(id)) {
      res.status(404).json({ success: false, error: 'Tài khoản không tồn tại.' });
      return;
    }
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ success: false, error: 'Body cấu hình phải là object.' });
      return;
    }
    const input = body as Record<string, unknown>;
    // Keep this allowlist explicit: optional BotConfig fields may not exist in
    // DEFAULT_BOT_CONFIG, and credentials/secrets must never be config fields.
    const allowed = new Set<string>([
      'legacyAutomationEnabled',
      'autoSell',
      'sellRules',
      'autoBuyHpMp',
      'minHpPotion',
      'hpRestockItem',
      'autoEatHp',
      'minHpPercent',
      'autoFarm',
      'autoTraining',
      'trainingMonsterType',
      'trainingRadius',
      'trainingAttackIntervalMs',
      'farmSeed',
      'autoDaily',
      'autoCave',
      'autoMainQuest',
      'autoDailyQuest',
      'autoCaveQuest',
      'autoTravelToFarm',
      'farmMapId',
      'farmKhu',
      'farmX',
      'farmY',
      'delayRangeMs',
      'tickIntervalSec',
    ]);
    const unknown = Object.keys(input).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      res.status(400).json({ success: false, error: `Field cấu hình không hỗ trợ: ${unknown.join(', ')}.` });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'trainingMonsterType')) {
      if (typeof input.trainingMonsterType !== 'string') {
        res.status(400).json({ success: false, error: 'trainingMonsterType phải là chuỗi.' });
        return;
      }
      const monsterType = input.trainingMonsterType.trim();
      if (monsterType.length > 128) {
        res.status(400).json({ success: false, error: 'trainingMonsterType không được vượt quá 128 ký tự.' });
        return;
      }
      input.trainingMonsterType = monsterType;
    }
    const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    if (Object.prototype.hasOwnProperty.call(input, 'autoTraining') && typeof input.autoTraining !== 'boolean') {
      res.status(400).json({ success: false, error: 'autoTraining phải là boolean.' });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'farmMapId')
      && (typeof input.farmMapId !== 'string' || (input.farmMapId.length > 0 && !/^[a-zA-Z0-9_-]{1,64}$/.test(input.farmMapId)))) {
      res.status(400).json({ success: false, error: 'farmMapId không hợp lệ.' });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'farmKhu')
      && (!isFiniteNumber(input.farmKhu) || !Number.isInteger(input.farmKhu) || input.farmKhu < 1)) {
      res.status(400).json({ success: false, error: 'farmKhu phải là số nguyên hữu hạn lớn hơn hoặc bằng 1.' });
      return;
    }
    for (const field of ['farmX', 'farmY'] as const) {
      if (Object.prototype.hasOwnProperty.call(input, field) && !isFiniteNumber(input[field])) {
        res.status(400).json({ success: false, error: `${field} phải là số hữu hạn.` });
        return;
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, 'trainingRadius')
      && (!isFiniteNumber(input.trainingRadius) || input.trainingRadius < 1 || input.trainingRadius > 100000)) {
      res.status(400).json({ success: false, error: 'trainingRadius phải nằm trong khoảng 1..100000.' });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'trainingAttackIntervalMs')
      && (!isFiniteNumber(input.trainingAttackIntervalMs) || input.trainingAttackIntervalMs < 100 || input.trainingAttackIntervalMs > 3600000)) {
      res.status(400).json({ success: false, error: 'trainingAttackIntervalMs phải nằm trong khoảng 100..3600000.' });
      return;
    }
    if (input.autoTraining === true) {
      const current = db.getBotConfig(id);
      const mapId = input.farmMapId ?? current.farmMapId;
      const x = input.farmX ?? current.farmX;
      const y = input.farmY ?? current.farmY;
      if (typeof mapId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(mapId)
        || !isFiniteNumber(x) || !isFiniteNumber(y)) {
        res.status(400).json({ success: false, error: 'Bật autoTraining cần farmMapId hợp lệ cùng farmX và farmY đã cấu hình.' });
        return;
      }
    }
    const updated = db.updateBotConfig(id, input as Partial<BotConfig>);
    workerPool.updateBotConfig(id, updated);
    res.json({ success: true, data: updated, runtime: workerPool.getRuntimeInfo(id) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET Account Logs
apiRouter.get('/accounts/:id/logs', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const limit = parseLimit(req.query.limit);
  const logs = db.getLogs(id, limit);
  res.json({ success: true, data: logs });
});

// GET Global Logs
apiRouter.get('/logs', (req: Request, res: Response) => {
  const limit = parseLimit(req.query.limit);
  const logs = db.getLogs(undefined, limit);
  res.json({ success: true, data: logs });
});

// Start All Bots
apiRouter.post('/orchestrator/start-all', async (req: Request, res: Response) => {
  try {
    await workerPool.startAll();
    res.json({ success: true, data: workerPool.getAllRuntimes() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stop All Bots
apiRouter.post('/orchestrator/stop-all', async (req: Request, res: Response) => {
  try {
    await workerPool.stopAll();
    res.json({ success: true, data: workerPool.getAllRuntimes() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// System Status
apiRouter.get('/system/status', (req: Request, res: Response) => {
  const accounts = workerPool.getAllRuntimes();
  const running = accounts.filter((a) => a.status === 'running').length;
  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      totalAccounts: accounts.length,
      runningBots: running,
      timestamp: Date.now(),
    },
  });
});
