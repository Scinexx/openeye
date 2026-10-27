// What dyes and cloths need to be drawn on a character, cut from the client:
//   dyes.png    one row per class: the standing frame facing right (as the site's class icons
//               face), then its dye mask from the client's mask sheet (red marks the parts
//               the first dye/cloth colours, green the parts the second one does, and the
//               channel's brightness is the shading kept);
//   textiles.png the four cloth sheets (textile4x4, 5x5, 9x9 and 10x10) stacked.
// dyes.json also names the dye or cloth item behind each value, and dyes.png holds the dye
// and cloth items' own icons and masks, so they show in their real colours.
// A character's tex1/tex2 say what to apply (as the 2012 client reads them in
// TextureRedrawer): the top byte is 1 for a dye, whose low 24 bits are its colour, or the
// cloth's tile size (4, 5, 9 or 10), whose low bits are its index in that textile sheet.
import {encodePng} from './swf.mjs';
import {STATIC} from './enemies.mjs';

const PLAYERS = '_-U0', MASKS = '_-tI';
export const TEXTILE_SIZES = [4, 5, 9, 10];

/** @param classes [{id}] @param objects [{type, body}] @param sheets Map from swfBitmaps */
export function buildDyes({classes, objects, sheets}) {
  const sheet = sheets.get(PLAYERS), mask = sheets.get(MASKS);
  if (!sheet || !mask || sheet.width !== mask.width || sheet.height !== mask.height) throw new Error('players sheet or its dye mask not found in client.swf');
  // Dye and cloth items are drawn the same way: their bottle or bolt (Texture) recoloured
  // through their Mask by their own Tex1/Tex2. Each distinct pair gets a row after the classes.
  const cell = (file, index) => {
    const spec = STATIC[file], sh = spec && sheets.get(spec[0]);
    if (!sh || spec[1] !== 8) return null;
    const per = Math.floor(sh.width / 8);
    return {sheet: sh, sx: (index % per) * 8, sy: Math.floor(index / per) * 8};
  };
  const pairs = [], icons = {};
  for (const o of objects) {
    if (!/<Class>Dye<\/Class>/.test(o.body) || !/<Item\s*\/>/.test(o.body)) continue;
    const t = o.body.match(/<Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/);
    const m = o.body.match(/<Mask>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/);
    if (!t || !m) continue;
    const key = `${t[1]}:${t[2]}:${m[1]}:${m[2]}`;
    let row = pairs.findIndex(p => p.key === key);
    if (row < 0) {
      const base = cell(t[1], Number(t[2])), mask = cell(m[1], Number(m[2]));
      if (!base || !mask) continue;
      pairs.push({key, base, mask});
      row = pairs.length - 1;
    }
    const tex = tag => Number(o.body.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1] ?? 0) || 0;
    icons[o.type] = {row: classes.length + row, tex1: tex('Tex1'), tex2: tex('Tex2')};
  }
  const W = 16, H = (classes.length + pairs.length) * 8, rgba = Buffer.alloc(W * H * 4), rows = {};
  pairs.forEach(({base, mask}, i) => {
    for (const [c, dx] of [[base, 0], [mask, 8]]) {
      for (let y = 0; y < 8; y++) c.sheet.rgba.copy(rgba, (((classes.length + i) * 8 + y) * W + dx) * 4, ((c.sy + y) * c.sheet.width + c.sx) * 4, ((c.sy + y) * c.sheet.width + c.sx + 8) * 4);
    }
  });
  classes.forEach((c, row) => {
    const o = objects.find(x => x.type === c.id);
    const index = Number(o?.body.match(/<AnimatedTexture>\s*<File>players<\/File>\s*<Index>([^<]+)<\/Index>/)?.[1]);
    if (!Number.isFinite(index)) throw new Error(`class ${c.id} has no players texture`);
    for (const [src, dx] of [[sheet, 0], [mask, 8]]) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const si = ((index * 24 + y) * src.width + x) * 4, di = ((row * 8 + y) * W + dx + x) * 4;
        src.rgba.copy(rgba, di, si, si + 4);
      }
    }
    rows[c.id] = row;
  });
  const tex = TEXTILE_SIZES.map(n => {
    const s = sheets.get(`Embeds_textile${n}x${n}Embed_`);
    if (!s) throw new Error(`textile${n}x${n} not found in client.swf`);
    return [n, s];
  });
  const TW = Math.max(...tex.map(([, s]) => s.width)), TH = tex.reduce((h, [, s]) => h + s.height, 0);
  const trgba = Buffer.alloc(TW * TH * 4), textiles = {};
  let y0 = 0;
  for (const [n, s] of tex) {
    for (let y = 0; y < s.height; y++) s.rgba.copy(trgba, ((y0 + y) * TW) * 4, y * s.width * 4, (y + 1) * s.width * 4);
    textiles[n] = {y: y0, width: s.width, height: s.height};
    y0 += s.height;
  }
  // Which dye or cloth item gives each value: Tex1 items dye the clothing, Tex2 items the accessory.
  const items = {};
  for (const o of objects) {
    for (const [tag, part] of [['Tex1', 'clothing'], ['Tex2', 'accessory']]) {
      const v = o.body.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1];
      if (!v || !/<Item\s*\/>/.test(o.body)) continue;
      const tex = Number(v);
      if (!Number.isSafeInteger(tex) || tex === 0) continue;
      (items[tex] ??= {})[part] = o.type;
    }
  }
  return {
    rows,
    items,
    icons,
    dyes: {width: W, height: H, png: encodePng(W, H, rgba)},
    textiles: {width: TW, height: TH, sheets: textiles, png: encodePng(TW, TH, trgba)}
  };
}
