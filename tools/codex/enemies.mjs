// Builds the Enemies catalog: stats and projectiles from the server's objects.xml, drops
// from the server's own loot code (exported by loot_export.rs), sprites from the client.
import {parseElement} from '../tooltip.mjs';
import {encodePng} from './swf.mjs';

// Sprite sheets as the client registers them (AssetLoader.as). Static sheets are cut into
// tiles; animated sheets into blocks of frames, whose first frame is the standing pose.
// Two sheets have obfuscated names in this client build, so they are listed by name.
const STATIC = {
  lofiChar8x8: ['Embeds_lofiCharEmbed_', 8, 8], lofiChar16x8: ['Embeds_lofiCharEmbed_', 16, 8], lofiChar16x16: ['Embeds_lofiCharEmbed_', 16, 16],
  lofiChar28x8: ['Embeds_lofiChar2Embed_', 8, 8], lofiChar216x8: ['Embeds_lofiChar2Embed_', 16, 8], lofiChar216x16: ['Embeds_lofiChar2Embed_', 16, 16],
  lofiCharBig: ['_-hU', 16, 16], lofiObjBig: ['_-p1', 16, 16],
  lofiEnvironment: ['Embeds_lofiEnvironmentEmbed_', 8, 8], lofiEnvironment2: ['Embeds_lofiEnvironment2Embed_', 8, 8], lofiEnvironment3: ['Embeds_lofiEnvironment3Embed_', 8, 8],
  lofiObj: ['Embeds_lofiObjEmbed_', 8, 8], lofiObj2: ['Embeds_lofiObj2Embed_', 8, 8], lofiObj3: ['Embeds_lofiObj3Embed_', 8, 8],
  lofiObj4: ['Embeds_lofiObj4Embed_', 8, 8], lofiObj5: ['Embeds_lofiObj5Embed_', 8, 8], lofiObj6: ['Embeds_lofiObj6Embed_', 8, 8],
  lofiObj40x40: ['Embeds_lofiObj40x40Embed_', 40, 40]
};
const animated = file => {
  const m = file.match(/^chars(\d+)x(\d+)[rd]/);
  return m ? [`Embeds_${file}Embed_`, Number(m[1]), Number(m[2]), Number(m[1]) * 7, Number(m[2])] : null;
};

const kids = (e, tag) => e.children.filter(c => c.tag === tag);
const first = (e, tag) => kids(e, tag)[0];
const text = (e, tag) => first(e, tag)?.text ?? null;
const has = (e, tag) => kids(e, tag).length > 0;
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const range = (speed, life) => { const r = speed * life / 10000; return Math.trunc((r - Math.trunc(r)) * 10) === 0 ? Math.trunc(r) : Number(r.toFixed(1)); };

/**
 * @param objects  [{type, src}] every <Object> in objects.xml
 * @param loot     export from loot_export.rs ({drops: {kind: [items]}})
 * @param sheets   Map from swfBitmaps(client.swf)
 * @param isItem   (id) => true for items in the item catalog
 */
export function buildEnemies({objects, loot, sheets, isItem, warn = console.warn}) {
  const enemies = [];
  const sprites = [];
  const missingSheets = new Set();
  for (const o of objects) {
    const el = parseElement(o.src);
    const drops = (loot.drops[String(o.type)] ?? []).filter(isItem);
    const isEnemy = has(el, 'Enemy');
    if (!isEnemy && !drops.length) continue;
    if (has(el, 'Item')) continue;
    const display = text(el, 'DisplayId') || el.attrs.id;
    const projectiles = kids(el, 'Projectile').map(p => {
      const speed = num(text(p, 'Speed')) ?? 0, life = num(text(p, 'LifetimeMS')) ?? 0;
      const min = num(text(p, 'MinDamage')), max = num(text(p, 'MaxDamage')), dmg = num(text(p, 'Damage'));
      return {
        id: num(p.attrs.id) ?? 0,
        damage: dmg ?? (min !== null && max !== null ? (min === max ? min : [min, max]) : null),
        speed, lifetime: life, range: range(speed, life),
        size: num(text(p, 'Size')),
        flags: ['MultiHit', 'PassesCover', 'ArmorPiercing', 'Boomerang', 'Wavy', 'Parametric'].filter(f => has(p, f)),
        effects: kids(p, 'ConditionEffect').map(c => ({name: c.text, duration: num(c.attrs.duration)}))
      };
    });
    // First texture listed is the one the client shows by default.
    const tex = el.children.find(c => c.tag === 'Texture' || c.tag === 'AnimatedTexture');
    let sprite = null;
    if (tex) {
      const file = text(tex, 'File'), index = Number(text(tex, 'Index'));
      const spec = tex.tag === 'AnimatedTexture' ? animated(file) : STATIC[file] && [...STATIC[file], STATIC[file][1], STATIC[file][2]];
      const sheet = spec && sheets.get(spec[0]);
      if (file !== 'invisible' && (!spec || !sheet)) missingSheets.add(file);
      if (sheet && Number.isFinite(index)) {
        const [, w, h, bw, bh] = spec;
        const perRow = Math.floor(sheet.width / bw);
        const sx = (index % perRow) * bw, sy = Math.floor(index / perRow) * bh;
        if (sy + h <= sheet.height) sprites.push({type: o.type, sheet, sx, sy, w, h});
      }
    }
    enemies.push({
      id: o.type,
      name: display,
      internal: display !== el.attrs.id ? el.attrs.id : undefined,
      cls: text(el, 'Class'),
      group: text(el, 'Group'),
      hp: num(text(el, 'MaxHitPoints')),
      def: num(text(el, 'Defense')) ?? 0,
      level: num(text(el, 'Level')),
      size: num(text(el, 'Size')),
      flags: ['Quest', 'God', 'Hero', 'Encounter', 'StasisImmune', 'Flying', 'Oryx'].filter(f => has(el, f)),
      enemy: isEnemy,
      projectiles,
      drops
    });
  }
  if (missingSheets.size) warn(`Enemy sprites skipped, sheet not found in client.swf: ${[...missingSheets].join(', ')}`);

  // Pack every sprite into one sheet of 16px cells (40px for the one 40x40 sheet).
  const cell = Math.max(16, ...sprites.map(s => Math.max(s.w, s.h)));
  const cols = 32, rows = Math.ceil(sprites.length / cols) || 1;
  const W = cols * cell, H = rows * cell;
  const rgba = Buffer.alloc(W * H * 4);
  const byType = new Map();
  sprites.forEach((s, i) => {
    const dx = (i % cols) * cell, dy = Math.floor(i / cols) * cell;
    let opaque = false;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const si = ((s.sy + y) * s.sheet.width + s.sx + x) * 4, di = ((dy + y) * W + dx + x) * 4;
      s.sheet.rgba.copy(rgba, di, si, si + 4);
      if (s.sheet.rgba[si + 3]) opaque = true;
    }
    if (opaque) byType.set(s.type, {x: dx, y: dy, w: s.w, h: s.h});
  });
  for (const e of enemies) e.sprite = byType.get(e.id) ?? null;
  enemies.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return {enemies, sheet: {width: W, height: H, png: encodePng(W, H, rgba)}};
}

/** Item ids handed out directly in the world's loot code, to check none are missing from the export. */
export function literalDrops(sources) {
  const ids = new Set();
  for (const src of sources) {
    for (const [, list] of src.matchAll(/loot_bags\([^;]*?&\[([^\]]*)\]/g)) for (const [hex] of list.matchAll(/0x[0-9a-fA-F]+/g)) ids.add(parseInt(hex, 16));
    for (const [, hex] of src.matchAll(/rewards\.push\((0x[0-9a-fA-F]+)\)/g)) ids.add(parseInt(hex, 16));
    for (const [, list] of src.matchAll(/=>\s*Some\(\[([^\]]*)\]\)/g)) for (const [hex] of list.matchAll(/0x[0-9a-fA-F]+/g)) ids.add(parseInt(hex, 16));
  }
  return ids;
}
