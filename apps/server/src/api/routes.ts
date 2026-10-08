import { Router, Request, Response } from 'express';
import { AuthError } from '@tutien2d/core-client';
import { db } from '../db/database.js';
import { workerPool } from '../orchestrator/worker-pool.js';
import { getWalkGrid, WALK_TILE_SIZE } from '../config/walk-grid.js';
import { VERIFIED_PORTAL_EDGES } from '../config/portal-catalog.js';
import type { AutoAnchor } from '../headless/auto-supervisor.js';
import { vendorAutoErrorResponse } from './vendor-auto-errors.js';
import { moveToErrorResponse } from './move-to-errors.js';

export const apiRouter: Router = Router();

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
  res.json({ success: true, data: workerPool.getAllRuntimes() });
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

apiRouter.post('/accounts', async (req: Request, res: Response) => {
  try {
    const { accountName, password, token, proxyUrl } = req.body;
    if (!accountName || (!password && !token)) {
      res.status(400).json({ success: false, error: 'Account name and password/token are required.' });
      return;
    }

    let initialRefreshToken: string | undefined;
    if (password) {
      try {
        const session = await workerPool.verifyLogin(accountName, password);
        initialRefreshToken = session.refreshToken;
      } catch (error) {
        const message = error instanceof AuthError ? error.message : `Authentication failed: ${String(error)}`;
        res.status(400).json({ success: false, error: message });
        return;
      }
    }

    const created = db.createAccount(accountName, {
      password: password || undefined,
      refreshToken: initialRefreshToken,
      legacyToken: token || undefined,
    }, proxyUrl);
    res.json({ success: true, data: workerPool.getRuntimeInfo(created.id) });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
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
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
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

apiRouter.post('/accounts/:id/move-to', (req: Request, res: Response) => {
  const accountId = String(req.params.id);
  if (!db.getAccountById(accountId)) {
    res.status(404).json({ success: false, error: 'account_not_found', errorCode: 'ACCOUNT_NOT_FOUND', retryable: false });
    return;
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown> : null;
  const validBody = !!body && Object.keys(body).length === 2
    && Object.keys(body).every((key) => key === 'x' || key === 'y')
    && typeof body.x === 'number' && Number.isFinite(body.x)
    && typeof body.y === 'number' && Number.isFinite(body.y);
  if (!validBody) {
    res.status(400).json({ success: false, error: 'TARGET_INVALID', errorCode: 'TARGET_INVALID', retryable: false });
    return;
  }
  try {
    const data = workerPool.moveTo(accountId, {
      target: { x: body?.x as number, y: body?.y as number },
      requester: 'user',
    });
    res.status(202).json({ success: true, data });
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

apiRouter.get('/accounts/:id/logs', (req: Request, res: Response) => {
  res.json({ success: true, data: db.getLogs(String(req.params.id), parseLimit(req.query.limit)) });
});

apiRouter.get('/logs', (req: Request, res: Response) => {
  res.json({ success: true, data: db.getLogs(undefined, parseLimit(req.query.limit)) });
});

apiRouter.post('/orchestrator/start-all', async (req: Request, res: Response) => {
  try {
    await workerPool.startAll();
    res.json({ success: true, data: workerPool.getAllRuntimes() });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

apiRouter.post('/orchestrator/stop-all', async (req: Request, res: Response) => {
  try {
    await workerPool.stopAll();
    res.json({ success: true, data: workerPool.getAllRuntimes() });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

apiRouter.get('/system/status', (_req: Request, res: Response) => {
  const accounts = workerPool.getAllRuntimes();
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
