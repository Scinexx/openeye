// First-find aura colours, taken from each rare UT's own sprite: its two most prominent
// colours (a, b) and its brightest highlight (s). Near-black outline pixels are ignored;
// mostly grey items (stone, bone) keep their greys.
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
// Lifts a colour so it reads as a glow on the dark site background.
function glow(rgb, minL = 0.55) {
  const [, , l] = hsl(rgb);
  if (l >= minL) return rgb;
  const k = (minL - l) / (1 - l);
  return rgb.map(v => v + (255 - v) * k);
}

export function spritePalette(sheet, x, y, size = 16) {
  const px = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const o = ((y + j) * sheet.width + x + i) * 4;
    if (sheet.rgba[o + 3] < 128) continue;
    const c = [sheet.rgba[o], sheet.rgba[o + 1], sheet.rgba[o + 2]];
    const [, , l] = hsl(c);
    if (l < 0.12) continue; // outline
    px.push(c);
  }
  if (!px.length) return null;
  const colourful = px.filter(c => { const [, s, l] = hsl(c); return s > 0.25 && l > 0.15 && l < 0.92; });
  const pool = colourful.length >= Math.max(3, px.length * 0.12) ? colourful : px;
  // Group by hue (or by lightness for greys) and rank groups by size.
  const groups = new Map();
  for (const c of pool) {
    const [h, s, l] = hsl(c);
    const key = s > 0.25 ? `h${Math.round(h / 24) % 15}` : `g${Math.round(l * 5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
  const mean = list => [0, 1, 2].map(k => list.reduce((n, c) => n + c[k], 0) / list.length);
  const a = mean(ranked[0]);
  const b = ranked[1] && ranked[1].length >= 2 ? mean(ranked[1]) : a.map(v => v + (255 - v) * 0.35);
  const s = px.reduce((best, c) => (hsl(c)[2] > hsl(best)[2] ? c : best), px[0]);
  return {a: hex(glow(a)), b: hex(glow(b, 0.6)), s: hex(glow(s, 0.8))};
}

/** {itemId: {a, b, s}} for every rare untiered item a player can obtain: notable, not common,
 *  and either dropped by something in the server's loot tables (dropRate) or sold in the shop.
 *  Event and admin items nobody can get have none. */
export function buildAuras(items, sheet) {
  const out = {};
  for (const it of items) {
    if (!it.untiered || !it.notable || it.commonUt || !it.sprite || !(it.dropRate > 0 || it.shop)) continue;
    const p = spritePalette(sheet, it.sprite.x, it.sprite.y);
    if (p) out[it.id] = p;
  }
  return out;
}
