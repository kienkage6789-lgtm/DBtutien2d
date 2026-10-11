#!/usr/bin/env node
// Đặt lại mật khẩu một người dùng (mặc định tài khoản admin) khi quên mật khẩu. Chạy TRÊN MÁY CHỦ.
//   1) pm2 stop tutien-server            (nên dừng server trước)
//   2) cd ~/DBtutien2d && node scripts/reset-admin-password.mjs [tenDangNhap]
//   3) pm2 start tutien-server           (khởi động lại cũng xóa khóa đăng nhập tạm thời trong bộ nhớ)
// Biến môi trường: DATA_DIR (mặc định apps/server/data, giống server khi chạy từ apps/server).
// Cần đã build: apps/server/dist (dùng đúng hàm băm mật khẩu của server).
// Script: sao lưu DB (VACUUM INTO) -> đặt mật khẩu mới + bắt đổi ở lần đăng nhập đầu -> xóa mọi phiên -> ghi audit.
// KHÔNG in mật khẩu/băm. Cờ: --enable (mở khóa tài khoản đang bị khóa).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const enable = args.includes('--enable');
const wantedName = (args.find((arg) => !arg.startsWith('--')) ?? 'admin').trim().toLowerCase();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(repoRoot, 'apps/server/data'));
const dbPath = path.join(dataDir, 'tutien_db.sqlite');

function fail(message) { console.error(`LỖI: ${message}`); process.exit(1); }

if (!fs.existsSync(dbPath)) fail(`Không thấy cơ sở dữ liệu ở ${dbPath}. Kiểm tra DATA_DIR.`);
const passwordModule = path.join(repoRoot, 'apps/server/dist/security/password.js');
if (!fs.existsSync(passwordModule)) fail('Chưa build server. Chạy: corepack pnpm build');
const { hashPassword } = await import(pathToFileURL(passwordModule).href);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdout = process.stdout;
    const originalWrite = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (text) => { if (text.includes(question)) originalWrite?.(text); else if (text === '\r\n' || text === '\n') stdout.write('\n'); };
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

let password = process.env.RESET_PASSWORD; // chỉ để chạy tự động/test; khuyến nghị dùng hỏi ẩn.
if (!password) {
  if (!process.stdin.isTTY) fail('Cần chạy trong terminal tương tác (hoặc đặt RESET_PASSWORD cho chạy tự động).');
  password = await askHidden('Mật khẩu mới (tối thiểu 6 ký tự): ');
  const again = await askHidden('Nhập lại mật khẩu mới: ');
  if (password !== again) fail('Hai lần nhập không khớp.');
}
if (typeof password !== 'string' || password.length < 6) fail('Mật khẩu tối thiểu 6 ký tự.');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
const user = db.prepare('SELECT id, username, role, status FROM users WHERE lower(username) = ?').get(wantedName);
if (!user) {
  const names = db.prepare('SELECT username FROM users ORDER BY created_at').all().map((row) => row.username);
  db.close();
  fail(`Không có người dùng "${wantedName}". Các tên hiện có: ${names.join(', ') || '(trống)'}`);
}

const backupDir = path.join(dataDir, 'backups');
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `pre-reset-${stamp}.sqlite`);
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
try { fs.chmodSync(backupPath, 0o600); } catch { /* Windows */ }

const now = Date.now();
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(password), user.id);
  if (enable) db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO audit_log (id, actor_id, action, target_type, target_id, detail, at) VALUES (?, NULL, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), 'password_reset_cli', 'user', user.id, `enable=${enable}`, now);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  fail(`Không ghi được: ${error instanceof Error ? error.message : String(error)}`);
}
db.close();

console.log(`Đã đặt lại mật khẩu cho "${user.username}" (vai trò ${user.role}). Mọi phiên đăng nhập cũ đã bị thu hồi.`);
console.log('Lần đăng nhập đầu sẽ bị yêu cầu đổi mật khẩu.');
if (user.status !== 'active' && !enable) console.log(`Chú ý: tài khoản đang ở trạng thái "${user.status}". Chạy lại với --enable để mở khóa.`);
console.log(`Bản sao lưu trước khi sửa: ${backupPath}`);
