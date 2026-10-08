import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'vendor/tutien2d-public-client/2026-10-06/src');
const vendorPrefix = 'vendor/tutien2d-public-client/2026-10-06/src/';
const tileSize = 32;

// These are the shared-world entries in apps/server/src/config/map-catalog.ts.
// Keep the list explicit so a new catalog map cannot be silently omitted from
// the generated artifact.
const targetMapIds = [
  'mieu_hoang', 'tan_vien', 'thanh_truc_lam', 'duoc_vien', 'vuon_ca_nhan',
  'long_uyen', 'hang_dong_co', 'bai_da_hang_gio', 'dong_mach_ngam',
  'mo_linh_thach', 'thach_phong_thung_lung', 'bat_quai_thach_phan',
  'thien_dao_khuyet', 'u_uynh_vuc', 'hac_phong_linh', 'hac_thi',
];

const sourceByMap = {
  mieu_hoang: ['world/mapdata.js'],
  tan_vien: ['world/mapdata.js'],
  thanh_truc_lam: ['world/mapdata.js'],
  duoc_vien: ['world/mapdata.js'],
  vuon_ca_nhan: ['world/mapdata.js'],
  long_uyen: ['world/mapdata.js', 'world/map_long_uyen.js'],
  hang_dong_co: ['world/mapdata.js'],
  bai_da_hang_gio: ['world/mapdata.js'],
  dong_mach_ngam: ['world/mapdata.js', 'world/map_mieu_truong_con.js'],
  mo_linh_thach: ['world/mapdata.js', 'world/map_tru_tran_mach.js'],
  thach_phong_thung_lung: ['world/mapdata.js', 'world/map_thung_lung_v2.js'],
  bat_quai_thach_phan: ['world/mapdata.js', 'world/map_tamgioi.js', 'world/map_daitan.js'],
  thien_dao_khuyet: ['world/mapdata.js', 'world/map_tamgioi.js'],
  u_uynh_vuc: ['world/mapdata.js', 'world/map_tamgioi.js'],
  hac_phong_linh: ['world/map_hac_thi.js'],
  hac_thi: ['world/map_hac_thi.js'],
};

const worldLoadOrder = [
  'world/mapdata.js',
  'world/map_tamgioi.js',
  'world/map_three_maps.js',
  'world/map_thung_lung_v2.js',
  'world/map_daitan.js',
  'world/map_dau_truong.js',
  'world/map_dai_long_uyen.js',
  'world/map_phong_cho.js',
  'world/map_long_uyen.js',
  'world/map_mieu_truong_con.js',
  'world/map_hac_thi.js',
  'world/map_lam_lang.js',
  'world/map_hu_thien.js',
  'world/map_yen_lang.js',
  'world/map_tru_tran_mach.js',
  'world/map_khu.js',
];

function makeCanvas() {
  return { style: {}, getContext: () => ({}) };
}

function loadVendor(sourceFiles) {
  const objectDefs = new Proxy({}, { get: () => ({}) });
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {
      PNTT: {
        Utils: {},
        Pixel: {},
        ObjectArt: { defs: objectDefs },
        // TileMap.load conditionally includes quest/realm props in collision.
        // Use the visible profile so static grids stay conservative and match
        // the checked-in six-map legacy grids. The dynamic hide state remains
        // documented as unverified for a static farm grid.
        Quest: { isSeedMaterialVisible: () => true },
        Progress: { isHarvested: () => false },
      },
      location: { hostname: '', search: '' },
    },
    document: {
      hidden: false,
      addEventListener() {},
      createElement: makeCanvas,
    },
  };
  context.window.PNTT.realmIndexById = () => 999;
  vm.createContext(context);
  for (const [file, code] of Object.entries(sourceFiles)) {
    vm.runInContext(code, context, { filename: file });
  }
  return context.window.PNTT;
}

const sourceFiles = {
  'core/config.js': await readFile(resolve(vendor, 'core/config.js'), 'utf8'),
  'core/utils.js': await readFile(resolve(vendor, 'core/utils.js'), 'utf8'),
  'entities/enemy.js': await readFile(resolve(vendor, 'entities/enemy.js'), 'utf8'),
  'systems/hac_thi.js': await readFile(resolve(vendor, 'systems/hac_thi.js'), 'utf8'),
  'systems/hu_thien.js': await readFile(resolve(vendor, 'systems/hu_thien.js'), 'utf8'),
  'systems/lam_lang.js': await readFile(resolve(vendor, 'systems/lam_lang.js'), 'utf8'),
  'systems/tran_mach.js': await readFile(resolve(vendor, 'systems/tran_mach.js'), 'utf8'),
  'world/mapdata.js': await readFile(resolve(vendor, 'world/mapdata.js'), 'utf8'),
  ...Object.fromEntries(await Promise.all(worldLoadOrder.slice(1).map(async (file) => [
    file,
    await readFile(resolve(vendor, file), 'utf8'),
  ]))),
  'world/tilemap.js': await readFile(resolve(vendor, 'world/tilemap.js'), 'utf8'),
};
const pntt = loadVendor(sourceFiles);
const maps = pntt.MapData;
const tileMap = pntt.TileMap;
const defs = pntt.ENEMY_DEFS;

if (!maps || !tileMap || !defs) throw new Error('Vendor VM did not expose MapData, TileMap, and ENEMY_DEFS');
if (pntt.CONFIG?.TILE !== tileSize) throw new Error(`Unexpected vendor tile size: ${pntt.CONFIG?.TILE}`);

// Avoid date-dependent linh-chi prop placement changing a generated file.
if (typeof maps.vnDay === 'function') maps.vnDay = () => 'static-generator-day';

function encodeBlockedRows(map) {
  const rows = [];
  for (let ty = 0; ty < map.height; ty += 1) {
    const ranges = [];
    let start = null;
    for (let tx = 0; tx <= map.width; tx += 1) {
      const blocked = tx < map.width && tileMap.blocked[ty * map.width + tx] === 1;
      if (blocked && start === null) start = tx;
      if (!blocked && start !== null) {
        ranges.push(start === tx - 1 ? String(start) : `${start}-${tx - 1}`);
        start = null;
      }
    }
    rows.push(ranges.join(','));
  }
  return rows;
}

function mapById(mapId) {
  return Object.values(maps).find((entry) => entry && entry.id === mapId);
}

function spawnPoint(spawn, map) {
  const x = Number(spawn.x);
  const y = Number(spawn.y);
  const tx = Math.floor(x / tileSize);
  const ty = Math.floor(y / tileSize) - 1;
  const index = ty * map.width + tx;
  return {
    id: String(spawn.id),
    tx,
    ty,
    x,
    y,
    walkable: tileMap.blocked[index] !== 1,
  };
}

const generatedGrids = {};
const spawnRows = [];
const blockedSpawns = [];
const mapSummaries = [];

for (const mapId of targetMapIds) {
  const map = mapById(mapId);
  if (!map) throw new Error(`Catalog map has no vendor MapData entry: ${mapId}`);
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width <= 0 || map.height <= 0) {
    throw new Error(`Invalid dimensions for ${mapId}: ${map.width}x${map.height}`);
  }
  if (!Array.isArray(map.ground) || map.ground.length !== map.height
    || map.ground.some((row) => typeof row !== 'string' || row.length !== map.width)) {
    throw new Error(`Invalid ground dimensions for ${mapId}`);
  }

  tileMap.load(map);
  const blockedRows = encodeBlockedRows(map);
  if (blockedRows.length !== map.height) throw new Error(`Invalid blocked row count for ${mapId}`);
  generatedGrids[mapId] = {
    mapId,
    source: (sourceByMap[mapId] ?? []).map((file) => vendorPrefix + file),
    tileSize,
    width: map.width,
    height: map.height,
    blockedRows,
  };

  const byType = new Map();
  for (const spawn of tileMap.enemySpawns ?? []) {
    if (!defs[spawn.type]) throw new Error(`Map ${mapId} references unknown ENEMY_DEFS type: ${spawn.type}`);
    const point = spawnPoint(spawn, map);
    const def = defs[spawn.type];
    const row = byType.get(spawn.type) ?? {
      mapId,
      enemyType: spawn.type,
      count: 0,
      wanderRadius: Number.isFinite(def.wanderRadius) ? def.wanderRadius : null,
      leashRange: Number.isFinite(def.leashRange)
        ? def.leashRange
        : (Number.isFinite(pntt.CONFIG?.ENEMY?.LEASH_RANGE) ? pntt.CONFIG.ENEMY.LEASH_RANGE : null),
      respawnSec: Number.isFinite(def.respawnSec)
        ? def.respawnSec
        : (Number.isFinite(pntt.CONFIG?.ENEMY?.RESPAWN_SEC) ? pntt.CONFIG.ENEMY.RESPAWN_SEC : null),
      spawns: [],
    };
    row.count += 1;
    row.spawns.push(point);
    byType.set(spawn.type, row);
    if (!point.walkable) blockedSpawns.push({ mapId, enemyType: spawn.type, tx: point.tx, ty: point.ty, id: point.id });
  }
  spawnRows.push(...byType.values());
  mapSummaries.push({ mapId, width: map.width, height: map.height, spawnCount: tileMap.enemySpawns?.length ?? 0 });
}

const outputGrid = `// Generated from ${vendorPrefix}core/config.js, world/mapdata.js, world/map_*.js, and world/tilemap.js.
// Regenerate with: node scripts/gen-walk-grids.mjs
// blockedRows use inclusive x ranges per y row. Out-of-bounds is blocked by TileMap.isBlockedTile.
// rectFlyBlocked/flyBlocked is intentionally not included: this artifact is for walking.
export const WALK_TILE_SIZE = ${tileSize} as const;
export interface GeneratedWalkGrid {
  readonly mapId: string;
  readonly source: readonly string[];
  readonly tileSize: number;
  readonly width: number;
  readonly height: number;
  readonly blockedRows: readonly string[];
}
export const WALK_GRIDS = ${JSON.stringify(generatedGrids, null, 2)} as const satisfies Readonly<Record<string, GeneratedWalkGrid>>;
`;

const outputSpawns = `// Generated from ${vendorPrefix}entities/enemy.js, world/mapdata.js, world/map_*.js, and world/tilemap.js.
// Regenerate with: node scripts/gen-walk-grids.mjs
// Static aggregate of TileMap.enemySpawns after vendor load, including client-generated extras.
export interface MapSpawnPoint {
  readonly id: string;
  readonly tx: number;
  readonly ty: number;
  readonly x: number;
  readonly y: number;
  readonly walkable: boolean;
}
export interface MapSpawnRow {
  readonly mapId: string;
  readonly enemyType: string;
  readonly count: number;
  readonly wanderRadius: number | null;
  readonly leashRange: number | null;
  readonly respawnSec: number | null;
  readonly spawns: readonly MapSpawnPoint[];
}
export const MAP_SPAWN_MAP_IDS = ${JSON.stringify(targetMapIds, null, 2)} as const;
export const MAP_SPAWNS = ${JSON.stringify(spawnRows, null, 2)} as const satisfies readonly MapSpawnRow[];
`;

const gridDestination = resolve(root, 'packages/core-client/src/state/walk-grids.generated.ts');
const spawnDestination = resolve(root, 'packages/core-client/src/state/map-spawns.generated.ts');
await writeFile(gridDestination, outputGrid, 'utf8');
await writeFile(spawnDestination, outputSpawns, 'utf8');

console.log(`Generated ${gridDestination} (${targetMapIds.length} maps)`);
console.log(`Generated ${spawnDestination} (${spawnRows.length} map/type rows)`);
console.log(`Spawn points: ${spawnRows.reduce((sum, row) => sum + row.count, 0)}`);
console.log(`Blocked spawn points: ${blockedSpawns.length}`);
if (blockedSpawns.length) console.log(JSON.stringify(blockedSpawns));
console.log(`Maps: ${JSON.stringify(mapSummaries)}`);
