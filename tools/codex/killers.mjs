// What players die to, named the way the game shows it. The server records a killer by its
// object id (objects.xml), which for many enemies differs from the name the client shows
// (DisplayId): "Rock Bot" is the Rock Construct, "Dr Terrible Rampage Cyborg" a Rampage
// Cyborg. Damaging floors are killers too ("Lava Blend" is lava), so they get their tile as
// an icon. The Mad Lab's traps and turrets are Dr Terrible's doing and are credited to him.
import {encodePng} from './swf.mjs';
import {STATIC} from './enemies.mjs';
import {parseElement} from '../tooltip.mjs';

export const MAD_LAB_TRAPS = ['Red Gas Spawner UL', 'Red Gas Spawner UR', 'Red Gas Spawner LL', 'Red Gas Spawner LR', 'Mad Gas Controller',
  'Green Potion', 'Turret Attack', 'West Automated Defense Turret', 'East Automated Defense Turret'];
const MAD_LAB_BOSS = 'Dr Terrible';
// Floors: a blend tile is the same hazard drawn at an edge.
const floorName = id => id.replace(/ Blend$/, '');

/**
 * @param objects [{type, id, src}] every <Object> in objects.xml
 * @param grounds grounds.xml text
 * @param sheets  Map from swfBitmaps(client.swf)
 * @returns names {server id: shown name} (only where they differ), hazards {name: {x, y, w, h}} in png
 */
export function buildKillers({objects, grounds, sheets}) {
  const names = {};
  for (const o of objects) {
    if (!/<Enemy\s*\/>/.test(o.body)) continue;
    const display = parseElement(o.src).children.find(c => c.tag === 'DisplayId')?.text;
    if (display && display !== o.id) names[o.id] = display;
  }
  for (const id of MAD_LAB_TRAPS) {
    if (!objects.some(o => o.id === id)) throw new Error(`Mad Lab trap ${id} is no longer in objects.xml`);
    names[id] = MAD_LAB_BOSS;
  }
  const tiles = [];
  for (const body of [...grounds.matchAll(/<Ground\b[\s\S]*?<\/Ground>/g)].map(m => m[0])) {
    if (!/<(?:MinDamage|MaxDamage|Damage)>/.test(body)) continue;
    const el = parseElement(body);
    const id = el.attrs.id, name = floorName(id);
    if (name !== id) names[id] = name;
    if (tiles.some(t => t.name === name)) continue;
    const tex = el.children.find(c => c.tag === 'Texture') ?? el.children.find(c => c.tag === 'RandomTexture')?.children.find(c => c.tag === 'Texture');
    const file = tex?.children.find(c => c.tag === 'File')?.text, index = Number(tex?.children.find(c => c.tag === 'Index')?.text);
    const spec = STATIC[file], sheet = spec && sheets.get(spec[0]);
    if (!sheet || !Number.isFinite(index)) continue;
    const [, w, h] = spec, per = Math.floor(sheet.width / w);
    tiles.push({name, sheet, sx: (index % per) * w, sy: Math.floor(index / per) * h, w, h});
  }
  const W = Math.max(8, tiles.reduce((n, t) => n + t.w, 0)), H = Math.max(8, ...tiles.map(t => t.h));
  const rgba = Buffer.alloc(W * H * 4), hazards = {};
  let x = 0;
  for (const t of tiles) {
    for (let y = 0; y < t.h; y++) t.sheet.rgba.copy(rgba, (y * W + x) * 4, ((t.sy + y) * t.sheet.width + t.sx) * 4, ((t.sy + y) * t.sheet.width + t.sx + t.w) * 4);
    hazards[t.name] = {x, y: 0, w: t.w, h: t.h};
    x += t.w;
  }
  return {names, hazards, sheet: {width: W, height: H, png: encodePng(W, H, rgba)}};
}
