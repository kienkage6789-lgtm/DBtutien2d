import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];
const IMPORT_PATTERNS = [
  /\b(?:from|import)\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']/g,
];

function listDirectories(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function walkFiles(directory) {
  const result = [];
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(fullPath));
    else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) result.push(fullPath);
  }
  return result;
}

function exactPathLookup(candidate, comparisonRoot) {
  const absolute = path.resolve(candidate);
  const root = path.resolve(comparisonRoot || path.dirname(absolute));
  const relative = path.relative(root, absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return { status: 'missing' };
  let current = root;
  const segments = relative.split(path.sep).filter(Boolean);
  for (const segment of segments) {
    let entries;
    try { entries = fs.readdirSync(current); } catch { return { status: 'missing' }; }
    const exact = entries.find((entry) => entry === segment);
    if (exact) {
      current = path.join(current, exact);
      continue;
    }
    const insensitive = entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
    if (insensitive) return { status: 'case-mismatch', actual: path.join(current, insensitive) };
    return { status: 'missing' };
  }
  return { status: 'exact', actual: current };
}

function candidatePaths(sourceFile, specifier) {
  const raw = path.resolve(path.dirname(sourceFile), specifier);
  const extension = path.extname(raw);
  const candidates = [raw];
  if (extension === '.js') candidates.push(raw.slice(0, -3) + '.ts', raw.slice(0, -3) + '.tsx', raw.slice(0, -3) + '.mjs');
  if (!extension) candidates.push(...SOURCE_EXTENSIONS.map((suffix) => raw + suffix));
  candidates.push(...SOURCE_EXTENSIONS.map((suffix) => path.join(raw, `index${suffix}`)));
  return Array.from(new Set(candidates));
}

function resolveRelativeImport(sourceFile, specifier, comparisonRoot) {
  let mismatch;
  for (const candidate of candidatePaths(sourceFile, specifier)) {
    const result = exactPathLookup(candidate, comparisonRoot);
    if (result.status === 'exact') return result;
    if (result.status === 'case-mismatch') mismatch = result;
  }
  return mismatch ?? { status: 'missing' };
}

export function extractRelativeImports(source) {
  const imports = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1].startsWith('.')) imports.push(match[1]);
    }
  }
  return Array.from(new Set(imports));
}

export function scanRelativeImports(files, comparisonRoot = path.dirname(files[0] || process.cwd())) {
  const errors = [];
  for (const file of files) {
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const specifier of extractRelativeImports(source)) {
      const result = resolveRelativeImport(file, specifier, comparisonRoot);
      if (result.status === 'case-mismatch') {
        errors.push(`Sai hoa-thường: ${file} -> ${specifier} (thực tế: ${result.actual})`);
      } else if (result.status === 'missing') {
        errors.push(`Không tìm thấy import tương đối: ${file} -> ${specifier}`);
      }
    }
  }
  return errors;
}

export function scanPlatformWarnings(files) {
  const warnings = [];
  for (const file of files) {
    if (path.basename(file) === 'check-linux-compat.mjs') continue;
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (/(?<![A-Za-z])[A-Za-z]:\\/.test(source) || /(?<!\\)\\\\[A-Za-z0-9_$.-]+\\/.test(source)) {
      warnings.push(`Đường dẫn Windows cứng: ${file}`);
    }
    if (/process\.platform\s*===\s*["']win32["']/.test(source)) {
      warnings.push(`Nhánh process.platform win32: ${file}`);
    }
  }
  return warnings;
}

export function versionAtLeast24(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value).trim().replace(/^v/, ''));
  if (!match) return false;
  return Number(match[1]) >= 24;
}

export function packageRequiresNode24(packageJson) {
  const range = packageJson?.engines?.node;
  return typeof range === 'string' && /(?:^|\s|>=)24(?:\D|$)/.test(range) && !/<\s*24/.test(range);
}

export function scanRepository(rootDirectory = path.resolve(path.dirname(SCRIPT_PATH), '..')) {
  const appRoots = listDirectories(path.join(rootDirectory, 'apps'))
    .map((directory) => path.join(directory, 'src'));
  const packageRoots = listDirectories(path.join(rootDirectory, 'packages'))
    .map((directory) => path.join(directory, 'src'));
  const sourceRoots = [...appRoots, ...packageRoots, path.join(rootDirectory, 'scripts')]
    .filter((directory) => fs.existsSync(directory));
  const files = sourceRoots.flatMap((directory) => walkFiles(directory));
  const errors = scanRelativeImports(files, rootDirectory);
  const warnings = scanPlatformWarnings(files);
  const packageFiles = [path.join(rootDirectory, 'package.json'), ...listDirectories(path.join(rootDirectory, 'apps')).map((dir) => path.join(dir, 'package.json')), ...listDirectories(path.join(rootDirectory, 'packages')).map((dir) => path.join(dir, 'package.json'))]
    .filter((packageFile) => fs.existsSync(packageFile));
  for (const packageFile of packageFiles) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      if (!packageRequiresNode24(packageJson)) errors.push(`package.json thiếu engines.node >=24: ${packageFile}`);
    } catch {
      errors.push(`Không đọc được package.json: ${packageFile}`);
    }
  }
  const nvmrc = path.join(rootDirectory, '.nvmrc');
  if (!fs.existsSync(nvmrc) || !versionAtLeast24(fs.readFileSync(nvmrc, 'utf8'))) errors.push('Thiếu .nvmrc yêu cầu Node >=24.');
  return { errors, warnings, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  const result = scanRepository();
  console.log(`Linux compatibility: ${result.errors.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const warning of result.warnings) console.log(`WARN ${warning}`);
  for (const error of result.errors) console.error(`FAIL ${error}`);
  process.exitCode = result.errors.length > 0 ? 1 : 0;
}
