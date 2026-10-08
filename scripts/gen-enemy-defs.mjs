import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'vendor/tutien2d-public-client/2026-10-06/src');

function makeCanvas() {
  return {
    style: {},
    getContext: () => ({}),
  };
}

function loadVendor(sourceFiles) {
  const context = {
    console,
    window: {
      PNTT: { Utils: {}, Pixel: {} },
      location: { hostname: '', search: '' },
    },
    document: {
      hidden: false,
      addEventListener() {},
      createElement: makeCanvas,
    },
  };
  vm.createContext(context);
  for (const [file, code] of Object.entries(sourceFiles)) {
    vm.runInContext(code, context, { filename: file });
  }
  return context.window.PNTT;
}

const sourceFiles = {
  'core/config.js': await readFile(resolve(vendor, 'core/config.js'), 'utf8'),
  'entities/enemy.js': await readFile(resolve(vendor, 'entities/enemy.js'), 'utf8'),
};
const pntt = loadVendor(sourceFiles);
const defs = pntt.ENEMY_DEFS;
const fallbackRespawnSec = pntt.CONFIG?.ENEMY?.RESPAWN_SEC;

if (!defs || typeof defs !== 'object') throw new Error('Vendor did not expose ENEMY_DEFS');
if (!Number.isFinite(fallbackRespawnSec)) throw new Error('Vendor did not expose CONFIG.ENEMY.RESPAWN_SEC');

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const numberOrNull = (value) => finite(value) ? value : null;
const boolean = (value) => value === true;
const spriteOf = (sprite) => sprite && finite(sprite.w) && finite(sprite.h)
  ? {
      w: sprite.w,
      h: sprite.h,
      ax: numberOrNull(sprite.ax),
      ay: numberOrNull(sprite.ay),
    }
  : null;

const generated = {};
for (const [id, def] of Object.entries(defs)) {
  if (!def || typeof def !== 'object' || typeof def.name !== 'string' || !finite(def.hp)) {
    throw new Error(`Invalid vendor enemy definition: ${id}`);
  }
  const isBoss = boolean(def.isBoss) || /Yêu Thú Cấp/.test(def.name);
  generated[id] = {
    id,
    type: id,
    name: def.name,
    level: numberOrNull(def.level),
    isBoss,
    isBossDeclared: boolean(def.isBoss),
    human: Boolean(def.human),
    tuSi: Boolean(def.tuSi),
    bodyRadius: numberOrNull(def.bodyRadius),
    hitRadius: numberOrNull(def.hitRadius) ?? (finite(pntt.CONFIG?.ENEMY?.HIT_RADIUS) ? pntt.CONFIG.ENEMY.HIT_RADIUS : 26),
    hpMax: def.hp,
    exp: numberOrNull(def.exp),
    respawnSec: numberOrNull(def.respawnSec) ?? fallbackRespawnSec,
    speed: numberOrNull(def.speed),
    aggro: numberOrNull(def.aggro),
    leashRange: numberOrNull(def.leashRange) ?? (finite(pntt.CONFIG?.ENEMY?.LEASH_RANGE) ? pntt.CONFIG.ENEMY.LEASH_RANGE : 260),
    wanderRadius: numberOrNull(def.wanderRadius),
    wanderPause: numberOrNull(def.wanderPause),
    contactDmg: numberOrNull(def.contactDmg),
    hitCooldown: numberOrNull(def.hitCooldown),
    drawScale: numberOrNull(def.drawScale) ?? 1,
    sprite: spriteOf(def.sprite),
    targetFlags: {
      khongNhan: boolean(def.khongNhan),
      yenLang: boolean(def.yenLang),
      khu1Only: boolean(def.khu1Only),
      tru: boolean(def.tru),
      truBan: boolean(def.truBan),
    },
  };
}

const crossChecks = [
  ['sau_truc', { name: 'Bọ Ngựa', hpMax: 5, exp: 3, isBoss: false, human: false }],
  ['linh_ho_tran_son', { name: 'Linh Hổ Trấn Sơn · Yêu Thú Cấp 4', hpMax: 200000, isBoss: true, human: false }],
  ['tieu_phu', { name: 'Tiều Phu', hpMax: 60, isBoss: false, human: true }],
];
for (const [id, expected] of crossChecks) {
  const actual = generated[id];
  for (const [field, value] of Object.entries(expected)) {
    if (!actual || actual[field] !== value) throw new Error(`Cross-check failed for ${id}.${field}`);
  }
}

const output = `// Generated from vendor/tutien2d-public-client/2026-10-06/src/core/config.js and entities/enemy.js.
// Regenerate with: node scripts/gen-enemy-defs.mjs
// The normalized values below preserve vendor defaults used by Enemy.create/update.
export const ENEMY_DEFS = ${JSON.stringify(generated, null, 2)} as const;
export type EnemyDefId = keyof typeof ENEMY_DEFS;
`;
const destination = resolve(root, 'packages/core-client/src/state/enemy-defs.generated.ts');
await writeFile(destination, output, 'utf8');
console.log(`Generated ${destination} (${Object.keys(generated).length} enemy definitions)`);
console.log('Cross-checked sau_truc, linh_ho_tran_son, tieu_phu against VM-loaded vendor definitions');
