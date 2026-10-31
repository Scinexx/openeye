// Sprites the themes draw with: dungeon bosses and their minions, the props of each dungeon
// (palm trees, webs, treasure, totems), the loot bags, and the pets a Hexed player turns into
// (the objects.xml Group "Hexable"). Cut from the client the way the enemy sprites are: the
// first texture listed, the standing frame of an animated one, the first of a random set.
import {encodePng} from './swf.mjs';
import {STATIC} from './enemies.mjs';
import {parseElement} from '../tooltip.mjs';

export const THEME_SPRITES = [
  // Pirate Cave
  'Dreadstump the Pirate King', 'Cave Pirate Parrot', 'Cave Pirate Macaw', 'Cave Pirate Monkey', 'Cave Pirate Sailor', 'Cave Pirate Brawler', 'Treasure Chest', 'Cannonball',
  // Spider Den
  'Arachna the Spider Queen', 'Black Den Spider', 'Red Spotted Den Spider', 'Brown Den Spider', 'Green Den Spider Hatchling', 'Spider Egg Sac', 'Spider Web',
  // Snake Pit
  'Stheno the Snake Queen', 'Stheno Swarm', 'Pit Snake', 'Greater Pit Snake', 'Brown Python', 'Fire Python', 'Yellow Python', 'Snakepit Guard', 'Snake Grate',
  // Forbidden Jungle
  'Mixcoatl the Masked God', 'Jungle Totem', 'Totem Spirit', 'Mask Shaman', 'Great Temple Snake', 'Jungle Brazier', 'Jungle Tree Big', 'Jungle Flower Bright', 'Pink Flowers', 'Jungle Temple Column',
  // Beachzone
  'Masked Party God', 'Beach Bum', 'Beach Spectre', 'Palm Tree', 'Beach Umbrella', 'Sand Castle',
  // Loot bags (brown, pink, purple, cyan, white; the soulbound one)
  'Loot Bag', 'Loot Bag 2', 'Loot Bag 3', 'Loot Bag 4', 'Loot Bag 5', 'Soulbound Loot Bag',
  // Ship's stores, for Pirate Rum
  'Wine Barrel', 'Ghost Ship Crate'
];
// Floor tiles (grounds.xml), tiled by the themes: the Mad Lab's two vats (green Hexes you, blue
// cures it) and its floor, and ship's planking.
export const THEME_GROUNDS = ['Lab Bad Vat No Slow', 'Lab Good Vat No Slow', 'Lab Floor', 'Wood Plank Floor', 'Wood Plank Floor Dark', 'Wood Panel Floor'];

const animated = file => {
  const m = file.match(/^chars(\d+)x(\d+)[rd]/);
  return m ? [`Embeds_${file}Embed_`, Number(m[1]), Number(m[2]), Number(m[1]) * 7, Number(m[2])] : null;
};
const own = node => node?.children.find(c => c.tag === 'Texture' || c.tag === 'AnimatedTexture');

/**
 * @param objects [{type, id, body, src}] every <Object>
 * @param grounds grounds.xml text
 * @param sheets  Map from swfBitmaps(client.swf)
 */
export function buildThemeSprites({objects, grounds = '', sheets}) {
  const hexable = objects.filter(o => /<Group>Hexable<\/Group>/.test(o.body)).map(o => o.id);
  const cuts = [], missing = [];
  for (const name of [...THEME_SPRITES, ...hexable]) try {
    const o = objects.find(x => x.id === name);
    if (!o) throw new Error(`Theme sprite ${name} missing from objects.xml`);
    const el = parseElement(o.src);
    const tex = own(el) ?? own(el.children.find(c => c.tag === 'Portrait')) ?? own(el.children.find(c => c.tag === 'RandomTexture'));
    if (!tex) throw new Error(`Theme sprite ${name} has no texture`);
    const kid = tag => tex.children.find(c => c.tag === tag)?.text;
    const file = kid('File'), index = Number(kid('Index'));
    const spec = tex.tag === 'AnimatedTexture' ? animated(file) : STATIC[file] && [...STATIC[file], STATIC[file][1], STATIC[file][2]];
    const sheet = spec && sheets.get(spec[0]);
    if (!sheet || !Number.isFinite(index)) throw new Error(`Theme sprite ${name}: sheet ${file} not found in client.swf`);
    const [, w, h, bw, bh] = spec;
    const per = Math.floor(sheet.width / bw);
    cuts.push({name, pet: hexable.includes(name), sheet, sx: (index % per) * bw, sy: Math.floor(index / per) * bh, w, h});
  } catch (e) { missing.push(e.message); }
  for (const name of THEME_GROUNDS) try {
    const m = grounds.match(new RegExp(`<Ground type="[^"]+" id="${name}">([\\s\\S]*?)</Ground>`));
    if (!m) throw new Error(`Theme ground ${name} missing from grounds.xml`);
    const el = parseElement(`<Ground>${m[1]}</Ground>`);
    const tex = own(el) ?? own(el.children.find(c => c.tag === 'RandomTexture'));
    const kid = tag => tex?.children.find(c => c.tag === tag)?.text;
    const spec = STATIC[kid('File')], sheet = spec && sheets.get(spec[0]), index = Number(kid('Index'));
    if (!sheet || !Number.isFinite(index)) throw new Error(`Theme ground ${name}: texture not found`);
    const [, w, h] = spec, per = Math.floor(sheet.width / w);
    cuts.push({name: `ground:${name}`, sheet, sx: (index % per) * w, sy: Math.floor(index / per) * h, w, h});
  } catch (e) { missing.push(e.message); }
  // Pets come and go with events, so a missing one is skipped; a missing prop is an error.
  const fatal = missing.filter(m => !hexable.some(p => m.includes(` ${p}`)));
  if (fatal.length) throw new Error(fatal.join('; '));
  // Packed left to right in square cells as big as the largest sprite.
  const cell = Math.max(16, ...cuts.map(c => Math.max(c.w, c.h))), cols = 16, rows = Math.ceil(cuts.length / cols);
  const W = cols * cell, H = rows * cell, rgba = Buffer.alloc(W * H * 4), sprites = {};
  cuts.forEach((c, i) => {
    const dx = (i % cols) * cell, dy = Math.floor(i / cols) * cell;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const si = ((c.sy + y) * c.sheet.width + c.sx + x) * 4, di = ((dy + y) * W + dx + x) * 4;
      c.sheet.rgba.copy(rgba, di, si, si + 4);
    }
    sprites[c.name] = {x: dx, y: dy, w: c.w, h: c.h, ...(c.pet ? {pet: true} : {})};
  });
  return {sprites, sheet: {width: W, height: H, png: encodePng(W, H, rgba)}};
}
