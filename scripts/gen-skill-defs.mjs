import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'vendor/tutien2d-public-client/2026-10-06/src');

function loadVendor(sourceFiles) {
  const context = {
    console,
    window: {
      PNTT: { Utils: { store: { get: () => null, set: () => {} } } },
      location: { hostname: '', search: '' },
    },
    document: {
      hidden: false,
      addEventListener() {},
      createElement: () => ({ getContext: () => ({}) }),
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
  'systems/items.js': await readFile(resolve(vendor, 'systems/items.js'), 'utf8'),
  'systems/skills.js': await readFile(resolve(vendor, 'systems/skills.js'), 'utf8'),
};
const pntt = loadVendor(sourceFiles);
const skills = pntt.Skills;
const items = pntt.ITEMS;
if (!skills?.DEFS || !Array.isArray(skills.SLOTS) || !skills.THUNDER_DEF) {
  throw new Error('Vendor did not expose the expected Skills tables');
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const numberOrNull = (value) => finite(value) ? value : null;
const copy = (value) => value === undefined ? null : value;
const active = {};
for (const [id, def] of Object.entries(skills.DEFS)) {
  active[id] = {
    id,
    short: String(def.short ?? ''),
    name: String(def.name ?? ''),
    book: String(def.book ?? ''),
    legacyBook: copy(def.legacyBook),
    shape: copy(def.shape),
    cooldown: numberOrNull(def.cooldown),
    cast: numberOrNull(def.cast),
    mp: numberOrNull(def.mp),
    sp: numberOrNull(def.sp),
    range: numberOrNull(def.range),
    coef: numberOrNull(def.coef),
    blastR: numberOrNull(def.blastR),
    shots: numberOrNull(def.shots),
    allowedWeapons: Array.isArray(def.allowedWeapons) ? [...def.allowedWeapons] : null,
    autoFoe: Boolean(def.autoFoe),
    playerTargetOnly: Boolean(def.playerTargetOnly),
    bienHinh: def.bienHinh ?? null,
    instantOnPress: Boolean(def.instantOnPress),
    thunder: false,
    effect: def.effect ?? null,
    boostWeapon: copy(def.boostWeapon),
    kieuRoi: copy(def.kieuRoi),
    requireRealm: copy(def.requireRealm),
    dao: copy(def.dao),
    medium: Boolean(def.medium),
  };
}

const thunder = {
  id: skills.THUNDER_DEF.id,
  short: skills.THUNDER_DEF.short,
  name: skills.THUNDER_DEF.name,
  book: skills.THUNDER_BOOK,
  legacyBook: null,
  shape: null,
  cooldown: pntt.CONFIG.THUNDER.COOLDOWN,
  cast: pntt.CONFIG.THUNDER.CAST,
  mp: pntt.CONFIG.THUNDER.MP_COST,
  sp: pntt.CONFIG.THUNDER.SP_COST,
  range: pntt.CONFIG.THUNDER.RANGE,
  coef: pntt.CONFIG.THUNDER.COEF,
  blastR: pntt.CONFIG.THUNDER.RADIUS,
  shots: 1,
  allowedWeapons: null,
  autoFoe: false,
  playerTargetOnly: false,
  bienHinh: null,
  instantOnPress: false,
  thunder: true,
  effect: null,
  boostWeapon: null,
  kieuRoi: null,
  requireRealm: null,
  dao: null,
  medium: false,
};

const books = [thunder, ...Object.values(active)].map((def) => def.book);
const autoConstants = {
  target: {
    range: pntt.CONFIG.TARGET.RANGE,
    reachPad: pntt.CONFIG.TARGET.REACH_PAD,
    keepPad: pntt.CONFIG.TARGET.KEEP_PAD,
  },
  player: {
    reach: pntt.CONFIG.PLAYER.REACH,
    spellGap: pntt.CONFIG.PLAYER.SPELL_GAP,
  },
  thunder: {
    range: pntt.CONFIG.THUNDER.RANGE,
  },
};
for (const book of books) {
  if (!items[book]) throw new Error(`Skill book missing from vendor ITEMS: ${book}`);
}
if (Object.keys(active).length !== 27 || skills.SLOTS.length !== 28) {
  throw new Error(`Unexpected skill table size: DEFS=${Object.keys(active).length}, SLOTS=${skills.SLOTS.length}`);
}
if (active.hoa_cau.cooldown !== 6 || active.xich_chan.playerTargetOnly !== true || thunder.coef !== 5.45) {
  throw new Error('Skill source cross-check failed');
}

const output = `// Generated from vendor/tutien2d-public-client/2026-10-06/src/core/config.js, systems/items.js, and systems/skills.js.
// Regenerate with: node scripts/gen-skill-defs.mjs
// allowedWeapons is null for every current DEFS entry; boostWeapon/kieuRoi are separate vendor fields.
export const SKILL_DEFS = ${JSON.stringify(active, null, 2)} as const;
export const THUNDER_DEF = ${JSON.stringify(thunder, null, 2)} as const;
export const SKILL_SLOT_IDS = ${JSON.stringify(skills.SLOTS, null, 2)} as const;
export const SKILL_BOOK_IDS = ${JSON.stringify(books, null, 2)} as const;
export const AUTO_CONSTANTS = ${JSON.stringify(autoConstants, null, 2)} as const;
`;
const destination = resolve(root, 'packages/core-client/src/state/skill-defs.generated.ts');
await writeFile(destination, output, 'utf8');
console.log(`Generated ${destination} (${Object.keys(active).length} DEFS, ${skills.SLOTS.length} slots)`);
console.log('Cross-checked hoa_cau, xich_chan, loi_chuong against VM-loaded vendor definitions');
