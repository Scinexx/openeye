// Fills in each player's history before OpenEye first saw them, one point per day, once
// the full graveyard has been collected. Built from what is on record:
//   collection   exact: the date each item was first looted
//   stars        the server's rule (src/store.rs AccountPresentation::stars): for each class
//                the best of living characters' fame and dead characters' total fame,
//                thresholds 20/150/400/800/2000
//   fame earned  the amount already credited for the time before tracking is kept exactly,
//                but spread over the days it was most likely earned instead of one lump
//   living fame  the best fame among characters alive that day
//   quests       no daily record exists, so a steady rise from 0
// Assumptions: a character's fame grows evenly from its creation to its death (or to now if
// alive); a dead character's creation time is estimated from its id, since character ids
// are handed out in order and living characters show the time for theirs.
import {now as nowTs} from './schema.js';

const DAY = 86400;
const THRESHOLDS = [20, 150, 400, 800, 2000];
const starsOf = best => [...best.values()].reduce((n, b) => n + THRESHOLDS.filter(t => b >= t).length, 0);

/** Creation time for a character id, interpolated between characters with known times. */
export function creationEstimator(known) {
  const pts = known.filter(k => Number.isSafeInteger(k.created_at)).sort((a, b) => a.char_id - b.char_id);
  return id => {
    if (!pts.length) return null;
    if (id <= pts[0].char_id) return pts[0].created_at;
    if (id >= pts.at(-1).char_id) return pts.at(-1).created_at;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].char_id <= id) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi];
    return Math.round(a.created_at + (b.created_at - a.created_at) * (id - a.char_id) / (b.char_id - a.char_id || 1));
  };
}

/**
 * Daily history for one account before `start` (its first tracked moment).
 * @param chars  [{class, created, ended, fame, dead, total}] fame = base fame at death (dead)
 *               or now (alive); ended = died_at, or `at` for living characters
 * @param finds  sorted found_at times of collected items
 * @param first  first tracked history row {stars, quests, total_fame}
 * @param lump   fame earned already credited for before `start`
 * @returns {history: [{at, base_fame, total_fame, stars, quests, collection}], gains: [{at, amount}]}
 */
export function accountHistory({chars, finds, first, lump, start}) {
  const begin = Math.min(...chars.map(c => c.created).filter(Number.isFinite), ...finds, start);
  const firstDay = Math.floor(begin / DAY) * DAY;
  const points = [];
  for (let d = firstDay; d + DAY - 1 < start; d += DAY) points.push(d + DAY - 1);
  const fameAt = (c, t) => {
    if (t < c.created) return null;
    if (c.dead && t >= c.ended) return null;
    const span = Math.max(1, c.ended - c.created);
    return Math.floor(c.fame * Math.min(1, (t - c.created) / span));
  };
  const earnedAt = t => chars.reduce((n, c) => n + (c.dead && t >= c.ended ? c.fame : t >= c.created ? fameAt(c, t) ?? 0 : 0), 0);
  const history = [{at: Math.max(0, begin - 60), base_fame: 0, total_fame: 0, stars: 0, quests: 0, collection: 0}];
  let found = 0;
  for (const t of points) {
    const best = new Map();
    let living = 0, wallet = 0;
    for (const c of chars) {
      if (c.dead && t >= c.ended) {
        best.set(c.class, Math.max(best.get(c.class) ?? 0, c.total));
        wallet += c.total;
        continue;
      }
      const f = fameAt(c, t);
      if (f === null) continue;
      living = Math.max(living, f);
      best.set(c.class, Math.max(best.get(c.class) ?? 0, f));
    }
    while (found < finds.length && finds[found] <= t) found++;
    history.push({
      at: t, base_fame: living, total_fame: Math.min(wallet, first.total_fame ?? wallet),
      stars: Math.min(starsOf(best), first.stars ?? Infinity),
      quests: Math.floor((first.quests ?? 0) * (t - begin) / Math.max(1, start - begin)),
      collection: found
    });
  }
  // Fame earned: the credited lump, shared out in proportion to each day's estimated gain.
  const gains = [];
  if (lump > 0) {
    const marks = points.length ? points : [start - 1];
    const total = earnedAt(start - 1);
    let given = 0, prev = 0;
    marks.forEach((t, i) => {
      const e = earnedAt(t);
      const amount = i === marks.length - 1 ? lump - given : total > 0 ? Math.floor(lump * (e - prev) / total) : 0;
      prev = e;
      if (amount > 0) { gains.push({at: t, amount}); given += amount; }
    });
  }
  return {history, gains};
}

/** Backfills every player not done yet. Returns the number of players filled in. */
export async function backfillHistory(db, at = nowTs()) {
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  // A few players per call keeps each write small; the rest follow on the next run.
  const players = await all('SELECT account, first_seen FROM players WHERE backfilled = 0 ORDER BY account LIMIT 15');
  if (!players.length) return 0;
  const todo = `p.account IN (${players.map(p => Number(p.account)).join(',')})`;
  const [known, deaths, living, finds, lumps, firsts] = await Promise.all([
    all('SELECT char_id, created_at FROM characters'),
    all(`SELECT d.account, d.char_id, d.class, d.died_at, d.base_fame, d.total_fame FROM deaths d
      JOIN players p ON p.account = d.account AND ${todo} WHERE d.died_at IS NOT NULL AND d.died_at < p.first_seen`),
    all(`SELECT c.account, c.char_id, c.class, c.fame, c.created_at FROM characters c
      JOIN players p ON p.account = c.account AND ${todo} WHERE c.created_at < p.first_seen`),
    all(`SELECT c.account, c.found_at FROM collection_items c
      JOIN players p ON p.account = c.account AND ${todo} WHERE c.found_at < p.first_seen ORDER BY c.found_at`),
    all(`SELECT g.account, SUM(g.amount) AS amount FROM fame_gains g
      JOIN players p ON p.account = g.account AND ${todo} WHERE g.at < p.first_seen GROUP BY g.account`),
    all(`SELECT h.account, h.stars, h.quests, h.total_fame FROM player_history h
      JOIN players p ON p.account = h.account AND ${todo}
      WHERE h.at = (SELECT MIN(x.at) FROM player_history x WHERE x.account = h.account AND x.at >= p.first_seen)`)
  ]);
  const created = creationEstimator(known);
  const group = (rows, key = 'account') => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) ?? []), r]), new Map());
  const deathsBy = group(deaths), livingBy = group(living), findsBy = group(finds);
  const lumpBy = new Map(lumps.map(r => [r.account, r.amount]));
  const firstBy = new Map(firsts.map(r => [r.account, r]));

  const history = [], gains = [];
  for (const p of players) {
    const start = p.first_seen;
    const chars = [
      ...(deathsBy.get(p.account) ?? []).map(d => {
        const est = created(d.char_id) ?? d.died_at - DAY;
        return {class: d.class, created: Math.min(est, d.died_at - 60), ended: d.died_at, dead: true,
          fame: d.base_fame ?? d.total_fame ?? 0, total: d.total_fame ?? d.base_fame ?? 0};
      }),
      ...(livingBy.get(p.account) ?? []).map(c => ({class: c.class, created: c.created_at, ended: at, dead: false, fame: c.fame ?? 0, total: 0}))
    ];
    const out = accountHistory({
      chars, finds: (findsBy.get(p.account) ?? []).map(f => f.found_at), first: firstBy.get(p.account) ?? {},
      lump: lumpBy.get(p.account) ?? 0, start
    });
    for (const r of out.history) history.push({account: p.account, ...r});
    for (const g of out.gains) gains.push({account: p.account, ...g});
  }
  const accounts = JSON.stringify(players.map(p => p.account));
  await db.batch([
    db.prepare(`DELETE FROM player_history WHERE account IN (SELECT value FROM json_each(?))
      AND at < (SELECT first_seen FROM players p WHERE p.account = player_history.account)`).bind(accounts),
    db.prepare(`DELETE FROM fame_gains WHERE account IN (SELECT value FROM json_each(?))
      AND at < (SELECT first_seen FROM players p WHERE p.account = fame_gains.account)`).bind(accounts),
    db.prepare(`INSERT OR REPLACE INTO player_history(account, at, base_fame, total_fame, stars, quests, collection)
      SELECT json_extract(value, '$.account'), json_extract(value, '$.at'), json_extract(value, '$.base_fame'),
        json_extract(value, '$.total_fame'), json_extract(value, '$.stars'), json_extract(value, '$.quests'),
        json_extract(value, '$.collection') FROM json_each(?)`).bind(JSON.stringify(history)),
    db.prepare(`INSERT OR REPLACE INTO fame_gains(account, at, amount)
      SELECT json_extract(value, '$.account'), json_extract(value, '$.at'), json_extract(value, '$.amount') FROM json_each(?)`)
      .bind(JSON.stringify(gains)),
    db.prepare('UPDATE players SET backfilled = 1 WHERE account IN (SELECT value FROM json_each(?))').bind(accounts)
  ]);
  return players.length;
}
