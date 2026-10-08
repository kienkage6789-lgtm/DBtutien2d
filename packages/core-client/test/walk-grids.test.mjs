import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../../../', import.meta.url);
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
const loadGenerated = async (relativePath) => import(dataModule(stripTypeScriptTypes(
  await readFile(new URL(relativePath, root), 'utf8'),
)));

const grids = await loadGenerated('packages/core-client/src/state/walk-grids.generated.ts');
const spawns = await loadGenerated('packages/core-client/src/state/map-spawns.generated.ts');
const enemies = await loadGenerated('packages/core-client/src/state/enemy-defs.generated.ts');

const legacy = {
  tan_vien: ['0-39', '0-39', '0-31,33-39', '0-18,21-30,33-39', '0-4,8-18,20,25-27,29,34-39', '0-2,7,10-17,26-27,35-39', '0-2,11-12,15,25-26,35-39', '0-3,25-26,35-39', '0-5,9-11,15-17,19-21,25-27,34-39', '0-5,9-11,15-17,19-21,24-26,33-39', '0-5,7,9,24-26,29,32-39', '0-2,4-5,16,20,24-25,32-39', '5-6,11,18,24-25,33-39', '6-11,24-25,36-39', '0-1', '0-1', '0-3,5-7,24-25,33,37-39', '0-2,5-7,24-25,38-39', '0-2,8,15,23-25,33,38-39', '0-2,22-24,35,38-39', '0-6,21-24,39', '0-4,6,10,13,17-19,21-24,29,39', '0-4,12,16-23,32-33,35-36,39', '0-3,15-22,28,32-39', '0-2,14-22,28-31,33-39', '0-4,6,10,14-21,27-28,30,34-39', '0-6,10-11,14-21,33-39', '0-6,9-12,14-21,30-39', '0-6,9-24,30-39', '0-6,9-39'],
  thanh_truc_lam: ['0-1,3-6,9-12,15-34,36-39', '0-2,4-6,9,11-22,25-27,30-32,34-39', '0-3,5-6,11-17,19,21-22,26-34,36-37', '0-6,12-15,21-22,29-33,35-38', '0-6,12-16,21-22,28-38', '0-6,12,14,18,21-22,29-32,34-37,39', '0-4,12,21-22,29-32,34-39', '2-4,6,32,34-39', '0-1,3-7,31,34,36,39', '1-4,17,21-22,36,39', '0-4,17,20-23,26-27', '0-3,20-23,31,38-39', '0-1,16,19-25,27,30-31,37', '0-2,12,18-24', '0-2,10,17-25', '0-1,17-25,37-39', '0,18-28,35-38', '0,4,7,20-28,35-37', '0,6-7,20-27,35,37-39', '0,6-7,20-23,35-39', '0,6,10,20-23,31-32,35-36,38-39', '0,21-23,25,35-39', '0,7,21-23,26,36-37,39', '0-1,3-4,21-22,24-25,37-39', '1-3,33-34,37-39', '0,2,4,6,31-35,38-39', '0-1,3-6,8-10,18,20-23,25-28,32-33,35-39', '0-2,5-6,8,10,18-24,27,32-35,37-39', '0-4,6-10,15,17-19,21-29,32-39', '0-10,14,16,18-25,27-39'],
  duoc_vien: ['0-11,14-39', '0-11,14-39', '0-2,4-5,7,11,14-15,17-18,21-24,26,33-39', '0-11,14,17,27-28,33-34,36-39', '0-6,11,16,31,33-34,36-39', '0-6,11,19,33-34,37-39', '0-3,16,26,33-34,36-39', '0-3,20,33-34,36-39', '0-3,11,14-15,24,28,33-34,36-39', '0-3,11,19,33-34,36-39', '0-3,6-8,11,37-39', '0-3,6-9,11,33-35,37-39', '0-3,7-8,11,17,22,29,33-34,37-39', '0-11,28,32-33,36-39', '0-3,21,31-32,37-39', '0-3,6,30-31,37-39', '0-2,6,20-25,29-30,36-39', '0-3,7,16-30,33,36-39', '0-2,4,8,16-29,37-39', '0-3,10,15-30,33,36-39', '0-5,15-30,33-34,37-39', '0-2,8,12,15-30,37-39', '0-2,7-8,15-30,36-39', '0-2,16-29,37-39', '0-2,9,14,18-27,35-39', '0-3,5,13-14,20-25,30,34,37-39', '0-5,7,10,12,18,24-25,28-31,33-39', '0-39', '0-39', '0-39'],
  vuon_ca_nhan: ['0-17', '0-1,16-17', '0-2,16-17', '0-7,12-17', '0-2,13-14,16-17', '0-2,12-14,16-17', '0-2,16-17', '0-1,16-17', '0-1,16-17', '0-1,3,10,16-17', '0-1,16-17', '0-1,16-17', '0-7,10-17'],
  mieu_hoang: ['0-19', '0-1,18-19', '0,15,19', '0,3-10,19', '0,3,10,14,19', '0,3,19', '0,3,7,12', '0,3', '0,3,10,19', '0,3-10,19', '0,19', '0-1,8,16,18-19', '0-1,15,18-19', '0-19'],
  dong_mach_ngam: ['0-29', '0-29', '0,2-3,10-20,26-27,29', '0,3-4,10-20,25-26,29', '0,3-4,6,10-20,23,25-26,29', '0,3-4,10-20,25-26,29', '0,2-4,10-20,25-26,29', '0,3-4,10-20,25-27,29', '0,4,7,10-20,23,25,29', '0,4,9,21,25,29', '0,4,12,18,25,29', '0,4-5,9,21,24-25,29', '0,4-5,15,24-25,29', '0,3-7,22-26,29', '0,3-9,21-27,29', '0,3-7,22-26,29', '0,3-7,23-25,29', '0,6-7,13,17,23-24,29', '0,2,7-8,22-24,27,29', '0,8-13,17-22,29', '0,8-13,17-22,29', '0,3,17-18,27,29', '0,29', '0,2,27,29', '0,11,13,17,19,29', '0-13,17-29'],
};

function isBlocked(grid, tx, ty) {
  const encoded = grid.blockedRows[ty];
  return encoded.split(',').filter(Boolean).some((range) => {
    const [startText, endText = startText] = range.split('-');
    return tx >= Number(startText) && tx <= Number(endText);
  });
}

function diffCells(left, right) {
  const diffs = [];
  for (let ty = 0; ty < right.height; ty += 1) {
    for (let tx = 0; tx < right.width; tx += 1) {
      const leftBlocked = left[ty].split(',').filter(Boolean).some((range) => {
        const [startText, endText = startText] = range.split('-');
        return tx >= Number(startText) && tx <= Number(endText);
      });
      const rightBlocked = isBlocked(right, tx, ty);
      if (leftBlocked !== rightBlocked) diffs.push({ ty, tx, legacyBlocked: leftBlocked, generatedBlocked: rightBlocked });
    }
  }
  return diffs;
}

assert.equal(Object.keys(grids.WALK_GRIDS).length, 16);
assert.deepEqual([...spawns.MAP_SPAWN_MAP_IDS], Object.keys(grids.WALK_GRIDS));
for (const [mapId, grid] of Object.entries(grids.WALK_GRIDS)) {
  assert.equal(grid.mapId, mapId);
  assert.equal(grid.tileSize, 32);
  assert.ok(Number.isInteger(grid.width) && grid.width > 0);
  assert.ok(Number.isInteger(grid.height) && grid.height > 0);
  assert.equal(grid.blockedRows.length, grid.height);
  for (const row of grid.blockedRows) {
    for (const range of row.split(',').filter(Boolean)) {
      const [startText, endText = startText] = range.split('-');
      assert.ok(Number.isInteger(Number(startText)) && Number(startText) >= 0);
      assert.ok(Number.isInteger(Number(endText)) && Number(endText) < grid.width);
    }
  }
}

for (const mapId of ['tan_vien', 'thanh_truc_lam', 'duoc_vien', 'vuon_ca_nhan', 'mieu_hoang']) {
  assert.deepEqual(grids.WALK_GRIDS[mapId].blockedRows, legacy[mapId], `${mapId} must match the legacy hand copy`);
}
assert.deepEqual(diffCells(legacy.dong_mach_ngam, grids.WALK_GRIDS.dong_mach_ngam), [
  { ty: 14, tx: 20, legacyBlocked: false, generatedBlocked: true },
], 'vendor TileMap.load adds the hu_thien_cuc_lac collision at dong_mach_ngam (20,14)');

for (const row of spawns.MAP_SPAWNS) {
  assert.ok(grids.WALK_GRIDS[row.mapId]);
  assert.equal(row.count, row.spawns.length);
  assert.ok(enemies.ENEMY_DEFS[row.enemyType], `spawn type ${row.enemyType} must be in ENEMY_DEFS`);
  for (const spawn of row.spawns) {
    assert.equal(spawn.x, spawn.tx * 32 + 16);
    assert.equal(spawn.y, (spawn.ty + 1) * 32);
    assert.ok(spawn.tx >= 0 && spawn.tx < grids.WALK_GRIDS[row.mapId].width);
    assert.ok(spawn.ty >= 0 && spawn.ty < grids.WALK_GRIDS[row.mapId].height);
    assert.equal(spawn.walkable, !isBlocked(grids.WALK_GRIDS[row.mapId], spawn.tx, spawn.ty));
  }
}
const blockedSpawns = spawns.MAP_SPAWNS.flatMap((row) => row.spawns
  .filter((spawn) => !spawn.walkable)
  .map((spawn) => ({ mapId: row.mapId, enemyType: row.enemyType, id: spawn.id, tx: spawn.tx, ty: spawn.ty })));
assert.deepEqual(blockedSpawns, [{ mapId: 'mo_linh_thach', enemyType: 'tm_tru', id: 'tm_tru', tx: 22, ty: 14 }]);
assert.equal(grids.WALK_TILE_SIZE, 32);
for (const grid of Object.values(grids.WALK_GRIDS)) {
  assert.ok(grid.source.length > 0);
  assert.ok(grid.source.every((source) => source.startsWith('vendor/tutien2d-public-client/2026-10-06/src/')));
}

console.log(`walk-grid tests passed (16 maps, 6 legacy comparisons, ${spawns.MAP_SPAWNS.reduce((sum, row) => sum + row.count, 0)} spawn points, ${blockedSpawns.length} blocked spawn reported)`);
