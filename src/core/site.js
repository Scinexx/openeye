// OpenEye's read-only JSON API. Shared by the Cloudflare Worker and the local server.
// There are no write or admin endpoints: everything here only reads the database.
import {getMeta, now} from './schema.js';

// Account fame (total_fame) is still recorded but not ranked: it is only what a player has left to spend.
export const BOARDS = ['stars', 'base_fame', 'fame_earned', 'collection', 'quests'];

export const SECURITY_HEADERS = {
  // Sprites are positioned with inline style attributes, so styles allow 'unsafe-inline'; scripts never do.
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A death belongs to a bot when its account has never been on the hiscores:
// the game server keeps every bot account off the hiscores and out of collections.
const IS_BOT = 'NOT EXISTS (SELECT 1 FROM players bp WHERE bp.account = d.account)';
const BOT_CONFIRMED = 'EXISTS (SELECT 1 FROM bots b WHERE b.name = d.name)';

const DEATH_COLS = `d.account, d.char_id, d.name, d.class, d.tex1, d.tex2, d.equipment, d.total_fame, d.base_fame,
  d.level, d.died_at, d.killed_by, d.discovered_at, d.detail_status,
  COALESCE(d.base_stats, (SELECT cs.stats FROM char_stats cs WHERE cs.char_id = d.char_id)) AS base_stats,
  ${IS_BOT} AS is_bot, ${BOT_CONFIRMED} AS bot_confirmed,
  (SELECT sp.stars FROM players sp WHERE sp.account = d.account) AS player_stars`;

const parseDeath = d => d && ({
  ...d,
  is_bot: !!d.is_bot,
  bot_confirmed: !!d.bot_confirmed,
  equipment: JSON.parse(d.equipment),
  base_stats: d.base_stats ? JSON.parse(d.base_stats) : null,
  stats: d.stats ? JSON.parse(d.stats) : null,
  bonuses: d.bonuses ? JSON.parse(d.bonuses) : null
});

// Item types for the loot filters, by equipment slot (see tools/update-catalog.mjs for slot names).
export const LOOT_TYPES = [
  ['weapon', [1, 2, 3, 8, 17]],
  ['ability', [4, 5, 11, 12, 13, 15, 16, 18, 19, 20, 21, 22, 23]],
  ['armor', [6, 7, 14]],
  ['ring', [9]],
  ['consumable', [10]]
];
const listParam = (url, name, allowed) => {
  const raw = url.searchParams.get(name);
  return new Set(raw === null ? allowed : raw.split(',').filter(v => allowed.includes(v)));
};

// A player is ranked when they are on the game's hiscores, unless the account is a guest
// (name starting with "Guest") whose every stat is settings.minRankedStat or lower.
const rankedWhere = (min, alias = '') =>
  `${alias}listed = 1 AND NOT (${alias}name LIKE 'Guest%' AND MAX(${alias}stars, ${alias}base_fame, ${alias}total_fame, ${alias}fame_earned, ${alias}collection, ${alias}quests) <= ${Math.max(0, Math.floor(min))})`;
const rankedSqlFor = min => board => `SELECT account, name, discord_id, base_fame, total_fame, fame_earned, stars, quests, collection, first_seen, last_seen,
  RANK() OVER (ORDER BY ${board} DESC) AS rank FROM players WHERE ${rankedWhere(min)}`;

/**
 * @param db  D1 database or local adapter
 * @param catalog  {items: [...]} from public/catalog/items.json
 * @param settings  from loadSettings()
 */
export function makeApi(db, catalog, settings) {
  const q = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const one = (sql, ...args) => db.prepare(sql).bind(...args).first();
  const notableJson = JSON.stringify(catalog.items.filter(i => i.notable).map(i => i.id));
  const untiered = new Set(catalog.items.filter(i => i.untiered).map(i => i.id));
  const RANKED = rankedWhere(settings.minRankedStat);
  const rankedSql = rankedSqlFor(settings.minRankedStat);
  const rankedCount = async () => (await one(`SELECT COUNT(*) AS n FROM players WHERE ${RANKED}`)).n;

  // ---- loot history filters: each item gets a tier ('ut', '0', '1', ... or null) and a type ----
  const lootMeta = new Map(catalog.items.map(i => {
    const tier = i.untiered ? 'ut' : i.tier !== null && i.slot !== 10 ? String(i.tier) : null;
    const type = LOOT_TYPES.find(([, slots]) => slots.includes(i.slot))?.[0] ?? 'consumable';
    return [i.id, {tier, type, common: !!i.commonUt, name: i.name.toLowerCase()}];
  }));
  const lootTiers = ['ut', ...[...new Set([...lootMeta.values()].map(m => m.tier).filter(t => t && t !== 'ut'))]
    .sort((a, b) => Number(a) - Number(b))];

  async function status() {
    const since = now() - 86400;
    const [latest, day, peak] = await Promise.all([
      one('SELECT at, ok, players, bots, worlds, uptime FROM server_status ORDER BY at DESC LIMIT 1'),
      q('SELECT at, ok, players FROM server_status WHERE at >= ? ORDER BY at', since),
      one('SELECT MAX(players) AS peak FROM server_status WHERE at >= ?', since)
    ]);
    // Features that switch on by themselves once the game server publishes the data
    // (OpenRotMG server PR #624): living characters and the full graveyard.
    const features = {
      characters: Number(await getMeta(db, 'characters_at') ?? 0) > now() - 86400,
      graveyard: (await getMeta(db, 'graveyard_ok')) !== null
    };
    const jobs = {};
    for (const job of ['health', 'hiscores', 'legends', 'deaths', ...(features.graveyard ? ['graveyard'] : [])]) {
      const lastOk = Number(await getMeta(db, `last_ok:${job}`) ?? 0) || null;
      const err = await getMeta(db, `last_error:${job}`);
      const errAt = err ? Number(err.split(' ')[0]) : 0;
      // Public status shows freshness only; error details stay in the logs.
      jobs[job] = {lastOk, delayed: errAt > (lastOk ?? 0)};
    }
    return {now: now(), apiBase: settings.apiBase, server: latest ?? null, peak24h: peak?.peak ?? null, day, jobs, features};
  }

  /** Notable finds: rare UTs and top-tier drops, minus UTs that most players already own. */
  async function notableFinds(limit) {
    const players = await rankedCount();
    const popular = new Set(players >= settings.popularUtMinPlayers
      ? (await q(`SELECT item FROM collection_items c JOIN players p ON p.account = c.account AND ${rankedWhere(settings.minRankedStat, 'p.')}
          GROUP BY item HAVING COUNT(*) >= ?`, Math.ceil(players * settings.popularUtShare))).map(r => r.item)
      : []);
    // first: nobody had looted this item before (the earliest find of it on record).
    const rows = await q(`SELECT c.account, p.name, p.stars, c.item, c.found_at,
        NOT EXISTS (SELECT 1 FROM collection_items x WHERE x.item = c.item AND x.found_at < c.found_at) AS first
      FROM collection_items c JOIN players p ON p.account = c.account
      WHERE c.item IN (SELECT value FROM json_each(?)) ORDER BY c.found_at DESC LIMIT 200`, notableJson);
    return rows.filter(f => !(popular.has(f.item) && untiered.has(f.item))).slice(0, limit)
      .map(f => ({...f, first: !!f.first && untiered.has(f.item)}));
  }

  // ---- Legends: players only, never bots ----
  // Ranked from the player deaths OpenEye has recorded, by the game's own rules
  // (src/store/legends.rs): deaths in the last 7 or 30 days or ever, most total fame,
  // earlier death first on a tie, top 20. With the full graveyard (the server's
  // /api/graveyard) that is every player death; before it, only deaths that reached the
  // game's own Legends lists are known.
  const SPANS = {week: 7 * 86400, month: 30 * 86400, all: null};
  const LEGENDS_SIZE = 20;
  const fullGraveyard = async () => (await getMeta(db, 'graveyard_ok')) !== null;
  async function legendBoard(span) {
    const since = SPANS[span] ? now() - SPANS[span] : null;
    const rows = await q(`SELECT ${DEATH_COLS}, p.name AS player FROM deaths d JOIN players p ON p.account = d.account
      WHERE d.died_at IS NOT NULL${since ? ' AND d.died_at > ?' : ''}
      ORDER BY d.total_fame DESC, d.died_at ASC, d.char_id ASC LIMIT ${LEGENDS_SIZE}`, ...(since ? [since] : []));
    return rows.map((d, i) => ({...parseDeath(d), rank: i + 1}));
  }
  /** Every death on a players-only board: "account:char" -> [{timespan, rank}]. */
  async function legendPlaces() {
    const places = new Map();
    for (const span of Object.keys(SPANS)) {
      for (const d of await legendBoard(span)) {
        const key = `${d.account}:${d.char_id}`;
        if (!places.has(key)) places.set(key, []);
        places.get(key).push({timespan: span, rank: d.rank, char_id: d.char_id, total_fame: d.total_fame});
      }
    }
    return places;
  }

  /** Ranked players who gained the most living fame in the last 24 hours. The starting
   *  fame credited when tracking began is dated a day earlier, so it never counts here. */
  async function fameToday(limit = 3) {
    return q(`SELECT p.name, p.stars, SUM(g.amount) AS fame FROM fame_gains g
      JOIN players p ON p.account = g.account AND ${rankedWhere(settings.minRankedStat, 'p.')}
      WHERE g.at > ? GROUP BY g.account HAVING fame > 0 ORDER BY fame DESC, MAX(g.at) ASC LIMIT ?`, now() - 86400, limit);
  }
  /** The crown goes to whoever leads the last-24-hours fame board. */
  async function crown() {
    return {name: (await fameToday(1))[0]?.name ?? null};
  }

  async function summary() {
    const counts = await one(`SELECT
      (SELECT COUNT(*) FROM players WHERE ${RANKED}) AS players,
      (SELECT COUNT(*) FROM deaths d WHERE NOT ${IS_BOT}) AS deaths,
      (SELECT COUNT(*) FROM deaths d WHERE ${IS_BOT}) AS botDeaths,
      (SELECT COUNT(*) FROM collection_items) AS finds,
      (SELECT COUNT(DISTINCT item) FROM collection_items) AS distinctItems,
      (SELECT COUNT(*) FROM collectible_items) AS collectible`);
    const top = {};
    await Promise.all(BOARDS.map(async board => {
      top[board] = await q(`${rankedSql(board)} AND ${board} > 0 ORDER BY ${board} DESC, account LIMIT 5`);
    }));
    const recentDeaths = (await q(`SELECT ${DEATH_COLS} FROM deaths d WHERE NOT ${IS_BOT}
      ORDER BY COALESCE(d.died_at, d.discovered_at) DESC LIMIT 8`)).map(parseDeath);
    return {counts, top, recentDeaths, recentFinds: await notableFinds(10), fameToday: await fameToday(3), status: await status()};
  }

  /** Living characters of ranked players, for the Best characters board; with dead, every
   *  recorded player death instead (bots never), with its fame, gear and stats at death. */
  async function characters({dead = false} = {}) {
    if (dead) {
      const rows = await q(`SELECT d.char_id, d.account, p.name, p.stars, d.class, d.level, COALESCE(d.base_fame, d.total_fame) AS fame,
          d.total_fame, d.equipment, d.died_at,
          COALESCE(d.base_stats, (SELECT cs.stats FROM char_stats cs WHERE cs.char_id = d.char_id)) AS stats
        FROM deaths d JOIN players p ON p.account = d.account AND ${rankedWhere(settings.minRankedStat, 'p.')}
        WHERE d.died_at IS NOT NULL ORDER BY fame DESC, d.char_id LIMIT 5000`);
      return {dead: true, characters: rows.map(c => ({...c, stats: c.stats ? JSON.parse(c.stats) : null, equipment: JSON.parse(c.equipment).slice(0, 4)}))};
    }
    const rows = await q(`SELECT c.char_id, c.account, p.name, p.stars, c.class, c.level, c.fame, c.stats, c.equipment, c.tex1, c.tex2
      FROM characters c JOIN players p ON p.account = c.account AND ${rankedWhere(settings.minRankedStat, 'p.')}
      WHERE c.seen_at > ? ORDER BY c.fame DESC, c.char_id`, now() - 3600);
    return {characters: rows.map(c => ({...c, stats: JSON.parse(c.stats), equipment: JSON.parse(c.equipment)}))};
  }

  async function rankings(board) {
    if (!BOARDS.includes(board)) throw new HttpError(404, 'Unknown ranking');
    return {board, players: await q(`${rankedSql(board)} ORDER BY ${board} DESC, account`)};
  }

  async function search(text) {
    if (!text) return {players: [], former: []};
    const like = `%${text.replace(/[%_\\]/g, m => '\\' + m)}%`;
    const players = await q(`SELECT account, name, base_fame, stars, listed FROM players WHERE name LIKE ? ESCAPE '\\'
      ORDER BY (name = ? COLLATE NOCASE) DESC, listed DESC, stars DESC LIMIT 10`, like, text);
    const former = await q(`SELECT h.name AS former, p.account, p.name, p.stars FROM name_history h JOIN players p ON p.account = h.account
      WHERE h.name LIKE ? ESCAPE '\\' AND h.name != p.name LIMIT 5`, like);
    return {players, former};
  }

  async function player(name) {
    const p = await one('SELECT * FROM players WHERE name = ? COLLATE NOCASE ORDER BY listed DESC LIMIT 1', name);
    if (!p) {
      const old = await one(`SELECT p.name FROM name_history h JOIN players p ON p.account = h.account
        WHERE h.name = ? COLLATE NOCASE ORDER BY h.first_seen DESC LIMIT 1`, name);
      if (old) return {redirect: old.name};
      throw new HttpError(404, `No player named ${name} has been seen yet`);
    }
    const ranks = {};
    await Promise.all(BOARDS.map(async board => {
      ranks[board] = (await one(`SELECT rank FROM (${rankedSql(board)}) WHERE account = ?`, p.account))?.rank ?? null;
    }));
    const [rankedPlayers, names, history, collection, deaths, legends, fameGains, characters] = await Promise.all([
      rankedCount(),
      q('SELECT name, first_seen FROM name_history WHERE account = ? ORDER BY first_seen', p.account),
      q('SELECT at, base_fame, total_fame, stars, quests, collection FROM player_history WHERE account = ? ORDER BY at', p.account),
      q('SELECT item, found_at FROM collection_items WHERE account = ? ORDER BY found_at DESC', p.account),
      q(`SELECT ${DEATH_COLS} FROM deaths d WHERE d.account = ? ORDER BY COALESCE(d.died_at, d.discovered_at) DESC`, p.account),
      legendPlaces().then(m => [...m.entries()].filter(([k]) => k.startsWith(`${p.account}:`)).flatMap(([, v]) => v)
        .sort((a, b) => a.timespan.localeCompare(b.timespan) || a.rank - b.rank)),
      q('SELECT at, amount FROM fame_gains WHERE account = ? ORDER BY at', p.account),
      // Only while the player is listed and the server still publishes characters, so nothing stale shows.
      p.listed ? q(`SELECT char_id, class, level, exp, fame, stats, equipment, tex1, tex2, created_at FROM characters
        WHERE account = ? AND seen_at > ? ORDER BY fame DESC, level DESC, char_id`, p.account, now() - 3600) : []
    ]);
    const features = {characters: Number(await getMeta(db, 'characters_at') ?? 0) > now() - 86400, graveyard: (await getMeta(db, 'graveyard_ok')) !== null};
    return {player: p, ranks, rankedPlayers, names, history, collection, deaths: deaths.map(parseDeath), legends, fameGains, features,
      characters: characters.map(c => ({...c, stats: JSON.parse(c.stats), equipment: JSON.parse(c.equipment)}))};
  }

  /** Deaths, newest (or most fame) first. Bots are left out unless asked for; `name`
   *  matches the character's name or the player's current name. */
  async function graveyard({page = 1, sort = 'recent', cls = null, bots = false, name = '', per = 40}) {
    const order = sort === 'fame' ? 'd.total_fame DESC, d.died_at DESC' : 'COALESCE(d.died_at, d.discovered_at) DESC';
    const conds = [], args = [];
    if (!bots) conds.push(`NOT ${IS_BOT}`);
    if (name) {
      const like = `%${name.replace(/[%_\\]/g, m => '\\' + m)}%`;
      conds.push(`(d.name LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')`);
      args.push(like, like);
    }
    const base = `FROM deaths d LEFT JOIN players p ON p.account = d.account${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''}`;
    const where = `${base}${cls ? `${conds.length ? ' AND' : ' WHERE'} d.class = ?` : ''}`;
    const [total, rows, byClass, totals] = await Promise.all([
      one(`SELECT COUNT(*) AS n ${where}`, ...args, ...(cls ? [cls] : [])),
      q(`SELECT ${DEATH_COLS}, p.name AS player ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, ...(cls ? [cls] : []), per, (page - 1) * per),
      q(`SELECT d.class, COUNT(*) AS n ${base} GROUP BY d.class`, ...args),
      one(`SELECT SUM(NOT ${IS_BOT}) AS players, SUM(${IS_BOT}) AS bots FROM deaths d`)
    ]);
    const places = await legendPlaces();
    return {total: total.n, page, per, byClass, bots, name,
      rows: rows.map(d => ({...parseDeath(d), in_legends: places.has(`${d.account}:${d.char_id}`)})),
      totals: {players: totals?.players ?? 0, bots: totals?.bots ?? 0}};
  }

  async function death(account, charId) {
    const d = await one(`SELECT ${DEATH_COLS}, d.stats, d.bonuses, p.name AS player FROM deaths d LEFT JOIN players p ON p.account = d.account
      WHERE d.account = ? AND d.char_id = ?`, account, charId);
    if (!d) throw new HttpError(404, 'That character is not in the graveyard');
    const legends = ((await legendPlaces()).get(`${account}:${charId}`) ?? []).map(({timespan, rank}) => ({timespan, rank}));
    return {death: parseDeath(d), legends};
  }

  /** board 'vanilla': the game's own Legends list exactly as published, bots included. */
  async function legends(span, board = 'players') {
    if (!(span in SPANS)) throw new HttpError(404, 'Unknown legends period');
    if (board === 'vanilla') {
      const rows = await q(`SELECT l.rank, ${DEATH_COLS}, p.name AS player FROM legends l
        JOIN deaths d ON d.account = l.account AND d.char_id = l.char_id
        LEFT JOIN players p ON p.account = l.account WHERE l.timespan = ? ORDER BY l.rank`, span);
      return {span, board, rows: rows.map(parseDeath), source: 'game', size: LEGENDS_SIZE,
        updated: Number(await getMeta(db, 'last_ok:legends') ?? 0) || null};
    }
    const full = await fullGraveyard();
    const updated = Number(await getMeta(db, full ? 'last_ok:graveyard' : 'last_ok:legends') ?? 0) || null;
    return {span, board: 'players', rows: await legendBoard(span), source: full ? 'graveyard' : 'game', size: LEGENDS_SIZE, updated};
  }

  /** All-time history of collected items, newest first, with item name, tier, type, time and player filters. */
  async function loot({page = 1, tiers, types, common = false, days = 0, player = '', item = '', per = 50}) {
    // Items without a tier (potions and the like) only show when no tier filter is applied.
    const everyTier = lootTiers.every(t => tiers.has(t));
    // The item search matches anywhere in the name, ignoring case ("ring" finds "Snake Eye Ring").
    const needle = item.toLowerCase();
    const ids = [...lootMeta].filter(([, m]) => (m.tier === null ? everyTier : tiers.has(m.tier)) && types.has(m.type) && (common || !m.common)
      && (!needle || m.name.includes(needle)))
      .map(([id]) => id);
    const where = ['c.item IN (SELECT value FROM json_each(?))'];
    const args = [JSON.stringify(ids)];
    if (days > 0) { where.push('c.found_at >= ?'); args.push(now() - days * 86400); }
    if (player) { where.push('p.name = ? COLLATE NOCASE'); args.push(player); }
    const sql = `FROM collection_items c JOIN players p ON p.account = c.account WHERE ${where.join(' AND ')}`;
    const [total, rows] = await Promise.all([
      one(`SELECT COUNT(*) AS n ${sql}`, ...args),
      q(`SELECT c.account, p.name, p.stars, c.item, c.found_at ${sql} ORDER BY c.found_at DESC, c.item LIMIT ? OFFSET ?`, ...args, per, (page - 1) * per)
    ]);
    return {total: total.n, page, per, rows};
  }

  async function items() {
    const [owners, collectible, players] = await Promise.all([
      q('SELECT item, COUNT(*) AS owners, MIN(found_at) AS first_found FROM collection_items GROUP BY item'),
      q('SELECT item FROM collectible_items'),
      rankedCount()
    ]);
    return {owners, collectible: collectible.map(r => r.item), players};
  }

  async function item(id) {
    const [owners, collectible, deaths, players] = await Promise.all([
      q(`SELECT c.account, p.name, p.stars, c.found_at FROM collection_items c JOIN players p ON p.account = c.account
        WHERE c.item = ? ORDER BY c.found_at`, id),
      one('SELECT 1 AS y FROM collectible_items WHERE item = ?', id),
      q(`SELECT ${DEATH_COLS}, p.name AS player FROM deaths d LEFT JOIN players p ON p.account = d.account
        WHERE NOT ${IS_BOT} AND d.equipment LIKE ? ORDER BY d.total_fame DESC LIMIT 200`, `%${id}%`),
      rankedCount()
    ]);
    return {id, owners, collectible: !!collectible,
      deaths: deaths.map(parseDeath).filter(d => d.equipment.includes(id)).slice(0, 20), players};
  }

  return {status, summary, crown, fameToday, rankings, characters, search, player, graveyard, death, legends, loot, lootTiers, items, item};
}

const int = (v, max) => Math.min(max, Math.max(1, Math.floor(Number(v)) || 1));

/** Map an /api/ URL to a handler call. Returns the response body object. */
export async function routeApi(api, url) {
  const p = url.pathname;
  let m;
  if (p === '/api/status') return api.status();
  if (p === '/api/crown') return api.crown();
  if (p === '/api/summary') return api.summary();
  if ((m = p.match(/^\/api\/rankings\/([a-z_]+)$/))) return api.rankings(m[1]);
  if (p === '/api/characters') return api.characters({dead: url.searchParams.get('dead') === '1'});
  if (p === '/api/search') return api.search((url.searchParams.get('q') ?? '').trim().slice(0, 20));
  if ((m = p.match(/^\/api\/player\/([^/]{1,40})$/))) {
    let name;
    try { name = decodeURIComponent(m[1]); } catch { throw new HttpError(400, 'Bad player name'); }
    return api.player(name.slice(0, 20));
  }
  if (p === '/api/graveyard') {
    return api.graveyard({
      page: int(url.searchParams.get('page'), 100000),
      sort: url.searchParams.get('sort') === 'fame' ? 'fame' : 'recent',
      cls: Number(url.searchParams.get('class')) || null,
      bots: url.searchParams.get('bots') === '1' || url.searchParams.get('who') === 'bots',
      name: (url.searchParams.get('q') ?? '').trim().slice(0, 20)
    });
  }
  if ((m = p.match(/^\/api\/death\/(\d{1,10})\/(\d{1,10})$/))) return api.death(Number(m[1]), Number(m[2]));
  if ((m = p.match(/^\/api\/legends\/([a-z]+)$/))) return api.legends(m[1], url.searchParams.get('board') === 'vanilla' ? 'vanilla' : 'players');
  if (p === '/api/loot') {
    return api.loot({
      page: int(url.searchParams.get('page'), 100000),
      tiers: listParam(url, 'tier', api.lootTiers),
      types: listParam(url, 'type', LOOT_TYPES.map(([t]) => t)),
      common: url.searchParams.get('common') !== '0',
      days: [1, 7, 30].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 0,
      player: (url.searchParams.get('player') ?? '').trim().slice(0, 20),
      item: (url.searchParams.get('item') ?? '').trim().slice(0, 40)
    });
  }
  if (p === '/api/items') return api.items();
  if ((m = p.match(/^\/api\/item\/(\d{1,6})$/))) return api.item(Number(m[1]));
  throw new HttpError(404, 'Unknown API route');
}

const jsonResponse = (body, status, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra}
});

/**
 * Handle one API request. `allow(key)` is the rate limiter; `log` gets internal errors.
 * Returns a standard Response, so it works in Workers and in Node 22.
 */
export async function handleApiRequest(request, {api, allow, clientKey, log = console}) {
  try {
    // The site is read-only: nothing accepts POST, PUT, DELETE or any other write.
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (request.url.length > 2048) throw new HttpError(414, 'Address too long');
    if (!(await allow(clientKey))) throw new HttpError(429, 'Too many requests. Try again in a minute.');
    const body = await routeApi(api, new URL(request.url));
    return jsonResponse(body, 200, {'cache-control': 'no-store'});
  } catch (e) {
    const status = e.status ?? 500;
    if (status === 500) log.error(e);
    // Internal error details are logged, never sent to visitors.
    return jsonResponse({error: status === 500 ? 'Something went wrong on this page.' : e.message}, status,
      status === 429 ? {'retry-after': '60'} : {});
  }
}
