import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { ProxyChecker } from './proxy-checker.js';

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)); });
}

async function stack(supabaseStatus: number): Promise<{ proxyUrl: string; supabaseUrl: string; gameUrl: string; direct: () => number; close: () => Promise<void> }> {
  let direct = 0;
  const supabase = http.createServer((_req, res) => { res.writeHead(supabaseStatus); res.end('{}'); });
  supabase.on('connection', () => { direct += 1; });
  const supabasePort = await listen(supabase);
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  wss.on('connection', (socket) => { direct += 1; socket.close(); });
  const gamePort = (wss.address() as net.AddressInfo).port;
  const proxy = http.createServer((req, res) => {
    if (!req.url) { res.writeHead(400); res.end(); return; }
    const upstream = http.request(req.url, { method: req.method, headers: req.headers }, (response) => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
    req.pipe(upstream);
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });
  proxy.on('connect', (request, client, head) => {
    const index = String(request.url).lastIndexOf(':');
    const upstream = net.connect(Number(String(request.url).slice(index + 1)), String(request.url).slice(0, index), () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
  });
  const proxyPort = await listen(proxy);
  return {
    proxyUrl: `http://127.0.0.1:${proxyPort}`, supabaseUrl: `http://127.0.0.1:${supabasePort}`, gameUrl: `ws://127.0.0.1:${gamePort}`, direct: () => direct,
    close: async () => { for (const c of wss.clients) c.terminate(); await Promise.all([new Promise<void>((r) => wss.close(() => r())), new Promise<void>((r) => { proxy.close(() => r()); proxy.closeAllConnections(); }), new Promise<void>((r) => { supabase.close(() => r()); supabase.closeAllConnections(); })]); },
  };
}

test('ProxyChecker: 401 từ Supabase (thiếu khóa) vẫn là ok vì đã tới đích qua proxy; WS chỉ bắt tay', async () => {
  const env = await stack(401);
  try {
    const result = await new ProxyChecker({ supabaseUrl: env.supabaseUrl, gameServerUrl: env.gameUrl, timeoutMs: 3000 }).check(env.proxyUrl);
    assert.equal(result.status, 'ok', String(result.error));
    assert.ok(result.latencyMs !== null && result.latencyMs >= 0);
  } finally { await env.close(); }
});

test('ProxyChecker: Supabase 5xx hoặc proxy chết → down, không lộ thông tin xác thực', async () => {
  const env = await stack(503);
  try {
    const down = await new ProxyChecker({ supabaseUrl: env.supabaseUrl, gameServerUrl: env.gameUrl, timeoutMs: 3000 }).check(env.proxyUrl);
    assert.equal(down.status, 'down');
    const dead = await new ProxyChecker({ supabaseUrl: env.supabaseUrl, gameServerUrl: env.gameUrl, timeoutMs: 3000 }).check('http://user:secret-pass@127.0.0.1:1');
    assert.equal(dead.status, 'down');
    assert.ok(!/secret-pass/.test(String(dead.error)));
    assert.ok(env.direct() >= 1, 'chỉ để chắc dựng được môi trường: kết nối tới Supabase giả đến từ proxy');
  } finally { await env.close(); }
});
