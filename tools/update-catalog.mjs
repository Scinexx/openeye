// Builds OpenEye's game catalog (items, classes, sprites) from the official
// OpenRotMG repositories. Run with `npm run update-catalog` after a game update.
//
//   node tools/update-catalog.mjs                 download from GitHub
//   node tools/update-catalog.mjs --from <dir>    use local clones in <dir>
//                                                 (Open-RotMG-Server, Open-RotMG-Website, Open-RotMG-Client)
//   --loot <file>   enemy drops exported from the server's code by tools/codex/loot_export.rs
//                   (the daily GitHub Action does this). Without it, enemies are left as they are.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseElement, equipmentTooltip} from './tooltip.mjs';
import {swfBitmaps} from './codex/swf.mjs';
import {buildGraves} from './codex/graves.mjs';
import {buildWalk} from './codex/walk.mjs';
import {buildAuras} from './codex/auras.mjs';
import {decodePng} from './codex/png.mjs';
import {buildEnemies, literalDrops} from './codex/enemies.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'catalog');
const RAW = 'https://raw.githubusercontent.com/OpenRotMG';
const fromIndex = process.argv.indexOf('--from');
const local = fromIndex > 0 ? process.argv[fromIndex + 1] : null;
const lootIndex = process.argv.indexOf('--loot');
const lootFile = lootIndex > 0 ? process.argv[lootIndex + 1] : null;

const SOURCES = {
  objects: ['Open-RotMG-Server', 'data/objects.xml'],
  // Loot tables: used to find which tiers can actually drop and how common each UT is.
  loot: ['Open-RotMG-Server', 'src/loot.rs'],
  endgame: ['Open-RotMG-Server', 'src/endgame.rs'],
  // The Nexus shop's stock, for items players can buy rather than loot.
  shop: ['Open-RotMG-Server', 'src/world/shop.rs'],
  items: ['Open-RotMG-Website', 'public/hiscores/items.json'],
  sheet: ['Open-RotMG-Website', 'public/hiscores/items.png'],
  classSprite: name => ['Open-RotMG-Website', `public/restoration/assets/player/${name}.png`],
  client: ['Open-RotMG-Client', 'client.swf']
};

async function get([repo, path], binary = false) {
  if (local) {
    const data = await readFile(join(local, repo, path));
    return binary ? data : data.toString('utf8');
  }
  const res = await fetch(`${RAW}/${repo}/main/${path}`);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${repo}/${path}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

const SLOT_NAMES = {
  1: 'Sword', 2: 'Dagger', 3: 'Bow', 4: 'Tome', 5: 'Shield', 6: 'Leather Armor', 7: 'Heavy Armor',
  8: 'Wand', 9: 'Ring', 10: 'Consumable', 11: 'Spell', 12: 'Seal', 13: 'Cloak', 14: 'Robe',
  15: 'Quiver', 16: 'Helm', 17: 'Staff', 18: 'Poison', 19: 'Skull', 20: 'Trap', 21: 'Orb',
  22: 'Prism', 23: 'Scepter'
};
// Untiered items hidden from "Latest loot" because nearly everyone gets them.
// Any UT with a drop chance of COMMON_UT_RATE or more is added automatically;
// these names are added on top of that (dungeon UTs with lower per-kill rates
// that are still farmed constantly).
const COMMON_UT_RATE = 0.1;
const COMMON_UT_EXTRA = ['Wand of the Bulwark', 'Ring of Divine Faith', "St. Abraham's Wand"];
// Slots whose top tier is too common to count as notable loot (T5 rings).
const TOP_TIER_NOT_NOTABLE = [9];

const STAT_TAGS = ['MaxHitPoints', 'MaxMagicPoints', 'Attack', 'Defense', 'Speed', 'Dexterity', 'HpRegen', 'MpRegen'];
const STAT_KEYS = ['hp', 'mp', 'att', 'def', 'spd', 'dex', 'vit', 'wis'];

const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (body, name) => {
  const m = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? unescape(m[1].trim()) : null;
};

await mkdir(join(out, 'classes'), {recursive: true});
const xml = await get(SOURCES.objects);
const sheet = JSON.parse(await get(SOURCES.items));
const sheetById = new Map(sheet.map(i => [i.id, i]));
const objects = [...xml.matchAll(/<Object type="(0x[0-9a-fA-F]+)" id="([^"]+)">([\s\S]*?)<\/Object>/g)]
  .map(([src, type, id, body]) => ({type: parseInt(type, 16), id: unescape(id), body, src}));

const items = [];
for (const o of objects) {
  if (!/<Item\s*\/>/.test(o.body)) continue;
  const pos = sheetById.get(o.type);
  const slot = Number(tag(o.body, 'SlotType') ?? 0);
  const tier = tag(o.body, 'Tier');
  const bonuses = [...o.body.matchAll(/<ActivateOnEquip stat="(\d+)" amount="(-?\d+)">IncrementStat<\/ActivateOnEquip>/g)]
    .map(([, stat, amount]) => ({stat: Number(stat), amount: Number(amount)}));
  items.push({
    id: o.type,
    name: o.id,
    slot,
    slotName: SLOT_NAMES[slot] ?? 'Other',
    tier: tier === null ? null : Number(tier),
    // Equipment without a tier is an untiered (UT) drop in the 2012 game.
    untiered: tier === null && slot !== 10 && slot !== 0,
    soulbound: /<Soulbound\s*\/>/.test(o.body),
    consumable: /<Consumable\s*\/>/.test(o.body),
    fameBonus: Number(tag(o.body, 'FameBonus') ?? 0),
    description: tag(o.body, 'Description') ?? '',
    bonuses,
    sprite: pos ? {x: pos.x, y: pos.y} : null
  });
}
items.sort((a, b) => a.id - b.id);

// ---- loot tables ----
const lootSrc = (await get(SOURCES.loot)) + '\n' + (await get(SOURCES.endgame).catch(() => ''));
const groups = {};
for (const [, name, list] of lootSrc.matchAll(/const (\w+): &\[i32\] = &\[([\d,\s]+)\]/g)) {
  groups[name] = list.split(',').map(Number).filter(Number.isFinite);
}
const maxDropTier = {};
for (const [, , tier, group] of lootSrc.matchAll(/\(\s*([0-9.]+)\s*,\s*(?:Pick::)?Tier\(\s*(\d+)\s*,\s*(\w+)\s*\)/g)) {
  for (const slot of groups[group] ?? []) maxDropTier[slot] = Math.max(maxDropTier[slot] ?? 0, Number(tier));
}
const dropRate = new Map();
for (const [, rate, hex] of lootSrc.matchAll(/\(\s*([0-9.]+)\s*,\s*(?:Pick::Item\(|Item\()?\s*(0x[0-9a-fA-F]+)\s*\)?\s*\)/g)) {
  const id = parseInt(hex, 16);
  dropRate.set(id, Math.max(dropRate.get(id) ?? 0, Number(rate)));
}
if (!Object.keys(maxDropTier).length) throw new Error('Could not read tier drops from loot.rs; the file format may have changed');
// Items sold in the shop: every 0x.. kind listed before "=>" in shop.rs's price table.
const shopSrc = await get(SOURCES.shop).catch(() => '');
const shopItems = new Set([...shopSrc.matchAll(/^\s*((?:0x[0-9a-fA-F]+\s*\|?\s*)+)=>/gm)]
  .flatMap(([, kinds]) => kinds.match(/0x[0-9a-fA-F]+/g).map(k => parseInt(k, 16))));
for (const it of items) {
  it.dropRate = dropRate.get(it.id) ?? null;
  it.shop = shopItems.has(it.id);
  it.topTier = it.tier !== null && maxDropTier[it.slot] !== undefined && it.tier === maxDropTier[it.slot];
  it.commonUt = it.untiered && ((it.dropRate ?? 0) >= COMMON_UT_RATE || COMMON_UT_EXTRA.includes(it.name));
  // Shown in "Latest loot": rare untiered items and the best tier that can drop.
  it.notable = (it.untiered && !it.commonUt) || (it.topTier && !TOP_TIER_NOT_NOTABLE.includes(it.slot));
}
const slots = {};
for (const [id, name] of Object.entries(SLOT_NAMES)) slots[id] = {name, maxDropTier: maxDropTier[id] ?? null};

const classes = [];
for (const o of objects) {
  if (!/<Player\s*\/>/.test(o.body)) continue;
  const base = {}, max = {};
  STAT_TAGS.forEach((t, i) => {
    const m = o.body.match(new RegExp(`<${t} max="(\\d+)">(\\d+)</${t}>`));
    if (m) { max[STAT_KEYS[i]] = Number(m[1]); base[STAT_KEYS[i]] = Number(m[2]); }
  });
  const slug = o.id.toLowerCase();
  classes.push({
    id: o.type, name: o.id, slug,
    description: tag(o.body, 'Description') ?? '',
    slotTypes: (tag(o.body, 'SlotTypes') ?? '').split(',').map(s => Number(s.trim())).slice(0, 4),
    base, max
  });
  try {
    await writeFile(join(out, 'classes', `${slug}.png`), await get(SOURCES.classSprite(slug), true));
  } catch (e) {
    console.warn(`No sprite for class ${o.id}: ${e.message}`);
  }
}
classes.sort((a, b) => a.id - b.id);

// In-game hover tooltips, built the way the client builds them (see tooltip.mjs).
const displayName = el => el.children.find(c => c.tag === 'DisplayId')?.text || el.attrs.id;
const playerClasses = objects.filter(o => /<Class>Player<\/Class>/.test(o.body)).map(o => {
  const el = parseElement(o.src);
  return {name: displayName(el), slotTypes: (tag(o.body, 'SlotTypes') ?? '').split(',').map(s => Number(s.trim()))};
});
const tooltips = {};
for (const o of objects) {
  if (/<Item\s*\/>/.test(o.body)) tooltips[o.type] = equipmentTooltip(parseElement(o.src), {classes: playerClasses, displayName});
}

await writeFile(join(out, 'tooltips.json'), JSON.stringify(tooltips));

// ---- enemies ----
if (lootFile) {
  const loot = JSON.parse(await readFile(lootFile, 'utf8'));
  const itemIds = new Set(items.map(i => i.id));
  const {enemies, sheet} = buildEnemies({objects, loot, sheets: swfBitmaps(await get(SOURCES.client, true)), isItem: id => itemIds.has(id)});
  // Items the world code drops by hand must all be in the export's list of hand-written extras.
  if (local) {
    const {readdir} = await import('node:fs/promises');
    const dir = join(local, 'Open-RotMG-Server', 'src');
    const files = ['world.rs', ...(await readdir(join(dir, 'world'))).filter(f => f.endsWith('.rs')).map(f => `world/${f}`)];
    const literal = literalDrops(await Promise.all(files.map(f => readFile(join(dir, f), 'utf8'))));
    const known = new Set(loot.extraItems);
    const missing = [...literal].filter(id => !known.has(id) && itemIds.has(id));
    if (missing.length) console.warn(`::warning::Hand-written drops not in loot_export.rs extras: ${missing.map(id => '0x' + id.toString(16)).join(', ')}`);
  }
  await writeFile(join(out, 'enemies.json'), JSON.stringify({sheet: {width: sheet.width, height: sheet.height}, enemies}));
  await writeFile(join(out, 'enemies.png'), sheet.png);
  console.log(`Enemies: ${enemies.length} (${enemies.filter(e => e.drops.length).length} with drops, ${enemies.filter(e => e.sprite).length} with sprites).`);
} else {
  console.log('Enemies not rebuilt: pass --loot <file> from tools/codex/loot_export.rs.');
}
// ---- gravestones and walking frames ----
{
  const clientSheets = swfBitmaps(await get(SOURCES.client, true));
  const walk = buildWalk({classes, objects, sheets: clientSheets});
  await writeFile(join(out, 'walk.json'), JSON.stringify({sheet: {width: walk.sheet.width, height: walk.sheet.height}, rows: walk.rows}));
  await writeFile(join(out, 'walk.png'), walk.sheet.png);
  const {graves, sheet} = buildGraves({objects, sheets: clientSheets});
  await writeFile(join(out, 'graves.json'), JSON.stringify({sheet: {width: sheet.width, height: sheet.height}, graves}));
  await writeFile(join(out, 'graves.png'), sheet.png);
}
const itemSheet = await get(SOURCES.sheet, true);
await writeFile(join(out, 'items.png'), itemSheet);
// First-find aura colours, from each rare UT's own sprite.
await writeFile(join(out, 'auras.json'), JSON.stringify(buildAuras(items, decodePng(itemSheet))));
await writeFile(join(out, 'items.json'), JSON.stringify(items));
await writeFile(join(out, 'classes.json'), JSON.stringify(classes, null, 1));
await writeFile(join(out, 'slots.json'), JSON.stringify(slots, null, 1));
console.log(`Catalog: ${items.length} items (${items.filter(i => i.sprite).length} with sprites), ${classes.length} classes.`);
console.log(`Latest loot shows ${items.filter(i => i.notable).length} items; hidden common UTs: ${items.filter(i => i.commonUt).map(i => i.name).join(', ')}`);
