// Gravestone sprites, cut from the client the same way as enemy sprites.
// The server picks the gravestone a dead character leaves by how many base stats were
// maxed (src/world.rs finish_death): with none maxed, Gravestone 1/2/3 by level
// (1, under 20, 20); with n maxed, Gravestone 3 + n (1..6), 10 (7) or 11 (8).
import {encodePng} from './swf.mjs';
import {STATIC} from './enemies.mjs';

export const GRAVE_TYPES = [0x723, 0x724, 0x725, 0x726, 0x727, 0x728, 0x729, 0x72a, 0x72b, 0x734, 0x735];

/** @param objects [{type, body}] from objects.xml, @param sheets Map from swfBitmaps(client.swf) */
export function buildGraves({objects, sheets}) {
  const cell = 16, cols = GRAVE_TYPES.length;
  const rgba = Buffer.alloc(cols * cell * cell * 4);
  const graves = {};
  GRAVE_TYPES.forEach((type, i) => {
    const o = objects.find(x => x.type === type);
    if (!o) throw new Error(`Gravestone 0x${type.toString(16)} missing from objects.xml`);
    const file = o.body.match(/<Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/);
    const spec = file && STATIC[file[1]];
    const sheet = spec && sheets.get(spec[0]);
    if (!sheet) throw new Error(`Gravestone 0x${type.toString(16)}: sheet ${file?.[1]} not found in client.swf`);
    const [, w, h] = spec, index = Number(file[2]);
    const perRow = Math.floor(sheet.width / w);
    const sx = (index % perRow) * w, sy = Math.floor(index / perRow) * h;
    const dx = i * cell + Math.floor((cell - w) / 2), dy = cell - h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((sy + y) * sheet.width + sx + x) * 4, di = ((dy + y) * cols * cell + dx + x) * 4;
      sheet.rgba.copy(rgba, di, si, si + 4);
    }
    graves[type] = {x: i * cell, y: 0, w: cell, h: cell, name: o.id};
  });
  return {graves, sheet: {width: cols * cell, height: cell, png: encodePng(cols * cell, cell, rgba)}};
}
