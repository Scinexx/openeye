// OpenEye's read-only JSON API. Shared by the Cloudflare Worker and the local server.
// There are no write or admin endpoints: everything here only reads the database.
import {getMeta, now} from './schema.js';

export const BOARDS = ['stars', 'base_fame', 'total_fame', 'collection', 'quests'];

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
  ${IS_BOT} AS is_bot, ${BOT_CONFIRMED} AS bot_confirmed,
  (SELECT sp.stars FROM players sp WHERE sp.account = d.account) AS player_stars`;

const parseDeath = d => d && ({
  ...d,
  is_bot: !!d.is_bot,
  bot_confirmed: !!d.bot_confirmed,
  equipment: JSON.parse(d.equipment),
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
export const LOOT_RARITIES = ['ut', 'top', 'high', 'low', 'other'];
const listParam = (url, name, allowed) => {
  const raw = url.searchParams.get(name);
  return new Set(raw === null ? allowed : raw.split(',').filter(v => allowed.includes(v)));
};

const rankedSql = board => `SELECT account, name, discord_id, base_fame, total_fame, stars, quests, collection, first_seen, last_seen,
  RANK() OVER (ORDER BY ${board} DESC) AS rank FROM players WHERE listed = 1`;

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
  const rankedCount = async () => (await one('SELECT COUNT(*) AS n FROM players WHERE listed = 1')).n;

  // ---- loot history filters: each item gets a rarity and a type ----
  const topTier = {};
  for (const i of catalog.items) if (i.topTier) topTier[i.slot] = i.tier;
  const lootMeta = new Map(catalog.items.map(i => {
    let rarity = 'other';
    if (i.untiered) rarity = 'ut';
    else if (i.tier !== null && i.slot !== 10) {
      const top = topTier[i.slot];
      rarity = top === undefined ? 'low' : i.tier >= top ? 'top' : i.tier === top - 1 ? 'high' : 'low';
    }
    const type = LOOT_TYPES.find(([, slots]) => slots.includes(i.slot))?.[0] ?? 'consumable';
    return [i.id, {rarity, type, common: !!i.commonUt}];
  }));

  async function status() {
    const since = now() - 86400;
    const [latest, day, peak] = await Promise.all([
      one('SELECT at, ok, players, bots, worlds, uptime FROM server_status ORDER BY at DESC LIMIT 1'),
      q('SELECT at, ok, players FROM server_status WHERE at >= ? ORDER BY at', since),
      one('SELECT MAX(players) AS peak FROM server_status WHERE at >= ?', since)
    ]);
    const jobs = {};
    for (const job of ['health', 'hiscores', 'legends', 'deaths']) {
      const lastOk = Number(await getMeta(db, `last_ok:${job}`) ?? 0) || null;
      const err = await getMeta(db, `last_error:${job}`);
      const errAt = err ? Number(err.split(' ')[0]) : 0;
      // Public status shows freshness only; error details stay in the logs.
      jobs[job] = {lastOk, delayed: errAt > (lastOk ?? 0)};
    }
    return {now: now(), apiBase: settings.apiBase, server: latest ?? null, peak24h: peak?.peak ?? null, day, jobs};
  }

  /** Notable finds: rare UTs and top-tier drops, minus UTs that most players already own. */
  async function notableFinds(limit) {
    const players = await rankedCount();
    const popular = new Set(players >= settings.popularUtMinPlayers
      ? (await q(`SELECT item FROM collection_items c JOIN players p ON p.account = c.account AND p.listed = 1
          GROUP BY item HAVING COUNT(*) >= ?`, Math.ceil(players * settings.popularUtShare))).map(r => r.item)
      : []);
    const rows = await q(`SELECT c.account, p.name, p.stars, c.item, c.found_at FROM collection_items c JOIN players p ON p.account = c.account
      WHERE c.item IN (SELECT value FROM json_each(?)) ORDER BY c.found_at DESC LIMIT 200`, notableJson);
    return rows.filter(f => !(popular.has(f.item) && untiered.has(f.item))).slice(0, limit);
  }

  async function summary() {
    const counts = await one(`SELECT
      (SELECT COUNT(*) FROM players WHERE listed = 1) AS players,
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
    return {counts, top, recentDeaths, recentFinds: await notableFinds(10), status: await status()};
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
      ranks[board] = p.listed ? (await one(`SELECT rank FROM (${rankedSql(board)}) WHERE account = ?`, p.account))?.rank ?? null : null;
    }));
    const [rankedPlayers, names, history, collection, deaths, legends] = await Promise.all([
      rankedCount(),
      q('SELECT name, first_seen FROM name_history WHERE account = ? ORDER BY first_seen', p.account),
      q('SELECT at, base_fame, total_fame, stars, quests, collection FROM player_history WHERE account = ? ORDER BY at', p.account),
      q('SELECT item, found_at FROM collection_items WHERE account = ? ORDER BY found_at DESC', p.account),
      q(`SELECT ${DEATH_COLS} FROM deaths d WHERE d.account = ? ORDER BY COALESCE(d.died_at, d.discovered_at) DESC`, p.account),
      q('SELECT timespan, rank, char_id, total_fame FROM legends WHERE account = ? ORDER BY timespan, rank', p.account)
    ]);
    return {player: p, ranks, rankedPlayers, names, history, collection, deaths: deaths.map(parseDeath), legends};
  }

  async function graveyard({page = 1, sort = 'recent', cls = null, bots = false, per = 40}) {
    const order = sort === 'fame' ? 'd.total_fame DESC, d.died_at DESC' : 'COALESCE(d.died_at, d.discovered_at) DESC';
    const who = bots ? IS_BOT : `NOT ${IS_BOT}`;
    const where = `WHERE ${who}${cls ? ' AND d.class = ?' : ''}`;
    const args = cls ? [cls] : [];
    const [total, rows, byClass, totals] = await Promise.all([
      one(`SELECT COUNT(*) AS n FROM deaths d ${where}`, ...args),
      q(`SELECT ${DEATH_COLS}, p.name AS player FROM deaths d LEFT JOIN players p ON p.account = d.account ${where}
        ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, per, (page - 1) * per),
      q(`SELECT class, COUNT(*) AS n FROM deaths d WHERE ${who} GROUP BY class`),
      one(`SELECT SUM(NOT ${IS_BOT}) AS players, SUM(${IS_BOT}) AS bots FROM deaths d`)
    ]);
    return {total: total.n, page, per, rows: rows.map(parseDeath), byClass, bots,
      totals: {players: totals?.players ?? 0, bots: totals?.bots ?? 0}};
  }

  async function death(account, charId) {
    const d = await one(`SELECT ${DEATH_COLS}, d.stats, d.bonuses, p.name AS player FROM deaths d LEFT JOIN players p ON p.account = d.account
      WHERE d.account = ? AND d.char_id = ?`, account, charId);
    if (!d) throw new HttpError(404, 'That character is not in the graveyard');
    const legends = await q('SELECT timespan, rank FROM legends WHERE account = ? AND char_id = ?', account, charId);
    return {death: parseDeath(d), legends};
  }

  async function legends(span) {
    if (!['week', 'month', 'all'].includes(span)) throw new HttpError(404, 'Unknown legends period');
    const rows = await q(`SELECT l.rank, ${DEATH_COLS}, p.name AS player FROM legends l
      JOIN deaths d ON d.account = l.account AND d.char_id = l.char_id
      LEFT JOIN players p ON p.account = l.account WHERE l.timespan = ? ORDER BY l.rank`, span);
    return {span, rows: rows.map(parseDeath), updated: Number(await getMeta(db, 'last_ok:legends') ?? 0) || null};
  }

  /** All-time history of collected items, newest first, with rarity, type, time and player filters. */
  async function loot({page = 1, rarities, types, common = false, days = 0, player = '', per = 50}) {
    const ids = [...lootMeta].filter(([, m]) => rarities.has(m.rarity) && types.has(m.type) && (common || !m.common)).map(([id]) => id);
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

  return {status, summary, rankings, search, player, graveyard, death, legends, loot, items, item};
}

const int = (v, max) => Math.min(max, Math.max(1, Math.floor(Number(v)) || 1));

/** Map an /api/ URL to a handler call. Returns the response body object. */
export async function routeApi(api, url) {
  const p = url.pathname;
  let m;
  if (p === '/api/status') return api.status();
  if (p === '/api/summary') return api.summary();
  if ((m = p.match(/^\/api\/rankings\/([a-z_]+)$/))) return api.rankings(m[1]);
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
      bots: url.searchParams.get('who') === 'bots'
    });
  }
  if ((m = p.match(/^\/api\/death\/(\d{1,10})\/(\d{1,10})$/))) return api.death(Number(m[1]), Number(m[2]));
  if ((m = p.match(/^\/api\/legends\/([a-z]+)$/))) return api.legends(m[1]);
  if (p === '/api/loot') {
    return api.loot({
      page: int(url.searchParams.get('page'), 100000),
      rarities: listParam(url, 'rarity', LOOT_RARITIES),
      types: listParam(url, 'type', LOOT_TYPES.map(([t]) => t)),
      common: url.searchParams.get('common') !== '0',
      days: [1, 7, 30].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 0,
      player: (url.searchParams.get('player') ?? '').trim().slice(0, 20)
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
