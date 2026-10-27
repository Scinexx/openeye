// The Wine Cellar, drawn from the server's own map (data/wine-cellar.wmap) with the client's
// textures, for the Wine Cellar Incantation theme. The map is read the way the server reads
// it (src/content.rs decode_bounded_cells); walls show their face where the floor south of
// them is open and their top elsewhere; Wine Barrels stand in the inner corners, the rule the
// server uses to place them (src/world/endgame.rs); Henchmen of Oryx stand where the map
// spawns them. Oryx himself is cut out separately, to loom over the page.
import {inflateSync} from 'node:zlib';
import {encodePng} from './swf.mjs';
import {STATIC} from './enemies.mjs';
import {parseElement} from '../tooltip.mjs';

const WALL = 'Wine Wall 4';
const animated = file => {
  const m = file.match(/^chars(\d+)x(\d+)[rd]/);
  return m ? [`Embeds_${file}Embed_`, Number(m[1]), Number(m[2]), Number(m[1]) * 7, Number(m[2])] : null;
};

function readMap(buf) {
  const d = inflateSync(buf);
  let p = 0;
  const short = () => { const v = d.readInt16LE(p); p += 2; return v; };
  const int = () => { const v = d.readInt32LE(p); p += 4; return v; };
  const byte = () => d[p++];
  const string = () => {
    let n = 0;
    for (let s = 0; ; s += 7) { const b = byte(); n |= (b & 127) << s; if (!(b & 128)) break; }
    const v = d.subarray(p, p + n).toString('utf8'); p += n; return v;
  };
  const dict = [];
  for (let n = short(); n > 0; n--) dict.push({ground: short() & 0xffff, object: string(), config: string(), terrain: byte(), region: byte()});
  const width = int(), height = int();
  const cells = [];
  for (let i = 0; i < width * height; i++) cells.push(dict[short()]);
  return {width, height, cells};
}

/** One texture element ({tag, children}) to {sheet, sx, sy, w, h}. */
function cut(tex, sheets) {
  const kid = tag => tex.children.find(c => c.tag === tag)?.text;
  const file = kid('File'), index = Number(kid('Index'));
  const spec = tex.tag === 'AnimatedTexture' ? animated(file) : STATIC[file] && [...STATIC[file], STATIC[file][1], STATIC[file][2]];
  const sheet = spec && sheets.get(spec[0]);
  if (!sheet) throw new Error(`Wine Cellar: sheet ${file} not found in client.swf`);
  const [, w, h, bw, bh] = spec;
  const per = Math.floor(sheet.width / bw);
  return {sheet, sx: (index % per) * bw, sy: Math.floor(index / per) * bh, w, h};
}
const textures = (el, tag = 'Texture') => {
  const random = el.children.find(c => c.tag === 'RandomTexture');
  if (random) return random.children.filter(c => c.tag === 'Texture');
  return el.children.filter(c => c.tag === tag || (tag === 'Texture' && c.tag === 'AnimatedTexture')).slice(0, 1);
};

/**
 * @param map      wine-cellar.wmap bytes
 * @param grounds  grounds.xml text
 * @param objects  [{type, id, src}] from objects.xml
 * @param sheets   Map from swfBitmaps(client.swf)
 */
export function buildCellar({map, grounds, objects, sheets}) {
  const m = readMap(map);
  const T = 8, W = m.width * T, H = m.height * T;
  const rgba = Buffer.alloc(W * H * 4);
  const groundEl = type => {
    const g = grounds.match(new RegExp(`<Ground type="0x0*${type.toString(16)}"[^>]*>[\\s\\S]*?</Ground>`, 'i'));
    return g && parseElement(g[0]);
  };
  const objectEl = name => {
    const o = objects.find(x => x.id === name);
    if (!o) throw new Error(`Wine Cellar: object ${name} missing from objects.xml`);
    return parseElement(o.src);
  };
  const draw = (t, dx, dy, dw = t.w, dh = t.h) => {
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const px = dx + x, py = dy + y;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const si = ((t.sy + Math.floor(y * t.h / dh)) * t.sheet.width + t.sx + Math.floor(x * t.w / dw)) * 4;
      if (!t.sheet.rgba[si + 3]) continue;
      t.sheet.rgba.copy(rgba, (py * W + px) * 4, si, si + 4);
    }
  };
  const cell = (x, y) => (x < 0 || y < 0 || x >= m.width || y >= m.height ? null : m.cells[y * m.width + x]);
  const open = (x, y) => { const c = cell(x, y); return Boolean(c && c.ground !== 0xff && c.object !== WALL); };
  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

  const groundTex = new Map();
  const wall = objectEl(WALL);
  const wallFace = cut(textures(wall)[0], sheets);
  const wallTop = cut(textures(wall.children.find(c => c.tag === 'Top'))[0], sheets);
  const barrels = textures(objectEl('Wine Barrel')).map(t => cut(t, sheets));
  const henchEl = objectEl('Henchman of Oryx');
  const hench = cut(textures(henchEl)[0], sheets);
  const sizeOf = el => Number(el.children.find(c => c.tag === 'Size')?.text ?? 100) / 100;
  const actors = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const c = cell(x, y);
    if (c.ground !== 0xff) {
      if (!groundTex.has(c.ground)) groundTex.set(c.ground, textures(groundEl(c.ground) ?? {children: []}).map(t => cut(t, sheets)));
      const options = groundTex.get(c.ground);
      if (options.length) draw(options[hash(x, y) % options.length], x * T, y * T);
    }
    if (c.object === WALL) draw(open(x, y + 1) ? wallFace : wallTop, x * T, y * T);
    else if (c.object === 'Henchman of Oryx') actors.push([x, y]);
    else if (!c.object && c.region !== 1 && open(x, y) && [[-1, -1], [-1, 1], [1, -1], [1, 1]].some(([dx, dy]) =>
      !open(x - dx, y) && !open(x, y - dy) && open(x + dx, y) && open(x, y + dy) && open(x + dx, y + dy))) {
      draw(barrels[hash(x, y) % barrels.length], x * T, y * T);
    }
  }
  // Characters stand on their tile: centred, feet at the tile's bottom, drawn at their Size.
  const hs = sizeOf(henchEl);
  for (const [x, y] of actors) {
    const w = Math.round(hench.w * hs), h = Math.round(hench.h * hs);
    draw(hench, x * T + T / 2 - w / 2, (y + 1) * T - h, w, h);
  }
  const oryxEl = objectEl('Oryx the Mad God 2');
  const oryx = cut(textures(oryxEl)[0], sheets);
  const sprite = Buffer.alloc(oryx.w * oryx.h * 4);
  for (let y = 0; y < oryx.h; y++) oryx.sheet.rgba.copy(sprite, y * oryx.w * 4, ((oryx.sy + y) * oryx.sheet.width + oryx.sx) * 4, ((oryx.sy + y) * oryx.sheet.width + oryx.sx + oryx.w) * 4);
  // His eyes: the red pixels, so the page can make them glow.
  const eyes = [];
  for (let y = 0; y < oryx.h; y++) for (let x = 0; x < oryx.w; x++) {
    const i = (y * oryx.w + x) * 4;
    if (sprite[i + 3] && sprite[i] > 120 && sprite[i + 1] < 80 && sprite[i + 2] < 80) eyes.push([x, y]);
  }
  let spot = null;
  for (let y = 0; y < m.height && !spot; y++) for (let x = 0; x < m.width; x++) if (cell(x, y).object === 'Oryx the Mad God 2') { spot = [x, y]; break; }
  return {
    map: {width: W, height: H, tile: T, oryx: spot, png: encodePng(W, H, rgba)},
    oryx: {width: oryx.w, height: oryx.h, eyes, png: encodePng(oryx.w, oryx.h, sprite)}
  };
}
