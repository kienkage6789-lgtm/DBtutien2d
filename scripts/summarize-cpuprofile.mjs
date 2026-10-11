#!/usr/bin/env node
// Tóm tắt file .cpuprofile (node --cpu-prof): hàm/tệp tốn CPU nhất theo thời gian "self".
// Dùng: node scripts/summarize-cpuprofile.mjs <file.cpuprofile> [soDong=25]
// Chỉ in tên hàm, đường dẫn tệp (rút gọn) và số liệu; không in dữ liệu game, token hay mật khẩu.
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const limit = Math.max(1, Number(process.argv[3]) || 25);
if (!file) { console.error('Dùng: node scripts/summarize-cpuprofile.mjs <file.cpuprofile> [soDong]'); process.exit(2); }

const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const selfMicros = new Map();
const deltas = profile.timeDeltas ?? [];
const samples = profile.samples ?? [];
for (let index = 0; index < samples.length; index += 1) {
  const id = samples[index];
  selfMicros.set(id, (selfMicros.get(id) ?? 0) + (deltas[index] ?? 0));
}
const total = [...selfMicros.values()].reduce((sum, value) => sum + value, 0) || 1;

function shortUrl(url) {
  if (!url) return '(native)';
  const clean = url.replace(/^file:\/\//, '');
  const marker = clean.search(/(apps|packages|vendor|node_modules)[\\/]/);
  return marker >= 0 ? clean.slice(marker) : path.basename(clean);
}

const byFunction = new Map();
const byFile = new Map();
for (const [id, micros] of selfMicros) {
  const frame = nodes.get(id)?.callFrame;
  if (!frame) continue;
  const where = shortUrl(frame.url);
  const name = frame.functionName || '(anonymous)';
  const fnKey = `${name}  ${where}:${frame.lineNumber + 1}`;
  byFunction.set(fnKey, (byFunction.get(fnKey) ?? 0) + micros);
  byFile.set(where, (byFile.get(where) ?? 0) + micros);
}

const pct = (micros) => `${((micros / total) * 100).toFixed(1).padStart(5)}%`;
const ms = (micros) => `${(micros / 1000).toFixed(0).padStart(7)} ms`;
const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

console.log(`Tổng thời gian mẫu: ${(total / 1e6).toFixed(1)} s, ${samples.length} mẫu\n`);
console.log('== Theo tệp (self time) ==');
for (const [key, micros] of top(byFile)) console.log(`${pct(micros)} ${ms(micros)}  ${key}`);
console.log('\n== Theo hàm (self time) ==');
for (const [key, micros] of top(byFunction)) console.log(`${pct(micros)} ${ms(micros)}  ${key}`);
