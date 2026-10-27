// Shared test setup: a fake game server plus a fresh SQLite database behind the D1 adapter.
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMock} from './mock-game-server.js';
import {SqliteD1} from '../src/node/sqlite-d1.js';
import {ensureSchema} from '../src/core/schema.js';
import {loadSettings} from '../src/core/settings.js';
import {Collector} from '../src/core/collector.js';
import {makeApi} from '../src/core/site.js';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const catalogItems = JSON.parse(readFileSync(join(root, 'public/catalog/items.json'), 'utf8'));
export const quiet = {info() {}, warn() {}, error() {}};

export async function setup({ticking = true, pr624 = false, leakBots = false, deathStats = false} = {}) {
  const mock = createMock({ticking, pr624, leakBots, deathStats});
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const settings = loadSettings({API_BASE: `http://127.0.0.1:${mock.address().port}`, REQUEST_GAP_MS: '0'});
  const db = new SqliteD1(':memory:');
  await ensureSchema(db);
  const api = makeApi(db, {items: catalogItems}, settings);
  const collector = () => new Collector(db, settings, quiet);
  return {mock, settings, db, api, collector, close() { db.close(); mock.close(); }};
}

export const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
export const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
