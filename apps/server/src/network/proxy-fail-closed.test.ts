import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { SupabaseAuth } from '@tutien2d/core-client';
import { createProxyTransport } from './proxy-transport.js';

// Máy chủ giả cục bộ: proxy http/socks5 có đếm, "Supabase" giả và "game" giả đếm MỌI kết nối đến.
// Bất biến cần chứng minh: lưu lượng của tài khoản có proxy chỉ đi qua proxy; proxy chết/sai thì 0 kết nối trực tiếp.

interface Counted<T> { server: T; port: number; accepted: () => number; close: () => Promise<void> }

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
}

function closeServer(server: net.Server | http.Server): Promise<void> {
  return new Promise((resolve) => { server.close(() => resolve()); (server as net.Server & { closeAllConnections?: () => void }).closeAllConnections?.(); });
}

async function fakeSupabase(): Promise<Counted<http.Server>> {
  let connections = 0;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  server.on('connection', () => { connections += 1; });
  const port = await listen(server);
  return { server, port, accepted: () => connections, close: () => closeServer(server) };
}

async function fakeGame(): Promise<Counted<WebSocketServer> & { messages: string[] }> {
  let connections = 0;
  const messages: string[] = [];
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  wss.on('connection', (socket) => {
    connections += 1;
    socket.on('message', (data) => { messages.push(String(data)); socket.send('pong:' + String(data)); });
  });
  const port = (wss.address() as net.AddressInfo).port;
  return { server: wss, port, messages, accepted: () => connections, close: () => new Promise<void>((resolve) => { for (const c of wss.clients) c.terminate(); wss.close(() => resolve()); }) };
}

async function fakeHttpProxy(auth?: { user: string; pass: string }): Promise<Counted<http.Server> & { rejected: () => number }> {
  let forwarded = 0;
  let rejected = 0;
  const expected = auth ? 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64') : null;
  const allowed = (header: string | undefined): boolean => expected === null || header === expected;
  const server = http.createServer((req, res) => {
    if (!allowed(req.headers['proxy-authorization'] as string | undefined)) { rejected += 1; res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="x"' }); res.end(); return; }
    if (!req.url) { res.writeHead(400); res.end(); return; }
    forwarded += 1;
    const upstream = http.request(req.url, { method: req.method, headers: req.headers }, (response) => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
    req.pipe(upstream);
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });
  server.on('connect', (request, client, head) => {
    if (!allowed(request.headers['proxy-authorization'] as string | undefined)) { rejected += 1; client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="x"\r\n\r\n'); return; }
    const separator = String(request.url).lastIndexOf(':');
    const host = String(request.url).slice(0, separator);
    const port = Number(String(request.url).slice(separator + 1));
    forwarded += 1;
    const upstream = net.connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  const port = await listen(server);
  return { server, port, accepted: () => forwarded, rejected: () => rejected, close: () => closeServer(server) };
}

async function fakeSocksProxy(auth?: { user: string; pass: string }): Promise<Counted<net.Server> & { rejected: () => number }> {
  let forwarded = 0;
  let rejected = 0;
  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'auth' | 'request' | 'relay' = 'greeting';
    client.on('error', () => undefined);
    client.on('data', (chunk) => {
      if (stage === 'relay') return;
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting' && buffer.length >= 2 && buffer.length >= buffer[1] + 2) {
        buffer = buffer.subarray(buffer[1] + 2);
        if (auth) { client.write(Buffer.from([5, 2])); stage = 'auth'; } else { client.write(Buffer.from([5, 0])); stage = 'request'; }
      }
      if (stage === 'auth' && buffer.length >= 2) {
        const userLength = buffer[1];
        if (buffer.length < 2 + userLength + 1) return;
        const passLength = buffer[2 + userLength];
        if (buffer.length < 3 + userLength + passLength) return;
        const user = buffer.subarray(2, 2 + userLength).toString();
        const pass = buffer.subarray(3 + userLength, 3 + userLength + passLength).toString();
        buffer = buffer.subarray(3 + userLength + passLength);
        if (auth && user === auth.user && pass === auth.pass) { client.write(Buffer.from([1, 0])); stage = 'request'; }
        else { rejected += 1; client.end(Buffer.from([1, 1])); return; }
      }
      if (stage === 'request' && buffer.length >= 7) {
        const addressType = buffer[3];
        const addressLength = addressType === 1 ? 4 : addressType === 3 ? 1 + buffer[4] : 16;
        const total = 4 + addressLength + 2;
        if (buffer.length < total) return;
        const host = addressType === 1 ? [...buffer.subarray(4, 8)].join('.') : addressType === 3 ? buffer.subarray(5, 5 + buffer[4]).toString() : '::1';
        const port = buffer.readUInt16BE(total - 2);
        buffer = buffer.subarray(total);
        stage = 'relay';
        forwarded += 1;
        const upstream = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, (port >> 8) & 255, port & 255]));
          if (buffer.length) upstream.write(buffer);
          upstream.pipe(client); client.pipe(upstream);
        });
        upstream.on('error', () => client.destroy());
        client.on('close', () => upstream.destroy());
      }
    });
  });
  const port = await listen(server);
  return { server, port, accepted: () => forwarded, rejected: () => rejected, close: () => closeServer(server) };
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

function roundTrip(transport: ReturnType<typeof createProxyTransport>, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new transport.WebSocketImpl(url);
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('ws timeout')); }, 5000);
    socket.once('open', () => socket.send('hello'));
    socket.once('message', (data) => { clearTimeout(timer); socket.close(); resolve(String(data)); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

const variants: Array<{ name: string; make: (auth?: { user: string; pass: string }) => Promise<Counted<http.Server | net.Server> & { rejected: () => number }>; url: (port: number, auth?: { user: string; pass: string }) => string }> = [
  { name: 'http', make: fakeHttpProxy, url: (port, auth) => `http://${auth ? `${auth.user}:${encodeURIComponent(auth.pass)}@` : ''}127.0.0.1:${port}` },
  { name: 'socks5', make: fakeSocksProxy, url: (port, auth) => `socks5://${auth ? `${auth.user}:${encodeURIComponent(auth.pass)}@` : ''}127.0.0.1:${port}` },
];

for (const variant of variants) {
  for (const withAuth of [false, true]) {
    const label = `${variant.name}${withAuth ? ' có xác thực' : ''}`;
    const auth = withAuth ? { user: 'u1', pass: 'p@ss:w0rd' } : undefined;

    test(`proxy ${label}: fetch và WebSocket đi QUA proxy (số kết nối đích == số proxy chuyển tiếp)`, async () => {
      const supabase = await fakeSupabase();
      const game = await fakeGame();
      const proxy = await variant.make(auth);
      const transport = createProxyTransport(variant.url(proxy.port, auth));
      try {
        const response = await transport.fetch(`http://127.0.0.1:${supabase.port}/auth/v1/health`);
        assert.equal(response.status, 200);
        assert.equal(await roundTrip(transport, `ws://127.0.0.1:${game.port}`), 'pong:hello');
        assert.equal(proxy.accepted(), 2, 'proxy phải chuyển tiếp cả fetch lẫn WS');
        assert.equal(supabase.accepted() + game.accepted(), proxy.accepted(), 'không được có kết nối trực tiếp tới đích');
      } finally {
        await transport.close();
        await proxy.close(); await supabase.close(); await game.close();
      }
    });

    if (withAuth) {
      test(`proxy ${label}: sai mật khẩu → PROXY_AUTH_FAILED, 0 kết nối tới đích, thông báo không lộ mật khẩu`, async () => {
        const supabase = await fakeSupabase();
        const game = await fakeGame();
        const proxy = await variant.make(auth);
        const transport = createProxyTransport(variant.url(proxy.port, { user: 'u1', pass: 'sai-mat-khau-bi-mat' }));
        try {
          const failure = await transport.fetch(`http://127.0.0.1:${supabase.port}/x`).then(() => null, (error: Error & { code?: string }) => error);
          assert.ok(failure, 'fetch phải thất bại');
          assert.equal(failure.code, 'PROXY_AUTH_FAILED', String(failure.message));
          assert.ok(!/sai-mat-khau-bi-mat/.test(`${failure.message} ${failure.stack ?? ''}`), 'không được lộ mật khẩu proxy');
          const wsFailure = await roundTrip(transport, `ws://127.0.0.1:${game.port}`).then(() => null, (error: Error) => error);
          assert.ok(wsFailure, 'WebSocket phải thất bại');
          assert.ok(!/sai-mat-khau-bi-mat/.test(`${wsFailure.message} ${wsFailure.stack ?? ''}`), 'không lộ mật khẩu qua WS');
          assert.equal(supabase.accepted() + game.accepted(), 0, 'sai xác thực không được dẫn tới kết nối trực tiếp');
        } finally {
          await transport.close();
          await proxy.close(); await supabase.close(); await game.close();
        }
      });
    }
  }

  test(`FAIL-CLOSED ${variant.name}: proxy chết → fetch/WS/đăng nhập Supabase thất bại và đích đếm 0 kết nối trực tiếp`, async () => {
    const supabase = await fakeSupabase();
    const game = await fakeGame();
    const deadPort = await closedPort();
    const transport = createProxyTransport(variant.url(deadPort));
    try {
      const fetchFailure = await transport.fetch(`http://127.0.0.1:${supabase.port}/x`).then(() => null, (error: Error & { code?: string }) => error);
      assert.ok(fetchFailure, 'fetch phải thất bại khi proxy chết');
      assert.ok(['PROXY_CONNECT_FAILED', 'PROXY_TIMEOUT', 'PROXY_PROTOCOL_ERROR'].includes(String(fetchFailure.code)), `mã lỗi: ${fetchFailure.code}`);
      const wsFailure = await roundTrip(transport, `ws://127.0.0.1:${game.port}`).then(() => null, (error: Error) => error);
      assert.ok(wsFailure, 'WebSocket phải thất bại khi proxy chết');
      // Đường đăng nhập thật của dự án: SupabaseAuth dùng transport.fetch; không được rơi về fetch toàn cục.
      const auth = new SupabaseAuth({ url: `http://127.0.0.1:${supabase.port}`, anonKey: 'k', gameApiBase: `http://127.0.0.1:${game.port}`, fetchImpl: transport.fetch });
      await assert.rejects(() => auth.signInWithPassword('someone', 'secret-pass'));
      // Kết nối lại nhiều lần vẫn không rò.
      for (let attempt = 0; attempt < 3; attempt += 1) await roundTrip(transport, `ws://127.0.0.1:${game.port}`).then(() => assert.fail('không được kết nối'), () => undefined);
      assert.equal(supabase.accepted(), 0, 'Supabase giả không được thấy kết nối trực tiếp');
      assert.equal(game.accepted(), 0, 'game giả không được thấy kết nối trực tiếp');
    } finally {
      await transport.close();
      await supabase.close(); await game.close();
    }
  });
}

test('proxy đã đóng: transport không rơi về kết nối trực tiếp', async () => {
  const supabase = await fakeSupabase();
  const proxy = await fakeHttpProxy();
  const transport = createProxyTransport(`http://127.0.0.1:${proxy.port}`);
  try {
    await transport.close();
    const failure = await transport.fetch(`http://127.0.0.1:${supabase.port}/x`).then(() => null, (error: Error & { code?: string }) => error);
    assert.equal(failure?.code, 'PROXY_UNAVAILABLE');
    assert.throws(() => new transport.WebSocketImpl('ws://127.0.0.1:1'), (error: unknown) => (error as { code?: string }).code === 'PROXY_UNAVAILABLE');
    assert.equal(supabase.accepted(), 0);
  } finally {
    await proxy.close(); await supabase.close();
  }
});
