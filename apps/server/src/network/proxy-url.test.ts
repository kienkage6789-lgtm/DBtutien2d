import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProxyUrl, redactProxyError, redactProxyUrl } from './proxy-url.js';

test('proxy URL parser accepts supported schemes only with an explicit port', () => {
  assert.equal(parseProxyUrl('http://proxy.example:8080', false).safeLabel, 'http://proxy.example:8080');
  assert.equal(parseProxyUrl('https://user:pass@proxy.example:8443', false).hasAuth, true);
  assert.equal(parseProxyUrl('socks5://proxy.example:1080', false).scheme, 'socks5');
  assert.equal(parseProxyUrl('socks5h://proxy.example:1081', false).protocol, 'socks5h');
  assert.throws(() => parseProxyUrl('http://proxy.example', false), /PROXY_PORT_INVALID/);
  assert.throws(() => parseProxyUrl('ftp://proxy.example:21', false), /PROXY_SCHEME_UNSUPPORTED/);
  assert.throws(() => parseProxyUrl('http://proxy.example:' + String.fromCharCode(1) + '8080', false), /PROXY_URL_INVALID/);
  assert.throws(() => parseProxyUrl('http://' + 'x'.repeat(2050) + ':8080', false), /PROXY_URL_INVALID/);
});

test('private proxy endpoints are opt-in and redaction never returns userinfo', () => {
  assert.throws(() => parseProxyUrl('http://127.0.0.1:8080', false), /PROXY_PRIVATE_HOST/);
  assert.equal(parseProxyUrl('http://127.0.0.1:8080', true).safeLabel, 'http://127.0.0.1:8080');
  assert.equal(redactProxyUrl('http://secret-user:secret-pass@proxy.example:8080'), 'http://proxy.example:8080');
  assert.doesNotMatch(redactProxyError('connect failed for http://secret-user:secret-pass@proxy.example:8080'), /secret-(user|pass)/);
});
