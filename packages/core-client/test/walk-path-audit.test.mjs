import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const repoRoot = fileURLToPath(root);
const vendorRoot = resolve(repoRoot, 'vendor/tutien2d-public-client/2026-10-06/src');
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
const loadSourceModule = async (relativePath, replacements = []) => {
  let source = stripTypeScriptTypes(await readFile(new URL(relativePath, root), 'utf8'));
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  return import(dataModule(source));
};

const generatedGridSource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/walk-grids.generated.ts', root), 'utf8'));
const generatedGridUrl = dataModule(generatedGridSource);
const generatedSpawnsSource = stripTypeScriptTypes(await readFile(new URL('packages/core-client/src/state/map-spawns.generated.ts', root), 'utf8'));
const generatedSpawns = await import(dataModule(generatedSpawnsSource));
const generatedGrids = await import(generatedGridUrl);
const gridSource = stripTypeScriptTypes(await readFile(new URL('apps/server/src/config/walk-grid.ts', root), 'utf8'))
  .replaceAll('@tutien2d/core-client', generatedGridUrl);
const gridUrl = dataModule(gridSource);
const walkPath = await loadSourceModule('apps/server/src/orchestrator/walk-path.ts', [["'../config/walk-grid.js'", `'${gridUrl}'`]]);

function makeCanvas() {
  return { style: {}, getContext: () => ({}) };
}

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

const vendorSourceFiles = {
  'core/config.js': await readFile(resolve(vendorRoot, 'core/config.js'), 'utf8'),
  'core/utils.js': await readFile(resolve(vendorRoot, 'core/utils.js'), 'utf8'),
  'entities/enemy.js': await readFile(resolve(vendorRoot, 'entities/enemy.js'), 'utf8'),
  'systems/hac_thi.js': await readFile(resolve(vendorRoot, 'systems/hac_thi.js'), 'utf8'),
  'systems/hu_thien.js': await readFile(resolve(vendorRoot, 'systems/hu_thien.js'), 'utf8'),
  'systems/lam_lang.js': await readFile(resolve(vendorRoot, 'systems/lam_lang.js'), 'utf8'),
  'systems/tran_mach.js': await readFile(resolve(vendorRoot, 'systems/tran_mach.js'), 'utf8'),
  ...Object.fromEntries(await Promise.all(worldLoadOrder.map(async (file) => [
    file,
    await readFile(resolve(vendorRoot, file), 'utf8'),
  ]))),
  'world/tilemap.js': await readFile(resolve(vendorRoot, 'world/tilemap.js'), 'utf8'),
  'world/pathfinding.js': await readFile(resolve(vendorRoot, 'world/pathfinding.js'), 'utf8'),
};

const context = {
  console: { log() {}, warn() {}, error() {} },
  window: {
    PNTT: {
      Utils: {},
      Pixel: {},
      ObjectArt: { defs: new Proxy({}, { get: () => ({}) }) },
      Quest: { isSeedMaterialVisible: () => true },
      Progress: { isHarvested: () => false },
    },
    location: { hostname: '', search: '' },
  },
  document: { hidden: false, addEventListener() {}, createElement: makeCanvas },
};
context.window.PNTT.realmIndexById = () => 999;
vm.createContext(context);
for (const [file, source] of Object.entries(vendorSourceFiles)) vm.runInContext(source, context, { filename: file });
const vendor = context.window.PNTT;
assert.ok(vendor.MapData && vendor.TileMap && vendor.Pathfinder, 'vendor VM must expose map, tilemap, and pathfinder');
if (typeof vendor.MapData.vnDay === 'function') vendor.MapData.vnDay = () => 'static-audit-day';

function isBlocked(grid, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.blockedRows[ty].split(',').filter(Boolean).some((range) => {
    const [startText, endText = startText] = range.split('-');
    return tx >= Number(startText) && tx <= Number(endText);
  });
}

function center(tx, ty) {
  return { x: tx * 32 + 16, y: ty * 32 + 16 };
}

function pathLength(from, path) {
  let previous = from;
  let length = 0;
  for (const point of path) {
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function segmentsClear(path, from, lineClear) {
  let previous = from;
  for (const point of path) {
    if (!lineClear(previous, point)) return false;
    previous = point;
  }
  return true;
}

const mapsWithSpawns = [...new Set(generatedSpawns.MAP_SPAWNS.filter((row) => row.count > 0).map((row) => row.mapId))];
const reports = [];
for (const mapId of mapsWithSpawns) {
  const grid = generatedGrids.WALK_GRIDS[mapId];
  const map = Object.values(vendor.MapData).find((entry) => entry && entry.id === mapId);
  assert.ok(map, `vendor map ${mapId} must exist`);
  vendor.TileMap.load(map);

  const walkablePoints = [];
  const blockedPoints = [];
  for (let ty = 0; ty < grid.height; ty += 1) {
    for (let tx = 0; tx < grid.width; tx += 1) {
      (isBlocked(grid, tx, ty) ? blockedPoints : walkablePoints).push(center(tx, ty));
    }
  }
  assert.ok(walkablePoints.length > 0, `${mapId} must have a walkable tile`);
  assert.ok(blockedPoints.length > 0, `${mapId} must have a blocked tile for the unreachable query`);

  const spawnPoints = generatedSpawns.MAP_SPAWNS.filter((row) => row.mapId === mapId)
    .flatMap((row) => row.spawns.filter((spawn) => spawn.walkable).map((spawn) => center(spawn.tx, spawn.ty)));
  const portalPoints = (map.portals ?? []).flatMap((portal) => {
    if (!Number.isInteger(portal.tx) || !Number.isInteger(portal.ty)) return [];
    return [center(portal.tx, portal.ty)];
  });
  const candidates = [...spawnPoints, ...portalPoints, ...walkablePoints];
  const queries = [];
  for (let index = 0; index < 20; index += 1) {
    if (index === 0) {
      queries.push({ from: blockedPoints[0], to: candidates[1] ?? candidates[0], kind: 'blocked-start' });
    } else if (index === 1) {
      queries.push({ from: candidates[index % candidates.length], to: blockedPoints[0], kind: 'blocked-target' });
    } else if (index === 2) {
      queries.push({ from: candidates[index % candidates.length], to: { x: grid.width * 32 + 128, y: grid.height * 32 + 128 }, kind: 'out-of-bounds-target' });
    } else {
      queries.push({
        from: candidates[(index * 17 + 3) % candidates.length],
        to: candidates[(index * 11 + 7) % candidates.length],
        kind: 'normal',
      });
    }
  }

  let presenceMismatch = 0;
  let lengthMismatch = 0;
  let maxLengthDelta = 0;
  let projectSafetyViolations = 0;
  let vendorSafetyViolations = 0;
  let unreachable = 0;
  for (const query of queries) {
    const targetTile = { tx: Math.floor(query.to.x / 32), ty: Math.floor(query.to.y / 32) };
    const vendorPathResult = vendor.Pathfinder.route(vendor.TileMap, query.from.x, query.from.y, query.to.x, query.to.y, 8, 12);
    const projectPathResult = walkPath.findWalkPath(mapId, query.from, targetTile);
    const vendorHasPath = vendorPathResult.length > 0;
    const sameProjectTile = Math.floor(query.from.x / 32) === targetTile.tx
      && Math.floor(query.from.y / 32) === targetTile.ty;
    const projectHasPath = projectPathResult !== null && (projectPathResult.length > 0 || sameProjectTile);
    if (!vendorHasPath || !projectHasPath) unreachable += 1;
    if (vendorHasPath !== projectHasPath) presenceMismatch += 1;
    if (vendorHasPath && projectHasPath) {
      const delta = Math.abs(pathLength(query.from, vendorPathResult) - pathLength(query.from, projectPathResult));
      maxLengthDelta = Math.max(maxLengthDelta, delta);
      if (delta > 32) lengthMismatch += 1;
    }
    if (!segmentsClear(projectPathResult ?? [], query.from, (from, to) => walkPath.isWalkSegmentClear(mapId, from, to))) projectSafetyViolations += 1;
    if (!segmentsClear(vendorPathResult, query.from, (from, to) => vendor.TileMap.lineClear(from.x, from.y, to.x, to.y, 8, 12))) vendorSafetyViolations += 1;
  }
  assert.ok(unreachable > 0, `${mapId} audit must include an unreachable/invalid pair`);
  assert.equal(projectSafetyViolations, 0, `${mapId} project path must not cross a blocked rectangle`);
  assert.equal(vendorSafetyViolations, 0, `${mapId} vendor path must not cross a blocked rectangle`);
  reports.push({ mapId, queries: queries.length, unreachable, presenceMismatch, lengthMismatch, maxLengthDelta: Math.round(maxLengthDelta) });
}

assert.equal(reports.length, mapsWithSpawns.length);
console.log(`walk-path audit passed (${reports.length} maps, ${reports.reduce((sum, report) => sum + report.queries, 0)} queries; no rectangle-safety violations)`);
for (const report of reports) console.log(JSON.stringify(report));
