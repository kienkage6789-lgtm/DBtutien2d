import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'vendor/tutien2d-public-client/2026-10-06/src');
const config = await readFile(resolve(vendor, 'core/config.js'), 'utf8');
const itemsSource = await readFile(resolve(vendor, 'systems/items.js'), 'utf8');

function records(source, marker, minimum, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Cannot find ${label} marker`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open < 0 || close < 0) throw new Error(`Cannot find ${label} bounds`);
  const text = source.slice(open + 1, close);
  const matches = [...text.matchAll(/\{id:"([a-z0-9_]+)"/g)];
  if (matches.length < minimum) throw new Error(`Unexpected ${label} record count: ${matches.length}`);
  return matches.map((match, index) => ({
    id: match[1],
    body: text.slice(match.index, matches[index + 1]?.index ?? text.length),
  }));
}

const realmRecords = records(config, 'REALMS=[', 16, 'REALMS');
const realmMax = {};
for (const { id, body } of realmRecords) {
  const values = {};
  for (const field of ['hpMax', 'mpMax']) {
    const match = body.match(new RegExp(`\\b${field}:(\\d+)\\b`));
    if (!match) throw new Error(`Missing ${field} in realm ${id}`);
    values[field] = Number(match[1]);
  }
  if (realmMax[id]) throw new Error(`Duplicate realm ${id}`);
  realmMax[id] = values;
}

const itemStart = itemsSource.indexOf('ITEMS={');
const itemOpen = itemsSource.indexOf('{', itemStart);
const itemClose = itemsSource.indexOf('},n.clearItemIcons=', itemOpen);
if (itemStart < 0 || itemOpen < 0 || itemClose < 0) throw new Error('Cannot find ITEMS object bounds');
const itemText = itemsSource.slice(itemOpen + 1, itemClose + 1);
const itemMatches = [...itemText.matchAll(/(?:^|,)([a-z0-9_]+):\{id:"\1"/g)];
if (itemMatches.length < 100) throw new Error(`Unexpected ITEMS record count: ${itemMatches.length}`);
const itemBonus = {};
const knownItemIds = itemMatches.map((match) => match[1]);
const bonusFields = { hpBonus: 'hpBonus', mpBonus: 'mpBonus' };
for (let index = 0; index < itemMatches.length; index++) {
  const match = itemMatches[index];
  const id = match[1];
  const body = itemText.slice(match.index + match[0].length, itemMatches[index + 1]?.index ?? itemText.length);
  const bonus = {};
  for (const [sourceField, targetField] of Object.entries(bonusFields)) {
    const value = body.match(new RegExp(`\\b${sourceField}:(\\d+)\\b`));
    if (value) bonus[targetField] = Number(value[1]);
  }
  if (Object.values(bonus).some((value) => value !== 0)) itemBonus[id] = bonus;
}

const output = `// Generated from vendor/tutien2d-public-client/2026-10-06/src/core/config.js and systems/items.js.\n// Regenerate with: node scripts/gen-derived-vitals.mjs\nexport const REALM_MAX = ${JSON.stringify(realmMax, null, 2)} as const;\n\n// Known item IDs distinguish a known item with no HP/MP bonus from an unknown item.\nexport const KNOWN_ITEM_IDS = ${JSON.stringify(knownItemIds, null, 2)} as const;\n\n// Only non-zero HP/MP bonuses are listed.\nexport const ITEM_BONUS = ${JSON.stringify(itemBonus, null, 2)} as const;\n`;
const destination = resolve(root, 'packages/core-client/src/state/derived-vitals.generated.ts');
await writeFile(destination, output, 'utf8');
console.log(`Generated ${destination} (${realmRecords.length} realms, ${itemMatches.length} items)`);
