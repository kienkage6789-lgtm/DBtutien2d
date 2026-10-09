import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRelativeImports, versionAtLeast24, packageRequiresNode24 } from './check-linux-compat.mjs';

test('detects an import whose case only works on Windows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tutien-linux-compat-'));
  const actual = path.join(root, 'actual.ts');
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(actual, 'export const ok = true;');
  fs.writeFileSync(entry, 'import ' + "'./Actual.js';");
  assert.equal(scanRelativeImports([entry], root).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('accepts Node 24 metadata', () => {
  assert.equal(versionAtLeast24('v24.16.0'), true);
  assert.equal(versionAtLeast24('23.11.0'), false);
  assert.equal(packageRequiresNode24({ engines: { node: '>=24' } }), true);
  assert.equal(packageRequiresNode24({ engines: { node: '>=22' } }), false);
});
