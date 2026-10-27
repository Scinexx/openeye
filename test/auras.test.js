// First-find auras come from each rare UT's own sprite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root} from './helpers.js';
import {decodePng} from '../tools/codex/png.mjs';
import {buildAuras} from '../tools/codex/auras.mjs';

const items = JSON.parse(readFileSync(join(root, 'public/catalog/items.json'), 'utf8'));
const sheet = decodePng(readFileSync(join(root, 'public/catalog/items.png')));
const auras = buildAuras(items, sheet);
const named = n => auras[items.find(i => i.name === n).id];
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

test('the sprite sheet decodes to its real size', () => {
  assert.equal(sheet.width, 320);
  assert.equal(sheet.rgba.length, sheet.width * sheet.height * 4);
});

test('auras follow the item colours and skip common UTs', () => {
  const [r, g, b] = rgb(named('Demon Blade').a);
  assert.ok(r > g + 40 && r > b + 40, 'Demon Blade glows red');
  const [r2, g2, b2] = rgb(named('Coral Silk Armor').a);
  assert.ok(r2 > g2 && b2 > g2, 'Coral Silk Armor glows pink');
  for (const it of items.filter(i => i.commonUt)) assert.equal(auras[it.id], undefined, it.name);
  assert.equal(named('Admin Sword'), undefined, 'nothing drops it');
  assert.ok(Object.keys(auras).every(id => { const i = items.find(x => x.id === Number(id)); return i.dropRate > 0 || i.shop; }), 'only obtainable items');
  assert.ok(named('Amulet of Resurrection'), 'sold in the shop');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'public/catalog/auras.json'), 'utf8')), JSON.parse(JSON.stringify(auras)), 'auras.json is up to date');
});
