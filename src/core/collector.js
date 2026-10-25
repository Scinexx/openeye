// The collector polls the public game API and records everything into the database.
// On Cloudflare it runs from a Cron Trigger; locally from a timer. Jobs run one at a
// time with a pause between requests, so the game server never sees bursts.
import {createGameApi} from './gameapi.js';
import {getMeta, setMetaStmt, now} from './schema.js';

const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
const TIMESPANS = ['week', 'month', 'all'];
const MAX_DETAIL_TRIES = 5;
const COLLECTIONS_PER_RUN = 60;
const LOCK_SECONDS = 600;

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

  async syncHiscores() {
    if (this.left() < 1) return false;
    const data = await this.api.hiscores();
    const at = now();
    const db = this.db;
    const known = new Map((await this.all('SELECT account, base_fame, total_fame, stars, quests, collection FROM players'))
      .map(r => [r.account, r]));
    const stmts = [db.prepare('UPDATE players SET listed = 0')];
    let added = 0, changed = 0;
    for (const p of data.players) {
      const v = [p.base_fame ?? 0, p.total_fame ?? 0, p.stars ?? 0, p.quests ?? 0, p.collection ?? 0].map(Number);
      const old = known.get(p.account);
      const history = db.prepare('INSERT OR REPLACE INTO player_history(account, at, base_fame, total_fame, stars, quests, collection) VALUES(?,?,?,?,?,?,?)')
        .bind(p.account, at, ...v);
      if (!old) {
        stmts.push(db.prepare(`INSERT INTO players(account, name, discord_id, base_fame, total_fame, stars, quests, collection, first_seen, last_seen, listed)
          VALUES(?,?,?,?,?,?,?,?,?,?,1)`).bind(p.account, p.name, p.discord_id ?? null, ...v, at, at), history);
        added++;
      } else {
        stmts.push(db.prepare(`UPDATE players SET name=?, discord_id=?, base_fame=?, total_fame=?, stars=?, quests=?, collection=?, last_seen=?, listed=1
          WHERE account=?`).bind(p.name, p.discord_id ?? null, ...v, at, p.account));
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

  // ---------- scheduling ----------

  jobs() {
    return [
      {name: 'health', every: this.s.healthMinutes * 60, run: () => this.syncHealth()},
      {name: 'legends', every: this.s.legendsMinutes * 60, run: () => this.syncLegends()},
      {name: 'hiscores', every: this.s.hiscoresMinutes * 60, run: () => this.syncHiscores()},
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
