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
  total_fame: {title: 'Account fame', short: 'Account fame', help: 'Fame banked from dead characters, minus what was spent.'},
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
  if (!it?.sprite) return h`<span class="sprite none" style="width:${size}px;height:${size}px"></span>`;
  return h`<span class="sprite${missing ? ' missing' : ''}" style="width:${size}px;height:${size}px;background-size:${320 * scale}px auto;background-position:-${it.sprite.x * scale}px -${it.sprite.y * scale}px"></span>`;
}
function itemSlot(id, scale = 2, opts = {}) {
  const size = 16 * scale;
  if (id === -1 || id === null || id === undefined) return h`<span class="slot empty-slot" title="Empty slot"><span style="width:${size}px;height:${size}px;display:inline-block"></span></span>`;
  const it = ITEMS.get(id);
  const t = tierInfo(it);
  const title = it ? `${it.name}${t.label ? ` (${t.label})` : ''}` : `Unknown item ${id}`;
  return h`<a class="slot ${bag(it)}" href="/item/${id}" data-link title="${title}" aria-label="${title}">${itemSprite(id, scale, opts)}</a>`;
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
const playerLink = (name, stars) => h`<span class="player">${starIcon(stars)}<a href="/player/${encodeURIComponent(name)}" data-link>${name}</a></span>`;
// Bots have no player page, so their name is plain text with a badge.
const ownerLink = d => (d.is_bot ? h`<span class="who">${d.name} <span class="badge bot" title="A computer-controlled character run by the game server">Bot</span></span>` : playerLink(d.player ?? d.name, d.player_stars));
const discordIcon = id => (id ? h`<a class="discord" href="https://discord.com/users/${id}" rel="noopener" title="Discord account linked" aria-label="Discord profile"><svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path fill="#8b9cf7" d="M13.5 1A13 13 0 0 0 10.3 0l-.4.8a12 12 0 0 0-3.8 0L5.7 0a13 13 0 0 0-3.2 1C.4 4 0 7 .2 9.9A13 13 0 0 0 4.1 12l.8-1.3a8 8 0 0 1-1.3-.6l.3-.2a9 9 0 0 0 8.2 0l.3.2-1.3.6.8 1.3a13 13 0 0 0 3.9-2c.3-3.4-.5-6.3-2.3-8.9ZM5.4 8.3c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6Zm5.2 0c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6S12 5.8 12 6.7s-.6 1.6-1.4 1.6Z"/></svg></a>` : '');
const gear = (equipment, scale = 2, count = 4) => h`<span class="gear">${(equipment ?? []).slice(0, count).map(id => itemSlot(id, scale))}</span>`;

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
    return h`<p class="empty" style="padding-left:0">${BOARDS[key].title} has stayed at ${fmt(v)} since tracking began. The graph appears once it changes.</p>`;
  }
  const nowTs = Math.floor(Date.now() / 1000);
  const pts = history.map(r => ({t: r.at, v: r[key]}));
  pts.push({t: Math.max(nowTs, pts.at(-1).t + 1), v: pts.at(-1).v});
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  const vmax = Math.max(1, ...pts.map(p => p.v));
  const x = t => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = v => T + (1 - v / vmax) * (H - T - B);
  // Step line: values hold until the next observed change.
  let d = `M${x(pts[0].t)},${y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t)} V${y(pts[i].v)}`;
  const ticks = [0, 0.5, 1].map(f => Math.round(vmax * f));
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

function deathRows(rows, {showPlayer = true} = {}) {
  if (!rows.length) return h`<p class="empty">No deaths on the Legends board yet.</p>`;
  return h`<ul class="rows">${rows.map(d => h`<li>
    ${classSprite(d.class, 32)}
    <span class="grow">
      <a class="title" href="/death/${d.account}/${d.char_id}" data-link>${showPlayer ? h`${starIcon(d.player_stars)}${d.name}` : `${d.level ? `Level ${d.level} ` : ''}${className(d.class)}`}</a>
      <span class="sub">${showPlayer ? `${className(d.class)}${d.level ? `, level ${d.level}` : ''}` : ''}${d.killed_by ? raw(`${showPlayer ? ', ' : ''}killed by <span class="killed">${esc(d.killed_by)}</span>`) : ''}${d.died_at ? raw(` ${when(d.died_at)}`) : ''}</span>
    </span>
    ${gear(d.equipment, 1)}
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
      <p>Rankings, item collections and a limited graveyard, recorded from the live Open RotMG server around the clock.</p>
    </section>
    ${!hasData ? h`<div class="notice"><strong>Fetching the latest data.</strong> This page fills in within a few minutes.</div>` : ''}
    <section class="panel status-strip" aria-label="Server status">
      ${online}
      <div class="stat"><strong>${st?.ok ? fmt(st.players) : '–'}</strong><span>${st?.ok ? 'playing now' : st ? 'server unreachable' : 'checking server'}</span></div>
      <div class="stat"><strong>${s.status.peak24h ?? '–'}</strong><span>24h peak</span></div>
      <div class="stat"><strong>${fmt(s.counts.players)}</strong><span>ranked players</span></div>
      <div class="stat"><strong>${fmt(s.counts.distinctItems)}<span class="muted"> / ${fmt(s.counts.collectible)}</span></strong><span>items discovered</span></div>
      ${sparkline(dayPoints)}
    </section>
    <div class="grid-2">
      <section class="panel">
        <header><h2>Recent deaths</h2><a href="/graveyard" data-link>Graveyard</a></header>
        ${deathRows(s.recentDeaths)}
      </section>
      <section class="panel">
        <header><h2>Latest loot</h2><a href="/items" data-link>All items</a></header>
        ${s.recentFinds.length ? h`<ul class="rows">${s.recentFinds.slice(0, 10).map(f => h`<li>
          ${itemSlot(f.item, 2)}
          <span class="grow"><span class="title">${ITEMS.get(f.item)?.name ?? `Item ${f.item}`}</span>
          <span class="sub">${playerLink(f.name, f.stars)} ${when(f.found_at)}</span></span>
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
          return p ? h`<td><span class="muted">${p.rank}.</span> ${playerLink(p.name)} <span class="fame">${fmt(p[b])}</span></td>` : h`<td class="muted">–</td>`;
        })}</tr>`)}</tbody>
      </table></div>
    </section>`);
  if (!hasData) setTimeout(() => location.pathname === '/' && route(), 15000);
}

async function rankings(board) {
  if (!BOARDS[board]) return notFound();
  const {players} = await get(`/api/rankings/${board}`);
  // Columns stay in the same order on every board; the selected one is highlighted.
  const cols = Object.keys(BOARDS);
  const draw = (filter = '') => {
    const rows = players.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
    document.getElementById('rank-body').innerHTML = String(rows.length ? h`${rows.map(p => h`<tr class="${p.rank === 1 ? 'top1' : ''}">
      <td class="rank">${p.rank}</td>
      <td><span class="who">${playerLink(p.name, p.stars)} ${discordIcon(p.discord_id)}</span></td>
      ${cols.map(c => h`<td class="n${c === board ? ' main-metric' : ''}">${fmt(p[c])}</td>`)}
    </tr>`)}` : h`<tr><td colspan="${cols.length + 2}" class="empty">No players match “${filter}”.</td></tr>`);
  };
  view(h`
    <div class="page-head"><div><h1>Rankings</h1><p>${BOARDS[board].help}</p></div></div>
    <nav class="tabs" aria-label="Ranking boards">${Object.entries(BOARDS).map(([k, b]) => h`<a href="/rankings/${k}" data-link ${k === board ? raw('aria-current="page"') : ''}>${b.title}</a>`)}</nav>
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
      ${starIcon(p.stars, 34)}
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
      <dd class="${k === 'stars' || k.includes('fame') ? 'fame' : ''}">${fmt(p[k])}${k === 'collection' ? h`<span class="muted" style="font-size:1rem"> / ${collectible.length}</span>` : ''}</dd>
      <span class="rank-line">${data.ranks[k] ? h`<a href="/rankings/${k}" data-link>Rank ${data.ranks[k]}</a> of ${data.rankedPlayers}` : 'Unranked'}</span>
    </div>`)}</dl>
    ${legendsBySpan.length ? h`<section class="panel" style="margin-bottom:24px"><header><h2>On the Legends board</h2></header>
      <div class="panel-body legend-badges">${legendsBySpan.map(l => h`<a class="badge gold" href="/death/${p.account}/${l.char_id}" data-link>${SPANS[l.timespan]}: rank ${l.rank}, ${fmt(l.total_fame)} fame</a>`)}</div></section>` : ''}
    <div class="grid-2">
      <section class="panel">
        <header><h2>Progress</h2></header>
        <div class="panel-body">
          <div class="tabs compact" role="group" aria-label="Chart metric">${Object.entries(BOARDS).map(([k, b], i) => h`<button type="button" data-metric="${k}" aria-pressed="${i === 0}">${b.short}</button>`)}</div>
          <div id="chart"></div>
          <p class="chart-readout">${data.history.length} update${data.history.length === 1 ? '' : 's'} since ${day(p.first_seen)}.</p>
        </div>
      </section>
      <section class="panel">
        <header><h2>Graveyard</h2><span class="muted">${data.deaths.length} on the Legends board</span></header>
        ${deathRows(data.deaths, {showPlayer: false})}
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

  const drawChart = key => { document.getElementById('chart').innerHTML = String(historyChart(data.history, key)); };
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
      return h`<a class="slot ${found.has(id) ? bag(it) : ''}" href="/item/${id}" data-link title="${title}" aria-label="${title}">${itemSprite(id, 2, {missing: !found.has(id)})}</a>`;
    })}`);
  };
  document.getElementById('col-sort').addEventListener('change', drawCollection);
  document.getElementById('col-owned').addEventListener('change', drawCollection);
  document.getElementById('col-tier').addEventListener('change', drawCollection);
  drawCollection();
}

async function graveyard() {
  const params = new URLSearchParams(location.search);
  const page = Number(params.get('page')) || 1, sort = params.get('sort') === 'fame' ? 'fame' : 'recent', cls = Number(params.get('class')) || 0;
  const who = params.get('who') === 'bots' ? 'bots' : 'players';
  const g = await get(`/api/graveyard?page=${page}&sort=${sort}&who=${who}${cls ? `&class=${cls}` : ''}`);
  const pages = Math.max(1, Math.ceil(g.total / g.per));
  const link = (changes) => {
    const p = new URLSearchParams({who, page, sort, ...(cls ? {class: cls} : {}), ...changes});
    if (p.get('who') === 'players') p.delete('who');
    if (p.get('class') === '0') p.delete('class');
    if (p.get('page') === '1') p.delete('page');
    if (p.get('sort') === 'recent') p.delete('sort');
    const qs = p.toString();
    return `/graveyard${qs ? `?${qs}` : ''}`;
  };
  const counts = new Map(g.byClass.map(c => [c.class, c]));
  view(h`
    <div class="page-head"><div><h1>Legends graveyard</h1><p>Deaths that made it to the leaderboard</p></div></div>
    <nav class="tabs" aria-label="Whose deaths">
      <a href="${link({who: 'players', page: 1, class: 0})}" data-link ${who === 'players' ? raw('aria-current="page"') : ''}>Players <span class="muted">${fmt(g.totals.players)}</span></a>
      <a href="${link({who: 'bots', page: 1, class: 0})}" data-link ${who === 'bots' ? raw('aria-current="page"') : ''}>Bots <span class="muted">${fmt(g.totals.bots)}</span></a>
    </nav>
    <div class="controls">
      <nav class="tabs" style="margin:0" aria-label="Sort">
        <a href="${link({sort: 'recent', page: 1})}" data-link ${sort === 'recent' ? raw('aria-current="page"') : ''}>Most recent</a>
        <a href="${link({sort: 'fame', page: 1})}" data-link ${sort === 'fame' ? raw('aria-current="page"') : ''}>Most fame</a>
      </nav>
      <div class="class-filter tabs" style="margin:0" aria-label="Filter by class">
        <a href="${link({class: 0, page: 1})}" data-link ${!cls ? raw('aria-current="page"') : ''}>All</a>
        ${[...CLASSES.values()].map(c => h`<a href="${link({class: c.id, page: 1})}" data-link ${cls === c.id ? raw('aria-current="page"') : ''} title="${c.name}: ${counts.get(c.id)?.n ?? 0} deaths" style="padding:4px 6px;line-height:0">${classSprite(c.id, 24)}</a>`)}
      </div>
    </div>
    <section class="panel">
      <div class="table-wrap"><table>
        <thead><tr><th>Character</th><th>${who === 'bots' ? 'Bot' : 'Player'}</th><th class="n">Fame</th><th>Equipment</th><th>Killed by</th><th>Died</th></tr></thead>
        <tbody>${g.rows.length ? g.rows.map(d => h`<tr>
          <td><a class="who" href="/death/${d.account}/${d.char_id}" data-link>${classSprite(d.class, 32)} <span>${d.level ? `Level ${d.level} ` : ''}${className(d.class)}</span></a></td>
          <td>${ownerLink(d)}</td>
          <td class="n main-metric">${fmt(d.total_fame)}</td>
          <td>${gear(d.equipment, 1)}</td>
          <td class="killed">${d.killed_by ?? ''}</td>
          <td>${d.died_at ? when(d.died_at) : h`<span class="muted">Loading</span>`}</td>
        </tr>`) : h`<tr><td colspan="6" class="empty">No ${who === 'bots' ? 'bot' : 'player'} deaths recorded${cls ? ` for ${className(cls)}` : ''} yet.</td></tr>`}</tbody>
      </table></div>
      <div class="pager">
        <span class="muted">${fmt(g.total)} ${who === 'bots' ? 'bot ' : ''}deaths, page ${page} of ${pages}</span>
        ${page > 1 ? h`<a class="btn" href="${link({page: page - 1})}" data-link>Previous</a>` : ''}
        ${page < pages ? h`<a class="btn" href="${link({page: page + 1})}" data-link>Next</a>` : ''}
      </div>
    </section>`);
}

async function death(account, charId) {
  let data;
  try { data = await get(`/api/death/${account}/${charId}`); }
  catch (e) { if (e.status === 404) return notFound(e.message); throw e; }
  const d = data.death, s = d.stats;
  const cls = CLASSES.get(d.class);
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
        <div><span class="fame-total">${fmt(d.total_fame)}</span> <span class="muted">total fame</span></div>
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
      ${cls ? h`<section class="panel"><header><h2>About the ${cls.name}</h2></header><div class="panel-body"><p class="muted">${cls.description}</p></div></section>` : ''}
    </div>` : ''}`);
}

async function legends(span) {
  if (!SPANS[span]) return notFound();
  const l = await get(`/api/legends/${span}`);
  view(h`
    <div class="page-head"><div><h1>Legends</h1><p>The 20 highest-fame deaths from the game’s own Legends board, bots included. Updated ${l.updated ? ago(l.updated) : 'soon'}.</p></div></div>
    <nav class="tabs" aria-label="Period">${Object.entries(SPANS).map(([k, t]) => h`<a href="/legends/${k}" data-link ${k === span ? raw('aria-current="page"') : ''}>${t}</a>`)}</nav>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Rank</th><th>Character</th><th>Player</th><th class="n">Fame</th><th>Equipment</th><th>Killed by</th></tr></thead>
      <tbody>${l.rows.length ? l.rows.map(d => h`<tr class="${d.rank === 1 ? 'top1' : ''}">
        <td class="rank">${d.rank}</td>
        <td><a class="who" href="/death/${d.account}/${d.char_id}" data-link>${classSprite(d.class, 32)} ${className(d.class)}</a></td>
        <td>${ownerLink(d)}</td>
        <td class="n main-metric">${fmt(d.total_fame)}</td>
        <td>${gear(d.equipment, 2)}</td>
        <td class="killed">${d.killed_by ?? ''}</td>
      </tr>`) : h`<tr><td colspan="6" class="empty">No deaths on this board yet.</td></tr>`}</tbody>
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
  const d = await get(`/api/item/${id}`);
  const t = tierInfo(it);
  document.title = `${it.name} | OpenEye`;
  view(h`
    <div class="item-hero">
      <span class="slot ${bag(it)}">${itemSprite(id, 4)}</span>
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
    ${d.deaths.length ? h`<section class="panel" style="margin-top:24px"><header><h2>Died wearing it</h2></header>${deathRows(d.deaths)}</section>` : ''}`);
}

async function about() {
  const s = await get('/api/status');
  const names = {health: 'Server', hiscores: 'Players', legends: 'Legends', deaths: 'Deaths'};
  view(h`
    <div class="page-head"><div><h1>About</h1></div></div>
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
    </div>`);
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
  [/^\/about$/, () => about(), 'about']
];

const TITLES = {rankings: 'Rankings', graveyard: 'Legends graveyard', legends: 'Legends', loot: 'Loot', items: 'Items', about: 'About'};
async function route() {
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

// ---------- player search ----------
const input = document.getElementById('search-input');
const results = document.getElementById('search-results');
let searchTimer, active = -1;
const closeSearch = () => { results.hidden = true; active = -1; };
input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (!q) return closeSearch();
  searchTimer = setTimeout(async () => {
    const r = await get(`/api/search?q=${encodeURIComponent(q)}`).catch(() => ({players: [], former: []}));
    const items = [
      ...r.players.map(p => h`<li><a href="/player/${encodeURIComponent(p.name)}" data-link><span class="player">${starIcon(p.stars)}${p.name}</span><span class="muted">${fmt(p.stars)}</span></a></li>`),
      ...r.former.map(f => h`<li><a href="/player/${encodeURIComponent(f.name)}" data-link><span class="player">${starIcon(f.stars)}${f.name}</span><span class="muted">was ${f.former}</span></a></li>`)
    ];
    results.innerHTML = String(items.length ? h`${items}` : h`<li class="hint">No player called “${q}” has been seen yet.</li>`);
    results.hidden = false;
    active = -1;
  }, 120);
});
input.addEventListener('keydown', e => {
  const links = [...results.querySelectorAll('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!links.length) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links.forEach((l, i) => l.classList.toggle('active', i === active));
  } else if (e.key === 'Escape') closeSearch();
});
input.form.addEventListener('submit', e => {
  e.preventDefault();
  const links = [...results.querySelectorAll('a')];
  const target = links[Math.max(0, active)];
  if (target) navigate(target.getAttribute('href'));
  else if (input.value.trim()) navigate(`/player/${encodeURIComponent(input.value.trim())}`);
  input.value = '';
  closeSearch();
});
results.addEventListener('click', () => { input.value = ''; closeSearch(); });
document.addEventListener('click', e => { if (!input.form.contains(e.target)) closeSearch(); });

// ---------- footer status ----------
async function footer() {
  try {
    const s = await get('/api/status');
    const last = s.jobs.hiscores.lastOk;
    document.getElementById('footer-status').textContent = last ? `Data updated ${ago(last)}.` : 'Waiting for the first update.';
  } catch { /* server stopped */ }
}

await loadCatalog();
route();
footer();
setInterval(footer, 60000);
