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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', CONFIG.TRUST_PROXY);

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
  app.use(express.static(webDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

const server = http.createServer(app);
app.use(errorHandler);

// Initialize WebSocket Hub on same HTTP server
wsHub.init(server, () => workerPool.getAllRuntimes());

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`[TuTien2D Server] Backend listening on http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`[TuTien2D Server] Internal WS Hub ready at ws://${CONFIG.HOST}:${CONFIG.PORT}/ws`);
  if (fs.existsSync(webDistPath)) {
    console.log(`[TuTien2D Server] Serving Web Dashboard from http://${CONFIG.HOST}:${CONFIG.PORT}`);
  }
});

// Graceful shutdown
async function handleShutdown() {
  console.log('\n[TuTien2D Server] Shutting down, stopping all active bots...');
  await workerPool.stopAll();
  db.flush();
  server.close(() => {
    console.log('[TuTien2D Server] Server closed cleanly.');
    process.exit(0);
  });
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
