// The collector polls the public game API and records everything into the database.
// On Cloudflare it runs from a Cron Trigger; locally from a timer. Jobs run one at a
// time with a pause between requests, so the game server never sees bursts.
import {createGameApi} from './gameapi.js';
import {getMeta, setMetaStmt, now} from './schema.js';
import {backfillHistory} from './backfill.js';

const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
const TIMESPANS = ['week', 'month', 'all'];
const MAX_DETAIL_TRIES = 5;
const COLLECTIONS_PER_RUN = 60;
const LOCK_SECONDS = 600;

// A death found in this run, of a character that died after guild tracking began, paid its
// fame to the guild its player is in (as the game does on death).
const creditGuilds = (db, at) => db.prepare(`UPDATE deaths SET guild_id = (SELECT guild_id FROM players p WHERE p.account = deaths.account)
  WHERE guild_id IS NULL AND (discovered_at >= ? OR died_at >= ?) AND died_at IS NOT NULL
    AND died_at >= COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'guilds_since'), 9e18)`).bind(at - 600, at - 3600);

export class Collector {
  /**
   * @param db  Cloudflare D1 database, or the local adapter with the same API
   * @param settings  from loadSettings()
   */
  constructor(db, settings, log = console) {
    this.db = db;
    this.s = settings;
    this.api = createGameApi(settings.apiBase);
    this.log = log;
    this.lastError = null;
  }

  async all(sql, ...args) { return (await this.db.prepare(sql).bind(...args).all()).results; }

  /** Requests still allowed in this run. */
  left() { return this.s.maxFetchesPerRun - this.api.used(); }

  // ---------- jobs ----------

  async syncHealth() {
    if (this.left() < 1) return false;
    const at = now();
    const db = this.db;
    try {
      const h = await this.api.health();
      await db.batch([
        db.prepare('INSERT OR REPLACE INTO server_status(at, ok, players, bots, worlds, uptime, revision) VALUES(?,?,?,?,?,?,?)')
          .bind(at, 1, h.players ?? null, h.bots ?? null, h.worlds ?? null, h.uptime_seconds ?? null, h.revision ?? null),
        // The all-time peak is kept in meta, since the status history only goes back 90 days.
        // First seeded from that history, then raised whenever a new record is seen.
        db.prepare(`INSERT OR IGNORE INTO meta(key, value) SELECT 'peak_players_at', at FROM server_status
          WHERE players IS NOT NULL ORDER BY players DESC, at ASC LIMIT 1`),
        db.prepare(`INSERT OR IGNORE INTO meta(key, value) SELECT 'peak_players', MAX(players) FROM server_status HAVING MAX(players) IS NOT NULL`),
        db.prepare(`UPDATE meta SET value = ? WHERE key = 'peak_players_at' AND ? > (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'peak_players')`)
          .bind(at, Number.isSafeInteger(h.players) ? h.players : -1),
        db.prepare(`UPDATE meta SET value = ? WHERE key = 'peak_players' AND ? > CAST(value AS INTEGER)`)
          .bind(String(Number.isSafeInteger(h.players) ? h.players : -1), Number.isSafeInteger(h.players) ? h.players : -1),
        db.prepare('DELETE FROM server_status WHERE at < ?').bind(at - 90 * 86400)
      ]);
    } catch (e) {
      await db.prepare('INSERT OR REPLACE INTO server_status(at, ok) VALUES(?, 0)').bind(at).run();
      throw e;
    }
    if (this.left() < 1) return true;
    await sleep(this.s.requestGapMs);
    await this.syncBots();
  }

  async syncBots() {
    const names = await this.api.bots();
    if (!names.length) return;
    const at = now();
    await this.db.prepare(`INSERT INTO bots(name, first_seen, last_seen) SELECT value, ?, ? FROM json_each(?)
      WHERE true ON CONFLICT(name) DO UPDATE SET last_seen = excluded.last_seen`).bind(at, at, JSON.stringify(names)).run();
  }

  /**
   * Guilds from the hiscores (once the server shares them): each guild's standing, each
   * player's guild and rank, a history point when a guild's numbers change, and events for
   * joins, departures, rank changes and hall upgrades. Deaths found from now on are credited
   * to the guild the player was in, as the game pays a member's death fame to their guild.
   */
  async guildStatements(data, known, at) {
    const db = this.db;
    const ok = n => Number.isSafeInteger(n) && n >= 0;
    const guilds = data.guilds.filter(g => ok(g.id) && typeof g.name === 'string' && ok(g.fame) && ok(g.earned))
      .map(g => ({id: g.id, name: g.name.slice(0, 40), level: ok(g.level) ? g.level : 1, fame: g.fame, earned: g.earned, members: ok(g.members) ? g.members : 0}));
    const ids = new Set(guilds.map(g => g.id));
    const old = new Map((await this.all('SELECT id, level, fame, earned, members FROM guilds')).map(r => [r.id, r]));
    const stmts = [db.prepare('UPDATE guilds SET listed = 0')];
    // Joins and departures are only news once guilds were already being followed: the first
    // time they appear, everyone is simply where they already were.
    const following = (await getMeta(db, 'guilds_since')) !== null;
    if (!following) stmts.push(setMetaStmt(db, 'guilds_since', at));
    stmts.push(setMetaStmt(db, 'guilds_at', at));
    for (const g of guilds) {
      const before = old.get(g.id);
      stmts.push(db.prepare(`INSERT INTO guilds(id, name, level, fame, earned, members, first_seen, last_seen, listed) VALUES(?,?,?,?,?,?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, level = excluded.level, fame = excluded.fame, earned = excluded.earned,
          members = excluded.members, last_seen = excluded.last_seen, listed = 1`).bind(g.id, g.name, g.level, g.fame, g.earned, g.members, at, at));
      if (!before || ['level', 'fame', 'earned', 'members'].some(k => before[k] !== g[k])) {
        stmts.push(db.prepare('INSERT OR REPLACE INTO guild_history(guild, at, level, fame, earned, members) VALUES(?,?,?,?,?,?)')
          .bind(g.id, at, g.level, g.fame, g.earned, g.members));
      }
      if (following && before && g.level > before.level) {
        stmts.push(db.prepare("INSERT OR IGNORE INTO guild_events(guild, at, account, kind, detail) VALUES(?,?,0,'upgrade',?)").bind(g.id, at, g.level));
      }
    }
    for (const p of data.players) {
      const m = p.guild && ok(p.guild.id) && ids.has(p.guild.id) ? p.guild : null;
      const id = m ? m.id : null, rank = m && ok(m.rank) ? m.rank : null, fame = m && ok(m.fame) ? m.fame : 0;
      stmts.push(db.prepare('UPDATE players SET guild_id = ?, guild_rank = ?, guild_fame = ? WHERE account = ?').bind(id, rank, fame, p.account));
      const was = known.get(p.account);
      if (!following || !was) continue;
      if (was.guild_id !== id) {
        if (was.guild_id !== null) stmts.push(db.prepare("INSERT OR IGNORE INTO guild_events(guild, at, account, kind) VALUES(?,?,?,'left')").bind(was.guild_id, at, p.account));
        if (id !== null) stmts.push(db.prepare("INSERT OR IGNORE INTO guild_events(guild, at, account, kind, detail) VALUES(?,?,?,'joined',?)").bind(id, at, p.account, rank));
      } else if (id !== null && was.guild_rank !== null && was.guild_rank !== rank) {
        stmts.push(db.prepare("INSERT OR IGNORE INTO guild_events(guild, at, account, kind, detail) VALUES(?,?,?,'rank',?)").bind(id, at, p.account, rank));
      }
    }
    return stmts;
  }

  async syncHiscores() {
    if (this.left() < 1) return false;
    const data = await this.api.hiscores();
    const at = now();
    const db = this.db;
    const known = new Map((await this.all('SELECT account, base_fame, total_fame, stars, quests, collection, guild_id, guild_rank FROM players'))
      .map(r => [r.account, r]));
    // Fame earned. On the first poll (or a player's first appearance) their current living
    // fame is credited as earned the day before; after that, every rise counts.
    const fameStarted = (await getMeta(db, 'fame_earned_since')) !== null;
    const DAY = 86400;
    const stmts = [db.prepare('UPDATE players SET listed = 0')];
    let added = 0, changed = 0;
    for (const p of data.players) {
      const v = [p.base_fame ?? 0, p.total_fame ?? 0, p.stars ?? 0, p.quests ?? 0, p.collection ?? 0].map(Number);
      const old = known.get(p.account);
      const baseline = !old || !fameStarted;
      const gain = baseline ? v[0] : Math.max(0, v[0] - old.base_fame);
      if (gain > 0) {
        stmts.push(db.prepare(`INSERT INTO fame_gains(account, at, amount) VALUES(?,?,?)
          ON CONFLICT(account, at) DO UPDATE SET amount = amount + excluded.amount`).bind(p.account, baseline ? at - DAY : at, gain));
      }
      const history = db.prepare('INSERT OR REPLACE INTO player_history(account, at, base_fame, total_fame, stars, quests, collection) VALUES(?,?,?,?,?,?,?)')
        .bind(p.account, at, ...v);
      if (!old) {
        stmts.push(db.prepare(`INSERT INTO players(account, name, discord_id, base_fame, total_fame, stars, quests, collection, first_seen, last_seen, listed, fame_earned)
          VALUES(?,?,?,?,?,?,?,?,?,?,1,?)`).bind(p.account, p.name, p.discord_id ?? null, ...v, at, at, gain), history);
        added++;
      } else {
        stmts.push(db.prepare(`UPDATE players SET name=?, discord_id=?, base_fame=?, total_fame=?, stars=?, quests=?, collection=?, last_seen=?, listed=1,
          fame_earned = fame_earned + ? WHERE account=?`).bind(p.name, p.discord_id ?? null, ...v, at, gain, p.account));
        const before = [old.base_fame, old.total_fame, old.stars, old.quests, old.collection];
        if (before.some((x, i) => x !== v[i])) { stmts.push(history); changed++; }
      }
      stmts.push(db.prepare('INSERT OR IGNORE INTO name_history(account, name, first_seen) VALUES(?,?,?)').bind(p.account, p.name, at));
    }
    if (Array.isArray(data.collectible_items)) {
      const list = JSON.stringify(data.collectible_items.filter(Number.isSafeInteger));
      stmts.push(
        db.prepare('DELETE FROM collectible_items WHERE item NOT IN (SELECT value FROM json_each(?))').bind(list),
        db.prepare('INSERT OR IGNORE INTO collectible_items(item) SELECT value FROM json_each(?)').bind(list)
      );
    }
    if (!fameStarted) stmts.push(setMetaStmt(db, 'fame_earned_since', at));
    // Living characters (server PR #624). Servers without it leave the field out and the
    // table is left alone. Only characters of listed players are kept, so bots never show.
    if (Array.isArray(data.characters)) {
      const listed = new Set(data.players.map(p => p.account));
      const chars = JSON.stringify(data.characters.filter(c => listed.has(c.account)).map(c => ({
        id: c.id, account: c.account, class: c.class, level: c.level, exp: Number.isSafeInteger(c.exp) ? c.exp : 0,
        fame: c.fame, stats: c.stats, equipment: c.equipment, tex1: Number.isSafeInteger(c.tex1) ? c.tex1 : 0,
        tex2: Number.isSafeInteger(c.tex2) ? c.tex2 : 0, created_at: Number.isSafeInteger(c.created_at) ? c.created_at : null
      })));
      stmts.push(
        db.prepare('DELETE FROM characters'),
        db.prepare(`INSERT OR REPLACE INTO characters(char_id, account, class, level, exp, fame, stats, equipment, tex1, tex2, created_at, seen_at)
          SELECT json_extract(value, '$.id'), json_extract(value, '$.account'), json_extract(value, '$.class'), json_extract(value, '$.level'),
            json_extract(value, '$.exp'), json_extract(value, '$.fame'), json_extract(value, '$.stats'), json_extract(value, '$.equipment'),
            json_extract(value, '$.tex1'), json_extract(value, '$.tex2'), json_extract(value, '$.created_at'), ? FROM json_each(?)`).bind(at, chars),
        db.prepare(`INSERT INTO char_stats(char_id, account, class, level, stats, seen_at)
          SELECT json_extract(value, '$.id'), json_extract(value, '$.account'), json_extract(value, '$.class'),
            json_extract(value, '$.level'), json_extract(value, '$.stats'), ? FROM json_each(?) WHERE true
          ON CONFLICT(char_id) DO UPDATE SET level = excluded.level, stats = excluded.stats, seen_at = excluded.seen_at`).bind(at, chars),
        setMetaStmt(db, 'characters_at', at)
      );
    }
    if (Array.isArray(data.guilds)) stmts.push(...await this.guildStatements(data, known, at));
    await db.batch(stmts);
    if (added || changed) this.log.info(`hiscores: ${data.players.length} players, ${added} new, ${changed} changed`);

    // Players whose collection count moved, or who are due a periodic re-check.
    // Whatever does not fit in this run's request budget is picked up next run;
    // a few requests are kept back so death records keep flowing.
    const reserve = Math.min(5, Math.floor(this.left() / 3));
    const room = Math.max(0, Math.min(COLLECTIONS_PER_RUN, this.left() - reserve));
    if (!room) return true;
    const due = (await this.all(`SELECT p.account FROM players p LEFT JOIN collection_sync s ON s.account = p.account
      WHERE p.listed = 1 AND (s.account IS NULL OR s.synced_count != p.collection OR s.synced_at < ?)
      ORDER BY (s.account IS NULL) DESC, s.synced_at LIMIT ?`, at - this.s.collectionResyncHours * 3600, room))
      .map(r => r.account);
    for (const account of due) {
      await sleep(this.s.requestGapMs);
      await this.syncCollection(account);
    }
  }

  async syncCollection(account) {
    const data = await this.api.collection(account);
    const at = now();
    const db = this.db;
    const items = data.items.filter(i => Number.isSafeInteger(i.item) && Number.isSafeInteger(i.found_at));
    const list = JSON.stringify(items);
    const before = (await db.prepare('SELECT COUNT(*) AS n FROM collection_items WHERE account = ?').bind(account).first()).n;
    await db.batch([
      db.prepare(`DELETE FROM collection_items WHERE account = ? AND item NOT IN
        (SELECT json_extract(value, '$.item') FROM json_each(?))`).bind(account, list),
      db.prepare(`INSERT INTO collection_items(account, item, found_at)
        SELECT ?, json_extract(value, '$.item'), json_extract(value, '$.found_at') FROM json_each(?) WHERE true
        ON CONFLICT(account, item) DO UPDATE SET found_at = excluded.found_at WHERE found_at != excluded.found_at`).bind(account, list),
      db.prepare(`INSERT INTO collection_sync(account, synced_count, synced_at) VALUES(?,?,?)
        ON CONFLICT(account) DO UPDATE SET synced_count = excluded.synced_count, synced_at = excluded.synced_at`)
        .bind(account, items.length, at)
    ]);
    if (items.length > before) this.log.info(`collection: ${data.name} +${items.length - before} item(s)`);
  }

  async syncLegends() {
    // All three lists or none, so the boards never mix old and new data.
    if (this.left() < TIMESPANS.length) return false;
    const db = this.db;
    const at = now();
    let discovered = 0;
    for (const [i, span] of TIMESPANS.entries()) {
      if (i) await sleep(this.s.requestGapMs);
      let entries;
      try {
        entries = await this.api.legends(span);
      } catch (e) {
        if (e.status === 429) { this.log.warn('legends: server rate limit reached, will retry next cycle'); return; }
        throw e;
      }
      const stmts = [db.prepare('DELETE FROM legends WHERE timespan = ?').bind(span)];
      const deathIdx = [];
      entries.forEach((e, n) => {
        stmts.push(db.prepare('INSERT INTO legends(timespan, rank, account, char_id, total_fame) VALUES(?,?,?,?,?)')
          .bind(span, n + 1, e.account, e.charId, e.totalFame ?? 0));
        deathIdx.push(stmts.length);
        stmts.push(db.prepare(`INSERT INTO deaths(account, char_id, name, class, tex1, tex2, equipment, total_fame, discovered_at)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account, char_id) DO NOTHING`)
          .bind(e.account, e.charId, e.name ?? '', e.class ?? 0, e.tex1, e.tex2, JSON.stringify(e.equipment), e.totalFame ?? 0, at));
      });
      stmts.push(creditGuilds(db, at));
      const results = await db.batch(stmts);
      for (const idx of deathIdx) discovered += Number(results[idx]?.meta?.changes ?? 0);
    }
    if (discovered) this.log.info(`legends: discovered ${discovered} new death(s)`);
  }

  async syncDeathDetails() {
    const db = this.db;
    const limit = Math.min(this.s.deathDetailsPerRun, this.left());
    if (limit <= 0) return false;
    const pending = await this.all(`SELECT account, char_id, detail_tries FROM deaths WHERE detail_status = 'pending' AND detail_tries < ?
      ORDER BY discovered_at LIMIT ?`, MAX_DETAIL_TRIES, limit);
    for (const [i, d] of pending.entries()) {
      if (i) await sleep(this.s.requestGapMs);
      try {
        const r = await this.api.deathDetail(d.account, d.char_id);
        await db.prepare(`UPDATE deaths SET name=?, class=?, tex1=?, tex2=?, level=?, died_at=?, killed_by=?, total_fame=?, base_fame=?,
          stats=?, bonuses=?, detail_status='ok', detail_error=NULL, detail_tries=detail_tries+1 WHERE account=? AND char_id=?`)
          .bind(r.name ?? '', r.class ?? 0, r.tex1, r.tex2, r.level, r.diedAt, r.killedBy, r.totalFame ?? 0, r.baseFame,
            JSON.stringify(r.stats), JSON.stringify(r.bonuses), d.account, d.char_id).run();
      } catch (e) {
        const tries = d.detail_tries + 1;
        await db.prepare('UPDATE deaths SET detail_tries=?, detail_error=?, detail_status=? WHERE account=? AND char_id=?')
          .bind(tries, String(e.message).slice(0, 300), tries >= MAX_DETAIL_TRIES ? 'error' : 'pending', d.account, d.char_id).run();
        this.log.warn(`death detail ${d.account}/${d.char_id}: ${e.message}`);
      }
    }
  }

  /**
   * Every player death from the server's graveyard (PR #624). Off until the meta key
   * graveyard_enabled is set to 1, so the endpoint is never called before it is approved.
   * Deaths are read oldest first from a cursor; new ones get their full record
   * (stats, fame bonuses) from the death details job.
   */
  async syncGraveyard() {
    const db = this.db;
    if ((await getMeta(db, 'graveyard_enabled')) !== '1') return;
    // While the server answers 404 (endpoint not reachable yet), only ask once an hour.
    if (Number(await getMeta(db, 'graveyard_missing_at') ?? 0) > now() - 3600) return;
    let since = Number(await getMeta(db, 'graveyard_since') ?? 0);
    let added = 0;
    for (let page = 0; page < 5; page++) {
      if (this.left() < 1) return false;
      if (page) await sleep(this.s.requestGapMs);
      let deaths;
      try {
        deaths = await this.api.graveyard(since);
      } catch (e) {
        if (e.status === 404) await setMetaStmt(db, 'graveyard_missing_at', now()).run();
        throw e;
      }
      // The first time the server includes stats at death (OpenRotMG PR #712), read every
      // death again from the start once, so older deaths get their stats (and graves) too.
      if (since > 0 && deaths.some(d => Array.isArray(d.stats)) && (await getMeta(db, 'graveyard_stats_at')) === null) {
        await setMetaStmt(db, 'graveyard_stats_at', now()).run();
        since = 0;
        page = -1;
        this.log.info('graveyard: stats at death now available, re-reading every death');
        continue;
      }
      const at = now();
      if (!deaths.length) { await setMetaStmt(db, 'graveyard_caught_up', at).run(); break; }
      const listed = new Set((await this.all('SELECT account FROM players')).map(r => r.account));
      // A death of a player registered since the last hiscores poll waits for that poll,
      // unless it is over an hour old (then it is not coming and is skipped).
      const waiting = deaths.filter(d => !listed.has(d.account) && d.died_at > at - 3600);
      const keep = deaths.filter(d => listed.has(d.account)).map(d => ({
        account: d.account, id: d.id, name: d.name, class: d.class, level: Number.isSafeInteger(d.level) ? d.level : null,
        base_fame: Number.isSafeInteger(d.base_fame) ? d.base_fame : null, total_fame: d.total_fame, died_at: d.died_at,
        killed_by: typeof d.killed_by === 'string' ? d.killed_by : null, equipment: JSON.stringify(d.equipment.slice(0, 4)),
        tex1: Number.isSafeInteger(d.tex1) ? d.tex1 : 0, tex2: Number.isSafeInteger(d.tex2) ? d.tex2 : 0,
        base_stats: Array.isArray(d.stats) && d.stats.length === 8 && d.stats.every(Number.isSafeInteger) ? JSON.stringify(d.stats) : null
      }));
      const last = deaths[deaths.length - 1].died_at;
      const next = waiting.length ? Math.min(last, ...waiting.map(d => d.died_at)) : last;
      const [res] = await db.batch([
        db.prepare(`INSERT INTO deaths(account, char_id, name, class, tex1, tex2, equipment, total_fame, base_fame, level, died_at, killed_by, base_stats, discovered_at)
          SELECT json_extract(value, '$.account'), json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.class'),
            json_extract(value, '$.tex1'), json_extract(value, '$.tex2'), json_extract(value, '$.equipment'), json_extract(value, '$.total_fame'),
            json_extract(value, '$.base_fame'), json_extract(value, '$.level'), json_extract(value, '$.died_at'), json_extract(value, '$.killed_by'),
            json_extract(value, '$.base_stats'), ?
          FROM json_each(?) WHERE true
          ON CONFLICT(account, char_id) DO UPDATE SET level = COALESCE(deaths.level, excluded.level),
            died_at = COALESCE(deaths.died_at, excluded.died_at), killed_by = COALESCE(deaths.killed_by, excluded.killed_by),
            base_fame = COALESCE(deaths.base_fame, excluded.base_fame), base_stats = COALESCE(excluded.base_stats, deaths.base_stats)`).bind(at, JSON.stringify(keep)),
        creditGuilds(db, at),
        setMetaStmt(db, 'graveyard_since', next),
        setMetaStmt(db, 'graveyard_ok', at)
      ]);
      added += Number(res?.meta?.changes ?? 0);
      // A full page means more are waiting. If every row shares one second the cursor
      // cannot move, so stop rather than loop.
      if (deaths.length < 500 || next <= since) {
        if (deaths.length < 500) await setMetaStmt(db, 'graveyard_caught_up', at).run();
        break;
      }
      since = next;
    }
    if (added) this.log.info(`graveyard: ${added} death(s) recorded`);
  }

  /** History before tracking, filled in once every player death is on record. No requests. */
  async syncBackfill() {
    if ((await getMeta(this.db, 'graveyard_caught_up')) === null) return;
    const n = await backfillHistory(this.db);
    if (n) this.log.info(`backfill: history filled in for ${n} player(s)`);
  }

  // ---------- scheduling ----------

  jobs() {
    return [
      {name: 'health', every: this.s.healthMinutes * 60, run: () => this.syncHealth()},
      {name: 'legends', every: this.s.legendsMinutes * 60, run: () => this.syncLegends()},
      {name: 'hiscores', every: this.s.hiscoresMinutes * 60, run: () => this.syncHiscores()},
      {name: 'graveyard', every: this.s.graveyardMinutes * 60, run: () => this.syncGraveyard()},
      {name: 'backfill', every: this.s.graveyardMinutes * 60, run: () => this.syncBackfill()},
      {name: 'deaths', every: this.s.deathsMinutes * 60, run: () => this.syncDeathDetails()}
    ];
  }

  /**
   * Run every job that is due. `force` is true (all jobs) or a list of job names.
   * A database lock stops two runs overlapping (for example a slow cron run and the next one).
   */
  async tick(force = false) {
    const db = this.db;
    const at = now();
    const got = await db.prepare(`INSERT INTO meta(key, value) VALUES('collector_lock', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) < ?`)
      .bind(String(at + LOCK_SECONDS), at).run();
    if (!Number(got.meta?.changes)) return false;
    try {
      for (const job of this.jobs()) {
        // Small allowance so a 2-minute cron does not skip a job that is due a second late.
        const last = Number(await getMeta(db, `last_run:${job.name}`) ?? 0);
        const forced = force === true || (Array.isArray(force) && force.includes(job.name));
        if (!forced && now() - last < job.every - 15) continue;
        try {
          // false means the request budget ran out before the job could start: try again next run.
          if ((await job.run()) === false) continue;
          await setMetaStmt(db, `last_ok:${job.name}`, now()).run();
        } catch (e) {
          this.lastError = `${job.name}: ${e.message}`;
          await setMetaStmt(db, `last_error:${job.name}`, `${now()} ${e.message}`).run();
          this.log.warn(`${job.name} failed: ${e.message}`);
        }
        await setMetaStmt(db, `last_run:${job.name}`, now()).run();
        await sleep(this.s.requestGapMs);
      }
    } finally {
      await db.prepare("DELETE FROM meta WHERE key = 'collector_lock'").run();
    }
    return true;
  }
}
