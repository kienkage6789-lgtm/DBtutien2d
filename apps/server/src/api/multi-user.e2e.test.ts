import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

// Kiểm thử đầu-cuối đa người dùng: chạy máy chủ thật (tsx) với DATA_DIR tạm, không chạm game, không mạng.
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address() as net.AddressInfo; srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

test('đa người dùng đầu-cuối: đăng nhập, phân quyền sở hữu, WS, thu hồi phiên, giới hạn đăng nhập', { timeout: 120_000 }, async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tt2d-mu-'));
  const PORT = await freePort();
  const B = `http://127.0.0.1:${PORT}`;
  const failures: string[] = [];
  const check = (cond: unknown, message: string): void => { if (!cond) failures.push(message); };
  const j = async (p: string, m = 'GET', b?: unknown, token?: string): Promise<{ s: number; b: any }> => {
    const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined });
    let body: any = null; try { body = await r.json(); } catch { /* không phải JSON */ }
    return { s: r.status, b: body };
  };
  const env = { ...process.env, DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', API_TOKEN: '', ADMIN_USERNAME: '', ADMIN_PASSWORD: '' };
  const srv = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i += 1) { try { up = (await fetch(B + '/health')).ok; } catch { /* chưa lên */ } if (!up) await sleep(250); }
    assert.ok(up, 'máy chủ không khởi động: ' + log.slice(0, 400));
    // 1. không token
    check((await j('/api/accounts')).s === 401, 'no token 401');
    check((await j('/api/accounts', 'GET', null, 'bogus')).s === 401, 'bad token 401');
    // 2. login admin
    let r = await j('/api/auth/login', 'POST', { username: 'Admin', password: 'admin123' });
    check(r.s === 200 && r.b.token, 'admin login ' + r.s);
    const tokA = r.b.token;
    check(r.b.user.mustChangePassword === true, 'mustChangePassword');
    check(JSON.stringify(r.b).indexOf('hash') < 0, 'no hash in login');
    // 3. sai mk
    r = await j('/api/auth/login', 'POST', { username: 'admin', password: 'wrongpass' });
    const r2 = await j('/api/auth/login', 'POST', { username: 'nouser', password: 'wrongpass' });
    check(r.s === 401 && r2.s === 401 && r.b.errorCode === r2.b.errorCode, 'same error ' + r.s + r2.s);
    // 4. tạo hai user
    r = await j('/api/admin/users', 'POST', { username: 'Alice', password: 'alice1' }, tokA);
    check(r.s === 200 || r.s === 201, 'create alice ' + r.s + JSON.stringify(r.b).slice(0, 120));
    const alice = r.b.data && (r.b.data.user || r.b.data);
    r = await j('/api/admin/users', 'POST', { username: 'bob', password: 'bob123', maxBots: 5 }, tokA);
    const bob = r.b.data && (r.b.data.user || r.b.data);
    r = await j('/api/admin/users', 'POST', { username: ' ALICE ', password: 'zzzzzz' }, tokA);
    check(r.s >= 400, 'dup username rejected ' + r.s);
    const adminUsers = await j('/api/admin/users', 'GET', null, tokA);
    const adminList = Array.isArray(adminUsers.b?.data) ? adminUsers.b.data : [];
    const adminAlice = adminList.find((item: any) => item.id === alice.id);
    check(adminUsers.s === 200 && adminAlice?.usage?.accounts === 0 && adminAlice?.usage?.running === 0, 'admin users usage');
    check(adminAlice?.activeSessions === 0 && adminAlice?.createdAt && adminAlice?.lastLoginAt === null, 'admin users metadata');
    check(JSON.stringify(adminUsers.b).toLowerCase().indexOf('password_hash') < 0 && JSON.stringify(adminUsers.b).toLowerCase().indexOf('token_hash') < 0, 'admin users no hashes');
    const tokAl = (await j('/api/auth/login', 'POST', { username: 'alice', password: 'alice1' })).b.token;
    const tokBo = (await j('/api/auth/login', 'POST', { username: 'bob', password: 'bob123' })).b.token;
    check(alice && alice.maxBots === 3 && bob.maxBots === 5, 'maxBots default/override ' + (alice && alice.maxBots));
    // 5. user thường vào admin
    check((await j('/api/admin/users', 'GET', null, tokAl)).s === 403, 'user admin 403');
    check((await j('/api/admin/users', 'POST', { username: 'x', password: 'xxxxxx' }, tokAl)).s === 403, 'user create 403');
    // 6. seed accounts bằng tiến trình khác (cùng SQLite)
    const seed = spawn(process.execPath, ['--import', 'tsx', '-e', `
      import('./src/db/database.ts').then(({db})=>{
        const a=db.createAccount('acc_alice',{password:'pw'},null,${JSON.stringify(alice.id)}); const b=db.createAccount('acc_bob',{password:'pw'},null,${JSON.stringify(bob.id)});
        console.log(JSON.stringify([a.id,b.id])); setTimeout(()=>process.exit(0),300);});
    `], { cwd: SERVER_DIR, env: { ...process.env, DATA_DIR: DATA } });
    let out = ''; seed.stdout.on('data', (d) => { out += d; }); seed.stderr.on('data', (d) => { out += d; });
    await new Promise((res) => seed.on('close', res));
    const m = /\[("[^"]+"),("[^"]+")\]/.exec(out);
    assert.ok(m, 'seed lỗi: ' + out.slice(0, 300));
    const idA = JSON.parse(m[1]), idB = JSON.parse(m[2]);
    // Grant/expiry contract without opening a game connection: auto/start reaches
    // the vendor gate after entitlement, and is rejected by entitlement before it
    // can touch the game when the expiry is forced into the past.
    r = await j(`/api/admin/users/${alice.id}/grant`, 'POST', { duration: '1d' }, tokA);
    check(r.s === 200 && r.b.data?.entitlement?.state === 'active', 'grant alice ' + r.s);
    const autoBeforeExpiry = await j(`/api/accounts/${idA}/auto/start`, 'POST', {}, tokAl);
    check(autoBeforeExpiry.s === 409 && autoBeforeExpiry.b.errorCode === 'ENGINE_VENDOR_REQUIRED', 'active user passed entitlement gate ' + autoBeforeExpiry.s);
    const stopAlice = await j(`/api/admin/users/${alice.id}/stop-bots`, 'POST', {}, tokA);
    check(stopAlice.s === 200 && stopAlice.b.data?.stopped === 0, 'admin stop-bots ' + stopAlice.s);
    r = await j(`/api/admin/users/${alice.id}/expiry`, 'POST', { expiresAt: 0 }, tokA);
    check(r.s === 200 && r.b.data?.entitlement?.state === 'expired', 'expiry alice ' + r.s);
    const autoAfterExpiry = await j(`/api/accounts/${idA}/auto/start`, 'POST', {}, tokAl);
    check(autoAfterExpiry.s === 403 && autoAfterExpiry.b.errorCode === 'ENTITLEMENT_EXPIRED', 'expired user blocked ' + autoAfterExpiry.s);
    // Ma trận cổng quyền khi hết hạn: route điều khiển bị chặn, route đọc/dừng/đổi mật khẩu vẫn qua.
    const gated: Array<[string, string, unknown?]> = [['POST', '/start'], ['POST', '/restart'], ['POST', '/auto/start', {}], ['POST', '/khu', { khu: 1 }], ['POST', '/move-to', { x: 1, y: 1 }], ['POST', '/daily/checkin', {}], ['POST', '/daily/seed', { taskId: 'duoc_moc' }], ['POST', '/daily/cancel', { operationId: 'x' }]];
    for (const [mth, suf, body] of gated) {
      const x = await j(`/api/accounts/${idA}${suf}`, mth, body, tokAl);
      check(x.s === 403 && x.b.errorCode === 'ENTITLEMENT_EXPIRED', `expired gate ${mth} ${suf} -> ${x.s} ${x.b?.errorCode}`);
    }
    const startAllExpired = await j('/api/orchestrator/start-all', 'POST', {}, tokAl);
    check(startAllExpired.s === 403 && startAllExpired.b.errorCode === 'ENTITLEMENT_EXPIRED', 'expired start-all ' + startAllExpired.s);
    const allowed: Array<[string, string, unknown?]> = [['GET', ''], ['GET', '/logs'], ['POST', '/stop'], ['POST', '/auto/stop']];
    for (const [mth, suf, body] of allowed) {
      const x = await j(`/api/accounts/${idA}${suf}`, mth, body, tokAl);
      check(x.b?.errorCode !== 'ENTITLEMENT_EXPIRED' && x.s !== 403, `expired allowed ${mth} ${suf} -> ${x.s} ${x.b?.errorCode}`);
    }
    check((await j('/api/orchestrator/stop-all', 'POST', {}, tokAl)).s === 200, 'expired stop-all allowed');
    const meExpired = (await j('/api/auth/me', 'GET', null, tokAl)).b;
    check(meExpired.user?.entitlement?.state === 'expired', 'me shows expired');
    r = await j(`/api/admin/users/${alice.id}/grant`, 'POST', { duration: '1d' }, tokA);
    check(r.s === 200 && r.b.data?.entitlement?.state === 'active', 'regrant alice ' + r.s);
    // Hạn mức bot: alice có 1 tài khoản; hạ maxBots còn 1 thì không thêm được tài khoản (chặn trước khi chạm mạng).
    r = await j(`/api/admin/users/${alice.id}`, 'PATCH', { maxBots: 1 }, tokA);
    check(r.s === 200, 'maxBots=1 ' + r.s);
    const overQuota = await j('/api/accounts', 'POST', { accountName: 'quota_probe', password: 'secret1' }, tokAl);
    check(overQuota.s === 403 && overQuota.b.errorCode === 'QUOTA_BOTS', 'quota blocks add ' + overQuota.s + ' ' + overQuota.b?.errorCode);
    check((await j(`/api/admin/users/${alice.id}`, 'PATCH', { maxBots: -1 }, tokA)).s === 400, 'maxBots invalid 400');
    check((await j(`/api/admin/users/${alice.id}`, 'PATCH', { maxBots: 3 }, tokA)).s === 200, 'maxBots=3 restored');
    // 7. ma trận sở hữu
    const list = async (t: string): Promise<string[]> => (await j('/api/accounts', 'GET', null, t)).b.data.map((x: any) => x.id);
    const lA = await list(tokAl), lB = await list(tokBo), lAd = await list(tokA);
    check(lA.length === 1 && lA[0] === idA, 'alice lists own only ' + lA);
    check(lB.length === 1 && lB[0] === idB, 'bob lists own only');
    check(lAd.includes(idA) && lAd.includes(idB), 'admin sees all');
    const adminRuntime = (await j('/api/accounts', 'GET', null, tokA)).b.data;
    const aliceRuntime = adminRuntime.find((item: any) => item.id === idA);
    const aliceOwnRuntime = (await j('/api/accounts', 'GET', null, tokAl)).b.data[0];
    check(aliceRuntime?.ownerUsername === 'alice' && aliceOwnRuntime?.ownerUsername === 'alice', 'runtime owner username scope');
    const routes: Array<[string, string, unknown?]> = [['GET', ''], ['POST', '/start'], ['POST', '/stop'], ['POST', '/restart'], ['POST', '/auto/start', {}], ['POST', '/auto/stop'], ['GET', '/khu'], ['POST', '/khu', { khu: 1 }], ['POST', '/move-to', { x: 1, y: 1 }], ['POST', '/move-to/cancel', { operationId: 'x' }], ['GET', '/reachable-maps'], ['GET', '/daily'], ['POST', '/daily/checkin', {}], ['POST', '/daily/seed', { taskId: 'duoc_moc' }], ['POST', '/daily/cancel', { operationId: 'x' }], ['GET', '/logs'], ['PUT', '/password', { password: 'abcdef' }], ['DELETE', ''], ['POST', '/quest-probe', { act: 'status' }], ['GET', '/khu-probe'], ['POST', '/khu-probe', { action: 'xem' }]];
    let leaks = 0;
    for (const [mth, suf, body] of routes) {
      const x = await j(`/api/accounts/${idB}${suf}`, mth, body, tokAl);
      if (x.s !== 404 && !(suf.includes('probe') && x.s === 403)) { leaks++; failures.push(`LEAK ${mth} ${suf} ${x.s}`); }
    }
    check(leaks === 0, 'cross-account leaks=' + leaks);
    check((await j(`/api/accounts/${idA}/quest-probe`, 'POST', { act: 'status' }, tokAl)).s === 403, 'probe admin only for own account');
    check((await j(`/api/accounts/${idA}`, 'GET', null, tokAl)).s === 200, 'own account readable');
    check((await j('/api/logs', 'GET', null, tokAl)).s === 200, 'logs ok');
    const st = await j('/api/system/status', 'GET', null, tokAl);
    check(st.s === 200 && JSON.stringify(st.b).indexOf('heap') < 0 && JSON.stringify(st.b).indexOf('rss') < 0, 'status no sys detail: ' + JSON.stringify(st.b).slice(0, 160));
    // 8. WS
    const wsMsgs = (tok: string) => new Promise<{ err?: boolean; code?: number; got: any[] }>((res) => {
      const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, ['bearer', tok], { origin: 'http://localhost:4000' });
      const got: any[] = []; w.on('message', (d) => got.push(JSON.parse(d.toString())));
      w.on('error', () => res({ err: true, got })); w.on('unexpected-response', (_q: unknown, rs: { statusCode?: number }) => res({ code: rs.statusCode, got }));
      setTimeout(() => { w.close(); res({ got }); }, 1500);
    });
    const wa = await wsMsgs(tokAl);
    const snap = wa.got.find((g) => g.type === 'initial_state');
    check(snap && snap.data.accounts.every((a: any) => a.id === idA) && snap.data.accounts.length === 1, 'ws alice only own: ' + JSON.stringify(snap && snap.data.accounts.map((a: any) => a.id)));
    const wn = await wsMsgs('bogus'); check(wn.code === 401 || wn.err, 'ws bad token rejected ' + wn.code);
    const wadm = await wsMsgs(tokA); const sn2 = wadm.got.find((g) => g.type === 'initial_state'); check(sn2 && sn2.data.accounts.length === 2, 'ws admin sees 2');
    // 9. đổi mật khẩu thu hồi phiên khác
    const tokA2 = (await j('/api/auth/login', 'POST', { username: 'alice', password: 'alice1' })).b.token;
    r = await j('/api/auth/password', 'POST', { currentPassword: 'alice1', newPassword: 'alice2' }, tokAl);
    check(r.s === 200, 'change pw ' + r.s);
    check((await j('/api/auth/me', 'GET', null, tokAl)).s === 200, 'current session kept');
    check((await j('/api/auth/me', 'GET', null, tokA2)).s === 401, 'other session revoked');
    check((await j('/api/auth/login', 'POST', { username: 'alice', password: 'alice1' })).s === 401, 'old pw rejected');
    // 10. khóa user -> phiên mất
    r = await j(`/api/admin/users/${bob.id}`, 'PATCH', { status: 'disabled' }, tokA);
    check(r.s === 200, 'disable bob ' + r.s);
    check((await j('/api/auth/me', 'GET', null, tokBo)).s === 401, 'disabled bob session rejected');
    const audit = await j('/api/admin/audit?limit=1', 'GET', null, tokA);
    check(audit.s === 200 && Array.isArray(audit.b.data) && Object.prototype.hasOwnProperty.call(audit.b, 'nextBefore'), 'admin audit page');
    check((await j('/api/admin/audit?limit=0', 'GET', null, tokA)).s === 400, 'audit limit lower bound');
    check((await j('/api/admin/audit', 'GET', null, tokAl)).s === 403, 'user audit 403');
    check((await j('/api/admin/audit', 'GET')).s === 401, 'no token audit 401');
    // 11. rate limit
    let last = 0; for (let i = 0; i < 7; i++) { last = (await j('/api/auth/login', 'POST', { username: 'carol', password: 'badpass' + i })).s; }
    check(last === 429, 'rate limit 429 got ' + last);
    // 12. xoá user cuối admin / chính mình
    const me = (await j('/api/auth/me', 'GET', null, tokA)).b; const adminId = (me.user || me).id;
    const revokeSelf = await j(`/api/admin/users/${adminId}/revoke-sessions`, 'POST', {}, tokA);
    check(revokeSelf.s === 200 && revokeSelf.b.data?.preservedCurrent === true && (await j('/api/auth/me', 'GET', null, tokA)).s === 200, 'self revoke keeps current session');
    check((await j(`/api/admin/users/${adminId}`, 'DELETE', null, tokA)).s === 409, 'cannot delete self');
    // 13. xoá alice -> tài khoản biến mất
    r = await j(`/api/admin/users/${alice.id}`, 'DELETE', null, tokA);
    check(r.s === 200 || r.s === 204, 'delete alice ' + r.s);
    check(!(await list(tokA)).includes(idA), 'alice account removed');
    const deletedAudit = await j('/api/admin/audit?limit=200', 'GET', null, tokA);
    const deletedRow = deletedAudit.b?.data?.find((item: any) => item.action === 'user_deleted' && item.targetId === alice.id);
    check(deletedRow && deletedRow.targetName === undefined, 'deleted user audit has id only');
    check(!log.includes('admin123') && !log.includes('alice1'), 'no passwords in server log');
    assert.deepEqual(failures, []);
  } finally {
    srv.kill();
    await sleep(300);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* Windows có thể còn giữ file WAL */ }
  }
});
