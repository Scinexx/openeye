// OpenEye front end: a small single-page app with no dependencies.

// ---------- HTML helpers (everything interpolated is escaped unless wrapped in raw) ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = s => new Raw(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function h(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map(x => (x instanceof Raw ? x.s : esc(x))).join('') : v instanceof Raw ? v.s : esc(v);
    out += part + strings[i + 1];
  });
  return raw(out);
}

// ---------- data ----------
const cache = new Map();
async function get(path) {
  const res = await fetch(path, {cache: 'no-store'});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), {status: res.status});
  return data;
}
async function staticJson(path) {
  if (!cache.has(path)) cache.set(path, get(path));
  return cache.get(path);
}
let ITEMS, CLASSES, TOP_TIER;
async function loadCatalog() {
  const [items, classes] = await Promise.all([staticJson('/catalog/items.json'), staticJson('/catalog/classes.json')]);
  ITEMS = new Map(items.map(i => [i.id, i]));
  CLASSES = new Map(classes.map(c => [c.id, c]));
  TOP_TIER = {};
  // Best tier that can actually drop for each slot (from the server's loot tables).
  for (const i of items) if (i.topTier) TOP_TIER[i.slot] = i.tier;
}

// ---------- formatting ----------
const fmt = n => (n ?? 0).toLocaleString('en-US');
const BOARDS = {
  stars: {title: 'Stars', short: 'Stars', help: 'Class stars from each class’s best fame.'},
  base_fame: {title: 'Living fame', short: 'Living fame', help: 'Highest fame of a character that is still alive.'},
  fame_earned: {title: 'Fame earned', short: 'Fame earned', help: 'Every rise in living fame, added up. Living fame a player already had when tracking began counts as earned the day before.'},
  collection: {title: 'Collection', short: 'Collection', help: 'Different items personally looted from enemies.'},
  quests: {title: 'Quests', short: 'Quests', help: 'Assigned quests completed across all characters.'}
};
const STAT_NAMES = {0: 'HP', 3: 'MP', 20: 'ATT', 21: 'DEF', 22: 'SPD', 26: 'VIT', 27: 'WIS', 28: 'DEX'};
const SPANS = {week: 'This week', month: 'This month', all: 'All time'};

function ago(ts) {
  if (!ts) return 'unknown';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return 'just now';
  const units = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, u] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? 's' : ''} ago`; }
}
const date = ts => (ts ? new Date(ts * 1000).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '');
const day = ts => (ts ? new Date(ts * 1000).toLocaleDateString(undefined, {dateStyle: 'medium'}) : '');
const when = ts => h`<time datetime="${new Date((ts ?? 0) * 1000).toISOString()}" title="${date(ts)}">${ago(ts)}</time>`;

function tierInfo(item) {
  if (!item) return {label: '', cls: ''};
  if (item.untiered) return {label: 'UT', cls: 'ut'};
  if (item.tier === null) return {label: '', cls: ''};
  // 'high' = the best tier that can drop in this slot (or above); every other tier is 'low'.
  return {label: `T${item.tier}`, cls: item.tier >= (TOP_TIER[item.slot] ?? 99) ? 'high' : 'low'};
}
function bag(item) {
  const t = tierInfo(item).cls;
  return t === 'ut' ? 'bag-ut' : t === 'high' ? 'bag-top' : '';
}

// ---------- sprites ----------
function itemSprite(id, scale = 2, {missing = false} = {}) {
  const it = ITEMS.get(id);
  const size = 16 * scale;
  if (!it?.sprite) return h`<span class="sprite none" ${it ? raw(`data-tip="${Number(id)}"`) : ''} style="width:${size}px;height:${size}px"></span>`;
  return h`<span class="sprite${missing ? ' missing' : ''}" data-tip="${id}" style="width:${size}px;height:${size}px;background-size:${320 * scale}px auto;background-position:-${it.sprite.x * scale}px -${it.sprite.y * scale}px"></span>`;
}
function itemSlot(id, scale = 2, opts = {}) {
  const size = 16 * scale;
  if (id === -1 || id === null || id === undefined) return h`<span class="slot empty-slot" title="Empty slot"><span style="width:${size}px;height:${size}px;display:inline-block"></span></span>`;
  const it = ITEMS.get(id);
  const t = tierInfo(it);
  const title = it ? `${it.name}${t.label ? ` (${t.label})` : ''}` : `Unknown item ${id}`;
  return h`<a class="slot ${bag(it)}" href="/item/${id}" data-link aria-label="${title}">${itemSprite(id, scale, opts)}</a>`;
}
function classSprite(classId, size = 32) {
  const c = CLASSES.get(classId);
  if (!c) return h`<span class="sprite none" style="width:${size}px;height:${size}px"></span>`;
  return h`<img class="cls" src="/catalog/classes/${c.slug}.png" width="${size}" height="${size}" alt="${c.name}" title="${c.name}">`;
}
const className = id => CLASSES.get(id)?.name ?? 'Unknown class';
// Star colours and thresholds from the 2012 client (FameUtil.as): the colour steps up
// every <class count> stars, and a player with every star gets a plain white one.
const STAR_COLORS = ['#8a98de', '#314ddb', '#c1272d', '#f7931e', '#ffff00', '#ffffff'];
function starIcon(stars, size = 16) {
  if (stars === null || stars === undefined) return '';
  const tier = Math.min(5, Math.floor(stars / Math.max(1, CLASSES.size)));
  const label = `${fmt(stars)} star${stars === 1 ? '' : 's'}`;
  return h`<svg class="star" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${label}"><title>${label}</title><path fill="${STAR_COLORS[tier]}" stroke="#1b1e26" stroke-width="1.6" stroke-linejoin="round" d="M12 1.8l3.1 6.5 7.1.9-5.2 4.9 1.3 7-6.3-3.4-6.3 3.4 1.3-7-5.2-4.9 7.1-.9z"/></svg>`;
}
// The crown: whoever has earned the most fame in the last 24 hours. It replaces their star
// next to their name everywhere, and sits beside it on their profile.
let CROWN = null;
async function loadCrown() {
  try { CROWN = (await get('/api/crown')).name?.toLowerCase() ?? null; } catch { /* keep the last holder */ }
}
const crowned = name => !!CROWN && String(name ?? '').toLowerCase() === CROWN;
function crownIcon(stars, size = 16) {
  // Our own crown, filled with the same colour as the player's rank star.
  const tier = Math.min(5, Math.floor((stars ?? 0) / Math.max(1, CLASSES.size)));
  const label = 'Most fame earned in the last 24 hours';
  return h`<svg class="crown" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${label}"><title>${label}</title><path fill="${STAR_COLORS[tier]}" stroke="#1b1e26" stroke-width="1.6" stroke-linejoin="round" d="M2.5 7.5l5 4.5 4.5-8 4.5 8 5-4.5-1.8 12.5H4.3z"/><path fill="#1b1e26" fill-opacity=".28" d="M4 17.2h16l-.3 2.3H4.3z"/><circle cx="2.5" cy="7.2" r="1.5" fill="${STAR_COLORS[tier]}" stroke="#1b1e26" stroke-width="1.2"/><circle cx="12" cy="3.4" r="1.5" fill="${STAR_COLORS[tier]}" stroke="#1b1e26" stroke-width="1.2"/><circle cx="21.5" cy="7.2" r="1.5" fill="${STAR_COLORS[tier]}" stroke="#1b1e26" stroke-width="1.2"/></svg>`;
}
const rankIcon = (name, stars, size = 16, star = true) => (crowned(name) ? crownIcon(stars, size) : star ? starIcon(stars, size) : '');
const playerLink = (name, stars, {star = true} = {}) => h`<span class="player">${rankIcon(name, stars, 16, star)}<a href="/player/${encodeURIComponent(name)}" data-link>${name}</a></span>`;
// Bots have no player page, so their name is plain text with a badge.
const ownerLink = d => (d.is_bot ? h`<span class="who">${d.name} <span class="badge bot" title="A computer-controlled character run by the game server">Bot</span></span>` : playerLink(d.player ?? d.name, d.player_stars));
const discordIcon = id => (id ? h`<a class="discord" href="https://discord.com/users/${id}" rel="noopener" title="Discord account linked" aria-label="Discord profile"><svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path fill="#8b9cf7" d="M13.5 1A13 13 0 0 0 10.3 0l-.4.8a12 12 0 0 0-3.8 0L5.7 0a13 13 0 0 0-3.2 1C.4 4 0 7 .2 9.9A13 13 0 0 0 4.1 12l.8-1.3a8 8 0 0 1-1.3-.6l.3-.2a9 9 0 0 0 8.2 0l.3.2-1.3.6.8 1.3a13 13 0 0 0 3.9-2c.3-3.4-.5-6.3-2.3-8.9ZM5.4 8.3c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6Zm5.2 0c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6S12 5.8 12 6.7s-.6 1.6-1.4 1.6Z"/></svg></a>` : '');
const gear = (equipment, scale = 2, count = 4) => h`<span class="gear">${(equipment ?? []).slice(0, count).map(id => itemSlot(id, scale))}</span>`;

// ---------- in-game item tooltips ----------
// The text of each tooltip is built from the game data by tools/tooltip.mjs, which is a
// port of the 2012 client's EquipmentToolTip. This part only draws it the way the client
// does: same box, colours, sizes, spacing, icon treatment and mouse-following position.
const TIP = {data: null, el: null, for: null, sheet: null, icons: new Map()};
// The tooltip boxes are sized from their text, so wait for the tooltip font as well.
const loadTips = () => (TIP.data ??= Promise.all([
  staticJson('/catalog/tooltips.json'),
  ...['14px', '16px', '700 16px'].map(f => document.fonts?.load(`${f} "Tooltip Sans"`).catch(() => {}))
]).then(([tips]) => tips, () => { TIP.data = null; return {}; }));
const tipColor = c => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : '#b3b3b3');

// TextureRedrawer.redraw(): the sprite scaled up on a canvas with 12px of room around it,
// darkened towards the bottom (GlowRedrawer's gradient), given a 1px black outline at 80%
// (OUTLINE_FILTER) and a soft black shadow (GLOW_FILTER).
function gameTexture(img, sx, sy, w, h, scale) {
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const s = src.getContext('2d');
  s.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  const px = s.getImageData(0, 0, w, h).data;
  const W = w * scale + 24, H = h * scale + 24;
  const tex = new ImageData(W, H), d = tex.data;
  for (let y = 0; y < H; y++) {
    const g = Math.max(0, ((y + 0.5) / H * 255 - 127) / 128 * 0x28);
    for (let x = 0; x < W; x++) {
      const tx = Math.floor((x - 12) / scale), ty = Math.floor((y - 12) / scale);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const i = (ty * w + tx) * 4, o = (y * W + x) * 4;
      if (!px[i + 3]) continue;
      d[o] = Math.max(0, px[i] - g); d[o + 1] = Math.max(0, px[i + 1] - g); d[o + 2] = Math.max(0, px[i + 2] - g); d[o + 3] = px[i + 3];
    }
  }
  const solid = Uint8Array.from({length: W * H}, (_, i) => d[i * 4 + 3] > 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (solid[y * W + x]) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = x + dx >= 0 && x + dx < W && solid[(y + dy) * W + x + dx] === 1;
    if (near) d[(y * W + x) * 4 + 3] = 204;
  }
  const flat = document.createElement('canvas');
  flat.width = W; flat.height = H;
  flat.getContext('2d').putImageData(tex, 0, 0);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const c = out.getContext('2d');
  c.shadowColor = 'rgba(0,0,0,0.6)';
  c.shadowBlur = 7;
  c.drawImage(flat, 0, 0);
  return out;
}
const sheetReady = () => new Promise(resolve => {
  if (!TIP.sheet) { TIP.sheet = new Image(); TIP.sheet.src = '/catalog/items.png'; }
  if (TIP.sheet.complete && TIP.sheet.naturalWidth) resolve(TIP.sheet); else TIP.sheet.addEventListener('load', () => resolve(TIP.sheet), {once: true});
});
// An item drawn the way the client does: tooltips use size 60 (3x, cropped by 4px), inventory slots size 80 (4x).
async function itemTexture(item, scale) {
  const key = `${item.id}:${scale}`;
  if (!TIP.icons.has(key)) TIP.icons.set(key, gameTexture(await sheetReady(), item.sprite.x + 4, item.sprite.y + 4, 8, 8, scale));
  return TIP.icons.get(key);
}
async function tipIcon(canvas, item) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 40, 40);
  if (!item?.sprite) return;
  const icon = await itemTexture(item, 3);
  ctx.clearRect(0, 0, 40, 40);
  ctx.drawImage(icon, -4, -4);
}

const tipLines = lines => lines.map(line => h`<div>${line.length ? line.map(([text, color]) => (color ? h`<span style="color:${tipColor(color)}">${text}</span>` : text)) : raw('&#8203;')}</div>`);
const tipBreak = () => raw('<div class="itip-line" aria-hidden="true"><svg width="226" height="8" viewBox="0 0 226 8"><path d="M4 0l4 4-4 4-4-4zM222 0l4 4-4 4-4-4zM4 3h218v2H4z"/></svg></div>');

async function showTip(target, x, y) {
  TIP.for = target;
  if (!TIP.el) {
    TIP.el = document.createElement('div');
    TIP.el.className = 'itip';
    TIP.el.setAttribute('role', 'tooltip');
    document.body.append(TIP.el);
  }
  const el = TIP.el;
  // TextToolTip: a bold white title and a grey line, in the same box (used by the Nexus button).
  if (target.dataset.tipTitle) {
    el.innerHTML = String(h`<div class="itip-title itip-text">${target.dataset.tipTitle}</div><div class="itip-desc itip-text">${target.dataset.tipText ?? ''}</div>`);
    el.hidden = false;
    return moveTip(x, y);
  }
  const id = Number(target.dataset.tip);
  const tip = (await loadTips())[id];
  if (TIP.for !== target || !tip) return;
  el.innerHTML = String(h`
    <div class="itip-head"><canvas width="40" height="40"></canvas>
      <div class="itip-name"><div class="itip-title">${tip.t}</div>${tip.r ? h`<div class="itip-tier"${tip.r === 'UT' ? raw(' style="color:#8a2be2"') : ''}>${tip.r}</div>` : ''}</div></div>
    <div class="itip-desc">${tip.d}</div>
    ${tip.e.length ? h`${tipBreak()}<div class="itip-fx">${tipLines(tip.e)}</div>` : ''}
    ${tip.x.length ? h`${tipBreak()}<div class="itip-req">${tip.x.map(([text, color, bold]) => h`<div style="color:${tipColor(color)}${bold ? ';font-weight:700' : ''}">${text}</div>`)}</div>` : ''}`);
  tipIcon(el.querySelector('canvas'), ITEMS.get(id));
  el.hidden = false;
  // SimpleText.updateMetrics(): the title and description boxes grow by 4px for every line.
  for (const [sel, lh] of [['.itip-title', 19], ['.itip-desc', 17]]) {
    const box = el.querySelector(sel);
    box.style.height = '';
    const lines = Math.max(1, Math.round((box.getBoundingClientRect().height - 4) / lh));
    box.style.height = `${lines * (lh + 4)}px`;
  }
  // A title taller than the icon sticks out above it, and the box grows to fit.
  const name = el.querySelector('.itip-name');
  el.style.paddingTop = `${6 + Math.max(0, (name.offsetHeight - 40) / 2)}px`;
  moveTip(x, y);
}
// ToolTip.position(): right of the mouse on the left half of the screen, left of it on the
// right half; below it in the top third, above it otherwise; never closer than 12px to an edge.
function moveTip(mx, my) {
  const el = TIP.el;
  if (!el || el.hidden) return;
  const w = el.offsetWidth, hgt = el.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
  let x = mx < vw / 2 ? mx + 6 : mx - w - 7;
  let y = my < vh / 3 ? my + 6 : my - hgt - 7;
  x = Math.max(6, Math.min(x, vw - w - 6));
  y = Math.max(6, Math.min(y, vh - hgt - 6));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideTip() {
  TIP.for = null;
  if (TIP.el) TIP.el.hidden = true;
}
const tipTarget = node => {
  const el = node?.closest?.('.slot, [data-tip], [data-tip-title]');
  return el?.matches('[data-tip], [data-tip-title]') ? el : el?.querySelector('[data-tip]') ?? null;
};
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const t = tipTarget(e.target);
  if (t && t !== TIP.for) showTip(t, e.clientX, e.clientY);
});
document.addEventListener('pointermove', e => { if (TIP.for) moveTip(e.clientX, e.clientY); });
document.addEventListener('pointerout', e => {
  if (!TIP.for) return;
  const from = tipTarget(e.target), to = tipTarget(e.relatedTarget);
  if (from === TIP.for && to !== TIP.for) hideTip();
});
document.addEventListener('focusin', e => {
  const t = e.target.matches?.(':focus-visible') ? tipTarget(e.target) : null;
  if (!t) return;
  const r = t.getBoundingClientRect();
  showTip(t, r.right, r.bottom);
});
document.addEventListener('focusout', hideTip);
document.addEventListener('pointerdown', hideTip);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });

// ---------- small SVG charts ----------
function sparkline(points, {width = 220, height = 36} = {}) {
  if (points.length < 2) return '';
  const max = Math.max(1, ...points.map(p => p.v));
  const t0 = points[0].t, t1 = points.at(-1).t || t0 + 1;
  const xy = points.map(p => [((p.t - t0) / (t1 - t0 || 1)) * width, height - 2 - (p.v / max) * (height - 4)]);
  return h`<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${xy.map(p => p.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2" shape-rendering="crispEdges"/></svg>`;
}

function historyChart(history, key) {
  const W = 760, H = 240, L = 64, R = 12, T = 14, B = 34;
  if (history.length < 2) {
    const v = history[0]?.[key] ?? 0;
    return h`<p class="empty" style="padding-left:0">${BOARDS[key].title} has stayed at ${fmt(v)}${history[0] ? h` since ${day(history[0].at)}` : ''}. The graph appears once it changes.</p>`;
  }
  const nowTs = Math.floor(Date.now() / 1000);
  const pts = history.map(r => ({t: r.at, v: r[key]}));
  pts.push({t: Math.max(nowTs, pts.at(-1).t + 1), v: pts.at(-1).v});
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  const vmin = 0;
  const vmax = Math.max(vmin + 1, ...pts.map(p => p.v));
  const x = t => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = v => T + (1 - (v - vmin) / (vmax - vmin)) * (H - T - B);
  // Step line: values hold until the next observed change.
  let d = `M${x(pts[0].t)},${y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t)} V${y(pts[i].v)}`;
  const ticks = [...new Set([0, 0.5, 1].map(f => Math.round(vmin + (vmax - vmin) * f)))];
  return h`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${BOARDS[key].title} over time, from ${fmt(pts[0].v)} to ${fmt(pts.at(-1).v)}">
    ${ticks.map(v => h`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 10}" y="${y(v) + 6}" text-anchor="end">${fmt(v)}</text>`)}
    <path class="line" d="${d}"/>
    ${history.map(r => h`<circle class="dot" cx="${x(r.at)}" cy="${y(r[key])}" r="3"><title>${fmt(r[key])} on ${date(r.at)}</title></circle>`)}
    <text class="axis" x="${L}" y="${H - 8}">${day(t0)}</text>
    <text class="axis" x="${W - R}" y="${H - 8}" text-anchor="end">Now</text>
  </svg>`;
}

// ---------- views ----------
const main = document.getElementById('main');
const view = (html) => { main.innerHTML = String(html); };
const loading = () => view(h`<p class="loading">Loading…</p>`);

// ---- First-find auras ----
// Each rare UT glows in its own colours: the two most prominent colours of its sprite and its
// brightest highlight (built from the sprite sheet by tools/codex/auras.mjs). Common UTs get none.
let AURAS = {};
async function loadAuras() { AURAS = await staticJson('/catalog/auras.json').catch(() => ({})); }
function auraOf(id) {
  const it = ITEMS.get(id);
  return it && !it.commonUt ? AURAS[id] ?? null : null;
}
const auraStyle = t => (t ? `--aura-a:${t.a};--aura-b:${t.b};--aura-s:${t.s}` : '');
// A small effect per UT or matching set, themed on the item (colours still from its sprite).
const AURA_FX = {
  flame: {label: 'Flickering flames', items: ['Demon Blade']},
  bubbles: {label: 'Rising bubbles', items: ['Coral Bow', 'Coral Ring', 'Coral Silk Armor', 'Coral Venom Trap']},
  ghost: {label: 'Ghostly wisps', items: ["Captain's Ring", 'Spectral Cloth Armor', 'Spirit Dagger', 'Ghostly Prism', 'Doom Bow']},
  sand: {label: 'Drifting sand', items: ['Ring of the Sphinx', 'Ring of the Nile', 'Ring of the Pyramid']},
  lightning: {label: 'Crackling lightning', items: ['Quiver of Thunder', 'Scepter of Fulmination']},
  toxic: {label: 'Bubbling fumes', items: ['Experimental Ring', 'Robe of the Mad Scientist']},
  holy: {label: 'Holy light', items: ['Tome of Purification', 'Chasuble of Holy Light', 'Tome of Holy Protection']},
  glint: {label: 'Crystal glints', items: ['Crystal Sword', 'Crystal Wand']},
  stars: {label: 'Orbiting stars', items: ['Cloak of the Planewalker', 'Staff of Extreme Prejudice']},
  dust: {label: 'Falling stone dust', items: ['Ancient Stone Sword']},
  pentagon: {label: 'Five turning points', items: ['Seal of Blasphemous Prayer']},
  cubes: {label: 'Tumbling cubes', items: ['Dirk of Cronus']},
  conflict: {label: 'Opposing motes', items: ['Orb of Conflict']},
  ward: {label: 'Protective ward', items: ['Shield of Ogmur']},
  bulwark: {label: 'Warding runes', items: ['Wand of the Bulwark']},
  stomp: {label: 'Heavy stomp', items: ['Helm of the Juggernaut']},
  revive: {label: 'Rising soul light', items: ['Amulet of Resurrection']}
};
const FX_BY_NAME = new Map(Object.entries(AURA_FX).flatMap(([k, f]) => f.items.map(n => [n, k])));
const auraFx = id => FX_BY_NAME.get(ITEMS.get(id)?.name) ?? 'sparks';
const firstFind = (id, title = '') => h`<span class="first-find fx-${auraFx(id)}"${title ? raw(` title="${esc(title)}"`) : ''}>${itemSlot(id, 2)}${raw('<i class="p"></i>'.repeat(6))}</span>`;

// ---- Graves ----
// The gravestone a death leaves, by the server's rule (src/world.rs finish_death): with no
// base stat maxed, Gravestone 1/2/3 by level (1, under 20, 20); with n maxed, Gravestone
// 3 + n (1 to 6), 10 (7) or 11 (8). Stats come from the death record when the server sends
// them, otherwise from the character's last seen stats; unknown stats show a plain grave.
let GRAVES = null;
async function loadGraves() {
  if (!GRAVES) GRAVES = await staticJson('/catalog/graves.json').catch(() => ({sheet: {width: 0}, graves: {}}));
  return GRAVES;
}
function deathMaxed(d) {
  const max = CLASSES.get(d.class)?.max;
  if (!max || !Array.isArray(d.base_stats) || d.base_stats.length !== 8) return null;
  return [['hp'], ['mp'], ['att'], ['def'], ['spd'], ['dex'], ['vit'], ['wis']].filter(([k], i) => d.base_stats[i] >= max[k]).length;
}
function graveType(d) {
  const n = deathMaxed(d);
  if (n === null) return 0x725;
  if (n === 0) return d.level === 1 ? 0x723 : (d.level ?? 1) < 20 ? 0x724 : 0x725;
  return n === 7 ? 0x734 : n === 8 ? 0x735 : 0x725 + n;
}
function graveSprite(d, scale = 2) {
  const g = GRAVES?.graves?.[graveType(d)];
  if (!g) return '';
  return h`<span class="grave-sprite" role="img" aria-label="${g.name}" style="width:${g.w * scale}px;height:${g.h * scale}px;background-size:${GRAVES.sheet.width * scale}px auto;background-position:-${g.x * scale}px -${g.y * scale}px"></span>`;
}
const graveBadge = (d, scale = 2) => {
  const n = deathMaxed(d);
  return h`<span class="grave${n === 8 ? ' hl' : ''}" title="${n === null ? 'Stats at death unknown' : `${n} of 8 stats maxed`}">${graveSprite(d, scale)}<span>${n === null ? '?' : n}/8</span></span>`;
};

// ---- Page arrows ----
// Left and right buttons styled after the game's minimap zoom buttons, with a page counter;
// clicking the page number lets you type the page to go to.
const ARROW = dir => raw(`<svg viewBox="0 0 8 8" width="10" height="10" aria-hidden="true"><path d="${dir === 'left' ? 'M6 0 L6 8 L1 4 Z' : 'M2 0 L2 8 L7 4 Z'}" fill="currentColor"/></svg>`);
function mountPager(el, {pages, page = 1, onPage}) {
  let current = Math.min(Math.max(1, page), Math.max(1, pages));
  const draw = () => {
    el.hidden = pages <= 1;
    el.innerHTML = String(h`
      <button type="button" class="zoom-btn" data-step="-1" aria-label="Previous page" ${current <= 1 ? raw('disabled') : ''}>${ARROW('left')}</button>
      <span class="page-count"><button type="button" class="page-num" aria-label="Go to page">${current}</button><span class="muted"> / ${pages}</span></span>
      <button type="button" class="zoom-btn" data-step="1" aria-label="Next page" ${current >= pages ? raw('disabled') : ''}>${ARROW('right')}</button>`);
  };
  const go = n => {
    const next = Math.min(Math.max(1, Math.round(n) || 1), pages);
    if (next !== current) { current = next; onPage(current); }
    draw();
  };
  el.addEventListener('click', e => {
    const step = e.target.closest('[data-step]');
    if (step) return go(current + Number(step.dataset.step));
    const num = e.target.closest('.page-num');
    if (!num) return;
    const input = document.createElement('input');
    Object.assign(input, {type: 'number', min: 1, max: pages, value: current, className: 'page-input'});
    input.setAttribute('aria-label', `Page, 1 to ${pages}`);
    num.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = ok => { if (done) return; done = true; ok ? go(Number(input.value)) : draw(); };
    input.addEventListener('keydown', k => { if (k.key === 'Enter') finish(true); if (k.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  });
  draw();
}

function deathRows(rows, {showPlayer = true} = {}) {
  if (!rows.length) return h`<p class="empty">No deaths recorded yet.</p>`;
  return h`<ul class="rows">${rows.map(d => h`<li>
    ${classSprite(d.class, 32)}
    <span class="grow">
      <a class="title" href="/death/${d.account}/${d.char_id}" data-link>${showPlayer ? h`${d.is_bot ? starIcon(d.player_stars) : rankIcon(d.name, d.player_stars)}${d.name}` : `${d.level ? `Level ${d.level} ` : ''}${className(d.class)}`}</a>
      <span class="sub">${showPlayer ? `${className(d.class)}${d.level ? `, level ${d.level}` : ''}` : ''}${d.killed_by ? raw(`${showPlayer ? ', ' : ''}killed by <span class="killed">${esc(d.killed_by)}</span>`) : ''}${d.died_at ? raw(` ${when(d.died_at)}`) : ''}</span>
    </span>
    ${gear(d.equipment, 1)}
    ${graveBadge(d, 1)}
    <span class="num fame">${fmt(d.total_fame)}</span>
  </li>`)}</ul>`;
}

async function home() {
  const s = await get('/api/summary');
  const st = s.status.server;
  const online = st?.ok ? h`<span class="light on"></span>` : st ? h`<span class="light off"></span>` : h`<span class="light"></span>`;
  const dayPoints = s.status.day.filter(r => r.ok).map(r => ({t: r.at, v: r.players ?? 0}));
  const hasData = s.counts.players > 0;
  view(h`
    <section class="hero">
      <p>Rankings, ${s.status.features.characters ? 'living characters, ' : ''}item collections and every player death, recorded from the live Open RotMG server around the clock.</p>
    </section>
    ${!hasData ? h`<div class="notice"><strong>Fetching the latest data.</strong> This page fills in within a few minutes.</div>` : ''}
    <section class="panel fame-box" aria-labelledby="fame-box-title">
      <header><h2 id="fame-box-title"><img class="fame-icon" src="/icons/fame.png" width="24" height="24" alt="">Most fame earned today</h2><span>Last 24 hours</span></header>
      ${s.fameToday.length ? h`<ol class="fame-top">${s.fameToday.map((f, i) => h`<li>
        <span class="place">${i + 1}</span>
        ${playerLink(f.name, f.stars)}
        <span class="gain">+${fmt(f.fame)}</span>
      </li>`)}</ol>` : h`<p class="empty">Nobody has earned fame in the last 24 hours yet.</p>`}
    </section>
    <section class="panel status-strip" aria-label="Server status">
      ${online}
      <div class="stat"><strong>${st?.ok ? fmt(st.players) : '–'}</strong><span>${st?.ok ? 'playing now' : st ? 'server unreachable' : 'checking server'}</span></div>
      <div class="stat"><strong>${s.status.peak24h ?? '–'}</strong><span>24h peak</span></div>
      <div class="stat"><strong>${fmt(s.counts.players)}</strong><span>registered players</span></div>
      <div class="stat"><strong>${fmt(s.counts.distinctItems)}<span class="muted"> / ${fmt(s.counts.collectible)}</span></strong><span>items discovered</span></div>
      ${sparkline(dayPoints)}
    </section>
    <div class="grid-2">
      <section class="panel">
        <header><h2>Latest player deaths</h2><a href="/graveyard" data-link>Graveyard</a></header>
        ${deathRows(s.recentDeaths)}
      </section>
      <section class="panel">
        <header><h2>Latest loot</h2><a href="/items" data-link>All items</a></header>
        ${s.recentFinds.length ? h`<ul class="rows">${s.recentFinds.slice(0, 10).map(f => h`<li style="${f.first ? auraStyle(auraOf(f.item)) : ''}">
          ${f.first ? firstFind(f.item, 'First ever found on the server') : itemSlot(f.item, 2)}
          <span class="grow"><span class="title">${ITEMS.get(f.item)?.name ?? `Item ${f.item}`}</span>
          <span class="sub">${playerLink(f.name, f.stars)} ${when(f.found_at)}${f.first ? h` <span class="first-tag">First!</span>` : ''}</span></span>
          <span class="tier ${tierInfo(ITEMS.get(f.item)).cls}">${tierInfo(ITEMS.get(f.item)).label}</span>
        </li>`)}</ul>` : h`<p class="empty">No rare drops recorded yet.</p>`}
      </section>
    </div>
    <section class="panel" style="margin-top:24px">
      <header><h2>Top players</h2><a href="/rankings/stars" data-link>Full rankings</a></header>
      <div class="table-wrap"><table>
        <thead><tr>${Object.keys(BOARDS).map(b => h`<th><a href="/rankings/${b}" data-link>${BOARDS[b].title}</a></th>`)}</tr></thead>
        <tbody>${[0, 1, 2, 3, 4].map(i => h`<tr>${Object.keys(BOARDS).map(b => {
          const p = s.top[b][i];
          return p ? h`<td><span class="muted">${p.rank}.</span> ${playerLink(p.name, p.stars, {star: false})} <span class="${b.includes('fame') ? 'fame' : 'hl'}">${fmt(p[b])}</span></td>` : h`<td class="muted">–</td>`;
        })}</tr>`)}</tbody>
      </table></div>
    </section>`);
  if (!hasData) setTimeout(() => location.pathname === '/' && route(), 15000);
}

// Ranking tabs: the player boards, then Best characters.
const boardTabs = current => h`<nav class="tabs" aria-label="Ranking boards">${Object.entries(BOARDS).map(([k, b]) => h`<a href="/rankings/${k}" data-link ${k === current ? raw('aria-current="page"') : ''}>${b.title}</a>`)}<a href="/rankings/characters" data-link ${current === 'characters' ? raw('aria-current="page"') : ''}>Best characters</a></nav>`;

// Best characters: living characters of ranked players, by fame, by stats maxed (x/8, then
// fame) or by gear: the summed fame bonus % of the 4 equipped items, the same total the
// server pays out as "Well Equipped" on death.
const CHAR_SORTS = {
  fame: {title: 'Fame', help: 'Living characters by their current fame.'},
  maxed: {title: 'Maxed stats', help: 'Living characters by how many of their 8 stats are maxed, then by fame.'},
  gear: {title: 'Best gear', help: 'Living characters by the fame bonus of their equipment (the "Well Equipped" bonus paid on death), then by fame. Rarer gear carries a bigger bonus.'}
};
const gearBonus = equipment => (equipment ?? []).slice(0, 4).reduce((n, id) => n + (ITEMS.get(id)?.fameBonus ?? 0), 0);
async function bestCharacters() {
  const params = new URLSearchParams(location.search);
  const sort = CHAR_SORTS[params.get('sort')] ? params.get('sort') : 'fame';
  const dead = params.get('dead') === '1';
  const max20 = params.get('level') === '20';
  const [{characters}] = await Promise.all([get(`/api/characters${dead ? '?dead=1' : ''}`), loadGraves()]);
  const rows = characters.filter(c => !max20 || c.level >= 20).map(c => {
    const max = CLASSES.get(c.class)?.max;
    const known = max && Array.isArray(c.stats) && c.stats.length === 8;
    return {...c, maxed: known ? STAT_KEYS.filter(([k], i) => c.stats[i] >= max[k]).length : null, bonus: gearBonus(c.equipment)};
  });
  // Unknown stats (deaths from before stats were recorded) sort after every known count.
  const key = {fame: c => [c.fame], maxed: c => [c.maxed ?? -1, c.fame], gear: c => [c.bonus, c.fame]}[sort];
  rows.sort((a, b) => { const x = key(a), y = key(b); return (y[0] - x[0]) || ((y[1] ?? 0) - (x[1] ?? 0)) || (b.level ?? 0) - (a.level ?? 0) || a.char_id - b.char_id; });
  // Ties are broken by fame, then level, so every character gets its own rank.
  rows.forEach((c, i) => { c.rank = i + 1; });
  const link = changes => {
    const q = new URLSearchParams({...(sort !== 'fame' ? {sort} : {}), ...(dead ? {dead: '1'} : {}), ...(max20 ? {level: '20'} : {})});
    for (const [k, v] of Object.entries(changes)) { if (v === null) q.delete(k); else q.set(k, v); }
    const qs = q.toString();
    return `/rankings/characters${qs ? `?${qs}` : ''}`;
  };
  const draw = (filter = '') => {
    const f = filter.toLowerCase();
    const shown = rows.filter(c => c.name.toLowerCase().includes(f) || className(c.class).toLowerCase().includes(f));
    document.getElementById('char-body').innerHTML = String(shown.length ? h`${shown.map(c => h`<tr class="${c.rank === 1 ? 'top1' : ''}">
      <td class="rank">${c.rank}</td>
      <td>${dead ? h`<a class="who" href="/death/${c.account}/${c.char_id}" data-link>${classSprite(c.class, 32)} <span>${className(c.class)}</span></a>` : h`<span class="who">${classSprite(c.class, 32)} <span>${className(c.class)}</span></span>`}</td>
      <td>${playerLink(c.name, c.stars)}</td>
      <td class="n">${c.level ?? '–'}</td>
      <td class="n fame${sort === 'fame' ? ' main-metric' : ''}">${fmt(c.fame)}</td>
      <td class="n${sort === 'maxed' ? ' main-metric' : ''}${c.maxed === 8 ? ' hl' : ''}">${dead ? graveBadge({...c, base_stats: c.stats}, 1) : `${c.maxed ?? '?'}/8`}</td>
      <td class="n${sort === 'gear' ? ' main-metric' : ''}">${c.bonus ? `+${c.bonus}%` : '0%'}</td>
      <td>${gear(c.equipment, 2)}</td>
      ${dead ? h`<td>${c.died_at ? when(c.died_at) : ''}</td>` : ''}
    </tr>`)}` : h`<tr><td colspan="${dead ? 9 : 8}" class="empty">${rows.length ? `No characters match “${filter}”.` : max20 ? `No ${dead ? 'dead' : 'living'} level 20 characters yet.` : dead ? 'No player deaths yet.' : 'No living characters yet.'}</td></tr>`);
  };
  document.title = 'Best characters | OpenEye';
  view(h`
    <div class="page-head"><div><h1>Rankings</h1></div></div>
    ${boardTabs('characters')}
    <div class="controls">
      <nav class="tabs" style="margin:0" aria-label="Sort characters">${Object.entries(CHAR_SORTS).map(([k, o]) => h`<a href="${link({sort: k === 'fame' ? null : k})}" data-link ${k === sort ? raw('aria-current="page"') : ''}>${o.title}</a>`)}</nav>
      <label class="sr" for="char-filter">Filter characters</label><input id="char-filter" type="search" placeholder="Filter by player or class">
      <span class="muted">${fmt(rows.length)} ${dead ? 'dead' : 'living'}${max20 ? ' level 20' : ''} characters</span>
      <label class="check" style="margin-left:auto"><input type="checkbox" id="char-max20" ${max20 ? raw('checked') : ''}> Level 20</label>
      <nav class="tabs" style="margin:0" aria-label="Alive or dead">
        <a href="${link({dead: null})}" data-link ${!dead ? raw('aria-current="page"') : ''}>Alive</a>
        <a href="${link({dead: '1'})}" data-link ${dead ? raw('aria-current="page"') : ''}>Dead</a>
      </nav>
    </div>
    <section class="panel"><div class="table-wrap"><table class="chars-board">
      <thead><tr><th>Rank</th><th>Character</th><th>Player</th><th class="n">Level</th><th class="n"${sort === 'fame' ? raw(' aria-sort="descending"') : ''}>Fame</th><th class="n"${sort === 'maxed' ? raw(' aria-sort="descending"') : ''}>Maxed</th><th class="n"${sort === 'gear' ? raw(' aria-sort="descending"') : ''}>Gear bonus</th><th>Equipment</th>${dead ? h`<th>Died</th>` : ''}</tr></thead>
      <tbody id="char-body"></tbody>
    </table></div></section>`);
  draw();
  document.getElementById('char-filter').addEventListener('input', e => draw(e.target.value));
  document.getElementById('char-max20').addEventListener('change', e => navigate(link({level: e.target.checked ? '20' : null}), true));
}

async function rankings(board) {
  if (board === 'total_fame') return navigate('/rankings/fame_earned', true); // retired board
  if (board === 'characters') return bestCharacters();
  if (!BOARDS[board]) return notFound();
  const {players} = await get(`/api/rankings/${board}`);
  // Columns stay in the same order on every board; the selected one is highlighted.
  const cols = Object.keys(BOARDS);
  const draw = (filter = '') => {
    const rows = players.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
    document.getElementById('rank-body').innerHTML = String(rows.length ? h`${rows.map(p => h`<tr class="${p.rank === 1 ? 'top1' : ''}">
      <td class="rank">${p.rank}</td>
      <td><span class="who">${playerLink(p.name, p.stars)} ${discordIcon(p.discord_id)}</span></td>
      ${cols.map(c => h`<td class="n${c === board ? ' main-metric' : ''}${c.includes('fame') ? ' fame' : ''}">${fmt(p[c])}</td>`)}
    </tr>`)}` : h`<tr><td colspan="${cols.length + 2}" class="empty">No players match “${filter}”.</td></tr>`);
  };
  view(h`
    <div class="page-head"><div><h1>Rankings</h1></div></div>
    ${boardTabs(board)}
    <div class="controls"><label class="sr" for="rank-filter">Filter players</label><input id="rank-filter" type="search" placeholder="Filter by name"><span class="muted">${fmt(players.length)} ranked players</span></div>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Rank</th><th>Player</th>${cols.map(c => h`<th class="n"${c === board ? raw(' aria-sort="descending"') : ''}><a href="/rankings/${c}" data-link>${BOARDS[c].short}</a></th>`)}</tr></thead>
      <tbody id="rank-body"></tbody>
    </table></div></section>`);
  draw();
  document.getElementById('rank-filter').addEventListener('input', e => draw(e.target.value));
}

async function player(name) {
  let data;
  try { data = await get(`/api/player/${encodeURIComponent(name)}`); }
  catch (e) { if (e.status === 404) return notFound(e.message); throw e; }
  if (data.redirect) return navigate(`/player/${encodeURIComponent(data.redirect)}`, true);
  const [{collectible}] = await Promise.all([get('/api/items')]);
  const p = data.player;
  document.title = `${p.name} | OpenEye`;
  const found = new Map(data.collection.map(c => [c.item, c.found_at]));
  // Tier filter options: untiered, each tier that exists among collectible items, consumables.
  const tierKey = id => { const it = ITEMS.get(id); return !it ? 'other' : it.untiered ? 'ut' : it.tier !== null ? `t${it.tier}` : 'other'; };
  const tierNums = [...new Set(collectible.map(id => ITEMS.get(id)?.tier).filter(t => t !== null && t !== undefined))].sort((a, b) => a - b);
  const tierOptions = [['all', 'All tiers'], ['ut', 'Untiered'], ...tierNums.map(t => [`t${t}`, `Tier ${t}`]),
    ...(collectible.some(id => tierKey(id) === 'other') ? [['other', 'Consumables']] : [])];
  const formerNames = data.names.filter(n => n.name !== p.name);
  const legendsBySpan = data.legends;

  view(h`
    <div class="player-head">
      ${crowned(p.name) ? crownIcon(p.stars, 34) : ''}${starIcon(p.stars, 34)}
      <h1>${p.name}</h1>
      ${discordIcon(p.discord_id)}
      ${!p.listed ? h`<span class="badge">No longer on the hiscores</span>` : ''}
    </div>
    <div class="player-meta">
      <span>Tracked since ${day(p.first_seen)}</span>
      <span>Last updated ${when(p.last_seen)}</span>
      ${formerNames.length ? h`<span>Formerly ${formerNames.map(n => n.name).join(', ')}</span>` : ''}
    </div>
    <dl class="panel scoreboard">${Object.entries(BOARDS).map(([k, b]) => h`<div class="score">
      <dt>${b.title}</dt>
      <dd class="${k.includes('fame') ? 'fame' : k === 'stars' ? 'hl' : ''}">${fmt(p[k])}${k === 'collection' ? h`<span class="muted" style="font-size:1rem"> / ${collectible.length}</span>` : ''}</dd>
      <span class="rank-line">${data.ranks[k] ? h`<a href="/rankings/${k}" data-link>Rank ${data.ranks[k]}</a> of ${data.rankedPlayers}` : 'Unranked'}</span>
    </div>`)}</dl>
    ${data.features.characters || data.characters.length ? characterPanel(data.characters, p) : ''}
    ${legendsBySpan.length ? h`<section class="panel" style="margin-bottom:24px"><header><h2>On the Legends board</h2></header>
      <div class="panel-body legend-badges">${legendsBySpan.map(l => h`<a class="badge gold" href="/death/${p.account}/${l.char_id}" data-link>${SPANS[l.timespan]}: rank ${l.rank}, <span class="fame">${fmt(l.total_fame)}</span> fame</a>`)}</div></section>` : ''}
    <div class="grid-2">
      <section class="panel">
        <header><h2>Progress</h2></header>
        <div class="panel-body">
          <div class="tabs compact" role="group" aria-label="Chart metric">${Object.entries(BOARDS).map(([k, b], i) => h`<button type="button" data-metric="${k}" aria-pressed="${i === 0}">${b.short}</button>`)}</div>
          <div id="chart"></div>
          <p class="chart-readout">${data.history.filter(r => r.at >= p.first_seen).length} update${data.history.filter(r => r.at >= p.first_seen).length === 1 ? '' : 's'} since ${day(p.first_seen)}.</p>
          ${data.history.some(r => r.at < p.first_seen) ? h`<p class="estimate-note">Stats before ${new Date(p.first_seen * 1000).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})} are estimated from deaths, characters and loot dates.</p>` : ''}
        </div>
      </section>
      <section class="panel">
        <header><h2>Graveyard</h2><span class="muted">${fmt(data.deaths.length)} death${data.deaths.length === 1 ? '' : 's'}</span></header>
        <div id="death-page"></div>
        <div class="pager page-arrows" id="death-pager"></div>
      </section>
    </div>
    <section class="panel" style="margin-top:24px">
      <header><h2>Collection</h2><span class="muted">${found.size} of ${collectible.length} items</span></header>
      <div class="panel-body">
        <div class="controls">
          <label for="col-sort">Sort</label>
          <select id="col-sort"><option value="recent">Recently found</option><option value="slot">By slot</option><option value="missing">Missing first</option></select>
          <label for="col-tier">Tier</label>
          <select id="col-tier">${tierOptions.map(([v, label]) => h`<option value="${v}">${label}</option>`)}</select>
          <label><input type="checkbox" id="col-owned"> Only items found</label>
          <span class="muted" id="col-count"></span>
        </div>
        <div class="item-grid" id="col-grid"></div>
        <p class="muted" style="margin-top:12px">Dark silhouettes are items ${p.name} has not looted yet.</p>
      </div>
    </section>`);

  document.getElementById('pots-toggle')?.addEventListener('change', e => {
    showPotions = e.target.checked;
    main.querySelector('.chars')?.classList.toggle('potions', showPotions);
    try { localStorage.setItem('potionsToMax', showPotions ? '1' : '0'); } catch { /* storage unavailable */ }
  });

  // Fame earned is charted from its own record of gains rather than the hiscores history.
  let earned = 0;
  const earnedHistory = data.fameGains.map(g => ({at: g.at, fame_earned: (earned += g.amount)}));
  // The graph starts from 0, where the player's history begins.
  if (earnedHistory.length) earnedHistory.unshift({at: Math.min(data.history[0]?.at ?? Infinity, earnedHistory[0].at - 60), fame_earned: 0});
  const drawChart = key => { document.getElementById('chart').innerHTML = String(historyChart(key === 'fame_earned' ? earnedHistory : data.history, key)); };
  drawChart('stars');
  main.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => {
    main.querySelectorAll('[data-metric]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    drawChart(b.dataset.metric);
  }));

  const drawCollection = () => {
    const sort = document.getElementById('col-sort').value;
    const owned = document.getElementById('col-owned').checked;
    const tier = document.getElementById('col-tier').value;
    const inTier = collectible.filter(id => tier === 'all' || tierKey(id) === tier);
    let ids = inTier.filter(id => !owned || found.has(id));
    document.getElementById('col-count').textContent = tier === 'all' ? '' : `${inTier.filter(id => found.has(id)).length} of ${inTier.length} found`;
    const slotOf = id => ITEMS.get(id)?.slot ?? 99, tierOf = id => ITEMS.get(id)?.untiered ? 99 : ITEMS.get(id)?.tier ?? -1;
    if (sort === 'recent') ids.sort((a, b) => (found.get(b) ?? 0) - (found.get(a) ?? 0) || slotOf(a) - slotOf(b) || tierOf(a) - tierOf(b));
    if (sort === 'slot') ids.sort((a, b) => slotOf(a) - slotOf(b) || tierOf(a) - tierOf(b) || a - b);
    if (sort === 'missing') ids.sort((a, b) => Number(found.has(a)) - Number(found.has(b)) || slotOf(a) - slotOf(b) || tierOf(a) - tierOf(b));
    if (!ids.length) {
      document.getElementById('col-grid').innerHTML = String(h`<p class="muted" style="grid-column:1/-1">${owned ? 'No items found at this tier yet.' : 'No items at this tier.'}</p>`);
      return;
    }
    document.getElementById('col-grid').innerHTML = String(h`${ids.map(id => {
      const it = ITEMS.get(id);
      const title = `${it?.name ?? id}${found.has(id) ? `, found ${day(found.get(id))}` : ', not found yet'}`;
      return h`<a class="slot ${found.has(id) ? bag(it) : ''}" href="/item/${id}" data-link aria-label="${title}">${itemSprite(id, 2, {missing: !found.has(id)})}</a>`;
    })}`);
  };
  document.getElementById('col-sort').addEventListener('change', drawCollection);
  document.getElementById('col-owned').addEventListener('change', drawCollection);
  document.getElementById('col-tier').addEventListener('change', drawCollection);
  drawCollection();

  // Deaths, a page at a time.
  const PER = 6;
  const drawDeaths = n => { document.getElementById('death-page').innerHTML = String(deathRows(data.deaths.slice((n - 1) * PER, n * PER), {showPlayer: false})); };
  drawDeaths(1);
  mountPager(document.getElementById('death-pager'), {pages: Math.ceil(data.deaths.length / PER), onPage: drawDeaths});
}

// Living characters (published by the game server since OpenRotMG PR #624).
// Stats are base stats, shown against the class maximum like the in-game "x/8".
const STAT_KEYS = [['hp', 'HP'], ['mp', 'MP'], ['att', 'ATT'], ['def', 'DEF'], ['spd', 'SPD'], ['dex', 'DEX'], ['vit', 'VIT'], ['wis', 'WIS']];
// The stat potion for each stat and how much one adds (objects.xml IncrementStat: Life and
// Mana +5, the rest +1). The server stops a potion at the class cap, so the potions still
// needed are ceil((class max - base) / amount).
const STAT_POTIONS = [[2793, 5], [2794, 5], [2591, 1], [2592, 1], [2593, 1], [2636, 1], [2612, 1], [2613, 1]];
// Equipment stat bonuses (ActivateOnEquip IncrementStat). Stat ids as in the game: MaxHP 0,
// MaxMP 3, Attack 20, Defense 21, Speed 22, Dexterity 28, Vitality 26, Wisdom 27.
const STAT_IDS = [0, 3, 20, 21, 22, 28, 26, 27];
const gearBoosts = equipment => STAT_IDS.map(id => (equipment ?? []).reduce((sum, item) =>
  sum + (ITEMS.get(item)?.bonuses ?? []).filter(b => b.stat === id).reduce((n, b) => n + b.amount, 0), 0));
const potionsLeft = (c, max) => STAT_KEYS.map(([k], i) => Math.max(0, Math.ceil((max[k] - c.stats[i]) / STAT_POTIONS[i][1])));
let showPotions = false;
try { showPotions = localStorage.getItem('potionsToMax') === '1'; } catch { /* storage unavailable */ }
function characterPanel(chars, p) {
  return h`<section class="panel chars${showPotions ? ' potions' : ''}" style="margin-bottom:24px">
    <header><h2>Characters${chars.length ? h` <span class="muted count">${chars.length} alive</span>` : ''}</h2>
      ${chars.length ? h`<label class="check pot-toggle"><input type="checkbox" id="pots-toggle" ${showPotions ? raw('checked') : ''}> Toggle potions to max</label>` : ''}</header>
    ${chars.length ? h`<div class="table-wrap"><table>
      <thead><tr><th>Character</th><th class="n">Level</th><th class="n">Fame</th><th>Equipment</th><th class="n">Maxed</th><th><span class="stat-val">Stats</span><span class="pot-val">Potions to max</span></th></tr></thead>
      <tbody>${chars.map(c => {
        const max = CLASSES.get(c.class)?.max;
        const left = max ? potionsLeft(c, max) : null;
        const boost = gearBoosts(c.equipment);
        const maxed = left ? left.filter(n => n === 0).length : null;
        return h`<tr>
          <td class="c-who"><span class="who">${classSprite(c.class, 40)} <span>${className(c.class)}${c.created_at ? h`<span class="sub">Created ${day(c.created_at)}</span>` : ''}</span></span></td>
          <td class="n c-level" data-label="Level">${c.level}</td>
          <td class="n fame main-metric c-fame" data-label="Fame">${fmt(c.fame)}</td>
          <td class="c-gear">${gear(c.equipment, 2)}</td>
          <td class="n c-maxed${maxed === 8 ? ' hl' : ''}" data-label="Maxed">${maxed === null ? '–' : `${maxed}/8`}</td>
          <td class="c-stats"><span class="char-stats">${STAT_KEYS.map(([k, label], i) => {
            // As in the client's StatView: total with the gear bonus in brackets, gold when the
            // base stat is maxed, else green for a bonus and red for a penalty.
            const total = c.stats[i] + boost[i];
            const shown = boost[i] ? `${total} (${boost[i] > 0 ? '+' : ''}${boost[i]})` : String(total);
            const tone = boost[i] > 0 ? 'boosted' : boost[i] < 0 ? 'lowered' : '';
            if (!max) return h`<span class="${tone}"><b>${label}</b>${shown}</span>`;
            const done = left[i] === 0;
            const pot = ITEMS.get(STAT_POTIONS[i][0]);
            return h`<span class="${done ? 'maxed' : tone}">
              <span class="stat-val" title="${label} ${c.stats[i]} of ${max[k]}${boost[i] ? `, ${boost[i] > 0 ? '+' : ''}${boost[i]} from equipment` : ''}"><b>${label}</b>${shown}</span>
              <span class="pot-val" title="${done ? `${label} is maxed` : `${left[i]} ${pot?.name ?? 'potion'}${left[i] === 1 ? '' : 's'} to max ${label} (${max[k] - c.stats[i]} more)`}"><b>${label}</b>${left[i]}</span>
            </span>`;
          })}</span></td>
        </tr>`;
      })}</tbody>
    </table></div>` : h`<p class="empty">${p.name} has no living characters right now.</p>`}
  </section>`;
}

async function graveyard() {
  const params = new URLSearchParams(location.search);
  const st = {
    page: Number(params.get('page')) || 1,
    sort: params.get('sort') === 'fame' ? 'fame' : 'recent',
    cls: Number(params.get('class')) || 0,
    q: (params.get('q') ?? '').trim().slice(0, 20)
  };
  const qs = (changes = {}) => {
    const s = {...st, ...changes};
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.sort !== 'recent') p.set('sort', s.sort);
    if (s.cls) p.set('class', s.cls);
    if (s.page > 1) p.set('page', s.page);
    return p.toString();
  };
  const link = changes => { const s = qs(changes); return `/graveyard${s ? `?${s}` : ''}`; };
  const load = () => get(`/api/graveyard?${qs({page: st.page || 1})}`);

  const draw = g => {
    const pages = Math.max(1, Math.ceil(g.total / g.per));
    const counts = new Map(g.byClass.map(c => [c.class, c.n]));
    document.getElementById('gy-filters').innerHTML = String(h`
      <nav class="tabs" style="margin:0" aria-label="Sort">
        <a href="${link({sort: 'recent', page: 1})}" data-link ${st.sort === 'recent' ? raw('aria-current="page"') : ''}>Most recent</a>
        <a href="${link({sort: 'fame', page: 1})}" data-link ${st.sort === 'fame' ? raw('aria-current="page"') : ''}>Most fame</a>
      </nav>
      <div class="class-filter tabs" style="margin:0" aria-label="Filter by class">
        <a href="${link({cls: 0, page: 1})}" data-link ${!st.cls ? raw('aria-current="page"') : ''}>All</a>
        ${[...CLASSES.values()].map(c => h`<a href="${link({cls: c.id, page: 1})}" data-link ${st.cls === c.id ? raw('aria-current="page"') : ''} title="${c.name}: ${counts.get(c.id) ?? 0} deaths" style="padding:4px 6px;line-height:0">${classSprite(c.id, 24)}</a>`)}
      </div>`);
    document.getElementById('gy-body').innerHTML = String(g.rows.length ? h`${g.rows.map(d => h`<tr>
      <td><a class="who" href="/death/${d.account}/${d.char_id}" data-link>${classSprite(d.class, 32)} <span>${d.level ? `Level ${d.level} ` : ''}${className(d.class)}</span>${d.in_legends ? h`<span class="badge gold legend-tag" data-tip-title="Legend" data-tip-text="On a Legends board right now">Legend</span>` : ''}</a></td>
      <td>${ownerLink(d)}</td>
      <td class="n main-metric fame">${fmt(d.total_fame)}</td>
      <td>${graveBadge(d, 2)}</td>
      <td>${gear(d.equipment, 1)}</td>
      <td class="killed">${d.killed_by ?? ''}</td>
      <td>${d.died_at ? when(d.died_at) : h`<span class="muted">Loading</span>`}</td>
    </tr>`)}` : h`<tr><td colspan="7" class="empty">${st.q ? `No deaths match “${st.q}”${st.cls ? ` for ${className(st.cls)}` : ''}.` : `No deaths recorded${st.cls ? ` for ${className(st.cls)}` : ''} yet.`}</td></tr>`);
    document.getElementById('gy-pager').innerHTML = String(h`
      <span class="muted">${fmt(g.total)} death${g.total === 1 ? '' : 's'}, page ${Math.min(st.page, pages)} of ${pages}</span>
      ${st.page > 1 ? h`<a class="btn" href="${link({page: st.page - 1})}" data-link>Previous</a>` : ''}
      ${st.page < pages ? h`<a class="btn" href="${link({page: st.page + 1})}" data-link>Next</a>` : ''}`);
  };

  const [first] = await Promise.all([load(), loadGraves()]);
  view(h`
    <div class="page-head"><div><h1>Graveyard</h1><p>Every player death on the server, newest first</p></div></div>
    <div class="controls">
      <label class="sr" for="gy-search">Search by name</label>
      <input id="gy-search" type="search" placeholder="Search by name" maxlength="20" autocomplete="off" value="${st.q}">
    </div>
    <div class="controls" id="gy-filters"></div>
    <section class="panel">
      <div class="table-wrap"><table>
        <thead><tr><th>Character</th><th>Player</th><th class="n">Fame</th><th>Grave</th><th>Equipment</th><th>Killed by</th><th>Died</th></tr></thead>
        <tbody id="gy-body"></tbody>
      </table></div>
      <div class="pager" id="gy-pager"></div>
    </section>`);
  draw(first);

  // Typing refreshes the list in place, keeping the URL shareable.
  let seq = 0, timer = null;
  const refresh = async () => {
    const mine = ++seq;
    history.replaceState(null, '', link({}));
    const g = await load();
    if (mine === seq && location.pathname === '/graveyard') draw(g);
  };
  document.getElementById('gy-search').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { st.q = e.target.value.trim().slice(0, 20); st.page = 1; refresh(); }, 250);
  });
}

async function death(account, charId) {
  let data;
  try { [data] = await Promise.all([get(`/api/death/${account}/${charId}`), loadGraves()]); }
  catch (e) { if (e.status === 404) return notFound(e.message); throw e; }
  const d = data.death, s = d.stats;
  document.title = `${d.name}'s ${className(d.class)} | OpenEye`;
  const acc = s && s.shots ? `${Math.round((s.shotsThatDamage / s.shots) * 100)}%` : '–';
  const dungeons = s ? [['Pirate Caves', s.pirateCaves], ['Spider Dens', s.spiderDens], ['Snake Pits', s.snakePits], ['Undead Lairs', s.undeadLairs], ['Abysses of Demons', s.abysses], ['Sprite Worlds', s.spriteWorlds], ['Tombs of the Ancients', s.tombs]] : [];
  view(h`
    <div class="page-head"><div>
      <h1>${d.name}’s ${className(d.class)}</h1>
      <p>${d.died_at ? h`${d.level ? `Level ${d.level} ` : ''}${className(d.class)} who died ${date(d.died_at)}${d.killed_by ? h`, killed by <span class="killed">${d.killed_by}</span>` : ''}.` : 'Full details for this death are still loading. Check back in a few minutes.'}</p>
    </div></div>
    <section class="panel"><div class="panel-body tombstone">
      <div>${classSprite(d.class, 96)}</div>
      <div class="stack" style="gap:16px">
        <div class="death-head-line"><span><span class="fame-total">${fmt(d.total_fame)}</span> <span class="muted">total fame</span></span>${graveBadge(d, 3)}</div>
        <div>${gear(d.equipment, 3, 4)}</div>
        ${d.equipment.slice(4).some(i => i !== -1) ? h`<div><span class="muted">Inventory</span><div style="margin-top:6px">${gear(d.equipment.slice(4), 2, 8)}</div></div>` : ''}
        <p class="muted">${d.is_bot ? 'Bot' : 'Player'}: ${ownerLink(d)}${data.legends.length ? h`. On the Legends board: ${data.legends.map(l => `${SPANS[l.timespan]} rank ${l.rank}`).join(', ')}` : ''}.</p>
      </div>
    </div></section>
    ${s ? h`<div class="grid-2" style="margin-top:24px">
      <section class="panel"><header><h2>Fame breakdown</h2></header>
        <ul class="rows">
          <li><span class="grow">Base fame</span><span class="num">${fmt(d.base_fame)}</span></li>
          ${(d.bonuses ?? []).map(b => h`<li><span class="grow"><span class="title">${b.id}</span><span class="sub">${b.desc}</span></span><span class="num fame">+${fmt(b.amount)}</span></li>`)}
          <li><span class="grow"><strong>Total</strong></span><span class="num fame">${fmt(d.total_fame)}</span></li>
        </ul>
      </section>
      <section class="panel"><header><h2>Lifetime stats</h2></header>
        <dl class="kv">
          ${[['Shots fired', fmt(s.shots)], ['Accuracy', acc], ['Tiles uncovered', fmt(s.tilesUncovered)], ['Monsters killed', fmt(s.monsterKills)],
            ['Gods killed', fmt(s.godKills)], ['Oryx kills', fmt(s.oryxKills)], ['Quests completed', fmt(s.questsCompleted)], ['Level-up assists', fmt(s.levelUpAssists)]]
            .map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}
        </dl>
      </section>
      <section class="panel"><header><h2>Dungeons cleared</h2></header>
        <dl class="kv">${dungeons.map(([k, v]) => h`<div><dt>${k}</dt><dd>${fmt(v)}</dd></div>`)}</dl>
      </section>
    </div>` : ''}`);
}

// Legends board: "Players only" (ours, bots never) or "Vanilla" (the game's own list,
// bots included). Kept in the address and remembered per browser.
let legendsBoard = 'players';
try { if (localStorage.getItem('legendsBoard') === 'vanilla') legendsBoard = 'vanilla'; } catch { /* storage unavailable */ }
async function legends(span) {
  if (!SPANS[span]) return notFound();
  const asked = new URLSearchParams(location.search).get('board');
  if (asked === 'vanilla' || asked === 'players') {
    legendsBoard = asked;
    try { localStorage.setItem('legendsBoard', asked); } catch { /* storage unavailable */ }
  }
  const board = legendsBoard;
  const at = (s, b) => `/legends/${s}?board=${b}`;
  const l = await get(`/api/legends/${span}${board === 'vanilla' ? '?board=vanilla' : ''}`);
  view(h`
    <div class="page-head legends-head"><div><h1>Legends</h1><p>${board === 'vanilla'
      ? 'The game’s own Legends board, exactly as on Open RotMG, bots included.'
      : l.source === 'graveyard'
      ? `The ${l.size} highest-fame player deaths, ranked from every death on the server. Bots are never included.`
      : 'The highest-fame player deaths recorded so far, bots never included. Until the game shares every death, only deaths that reached its Legends board count.'} Updated ${l.updated ? ago(l.updated) : 'soon'}.</p></div></div>
    <div class="controls legends-controls">
      <nav class="tabs" style="margin:0" aria-label="Period">${Object.entries(SPANS).map(([k, t]) => h`<a href="${at(k, board)}" data-link ${k === span ? raw('aria-current="page"') : ''}>${t}</a>`)}</nav>
      <nav class="tabs" style="margin:0 0 0 auto" aria-label="Board">
        <a href="${at(span, 'vanilla')}" data-link ${board === 'vanilla' ? raw('aria-current="page"') : ''} title="The game’s own board, bots included">Vanilla</a>
        <a href="${at(span, 'players')}" data-link ${board === 'players' ? raw('aria-current="page"') : ''} title="Only players, never bots">Players only</a>
      </nav>
    </div>
    <section class="panel"><div class="table-wrap"><table class="legends-table">
      <colgroup><col class="c-rank"><col class="c-char"><col class="c-player"><col class="c-fame"><col class="c-gear"><col class="c-killer"><col class="c-died"></colgroup>
      <thead><tr><th>Rank</th><th>Character</th><th>Player</th><th class="n">Fame</th><th>Equipment</th><th>Killed by</th><th>Died</th></tr></thead>
      <tbody>${l.rows.length ? l.rows.map(d => h`<tr class="${d.rank === 1 ? 'top1' : ''}">
        <td class="rank">${d.rank}</td>
        <td><a class="who" href="/death/${d.account}/${d.char_id}" data-link>${classSprite(d.class, 32)} ${d.level ? `Level ${d.level} ` : ''}${className(d.class)}</a></td>
        <td>${ownerLink(d)}</td>
        <td class="n main-metric fame">${fmt(d.total_fame)}</td>
        <td>${gear(d.equipment, 2)}</td>
        <td class="killed" title="${d.killed_by ?? ''}">${d.killed_by ?? ''}</td>
        <td>${d.died_at ? when(d.died_at) : ''}</td>
      </tr>`) : h`<tr><td colspan="7" class="empty">${board === 'vanilla' ? 'No deaths on this board yet.' : 'No player deaths on this board yet.'}</td></tr>`}</tbody>
    </table></div></section>`);
}

// ---------- loot history ----------
const LOOT_TYPE = [['weapon', 'Weapons'], ['ability', 'Abilities'], ['armor', 'Armor'], ['ring', 'Rings'], ['consumable', 'Consumables']];
const LOOT_DAYS = [['0', 'All time'], ['30', 'Last 30 days'], ['7', 'Last 7 days'], ['1', 'Last 24 hours']];

async function loot() {
  // Tier toggles: UT plus every tier that appears among collectible items.
  const {collectible} = await get('/api/items');
  const LOOT_TIER = [['ut', 'UT'], ...[...new Set(collectible.map(id => ITEMS.get(id))
    .filter(it => it && !it.untiered && it.tier !== null && it.slot !== 10).map(it => it.tier))]
    .sort((a, b) => a - b).map(t => [String(t), `T${t}`])];
  const params = new URLSearchParams(location.search);
  const listFrom = (name, all) => {
    const raw = params.get(name);
    return new Set(raw === null ? all.map(([v]) => v) : raw.split(',').filter(v => all.some(([a]) => a === v)));
  };
  const state = {
    tier: listFrom('tier', LOOT_TIER),
    type: listFrom('type', LOOT_TYPE),
    common: params.get('common') !== '0',
    days: LOOT_DAYS.some(([v]) => v === params.get('days')) ? params.get('days') : '0',
    player: params.get('player') ?? '',
    item: params.get('item') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1)
  };
  const box = (group, value, label, checked) =>
    h`<label class="check"><input type="checkbox" data-group="${group}" value="${value}" ${checked ? raw('checked') : ''}> ${label}</label>`;
  view(h`
    <div class="page-head"><div><h1>Loot</h1><p>Every item players have looted, newest first.</p></div></div>
    <p class="notice">Only the first time each player obtains an item is recorded. Finding the same item again does not add a new entry.</p>
    <div class="loot-layout">
      <form class="panel loot-filters" id="loot-filters" aria-label="Filters">
        <header><h2>Filters</h2><a href="/loot" data-link>Reset</a></header>
        <div class="panel-body stack" style="gap:18px">
          <fieldset><legend>Item</legend>
            <label class="sr" for="loot-item">Item name</label>
            <input id="loot-item" type="search" placeholder="Any item" maxlength="40" spellcheck="false" value="${state.item}">
          </fieldset>
          <fieldset><legend>Tier <span class="legend-links"><button type="button" data-tiers="all">All</button><button type="button" data-tiers="none">None</button></span></legend>
            <div class="chips" style="grid-template-columns:repeat(${Math.ceil(LOOT_TIER.length / 2)}, 1fr)">${LOOT_TIER.map(([v, l]) => h`<label class="chip"><input type="checkbox" data-group="tier" value="${v}" ${state.tier.has(v) ? raw('checked') : ''}><span>${l}</span></label>`)}</div>
            ${box('common', '1', 'Include common UTs', state.common)}
          </fieldset>
          <fieldset><legend>Type</legend>${LOOT_TYPE.map(([v, l]) => box('type', v, l, state.type.has(v)))}</fieldset>
          <fieldset><legend>When</legend>
            <label class="sr" for="loot-days">Time range</label>
            <select id="loot-days">${LOOT_DAYS.map(([v, l]) => h`<option value="${v}" ${v === state.days ? raw('selected') : ''}>${l}</option>`)}</select>
          </fieldset>
          <fieldset><legend>Player</legend>
            <label class="sr" for="loot-player">Player name</label>
            <input id="loot-player" type="search" placeholder="Any player" maxlength="20" spellcheck="false" value="${state.player}">
          </fieldset>
        </div>
      </form>
      <section class="panel" id="loot-results" aria-live="polite"><p class="loading" style="padding:24px 16px">Loading…</p></section>
    </div>`);

  const form = document.getElementById('loot-filters');
  const query = () => {
    const q = new URLSearchParams();
    if (state.tier.size !== LOOT_TIER.length) q.set('tier', [...state.tier].join(','));
    if (state.type.size !== LOOT_TYPE.length) q.set('type', [...state.type].join(','));
    if (!state.common) q.set('common', '0');
    if (state.days !== '0') q.set('days', state.days);
    if (state.item.trim()) q.set('item', state.item.trim());
    if (state.player.trim()) q.set('player', state.player.trim());
    if (state.page > 1) q.set('page', state.page);
    return q.toString();
  };
  let seq = 0;
  const load = async () => {
    const qs = query();
    history.replaceState({}, '', `/loot${qs ? `?${qs}` : ''}`);
    const mine = ++seq;
    const results = document.getElementById('loot-results');
    if (!state.type.size) {
      results.innerHTML = String(h`<p class="empty">Pick at least one item type.</p>`);
      return;
    }
    let d;
    try { d = await get(`/api/loot${qs ? `?${qs}` : ''}`); }
    catch { if (mine === seq) results.innerHTML = String(h`<p class="empty">Loot could not load. Try again in a moment.</p>`); return; }
    if (mine !== seq) return;  // a newer filter change is already loading
    const pages = Math.max(1, Math.ceil(d.total / d.per));
    results.innerHTML = String(h`
      <header><h2>${fmt(d.total)} ${d.total === 1 ? 'item' : 'items'}</h2><span class="muted">${pages > 1 ? `Page ${d.page} of ${pages}` : ''}</span></header>
      ${d.rows.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>Item</th><th>Tier</th><th>Type</th><th>Player</th><th>Found</th></tr></thead>
        <tbody>${d.rows.map(f => {
          const it = ITEMS.get(f.item), t = tierInfo(it);
          return h`<tr>
            <td><span class="who">${itemSlot(f.item, 1)}<a href="/item/${f.item}" data-link>${it?.name ?? `Item ${f.item}`}</a></span></td>
            <td><span class="tier ${t.cls}">${t.label || '–'}</span></td>
            <td class="muted">${it?.slotName ?? ''}</td>
            <td>${playerLink(f.name, f.stars)}</td>
            <td>${when(f.found_at)}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      <div class="pager">
        ${d.page > 1 ? h`<button class="btn" type="button" data-page="${d.page - 1}">Previous</button>` : ''}
        ${d.page < pages ? h`<button class="btn" type="button" data-page="${d.page + 1}">Next</button>` : ''}
      </div>` : h`<p class="empty">No loot matches these filters.</p>`}`);
    results.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => {
      state.page = Number(b.dataset.page);
      load();
      results.scrollIntoView({block: 'start'});
    }));
  };

  form.addEventListener('submit', e => e.preventDefault());
  form.querySelectorAll('[data-tiers]').forEach(b => b.addEventListener('click', () => {
    const on = b.dataset.tiers === 'all';
    state.tier = new Set(on ? LOOT_TIER.map(([v]) => v) : []);
    form.querySelectorAll('[data-group="tier"]').forEach(c => { c.checked = on; });
    state.page = 1;
    load();
  }));
  form.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.group === 'tier' || el.dataset.group === 'type') {
      state[el.dataset.group][el.checked ? 'add' : 'delete'](el.value);
    } else if (el.dataset.group === 'common') {
      state.common = el.checked;
    } else if (el.id === 'loot-days') {
      state.days = el.value;
    } else return;
    state.page = 1;
    load();
  });
  let typing;
  for (const [id, key] of [['loot-player', 'player'], ['loot-item', 'item']]) {
    document.getElementById(id).addEventListener('input', e => {
      clearTimeout(typing);
      typing = setTimeout(() => { state[key] = e.target.value; state.page = 1; load(); }, 300);
    });
  }
  load();
}

async function items() {
  const data = await get('/api/items');
  const owners = new Map(data.owners.map(o => [o.item, o]));
  const list = data.collectible.map(id => ITEMS.get(id)).filter(Boolean);
  const params = new URLSearchParams(location.search);
  view(h`
    <div class="page-head"><div><h1>Items</h1><p>Every item that counts toward collections, and how many of the ${data.players} ranked players have looted it.</p></div></div>
    <div class="controls">
      <label class="sr" for="item-q">Search items</label><input id="item-q" type="search" placeholder="Search items" value="${params.get('q') ?? ''}">
      <label for="item-show">Show</label>
      <select id="item-show"><option value="all">All items</option><option value="found">Found by someone</option><option value="unfound">Never found</option></select>
    </div>
    <div id="catalog"></div>`);
  const draw = () => {
    const q = document.getElementById('item-q').value.toLowerCase(), show = document.getElementById('item-show').value;
    const groups = new Map();
    for (const it of list) {
      const o = owners.get(it.id);
      if (q && !it.name.toLowerCase().includes(q)) continue;
      if (show === 'found' && !o) continue;
      if (show === 'unfound' && o) continue;
      const g = it.slot === 10 ? 'Consumables' : it.untiered ? 'Untiered' : `${it.slotName}s`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    }
    const order = [...groups.keys()].sort((a, b) => (a === 'Untiered' ? -1 : b === 'Untiered' ? 1 : a === 'Consumables' ? 1 : b === 'Consumables' ? -1 : a.localeCompare(b)));
    document.getElementById('catalog').innerHTML = String(order.length ? h`${order.map(g => h`<section class="catalog-group"><h3>${g}</h3><div class="catalog">${groups.get(g)
      .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.name.localeCompare(b.name))
      .map(it => {
        const o = owners.get(it.id), t = tierInfo(it);
        return h`<a href="/item/${it.id}" data-link class="${o ? '' : 'unfound'}">${itemSprite(it.id, 2, {missing: !o})}<span class="grow"><span class="title">${it.name}</span>
          <span class="sub">${t.label && g !== 'Untiered' ? h`<span class="tier ${t.cls}">${t.label}</span> ` : ''}${o ? `found by ${o.owners}` : 'never found'}</span></span></a>`;
      })}</div></section>`)}` : h`<p class="empty">No items match.</p>`);
  };
  document.getElementById('item-q').addEventListener('input', draw);
  document.getElementById('item-show').addEventListener('change', draw);
  draw();
}

async function item(id) {
  const it = ITEMS.get(id);
  if (!it) return notFound('That item is not in the game catalog');
  const [d, E] = await Promise.all([get(`/api/item/${id}`), loadEnemies()]);
  const sources = (E.droppedBy.get(id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const t = tierInfo(it);
  document.title = `${it.name} | OpenEye`;
  view(h`
    <div class="item-hero">
      ${auraOf(id) ? h`<span class="aura-big" style="${auraStyle(auraOf(id))}">${firstFind(id, AURA_FX[auraFx(id)]?.label ?? '')}</span>` : h`<span class="slot ${bag(it)}">${itemSprite(id, 4)}</span>`}
      <div>
        <h1>${it.name}</h1>
        <p class="muted" style="margin-top:6px">${t.label ? h`<span class="tier ${t.cls}">${t.label === 'UT' ? 'Untiered' : `Tier ${it.tier}`}</span> ` : ''}${it.slotName}${it.soulbound ? ', soulbound' : ''}${it.fameBonus ? `, +${it.fameBonus}% fame bonus` : ''}</p>
      </div>
    </div>
    <div class="grid-2">
      <section class="panel"><header><h2>Details</h2></header><div class="panel-body">
        <p>${it.description || 'No description.'}</p>
        ${it.bonuses.length ? h`<ul class="bonus-list">${it.bonuses.map(b => h`<li>${b.amount > 0 ? '+' : ''}${b.amount} ${STAT_NAMES[b.stat] ?? `stat ${b.stat}`}</li>`)}</ul>` : ''}
        <p class="muted" style="margin-top:12px">${d.collectible ? `Found by ${d.owners.length} of ${d.players} ranked players.` : 'This item does not count toward collections.'}</p>
      </div></section>
      <section class="panel"><header><h2>Who found it</h2></header>
        ${d.owners.length ? h`<ul class="rows">${d.owners.map((o, i) => h`<li><span class="grow">${playerLink(o.name, o.stars)}${i === 0 ? h` <span class="badge gold">First</span>` : ''}</span><span class="sub">${date(o.found_at)}</span></li>`)}</ul>` : h`<p class="empty">Nobody has looted this yet.</p>`}
      </section>
    </div>
    <section class="panel" style="margin-top:24px"><header><h2>Dropped by</h2><span class="muted">In the current game code</span></header>
      ${sources.length ? h`<div class="panel-body"><div class="catalog enemy-cards">${sources.map(e => h`<a href="/enemy/${e.id}" data-link>${enemySprite(e, 40)}<span class="grow"><span class="title">${e.name}</span>
        <span class="sub">${e.hp !== null ? `${fmt(e.hp)} HP` : ''}${e.internal ? ` (${e.internal})` : ''}</span></span></a>`)}</div></div>` : h`<p class="empty">No enemy drops this item.</p>`}
    </section>
    ${d.deaths.length ? h`<section class="panel" style="margin-top:24px"><header><h2>Died wearing it</h2></header>${deathRows(d.deaths)}</section>` : ''}`);
}

// ---------- enemies ----------
// Built daily from the Open RotMG code (tools/codex): stats from objects.xml, drops from the
// server's own loot tables, sprites from the client.
let ENEMIES = null;
async function loadEnemies() {
  if (!ENEMIES) {
    const data = await staticJson('/catalog/enemies.json').catch(() => ({sheet: {width: 0}, enemies: []}));
    const list = data.enemies ?? [];
    ENEMIES = {list, sheetWidth: data.sheet?.width ?? 0, byId: new Map(list.map(e => [e.id, e])), droppedBy: new Map()};
    for (const e of list) for (const id of e.drops) {
      if (!ENEMIES.droppedBy.has(id)) ENEMIES.droppedBy.set(id, []);
      ENEMIES.droppedBy.get(id).push(e);
    }
  }
  return ENEMIES;
}
const BOSS_FLAGS = ['Quest', 'God', 'Hero', 'Encounter'];
const isBoss = e => e.flags.some(f => BOSS_FLAGS.includes(f));
// Health and Magic Potions drop from almost everything, so they do not count as "drops" in the list filter.
const BASIC_POTIONS = new Set([0xa22, 0xa23]);
const hasRealDrops = e => e.drops.some(id => !BASIC_POTIONS.has(id));
const FLAG_NAMES = {Quest: 'Quest', God: 'God', Hero: 'Hero', Encounter: 'Encounter', StasisImmune: 'Stasis immune', Flying: 'Flying', Oryx: 'Oryx'};
// Sprites drawn at a whole-number scale that fits the box, with the game's black outline.
function enemySprite(e, box = 40) {
  if (!e?.sprite) return h`<span class="esprite none" style="width:${box}px;height:${box}px"></span>`;
  const {x, y, w, h: ht} = e.sprite;
  const s = Math.max(1, Math.floor(box / Math.max(w, ht)));
  return h`<span class="esprite-box" style="width:${box}px;height:${box}px"><span class="esprite" role="img" aria-label="${e.name}" style="width:${w * s}px;height:${ht * s}px;background-size:${ENEMIES.sheetWidth * s}px auto;background-position:-${x * s}px -${y * s}px"></span></span>`;
}
const dropOrder = (a, b) => {
  // Consumables (potions first) at the top, then untiered items, then tiers from highest down.
  const rank = it => (!it ? 4 : it.slot === 10 ? (/^Potion of /.test(it.name) ? 0 : 1) : it.untiered ? 2 : 3);
  return rank(a) - rank(b) || (b?.tier ?? 0) - (a?.tier ?? 0) || (a?.name ?? '').localeCompare(b?.name ?? '');
};
const fmtDamage = d => (d === null ? '–' : Array.isArray(d) ? `${fmt(d[0])} – ${fmt(d[1])}` : fmt(d));

async function enemies() {
  const E = await loadEnemies();
  const params = new URLSearchParams(location.search);
  document.title = 'Enemies | OpenEye';
  view(h`
    <div class="page-head"><div><h1>Enemies</h1><p>Every enemy in the current Open RotMG code, with its stats, attacks and the items it can drop. Rebuilt daily from the game's code.</p></div></div>
    <div class="controls">
      <label class="sr" for="enemy-q">Search enemies</label><input id="enemy-q" type="search" placeholder="Search enemies or items" value="${params.get('q') ?? ''}">
      <label for="enemy-show">Show</label>
      <select id="enemy-show"><option value="all">All enemies</option><option value="drops" selected>With drops</option><option value="bosses">Bosses and quests</option></select>
      <label for="enemy-sort">Sort</label>
      <select id="enemy-sort"><option value="name">Name</option><option value="hp">Most HP</option><option value="drops">Most drops</option></select>
      <span class="muted" id="enemy-count"></span>
      <label class="push-right"><input type="checkbox" id="enemy-iconless"> Show icon-less enemies</label>
    </div>
    <div id="enemy-list"></div>`);
  const draw = () => {
    const q = document.getElementById('enemy-q').value.trim().toLowerCase();
    const show = document.getElementById('enemy-show').value, sort = document.getElementById('enemy-sort').value;
    const iconless = document.getElementById('enemy-iconless').checked;
    let rows = E.list.filter(e => (iconless || e.sprite) && (show !== 'drops' || hasRealDrops(e)) && (show !== 'bosses' || isBoss(e)));
    if (q) rows = rows.filter(e => e.name.toLowerCase().includes(q) || e.internal?.toLowerCase().includes(q)
      || e.drops.some(id => ITEMS.get(id)?.name.toLowerCase().includes(q)));
    if (sort === 'hp') rows = [...rows].sort((a, b) => (b.hp ?? 0) - (a.hp ?? 0));
    if (sort === 'drops') rows = [...rows].sort((a, b) => b.drops.length - a.drops.length);
    document.getElementById('enemy-count').textContent = `${fmt(rows.length)} shown`;
    document.getElementById('enemy-list').innerHTML = String(rows.length ? h`<div class="catalog enemy-cards">${rows.map(e => h`<a href="/enemy/${e.id}" data-link>
      ${enemySprite(e, 40)}
      <span class="grow"><span class="title">${e.name}</span>
      <span class="sub">${e.internal ? `${e.internal}: ` : ''}${e.hp !== null ? `${fmt(e.hp)} HP` : 'No HP'}${e.def ? `, ${fmt(e.def)} DEF` : ''}${e.drops.length ? `, ${e.drops.length} drop${e.drops.length === 1 ? '' : 's'}` : ''}</span></span>
    </a>`)}</div>` : h`<p class="empty">No enemies match.</p>`);
  };
  for (const id of ['enemy-q', 'enemy-show', 'enemy-sort', 'enemy-iconless']) document.getElementById(id).addEventListener(id === 'enemy-q' ? 'input' : 'change', draw);
  draw();
}

async function enemy(id) {
  const E = await loadEnemies();
  const e = E.byId.get(id);
  if (!e) return notFound('That enemy is not in the current game code');
  document.title = `${e.name} | OpenEye`;
  const drops = e.drops.map(i => ITEMS.get(i)).filter(Boolean).sort(dropOrder);
  view(h`
    <div class="item-hero">
      <span class="enemy-frame">${enemySprite(e, 96)}</span>
      <div>
        <h1>${e.name}</h1>
        <p class="muted" style="margin-top:6px">${e.internal ? `${e.internal}, ` : ''}${e.group ? `${e.group}, ` : ''}type 0x${e.id.toString(16)}</p>
        ${e.flags.length ? h`<p class="enemy-flags">${e.flags.map(f => h`<span class="badge${BOSS_FLAGS.includes(f) ? ' gold' : ''}">${FLAG_NAMES[f] ?? f}</span>`)}</p>` : ''}
      </div>
    </div>
    <dl class="panel kv" style="margin-bottom:24px">
      <div><dt>HP</dt><dd>${e.hp !== null ? fmt(e.hp) : '–'}</dd></div>
      <div><dt>Defense</dt><dd>${fmt(e.def)}</dd></div>
      ${e.level !== null ? h`<div><dt>Level</dt><dd>${fmt(e.level)}</dd></div>` : ''}
      <div><dt>Size</dt><dd>${e.size !== null ? fmt(e.size) : '–'}</dd></div>
      <div><dt>Attacks</dt><dd>${fmt(e.projectiles.length)}</dd></div>
      <div><dt>Drops</dt><dd>${fmt(drops.length)}</dd></div>
    </dl>
    <section class="panel" style="margin-bottom:24px">
      <header><h2>Projectiles</h2><span class="muted">Range in tiles</span></header>
      ${e.projectiles.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>Shot</th><th class="n">Damage</th><th class="n">Range</th><th class="n">Speed</th><th class="n">Lifetime</th><th>Effects</th><th>Notes</th></tr></thead>
        <tbody>${e.projectiles.map(p => h`<tr>
          <td class="muted">${p.id}</td>
          <td class="n main-metric">${fmtDamage(p.damage)}</td>
          <td class="n">${p.range}</td>
          <td class="n">${fmt(p.speed)}</td>
          <td class="n">${fmt(p.lifetime)} ms</td>
          <td>${p.effects.length ? p.effects.map(c => `${c.name}${c.duration !== null ? ` for ${c.duration} secs` : ''}`).join(', ') : h`<span class="muted">–</span>`}</td>
          <td>${p.flags.length ? p.flags.map(f => ({MultiHit: 'Hits multiple targets', PassesCover: 'Passes through obstacles', ArmorPiercing: 'Armor piercing', Boomerang: 'Boomerang', Wavy: 'Wavy', Parametric: 'Parametric'}[f] ?? f)).join(', ') : h`<span class="muted">–</span>`}</td>
        </tr>`)}</tbody></table></div>` : h`<p class="empty">This enemy has no projectiles.</p>`}
    </section>
    <section class="panel">
      <header><h2>Drops</h2><span class="muted">Every item it can drop in the current code</span></header>
      ${drops.length ? h`<div class="panel-body"><div class="catalog">${drops.map(it => {
        const t = tierInfo(it);
        return h`<a href="/item/${it.id}" data-link>${itemSprite(it.id, 2)}<span class="grow"><span class="title">${it.name}</span>
          <span class="sub">${t.label ? h`<span class="tier ${t.cls}">${t.label}</span> ` : ''}${it.slotName}</span></span></a>`;
      })}</div></div>` : h`<p class="empty">This enemy drops nothing.</p>`}
    </section>`);
}

async function about() {
  const s = await get('/api/status');
  const names = {health: 'Server', hiscores: 'Players', legends: 'Legends', deaths: 'Deaths', graveyard: 'Graveyard'};
  view(h`
    <div class="page-head"><div><h1>About</h1></div></div>
    <section class="panel" style="margin-bottom:24px">
      <div class="panel-body"><p style="margin:0">OpenEye is made by spankmaster. It is <a href="https://github.com/Scinexx/openeye" rel="noopener">open source</a> and free to reuse, copy and change. It is not run by or associated with RedBracket or any other Open RotMG devs. Data comes from the game's public API.</p></div>
    </section>
    <div class="grid-2" style="align-items:start">
      <section class="panel">
        <header><h2>Last updated</h2></header>
        <ul class="rows">${Object.entries(s.jobs).map(([k, j]) => h`<li>
          <span class="light ${j.delayed ? 'off' : j.lastOk ? 'on' : ''}"></span>
          <span class="grow title">${names[k]}</span>
          <span class="sub">${j.delayed ? 'Delayed' : j.lastOk ? when(j.lastOk) : 'Starting'}</span>
        </li>`)}</ul>
      </section>
      <section class="panel">
        <header><h2>Source code</h2></header>
        <div class="panel-body"><a href="https://github.com/Scinexx/openeye" rel="noopener">github.com/Scinexx/openeye</a></div>
      </section>
      <section class="panel">
        <header><h2>Auras</h2></header>
        <div class="panel-body"><a href="/auras" data-link>See every first-find aura</a></div>
      </section>
    </div>`);
}

// Unlisted gallery of every first-find aura (not linked anywhere): /auras
function auras() {
  document.title = 'Auras | OpenEye';
  const ids = Object.keys(AURAS).map(Number).filter(id => auraOf(id)).sort((a, b) => ITEMS.get(a).name.localeCompare(ITEMS.get(b).name));
  view(h`
    <div class="page-head"><div><h1>Auras</h1><p>The glow a UT gets in Latest loot when it is the first ever found, in the item’s own colours.</p></div></div>
    <div class="aura-gallery">${ids.map(id => h`<div class="panel aura-card" style="${auraStyle(auraOf(id))}">
      ${firstFind(id)}
      <span class="grow"><span class="title">${ITEMS.get(id).name}</span><span class="sub">${AURA_FX[auraFx(id)]?.label ?? 'Sparks'}</span></span>
      <span class="first-tag">First!</span>
    </div>`)}</div>`);
}

// ---------- the Vault (unlisted: /vault) ----------
// Every theme in one place, kept in vault chests like the game's: click an item to wear its
// theme, double-click to use it as in the game (loading screens, sounds and effects included).
const THEME_NOTES = {
  '': 'The Nexus: the default stone theme.',
  life: 'Healing light: soft green crosses rise like the game’s heal effect.',
  mana: 'Magic in the air: golden motes drift and sparkle.',
  attack: 'Sword swipes flash across the page.',
  defense: 'Plain steel grey; drinking it sends a sheen across like light on armor.',
  speed: 'Wind streaks rush past.',
  dexterity: 'Arrows fly across the page.',
  vitality: 'A heartbeat pulses at the edges of the screen.',
  wisdom: 'Arcane rings turn slowly behind twinkling runes.',
  tomb: 'Sand blows across a golden tomb.',
  trench: 'Deep water: bubbles rise past glowing sea life.',
  manor: 'A blood moon, crimson edges and bats flitting past.',
  locker: 'Ghostly fog rolls over the sunken deck.',
  madlab: 'Monitor scanlines sweep down; toxic bubbles rise.',
  abyss: 'Embers rise from the magma below.',
  undead: 'Cold mist and lost souls drifting upward.',
  sprite: 'Twinkling stars, drifting nebulae and the odd shooting star.',
  cellar: 'Oryx’s Wine Cellar from the game’s own map, with the Mad God himself watching.',
  rum: 'Inside the ghostly bottle: rum sloshing, bubbles and spirits rising.',
  snakeoil: 'The tonic show’s spotless white: oily soap bubbles and a rainbow sheen.',
  mushroom: 'Amanita red, a turning rainbow, ripples and pulsing spores. Eat it to hallucinate.',
  sunrise: 'The sun climbs out of the sea between the palms while gulls glide by.',
  paradise: 'Under the lagoon: caustic light, sun shafts, bubbles and a passing school of fish.',
  passion: 'A warm magenta breeze carrying petals past soft lights.',
  jungle: 'A jungle bay at night: fireflies, moonlight and leaves spinning down.'
};
function vault() {
  document.title = 'Vault | OpenEye';
  const byName = new Map([...ITEMS.values()].map(i => [i.name, i]));
  const chests = [['Potions', POTIONS], ['Dungeon keys', KEYS], ['Rare finds', BREWS]];
  const current = () => document.documentElement.dataset.theme ?? '';
  const slotOf = ([key, label, item]) => {
    const it = byName.get(item);
    return h`<button type="button" class="vault-slot" data-vault="${key}" aria-pressed="${key === current()}" aria-label="${label}"${it ? raw(` data-tip="${it.id}"`) : ''}>${it ? itemSprite(it.id, 5) : ''}</button>`;
  };
  view(h`
    <div class="page-head"><div><h1>Vault</h1><p>Every theme in one place. Click an item to wear its theme, double-click to use it like in the game.</p></div></div>
    <div class="vault">
      <div class="vault-top">
        <button type="button" class="vault-nexus" data-vault="" aria-pressed="${current() === ''}"><img src="/icons/nexus.png" width="48" height="48" alt=""><span>Nexus</span></button>
        <section class="panel vault-now" aria-live="polite"><p class="vault-name"></p><p class="vault-note"></p></section>
      </div>
      <div class="vault-chests">${chests.map(([title, list]) => h`<section class="vault-chest" aria-label="${title}">
        <h2>${title}</h2>
        <div class="vault-grid">${list.map(slotOf)}</div>
      </section>`)}</div>
    </div>`);
  const sync = () => {
    const key = current();
    document.querySelectorAll('[data-vault]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vault === key)));
    const entry = INV_ALL.find(t => t[0] === key);
    document.querySelector('.vault-name').textContent = entry ? (BREWS.includes(entry) ? entry[2] : KEYS.includes(entry) ? entry[1] : `${entry[1]} potion`) : 'Nexus';
    document.querySelector('.vault-note').textContent = THEME_NOTES[key] ?? '';
  };
  sync();
  const box = document.querySelector('.vault');
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-vault]');
    if (!b || mapLoading) return;
    const key = b.dataset.vault;
    if (e.detail > 1) return; // the double-click handler takes it from here
    if (key === current() && key) return;
    sober();
    playSound(KEYS.some(k => k[0] === key) || key === 'cellar' ? '/sfx/use_key.mp3' : '/sfx/use_potion.mp3');
    setTheme(key, {intro: true});
    sync();
  });
  box.addEventListener('dblclick', e => {
    const b = e.target.closest('[data-vault]');
    if (!b || !b.dataset.vault || mapLoading) return;
    hideTip();
    useItem(b.dataset.vault, fxAt(b));
    setTimeout(sync, 1100);
    sync();
  });
}

function notFound(message = 'There is nothing at this address.') {
  document.title = 'Not found | OpenEye';
  view(h`<div class="page-head"><div><h1>Not found</h1><p>${message}</p><p><a href="/" data-link>Go to the home page</a> or search for a player above.</p></div></div>`);
}

// ---------- router ----------
const routes = [
  [/^\/$/, () => home(), ''],
  [/^\/rankings\/?$/, () => navigate('/rankings/stars', true), 'rankings'],
  [/^\/rankings\/([a-z_]+)$/, m => rankings(m[1]), 'rankings'],
  [/^\/player\/([^/]+)$/, m => player(decodeURIComponent(m[1])), ''],
  [/^\/graveyard$/, () => graveyard(), 'graveyard'],
  [/^\/death\/(\d+)\/(\d+)$/, m => death(Number(m[1]), Number(m[2])), 'graveyard'],
  [/^\/legends\/?$/, () => legends('week'), 'legends'],
  [/^\/legends\/([a-z]+)$/, m => legends(m[1]), 'legends'],
  [/^\/loot$/, () => loot(), 'loot'],
  [/^\/items$/, () => items(), 'items'],
  [/^\/item\/(\d+)$/, m => item(Number(m[1])), 'items'],
  [/^\/enemies$/, () => enemies(), 'enemies'],
  [/^\/enemy\/(\d+)$/, m => enemy(Number(m[1])), 'enemies'],
  [/^\/about$/, () => about(), 'about'],
  [/^\/auras\/?$/, () => auras(), ''],
  [/^\/vault\/?$/, () => vault(), '']
];

const TITLES = {rankings: 'Rankings', graveyard: 'Graveyard', legends: 'Legends', loot: 'Loot', items: 'Items', enemies: 'Enemies', about: 'About'};
async function route() {
  hideTip();
  const path = location.pathname;
  for (const [re, fn, nav] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('[data-nav]').forEach(a => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    // Pages with their own subject (a player, an item, a death) set a more specific title.
    document.title = TITLES[nav] ? `${TITLES[nav]} | OpenEye` : 'OpenEye';
    if (!main.innerHTML) loading();
    try { await fn(m); }
    catch (e) { view(h`<div class="notice error"><strong>This page could not load.</strong> ${e.status === 429 ? 'Too many requests. Wait a minute and try again.' : 'Try refreshing the page in a moment.'}</div>`); }
    return;
  }
  notFound();
}
function navigate(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.scrollTo(0, 0);
  route().then(() => main.focus({preventScroll: true}));
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', route);

// ---------- header search: players, or items and enemies ----------
const input = document.getElementById('search-input');
const results = document.getElementById('search-results');
const MODES = {player: 'Find a player', codex: 'Find an item or enemy'};
let searchMode = 'player';
try { if (localStorage.getItem('searchMode') === 'codex') searchMode = 'codex'; } catch { /* storage unavailable */ }
let searchTimer, active = -1, pending = null;
const closeSearch = () => { results.hidden = true; active = -1; };
function setSearchMode(mode) {
  searchMode = mode;
  try { localStorage.setItem('searchMode', mode); } catch { /* storage unavailable */ }
  document.querySelectorAll('[data-search-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.searchMode === mode)));
  input.placeholder = MODES[mode];
  document.getElementById('search-label').textContent = MODES[mode];
  if (input.value.trim()) runSearch(); else closeSearch();
}
document.querySelectorAll('[data-search-mode]').forEach(b => b.addEventListener('click', () => { setSearchMode(b.dataset.searchMode); input.focus(); }));

// Best matches first: exact name, then names starting with the text, then anywhere in the name.
const matchScore = (name, q) => { const n = name.toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : n.split(/[\s'-]+/).some(w => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : -1; };
async function codexResults(q) {
  const E = await loadEnemies();
  const found = [];
  for (const it of ITEMS.values()) { const s = matchScore(it.name, q); if (s >= 0) found.push({s, name: it.name, item: it}); }
  // Same-named enemy variants collapse to the one with the most drops.
  const best = new Map();
  for (const e of E.list) {
    const s = matchScore(e.name, q);
    if (s < 0) continue;
    const prev = best.get(e.name);
    if (!prev || e.drops.length > prev.enemy.drops.length || (!prev.enemy.sprite && e.sprite)) best.set(e.name, {s, name: e.name, enemy: e});
  }
  found.push(...best.values());
  found.sort((a, b) => a.s - b.s || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return found.slice(0, 10).map(r => r.item
    ? h`<li><a href="/item/${r.item.id}" data-link><span class="player">${itemSprite(r.item.id, 1)}${r.item.name}</span><span class="muted">${tierInfo(r.item).label || 'Item'}</span></a></li>`
    : h`<li><a href="/enemy/${r.enemy.id}" data-link><span class="player">${enemySprite(r.enemy, 16)}${r.enemy.name}</span><span class="muted">Enemy</span></a></li>`);
}
async function playerResults(q) {
  const r = await get(`/api/search?q=${encodeURIComponent(q)}`).catch(() => ({players: [], former: []}));
  return [
    ...r.players.map(p => h`<li><a href="/player/${encodeURIComponent(p.name)}" data-link><span class="player">${rankIcon(p.name, p.stars)}${p.name}</span><span class="muted">${fmt(p.stars)}</span></a></li>`),
    ...r.former.map(f => h`<li><a href="/player/${encodeURIComponent(f.name)}" data-link><span class="player">${rankIcon(f.name, f.stars)}${f.name}</span><span class="muted">was ${f.former}</span></a></li>`)
  ];
}
function runSearch() {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (!q) { pending = null; return closeSearch(); }
  const mode = searchMode;
  const job = new Promise(resolve => {
    searchTimer = setTimeout(async () => {
      const rows = mode === 'player' ? await playerResults(q) : await codexResults(q.toLowerCase());
      if (pending === job) {
        results.innerHTML = String(rows.length ? h`${rows}` : h`<li class="hint">${mode === 'player' ? `No player called “${q}” has been seen yet.` : `No item or enemy matches “${q}”.`}</li>`);
        results.hidden = false;
        active = -1;
      }
      resolve();
    }, mode === 'player' ? 120 : 0);
  });
  pending = job;
}
input.addEventListener('input', runSearch);
input.addEventListener('keydown', e => {
  const links = [...results.querySelectorAll('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!links.length) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links.forEach((l, i) => l.classList.toggle('active', i === active));
  } else if (e.key === 'Escape') closeSearch();
});
// Enter opens the highlighted result, or the top one; it waits for a search still in flight.
input.form.addEventListener('submit', async e => {
  e.preventDefault();
  if (pending) await pending;
  const links = [...results.querySelectorAll('a')];
  const target = links[Math.max(0, active)];
  if (target) navigate(target.getAttribute('href'));
  else if (searchMode === 'player' && input.value.trim()) navigate(`/player/${encodeURIComponent(input.value.trim())}`);
  else return;
  input.value = '';
  pending = null;
  closeSearch();
});
results.addEventListener('click', () => { input.value = ''; pending = null; closeSearch(); });
document.addEventListener('click', e => { if (!input.form.contains(e.target)) closeSearch(); });
setSearchMode(searchMode);

// ---------- themes ----------
// One theme per stat potion, coloured from the potion sprites; the choice is kept in this browser.
const THEMES = [
  ['', 'Nexus', null], ['life', 'Life', 'Potion of Life'], ['mana', 'Mana', 'Potion of Mana'],
  ['attack', 'Attack', 'Potion of Attack'], ['defense', 'Defense', 'Potion of Defense'], ['speed', 'Speed', 'Potion of Speed'],
  ['dexterity', 'Dexterity', 'Potion of Dexterity'], ['vitality', 'Vitality', 'Potion of Vitality'], ['wisdom', 'Wisdom', 'Potion of Wisdom']
];
// A secret: pressing the Nexus on cramshon's or RedBracket's profile fills the inventory with the keys to the
// eight hardest dungeons instead. Using a key loads into its dungeon (the client's loading
// screen with the dungeon's name) and dresses the site in that dungeon's colours.
const KEYS = [
  ['tomb', 'Tomb of the Ancients', 'Tomb of the Ancients Key'], ['trench', 'Ocean Trench', 'Ocean Trench Key'],
  ['manor', 'Manor of the Immortals', 'Manor Key'], ['locker', "Davy Jones' Locker", "Davy's Key"],
  ['madlab', 'Mad Lab', 'Lab Key'], ['abyss', 'Abyss of Demons', 'Abyss of Demons Key'],
  ['undead', 'Undead Lair', 'Undead Lair Key'], ['sprite', 'Sprite World', 'Sprite World Key']
];
const KEY_PROFILES = ['/player/cramshon', '/player/redbracket'];
// Rare finds: each of these consumables (and each dungeon key) has a 1% chance to take the place of a potion when the
// Nexus refills the inventory, and is certain to on the page of an enemy that drops it. Each has
// its own theme with moving effects, and using it does what the item does in the game
// (objects.xml): the incantation opens the Wine Cellar with the key sound, Snake Oil heals 100 HP
// in a 10-tile nova, the mushroom makes you hallucinate for 30 s, and the rum and the Masked
// Party God's drinks make you drunk (6 s and 15 s; the rum also turns you invisible for 4 s).
// [key, label, item, verb, effects]
const BREWS = [
  ['cellar', 'Wine Cellar', 'Wine Cellar Incantation', 'Use', {portal: 'Wine Cellar'}],
  ['rum', 'Ghost Pirate Rum', 'Ghost Pirate Rum', 'Drink', {drunk: 6, invisible: 4}],
  ['snakeoil', 'Snake Oil', 'Snake Oil', 'Drink', {heal: 100, range: 10}],
  ['mushroom', 'Magic Mushroom', 'Magic Mushroom', 'Eat', {hallucinating: 30}],
  ['sunrise', 'Bahama Sunrise', 'Bahama Sunrise', 'Drink', {boost: true, drunk: 15}],
  ['paradise', 'Blue Paradise', 'Blue Paradise', 'Drink', {boost: true, drunk: 15}],
  ['passion', 'Pink Passion Breeze', 'Pink Passion Breeze', 'Drink', {boost: true, drunk: 15}],
  ['jungle', 'Lime Jungle Bay', 'Lime Jungle Bay', 'Drink', {boost: true, drunk: 15}]
];
const BREW_CHANCE = 0.01;
const POTIONS = THEMES.filter(t => t[2]);
const INV_ALL = [...POTIONS, ...KEYS, ...BREWS];
// The inventory is the list of the eight slots' keys, kept in this browser until the next Nexus.
let inventory = POTIONS.map(t => t[0]);
try {
  const saved = localStorage.getItem('inventory');
  if (saved === 'keys') inventory = KEYS.map(k => k[0]);
  else if (saved?.startsWith('[')) {
    const list = JSON.parse(saved);
    if (Array.isArray(list) && list.length === 8 && list.every(k => INV_ALL.some(t => t[0] === k))) inventory = list;
  }
} catch { /* storage unavailable */ }
const invItems = () => inventory.map(k => INV_ALL.find(t => t[0] === k));
const invKind = key => (KEYS.some(k => k[0] === key) ? 'key' : BREWS.some(b => b[0] === key) ? 'brew' : 'potion');
function rollInventory(forced = new Set()) {
  const slots = POTIONS.map(t => t[0]);
  // The dungeon keys can turn up the same way, at the same 1% each.
  const found = [...BREWS.filter(b => forced.has(b[2])), ...[...BREWS, ...KEYS].filter(b => !forced.has(b[2]) && Math.random() < BREW_CHANCE)].map(b => b[0]);
  const free = [...slots.keys()].sort(() => Math.random() - 0.5);
  found.slice(0, 8).forEach((k, i) => { slots[free[i]] = k; });
  return slots;
}
const themeButton = document.getElementById('theme-button');
const themeMenu = document.getElementById('theme-menu');
// The theme menu is the game's inventory: eight slots (InventoryGrid: 40px slots, 4px apart,
// corner cuts on the grid's outside corners, hotkey numbers 1-8 behind the items) holding the
// eight stat potions, on the HUD's #363636, with the HUD's Nexus button to go back to the default.
const SLOT_CUTS = {0: 'tl', 3: 'tr', 4: 'bl', 7: 'br'};
// Drinking: double-click a potion to drink it, as in the game. It plays the game's own
// use_potion sound, switches the site to that theme and leaves the slot empty until the
// next Nexus, which refills every potion and resets the theme.
let drunk = new Set();
try { drunk = new Set(JSON.parse(localStorage.getItem('drunkPotions') ?? '[]')); } catch { /* storage unavailable */ }
const saveDrunk = () => { try { localStorage.setItem('drunkPotions', JSON.stringify([...drunk])); } catch { /* storage unavailable */ } };
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function playSound(src, volume = 0.5) {
  try { const a = new Audio(src); a.volume = volume; a.play().catch(() => {}); } catch { /* no audio */ }
}
// A short cooldown between drinks.
const DRINK_COOLDOWN = 700;
let lastDrink = -Infinity;
function drink(key) {
  if (!key || drunk.has(key) || mapLoading) return;
  if (performance.now() - lastDrink < DRINK_COOLDOWN) return;
  lastDrink = performance.now();
  hideTip();
  const slot = themeMenu.querySelector(`.inv-slot[data-theme-key="${key}"]`);
  const at = fxAt(slot);
  drunk.add(key);
  saveDrunk();
  syncThemeMenu();
  useItem(key, at);
}
// Using an item, as in the game: keys (and the incantation) play the key sound and load into
// their dungeon; potions play use_potion; rare consumables also do what the item does.
function useItem(key, at) {
  const dungeon = KEYS.find(k => k[0] === key);
  if (dungeon) {
    playSound('/sfx/use_key.mp3');
    loadingScreen(dungeon[1], () => setTheme(key, {intro: true}));
    return;
  }
  const brew = BREWS.find(b => b[0] === key);
  if (brew?.[4].portal) {
    playSound('/sfx/use_key.mp3');
    loadingScreen(brew[4].portal, () => setTheme(key, {intro: true}));
    return;
  }
  playSound('/sfx/use_potion.mp3');
  setTheme(key, {intro: true});
  if (brew) brewEffects(brew[4], at);
}
// Nexus: the client's map loading screen, as read from client.swf (MapLoadingView and the code
// that opens it): a black screen; the character walking right, its frames
// AnimatedChar.imageFromDir(RIGHT, WALK, 0) and (…, 0.5) resized to 5x with no outline and
// swapped every 200 ms, placed at charContainer (399.5, 245.85) minus half its bitmap, plus 5;
// the map name in Myriad Pro bold 30px white, centred at mapNameContainer (399.5, 290.5); shown
// for at least 1000 ms, then faded out over 0.4 s. The character is a random class each time.
let WALK = null;
async function loadWalk() { WALK = await staticJson('/catalog/walk.json').catch(() => null); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function nexus() {
  closeThemes();
  // On cramshon's or RedBracket's profile the Nexus hands out dungeon keys instead of potions;
  // anywhere else, a rare consumable may turn up among the potions.
  let here = '';
  try { here = decodeURIComponent(location.pathname).toLowerCase(); } catch { /* malformed address */ }
  if (KEY_PROFILES.includes(here)) inventory = KEYS.map(k => k[0]);
  else {
    // On the page of an enemy that drops one of the rare consumables, it is certain to be there.
    const enemy = /^\/enemy\/(\d+)$/.exec(here);
    const forced = new Set();
    if (enemy) {
      const E = await loadEnemies();
      const names = new Set((E.byId.get(Number(enemy[1]))?.drops ?? []).map(id => ITEMS.get(id)?.name));
      for (const b of BREWS) if (names.has(b[2])) forced.add(b[2]);
    }
    inventory = rollInventory(forced);
  }
  try { localStorage.setItem('inventory', JSON.stringify(inventory)); } catch { /* storage unavailable */ }
  await loadingScreen('Nexus', () => {
    drunk.clear();
    saveDrunk();
    setTheme('');
    drawThemeMenu();
    if (location.pathname !== '/') navigate('/');
  });
}
let mapLoading = false;
async function loadingScreen(name, behind) {
  if (mapLoading) return;
  mapLoading = true;
  const classes = [...CLASSES.values()];
  const c = classes[Math.floor(Math.random() * classes.length)];
  const screen = document.createElement('div');
  screen.className = 'map-loading';
  screen.setAttribute('role', 'status');
  const row = c && WALK?.rows?.[c.id];
  screen.innerHTML = String(h`${row !== undefined ? h`<span class="ml-char" role="img" aria-label="${c.name}" style="--walk-y:-${row * 40}px;background-size:${WALK.sheet.width * 5}px ${WALK.sheet.height * 5}px"></span>` : ''}<span class="ml-name">${name}</span>`);
  document.body.append(screen);
  try { behind(); } catch (e) { console.error(e); }
  await sleep(1000);
  screen.classList.add('out');
  await sleep(reducedMotion() ? 0 : 400);
  screen.remove();
  mapLoading = false;
}

// Updates the open inventory in place (selection and drunk slots) without rebuilding it, so a
// click that is already under way still lands on the same button.
function syncThemeMenu() {
  const current = document.documentElement.dataset.theme ?? '';
  themeMenu.querySelectorAll('[data-theme-key]').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.themeKey === current));
    if (b.classList.contains('inv-slot') && drunk.has(b.dataset.themeKey) && !b.classList.contains('drunk')) {
      b.classList.add('drunk');
      b.querySelector('canvas')?.remove();
      b.removeAttribute('data-tip');
      b.setAttribute('aria-label', `${b.getAttribute('aria-label').replace(/^(Drink|Use|Eat) the | \(double-click\)$/g, '')}, used`);
    }
  });
}

function drawThemeMenu() {
  const current = document.documentElement.dataset.theme ?? '';
  const byName = new Map([...ITEMS.values()].map(i => [i.name, i]));
  const potions = invItems();
  themeMenu.innerHTML = String(h`<div class="inv-panel">
    <span class="inv-title">Themes</span>
    <button type="button" class="inv-nexus" role="menuitemradio" aria-checked="${current === ''}" aria-label="Nexus: default theme" data-theme-key="" data-tip-title="Nexus" data-tip-text="Default theme"><canvas width="40" height="40"></canvas></button>
    <div class="inv-grid">${potions.map(([key, label, potion, verb], i) => {
      const it = byName.get(potion);
      const gone = drunk.has(key);
      const kind = invKind(key);
      const what = kind === 'key' ? `${label} key` : kind === 'brew' ? potion : `${label} potion`;
      return h`<button type="button" class="inv-slot ${SLOT_CUTS[i] ?? ''}${gone ? ' drunk' : ''}" role="menuitemradio" aria-checked="${key === current}" aria-label="${gone ? `${what}, used` : `${verb ?? (kind === 'key' ? 'Use' : 'Drink')} the ${what} (double-click)`}" data-theme-key="${key}"${!gone && it ? raw(` data-tip="${it.id}"`) : ''}><span class="inv-num" aria-hidden="true">${i + 1}</span>${gone ? '' : h`<canvas width="56" height="56" data-potion="${it?.id ?? ''}"></canvas>`}</button>`;
    })}</div></div>`);
  themeMenu.querySelectorAll('canvas[data-potion]').forEach(async c => {
    const it = ITEMS.get(Number(c.dataset.potion));
    if (it?.sprite) c.getContext('2d').drawImage(await itemTexture(it, 4), 0, 0);
  });
  // IconButton: the Nexus icon (lofiInterfaceBig 6) redrawn at its own size, tinted gold on hover.
  const nexus = new Image();
  nexus.src = '/icons/nexus.png';
  nexus.onload = () => {
    const c = themeMenu.querySelector('.inv-nexus canvas');
    if (c) c.getContext('2d').drawImage(gameTexture(nexus, 0, 0, 16, 16, 1), 0, 0);
  };
}
// With a potion theme, the logo becomes that potion (sprite positions come from the item catalog).
function drawBrand() {
  const key = document.documentElement.dataset.theme ?? '';
  const potion = [...THEMES, ...KEYS, ...BREWS].find(t => t[0] === key)?.[2];
  const it = potion && [...ITEMS.values()].find(i => i.name === potion);
  const el = document.getElementById('brand-potion');
  if (!it?.sprite) { el.removeAttribute('style'); return; }
  const s = 4; // 8px sprite at 4x, 32px tall like the logo
  el.style.cssText = `background-image:url(/catalog/items.png);background-size:${320 * s}px auto;background-position:-${(it.sprite.x + 4) * s}px -${(it.sprite.y + 4) * s}px`;
}
function setTheme(key, {intro = false} = {}) {
  if (key) document.documentElement.dataset.theme = key; else delete document.documentElement.dataset.theme;
  try { if (key) localStorage.setItem('theme', key); else localStorage.removeItem('theme'); } catch { /* storage unavailable */ }
  syncThemeMenu();
  drawBrand();
  themeFx(key, intro);
  if (!key) sober();
}

// ---------- rare consumable themes: moving layers and what using the item does ----------
// Every moving part only changes transform or opacity, so the browser can run it without
// redrawing the page, and nothing moves for people who ask for reduced motion.
const fxLayer = document.createElement('div');
fxLayer.id = 'theme-fx';
fxLayer.setAttribute('aria-hidden', 'true');
document.body.prepend(fxLayer);
const rand = (a, b) => a + Math.random() * (b - a);
const pct = (a, b) => `${rand(a, b).toFixed(1)}%`;
const many = (n, make) => Array.from({length: n}, (_, i) => make(i)).join('');
const FX = {
  life: () => `<i class="fx-halo"></i>${many(12, () => `<i class="fx-mote fx-plus" style="left:${pct(2, 98)};--s:${rand(7, 13).toFixed(0)}px;--dx:${rand(-30, 30).toFixed(0)}px;--t:${rand(11, 20).toFixed(1)}s;--d:-${rand(0, 20).toFixed(1)}s"></i>`)}`,
  mana: () => `<i class="fx-swirl"></i>${many(20, () => `<i class="fx-fly fx-gold" style="left:${pct(2, 98)};top:${pct(5, 98)};--t:${rand(6, 12).toFixed(1)}s;--d:-${rand(0, 12).toFixed(1)}s;--dx:${rand(-70, 70).toFixed(0)}px;--dy:${rand(-70, 40).toFixed(0)}px"></i>`)}`,
  attack: () => many(6, () => `<i class="fx-slash" style="left:${pct(0, 75)};top:${pct(8, 92)};--r:${rand(-40, 40).toFixed(0)}deg;--t:${rand(5, 9).toFixed(1)}s;--d:-${rand(0, 9).toFixed(1)}s"></i>`),
  defense: () => '<i class="fx-sheen"></i>',
  speed: () => many(12, () => `<i class="fx-streak" style="top:${pct(3, 97)};--w:${rand(80, 260).toFixed(0)}px;--t:${rand(1.4, 3).toFixed(2)}s;--d:-${rand(0, 6).toFixed(1)}s"></i>`),
  dexterity: () => many(5, () => `<i class="fx-arrow" style="top:${pct(8, 92)};--r:${rand(-6, 6).toFixed(1)}deg;--dy:${rand(-60, 60).toFixed(0)}px;--t:${rand(6, 11).toFixed(1)}s;--d:-${rand(0, 11).toFixed(1)}s"></i>`),
  vitality: () => `<i class="fx-pulse"></i>${many(8, () => `<i class="fx-mote fx-cell" style="left:${pct(2, 98)};--s:${rand(6, 12).toFixed(0)}px;--dx:${rand(-30, 30).toFixed(0)}px;--t:${rand(14, 24).toFixed(1)}s;--d:-${rand(0, 24).toFixed(1)}s"></i>`)}`,
  wisdom: () => `<i class="fx-ring" style="width:90vmin;margin:-45vmin 0 0 -45vmin;--t:160s"></i><i class="fx-ring b" style="width:120vmin;margin:-60vmin 0 0 -60vmin;--t:220s"></i>${many(12, () => `<i class="fx-glint fx-rune" style="left:${pct(2, 98)};top:${pct(4, 96)};--t:${rand(4, 8).toFixed(1)}s;--d:-${rand(0, 8).toFixed(1)}s"></i>`)}`,
  tomb: () => `<i class="fx-halo fx-sunwarm"></i>${many(26, () => `<i class="fx-sand" style="top:${pct(5, 98)};--dy:${rand(-40, 40).toFixed(0)}px;--t:${rand(5, 10).toFixed(1)}s;--d:-${rand(0, 10).toFixed(1)}s"></i>`)}`,
  trench: () => `${many(3, i => `<i class="fx-ray fx-deepray" style="left:${15 + i * 30 + rand(-6, 6)}%;--a:${rand(-10, 10).toFixed(1)}deg;--t:${rand(9, 14).toFixed(1)}s;--d:-${rand(0, 14).toFixed(1)}s"></i>`)}${many(10, () => `<i class="fx-glow" style="left:${pct(2, 98)};top:${pct(30, 98)};--s:${rand(4, 10).toFixed(0)}px;--c:${Math.random() < .5 ? '#ff7aa8' : '#6fffe6'};--t:${rand(2, 5).toFixed(1)}s;--d:-${rand(0, 5).toFixed(1)}s"></i>`)}${many(10, () => `<i class="fx-bubble fx-sea" style="left:${pct(2, 98)};--s:${rand(4, 10).toFixed(0)}px;--t:${rand(8, 15).toFixed(1)}s;--d:-${rand(0, 15).toFixed(1)}s"></i>`)}`,
  manor: () => `<i class="fx-moon"></i>${many(5, () => `<i class="fx-bat" style="top:${pct(5, 55)};--k:${rand(.6, 1.2).toFixed(2)};--t:${rand(9, 16).toFixed(1)}s;--d:-${rand(0, 16).toFixed(1)}s"><b></b></i>`)}`,
  locker: () => `${many(4, i => `<i class="fx-fog" style="top:${10 + i * 22}%;--t:${rand(40, 70).toFixed(0)}s;--d:-${rand(0, 70).toFixed(0)}s"></i>`)}${many(9, () => `<i class="fx-fly fx-ghost" style="left:${pct(2, 98)};top:${pct(10, 95)};--t:${rand(7, 12).toFixed(1)}s;--d:-${rand(0, 12).toFixed(1)}s;--dx:${rand(-60, 60).toFixed(0)}px;--dy:${rand(-40, 30).toFixed(0)}px"></i>`)}`,
  madlab: () => `<i class="fx-scan"></i>${many(10, () => `<i class="fx-bubble fx-toxic" style="left:${pct(60, 99)};--s:${rand(5, 13).toFixed(0)}px;--t:${rand(5, 10).toFixed(1)}s;--d:-${rand(0, 10).toFixed(1)}s"></i>`)}`,
  abyss: () => `<i class="fx-halo fx-magma"></i>${many(22, () => `<i class="fx-mote fx-ember" style="left:${pct(1, 99)};--s:${rand(3, 7).toFixed(0)}px;--dx:${rand(-60, 60).toFixed(0)}px;--t:${rand(6, 13).toFixed(1)}s;--d:-${rand(0, 13).toFixed(1)}s"></i>`)}`,
  undead: () => `${many(2, i => `<i class="fx-fog fx-mist" style="--t:${50 + i * 20}s;--d:-${rand(0, 50).toFixed(0)}s"></i>`)}${many(4, i => `<i class="fx-wisp fx-soul" style="left:${8 + i * 24}%;--t:${rand(18, 28).toFixed(1)}s;--d:-${rand(0, 25).toFixed(1)}s"></i>`)}`,
  sprite: () => `<i class="fx-haze fx-nebula"></i>${many(16, () => `<i class="fx-glint fx-star" style="left:${pct(1, 99)};top:${pct(2, 98)};--c:${['#7cf7ff', '#ff7ad9', '#fff', '#b48cff'][Math.floor(Math.random() * 4)]};--t:${rand(3, 7).toFixed(1)}s;--d:-${rand(0, 7).toFixed(1)}s"></i>`)}${many(2, () => `<i class="fx-shoot" style="left:${pct(0, 50)};top:${pct(0, 35)};--t:${rand(9, 15).toFixed(1)}s;--d:-${rand(0, 15).toFixed(1)}s"></i>`)}`,
  cellar: () => `<i class="fx-cellar"></i><i class="fx-gloom"></i>${many(6, () => `<i class="fx-drip" style="left:${pct(3, 97)};--t:${rand(7, 14).toFixed(1)}s;--d:-${rand(0, 14).toFixed(1)}s"></i>`)}<i class="fx-oryx"><b></b><b></b></i><i class="fx-sigil"></i>`,
  rum: () => `<i class="fx-wave"></i><i class="fx-wave b"></i>${many(9, () => `<i class="fx-bubble" style="left:${pct(2, 98)};--s:${rand(4, 11).toFixed(0)}px;--t:${rand(6, 13).toFixed(1)}s;--d:-${rand(0, 13).toFixed(1)}s"></i>`)}${many(3, i => `<i class="fx-wisp" style="left:${10 + i * 32}%;--t:${rand(16, 24).toFixed(1)}s;--d:-${rand(0, 20).toFixed(1)}s"></i>`)}`,
  snakeoil: () => '<i class="fx-slick"></i>' + many(10, () => `<i class="fx-mote fx-soap" style="left:${pct(2, 98)};--s:${rand(16, 42).toFixed(0)}px;--dx:${rand(-50, 50).toFixed(0)}px;--t:${rand(16, 28).toFixed(1)}s;--d:-${rand(0, 28).toFixed(1)}s"></i>`),
  mushroom: () => `<i class="fx-trip"></i>${many(7, () => `<i class="fx-spore" style="left:${pct(0, 100)};top:${pct(10, 95)};--s:${rand(14, 40).toFixed(0)}px;--t:${rand(7, 12).toFixed(1)}s;--d:-${rand(0, 12).toFixed(1)}s"></i>`)}` + many(3, i => `<i class="fx-ripple" style="--c:${['#ff4d6d', '#fff35c', '#5cd6ff'][i]};--d:-${i * 3}s"></i>`),
  sunrise: () => '<i class="fx-sun"></i><i class="fx-glare"></i><i class="fx-palm"></i><i class="fx-palm b"></i>' + many(4, () => `<i class="fx-gull" style="top:${pct(8, 40)};--k:${rand(.5, 1).toFixed(2)};--dy:${rand(-40, 30).toFixed(0)}px;--t:${rand(26, 40).toFixed(1)}s;--d:-${rand(0, 40).toFixed(1)}s"><b></b></i>`),
  paradise: () => `<i class="fx-caustics"></i><i class="fx-caustics b"></i><i class="fx-surface"></i>${many(5, i => `<i class="fx-ray" style="left:${8 + i * 21 + rand(-5, 5)}%;--a:${rand(-14, 14).toFixed(1)}deg;--t:${rand(7, 12).toFixed(1)}s;--d:-${rand(0, 12).toFixed(1)}s"></i>`)}<i class="fx-deep"></i>${many(12, () => `<i class="fx-mote" style="left:${pct(2, 98)};--s:${rand(3, 9).toFixed(0)}px;--dx:${rand(-40, 40).toFixed(0)}px;--t:${rand(12, 24).toFixed(1)}s;--d:-${rand(0, 24).toFixed(1)}s"></i>`)}${many(5, () => `<i class="fx-glint" style="left:${pct(3, 97)};top:${pct(4, 30)};--t:${rand(3, 6).toFixed(1)}s;--d:-${rand(0, 6).toFixed(1)}s"></i>`)}` + many(7, () => `<i class="fx-fish" style="top:${pct(35, 60)};--dy:${rand(-50, 50).toFixed(0)}px;--t:28s;--d:-${rand(0, 3).toFixed(1)}s"><b></b></i>`),
  passion: () => `<i class="fx-haze"></i>${many(11, () => `<i class="fx-petal" style="top:${pct(-10, 70)};--s:${rand(10, 20).toFixed(0)}px;--t:${rand(11, 19).toFixed(1)}s;--d:-${rand(0, 19).toFixed(1)}s;--r:${rand(-200, 200).toFixed(0)}deg"></i>`)}` + many(7, () => `<i class="fx-bokeh" style="left:${pct(0, 95)};top:${pct(0, 90)};--s:${rand(60, 160).toFixed(0)}px;--dx:${rand(-80, 80).toFixed(0)}px;--dy:${rand(-60, 60).toFixed(0)}px;--t:${rand(8, 14).toFixed(1)}s;--d:-${rand(0, 14).toFixed(1)}s"></i>`),
  jungle: () => `<i class="fx-leaves"></i><i class="fx-leaves b"></i>${many(16, () => `<i class="fx-fly" style="left:${pct(2, 98)};top:${pct(25, 98)};--t:${rand(5, 10).toFixed(1)}s;--d:-${rand(0, 10).toFixed(1)}s;--dx:${rand(-60, 60).toFixed(0)}px;--dy:${rand(-50, 20).toFixed(0)}px"></i>`)}` + many(6, () => `<i class="fx-leaf" style="left:${pct(2, 98)};--dx:${rand(-120, 120).toFixed(0)}px;--t:${rand(14, 22).toFixed(1)}s;--d:-${rand(0, 22).toFixed(1)}s"></i>`)
};
// The stat potions are the plain everyday themes: their effects only play for a few seconds
// after drinking one, then fade away and leave the clean theme.
const POTION_FX_MS = 4000;
let fxTimer = null;
function themeFx(key, intro = false) {
  clearTimeout(fxTimer);
  const brief = POTIONS.some(t => t[0] === key);
  fxLayer.className = intro ? 'intro' : '';
  fxLayer.innerHTML = brief && !intro ? '' : FX[key]?.() ?? '';
  if (brief && intro) {
    fxTimer = setTimeout(() => {
      fxLayer.classList.add('outro');
      fxTimer = setTimeout(() => { fxLayer.innerHTML = ''; fxLayer.className = ''; }, 1000);
    }, POTION_FX_MS);
  }
}
// One-shot effects as the server sends them (src/world/consumables.rs): a nova ring around the
// player (the item's range, or 1 tile for a condition), and the healed amount in green.
const TILE = 28;
function fxAt(el) {
  const r = el?.getBoundingClientRect();
  return r ? {x: r.left + r.width / 2, y: r.top + r.height / 2} : {x: innerWidth / 2, y: innerHeight / 2};
}
function burst(cls, {x, y}, style = '', text = '') {
  if (reducedMotion() && cls !== 'fx-status') return;
  const el = document.createElement('div');
  el.className = `fx-burst ${cls}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `left:${x}px;top:${y}px;${style}`;
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 1600);
}
const effectTimers = new Map();
function condition(name, seconds) {
  if (reducedMotion() && name !== 'invisible') return;
  clearTimeout(effectTimers.get(name));
  document.documentElement.classList.add(name);
  effectTimers.set(name, setTimeout(() => { document.documentElement.classList.remove(name); if (name === 'hallucinating') hallucinate(false); }, seconds * 1000));
  if (name === 'hallucinating') hallucinate(true);
}
function sober() {
  for (const [name, t] of effectTimers) { clearTimeout(t); document.documentElement.classList.remove(name); }
  effectTimers.clear();
  hallucinate(false);
}
function brewEffects(fx, at) {
  if (fx.heal) {
    burst('fx-nova', at, `--r:${fx.range * TILE}px`);
    burst('fx-status', {x: at.x, y: at.y - 24}, '', `+${fx.heal}`);
  }
  if (fx.boost) burst('fx-heal', at);
  for (const name of ['drunk', 'invisible', 'hallucinating']) {
    if (!fx[name]) continue;
    burst('fx-nova', at, `--r:${TILE}px`);
    condition(name, fx[name]);
  }
}
// Hallucinating: as in the client, things are drawn with the wrong textures. Every sprite on the
// page (items, classes and enemies) is swapped for a random one, again and again, until it ends.
let tripTimer = null;
async function hallucinate(on) {
  clearInterval(tripTimer);
  tripTimer = null;
  if (!on) {
    document.querySelectorAll('[data-sober]').forEach(el => {
      if (el.tagName === 'IMG') el.src = el.dataset.sober; else el.style.backgroundPosition = el.dataset.sober;
      el.removeAttribute('data-sober');
    });
    return;
  }
  const E = await loadEnemies();
  const items = [...ITEMS.values()].filter(i => i.sprite);
  const classes = [...CLASSES.values()];
  const bySize = new Map();
  for (const e of E.list) if (e.sprite) { const k = `${e.sprite.w}x${e.sprite.h}`; if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(e); }
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const swap = () => {
    for (const el of document.querySelectorAll('main .sprite:not(.none), main img.cls, main .esprite:not(.none)')) {
      if (Math.random() < 0.5) continue;
      if (!el.dataset.sober) el.dataset.sober = el.tagName === 'IMG' ? el.getAttribute('src') : el.style.backgroundPosition;
      if (el.tagName === 'IMG') { el.src = `/catalog/classes/${pick(classes).slug}.png`; continue; }
      const scale = parseFloat(el.style.backgroundSize) / (el.classList.contains('esprite') ? E.sheetWidth : 320);
      if (el.classList.contains('esprite')) {
        const same = bySize.get(`${Math.round(parseFloat(el.style.width) / scale)}x${Math.round(parseFloat(el.style.height) / scale)}`);
        const e = same && pick(same);
        if (e) el.style.backgroundPosition = `-${e.sprite.x * scale}px -${e.sprite.y * scale}px`;
      } else {
        const it = pick(items);
        el.style.backgroundPosition = `-${it.sprite.x * scale}px -${it.sprite.y * scale}px`;
      }
    }
  };
  swap();
  tripTimer = setInterval(swap, 1200);
}
const closeThemes = () => { themeMenu.hidden = true; themeButton.setAttribute('aria-expanded', 'false'); };
themeButton.addEventListener('click', e => {
  e.stopPropagation();
  if (!themeMenu.hidden) return closeThemes();
  drawThemeMenu();
  themeMenu.hidden = false;
  themeButton.setAttribute('aria-expanded', 'true');
});
// Potions are drunk with a double-click (or Enter), the Nexus is a single click. The menu stays
// open, so potions can be drunk one after another.
themeMenu.addEventListener('click', e => {
  e.stopPropagation();
  if (e.target.closest('.inv-nexus')) nexus();
});
themeMenu.addEventListener('dblclick', e => {
  e.stopPropagation();
  const b = e.target.closest('.inv-slot');
  if (b) drink(b.dataset.themeKey);
});
themeMenu.addEventListener('keydown', e => {
  const b = e.target.closest('.inv-slot');
  if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); drink(b.dataset.themeKey); }
});
// A click that reaches only the page root is not a click outside the menu (it happens when a
// press and release land on different elements).
document.addEventListener('click', e => { if (!themeMenu.hidden && e.target !== document.documentElement && !e.target.closest('.settings')) closeThemes(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !themeMenu.hidden) { closeThemes(); themeButton.focus(); } });

// ---------- footer status ----------
async function footer() {
  try {
    const s = await get('/api/status');
    const last = s.jobs.hiscores.lastOk;
    document.getElementById('footer-status').textContent = last ? `Data updated ${ago(last)}.` : 'Waiting for the first update.';
  } catch { /* server stopped */ }
}

await Promise.all([loadCatalog(), loadCrown(), loadGraves(), loadAuras(), loadWalk()]);
drawBrand();
themeFx(document.documentElement.dataset.theme ?? '');
route();
footer();
setInterval(() => { footer(); loadCrown(); }, 60000);
