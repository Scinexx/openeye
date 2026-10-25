// A tiny adapter that gives Node's built-in SQLite the same API as Cloudflare D1
// (prepare/bind/all/first/run/batch), so the shared core runs unchanged locally and in tests.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) {
    for (const a of args) if (a === undefined) throw new TypeError(`undefined bound to: ${this.sql.slice(0, 60)}`);
    return new Statement(this.db, this.sql, args);
  }
  async all() { return {results: this.db.prepare(this.sql).all(...this.args).map(r => ({...r}))}; }
  async first() { const r = this.db.prepare(this.sql).get(...this.args); return r ? {...r} : null; }
  async run() { return this.runSync(); }
  runSync() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return {success: true, meta: {changes: Number(r.changes)}, results: []};
  }
}

export class SqliteD1 {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  prepare(sql) { return new Statement(this.db, sql); }
  /** Like D1: every statement in one transaction, all or nothing. */
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(s => s.runSync());
      this.db.exec('COMMIT');
      return results;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() { this.db.close(); }
}
