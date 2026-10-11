import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import { apiRouter } from './api/routes.js';
import { wsHub } from './ws/hub.js';
import { workerPool } from './orchestrator/worker-pool.js';
import { db } from './db/database.js';
import { errorHandler } from './security/errors.js';
import { entitlementWatcher } from './orchestrator/entitlement-runtime.js';
import { processMetrics } from './orchestrator/process-metrics.js';
import { redactProxyError } from './network/proxy-url.js';
import { createSecurityHeaders, STATIC_CACHE_CONTROL, HTML_CACHE_CONTROL } from './security/http-hardening.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
// Trust one known reverse-proxy hop only. `true` would accept an arbitrary
// forwarded-header chain and make IP rate limiting unsafe.
app.set('trust proxy', CONFIG.TRUST_PROXY ? CONFIG.TRUST_PROXY_HOPS : false);
app.use(createSecurityHeaders({ trustProxy: CONFIG.TRUST_PROXY }));

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || CONFIG.ALLOWED_ORIGINS.includes(origin)),
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
}));
app.use((req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w.-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use((_req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 400 || !body || typeof body !== 'object' || Array.isArray(body)) return sendJson(body);
    const payload = body as Record<string, unknown>;
    const message = res.statusCode >= 500 ? 'Lỗi máy chủ nội bộ.'
      : typeof payload.error === 'string' ? payload.error
        : typeof payload.message === 'string' ? payload.message : 'Yêu cầu không hợp lệ.';
    const code = typeof payload.errorCode === 'string' ? payload.errorCode
      : typeof payload.code === 'string' ? payload.code
        : /^[a-z][a-z0-9_]{2,63}$/.test(String(payload.error ?? '')) ? String(payload.error).toUpperCase() : `HTTP_${res.statusCode}`;
    return sendJson({ ...payload, success: false, error: message, errorCode: code,
      requestId: res.locals.requestId, retryable: typeof payload.retryable === 'boolean' ? payload.retryable : false });
  }) as typeof res.json;
  next();
});

// API router
app.use('/api', apiRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend build if exists
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
      else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', STATIC_CACHE_CONTROL);
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

const server = http.createServer(app);
app.use(errorHandler);

// Initialize WebSocket Hub on same HTTP server
wsHub.init(server, () => workerPool.getAllRuntimes());
entitlementWatcher.start();
processMetrics.start();
workerPool.startProxyChecks();

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`[TuTien2D Server] Backend listening on http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`[TuTien2D Server] Internal WS Hub ready at ws://${CONFIG.HOST}:${CONFIG.PORT}/ws`);
  if (fs.existsSync(webDistPath)) {
    console.log(`[TuTien2D Server] Serving Web Dashboard from http://${CONFIG.HOST}:${CONFIG.PORT}`);
  }
});

// Graceful shutdown
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 20_000;

/** Mô tả lỗi đã làm sạch: không bao giờ chứa token/URL proxy có xác thực; đường dẫn thư mục bị cắt bớt. */
function describeFailure(error: unknown): { name: string; message: string; where: string } {
  const err = error instanceof Error ? error : null;
  const message = redactProxyError(err ? err.message : String(error ?? '')).slice(0, 240);
  const frames = (err?.stack ?? '').split('\n').slice(1, 4)
    .map((line) => line.trim().replace(/^at\s+/, '').replace(/\(?[^()\s]*[\\/]([^\\/()\s]+)\)?$/, '($1)'))
    .join(' | ').slice(0, 300);
  return { name: err ? err.name : typeof error, message, where: frames };
}

async function handleShutdown(exitCode = 0, reason = 'unknown'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[TuTien2D Server] Shutting down, stopping all active bots... (reason=${reason}; exitCode=${exitCode})`);
  const httpClosed = new Promise<void>((resolve) => {
    if (!server.listening) { resolve(); return; }
    server.close(() => resolve());
  });
  wsHub.closeAll();
  entitlementWatcher.stop();
  processMetrics.stop();
  workerPool.stopProxyChecks();
  try {
    await workerPool.stopAll(undefined, { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    await workerPool.shutdownShards(SHUTDOWN_TIMEOUT_MS);
    await Promise.race([
      httpClosed,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch {
    console.error(JSON.stringify({ event: 'shutdown_error' }));
  } finally {
    db.flush();
    db.close();
    console.log('[TuTien2D Server] Server closed cleanly.');
    process.exit(exitCode);
  }
}

process.on('SIGINT', () => { void handleShutdown(0, 'SIGINT'); });
process.on('SIGTERM', () => { void handleShutdown(0, 'SIGTERM'); });
process.on('uncaughtException', (error) => {
  const detail = describeFailure(error);
  console.error(JSON.stringify({ event: 'uncaught_exception', error: detail.name, message: detail.message, where: detail.where }));
  void handleShutdown(1, `uncaught_exception:${detail.name}`);
});
process.on('unhandledRejection', (reason) => {
  const detail = describeFailure(reason);
  console.error(JSON.stringify({ event: 'unhandled_rejection', error: detail.name, message: detail.message, where: detail.where }));
  void handleShutdown(1, `unhandled_rejection:${detail.name}`);
});
