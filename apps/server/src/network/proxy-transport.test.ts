import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { createProxyTransport } from './proxy-transport.js';

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
}

function closeServer(server: net.Server | http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('HTTP proxy transport routes fetch and WebSocket through one local proxy', async () => {
  const target = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('target'); });
  const targetPort = await listen(target);
  const wsServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wsServer.once('listening', () => resolve()));
  wsServer.on('connection', (socket) => socket.close());
  const wsPort = (wsServer.address() as net.AddressInfo).port;

  const proxy = http.createServer((req, res) => {
    if (!req.url) { res.writeHead(400); res.end(); return; }
    const targetRequest = http.request(req.url, { method: req.method, headers: req.headers }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    req.pipe(targetRequest);
    targetRequest.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });
  proxy.on('connect', (request, client, head) => {
    const separator = String(request.url).lastIndexOf(':');
    const host = String(request.url).slice(0, separator);
    const port = Number(String(request.url).slice(separator + 1));
    const upstream = net.connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
  });
  const proxyPort = await listen(proxy);
  const transport = createProxyTransport('http://127.0.0.1:' + proxyPort);
  try {
    const response = await transport.fetch('http://127.0.0.1:' + targetPort + '/health');
    assert.equal(await response.text(), 'target');
    await new Promise<void>((resolve, reject) => {
      const socket = new transport.WebSocketImpl('ws://127.0.0.1:' + wsPort);
      socket.once('open', () => { socket.close(); resolve(); });
      socket.once('error', reject);
    });
    await transport.close();
    await assert.rejects(() => transport.fetch('http://127.0.0.1:' + targetPort + '/health'), (error: unknown) => (error as { code?: string }).code === 'PROXY_UNAVAILABLE');
  } finally {
    await transport.close();
    await closeServer(proxy);
    await closeServer(target);
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
  }
});

test('SOCKS5 proxy transport routes a local request without falling back direct', async () => {
  const target = http.createServer((_req, res) => res.end('socks-target'));
  const targetPort = await listen(target);
  const socks = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'request' | 'relay' = 'greeting';
    client.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting' && buffer.length >= 2) {
        const length = buffer[1] + 2;
        if (buffer.length < length) return;
        buffer = buffer.subarray(length);
        client.write(Buffer.from([5, 0]));
        stage = 'request';
      }
      if (stage === 'request' && buffer.length >= 7) {
        const addressType = buffer[3];
        const addressLength = addressType === 1 ? 4 : addressType === 3 ? 5 + buffer[4] : 17;
        const length = 4 + addressLength + 2;
        if (buffer.length < length) return;
        const port = buffer.readUInt16BE(length - 2);
        buffer = buffer.subarray(length);
        const upstream = net.connect(port, '127.0.0.1', () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, (port >> 8) & 255, port & 255]));
          stage = 'relay';
          if (buffer.length) upstream.write(buffer);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on('error', () => client.destroy());
      }
    });
  });
  const socksPort = await listen(socks);
  const transport = createProxyTransport('socks5://127.0.0.1:' + socksPort);
  try {
    const response = await transport.fetch('http://127.0.0.1:' + targetPort + '/health');
    assert.equal(await response.text(), 'socks-target');
  } finally {
    await transport.close();
    await closeServer(socks);
    await closeServer(target);
  }
});
