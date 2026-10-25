import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {setup, rows, one} from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(() => t.close());

test('a full collection run fills every table', async () => {
  const c = t.collector();
  assert.equal(await c.tick(true), true);
  assert.equal(c.lastError, null);
  const n = await one(t.db, `SELECT (SELECT COUNT(*) FROM players) p, (SELECT COUNT(*) FROM collection_items) i,
    (SELECT COUNT(*) FROM deaths) d, (SELECT COUNT(*) FROM deaths WHERE detail_status='ok') ok,
    (SELECT COUNT(*) FROM legends) l, (SELECT COUNT(*) FROM server_status WHERE ok=1) s`);
  assert.equal(n.p, 25);
  assert.ok(n.i > 100, 'collections synced');
  assert.ok(n.d >= 20, 'deaths discovered from legends');
  assert.equal(n.ok, Math.min(n.d, 25), 'death details fetched (25 per cycle)');
  assert.ok(n.l >= 40 && n.l <= 60);
  assert.equal(n.s, 1);
  // Legends used exactly 3 of the 20 guest requests.
  assert.equal(t.mock.stats.requests['/legacy-api/fame/list'], 3);
});

test('collection counts match the hiscores after sync', async () => {
  const bad = await rows(t.db, `SELECT p.name FROM players p WHERE p.collection != (SELECT COUNT(*) FROM collection_items c WHERE c.account = p.account)`);
  assert.deepEqual(bad, []);
});

test('a second run records history and only refetches changed collections', async () => {
  const count = () => Object.entries(t.mock.stats.requests).filter(([k]) => k.startsWith('/api/collection/')).reduce((s, [, v]) => s + v, 0);
  const before = count();
  await new Promise(r => setTimeout(r, 1100));
  await t.collector().tick(['hiscores']);
  assert.ok(count() - before <= 1, `refetched ${count() - before}`);
  const stale = await rows(t.db, `SELECT p.name FROM players p JOIN player_history h ON h.account = p.account
    AND h.at = (SELECT MAX(at) FROM player_history WHERE account = p.account)
    WHERE h.base_fame != p.base_fame OR h.collection != p.collection OR h.total_fame != p.total_fame`);
  assert.deepEqual(stale, []);
});

test('jobs that are not due are skipped', async () => {
  const before = {...t.mock.stats.requests};
  await t.collector().tick();
  assert.equal(t.mock.stats.requests['/legacy-api/fame/list'], before['/legacy-api/fame/list'], 'legends not re-polled');
  assert.equal(t.mock.stats.requests['/api/hiscores'], before['/api/hiscores'], 'hiscores not re-polled');
});

test('two overlapping runs never both execute', async () => {
  const [a, b] = await Promise.all([t.collector().tick(['health']), t.collector().tick(['health'])]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal(await one(t.db, "SELECT value FROM meta WHERE key = 'collector_lock'"), null, 'lock released');
});

test('legends survives the server rate limit without failing the job', async () => {
  const c = t.collector();
  for (let i = 0; i < 8; i++) await c.syncLegends();
  assert.ok(t.mock.stats.requests['/legacy-api/fame/list'] > 20);
});

test('website API returns sensible shapes', async () => {
  const s = await t.api.summary();
  assert.equal(s.counts.players, 25);
  assert.equal(s.top.stars.length, 5);
  const r = await t.api.rankings('collection');
  assert.equal(r.players[0].rank, 1);
  assert.ok(r.players.every((p, i, a) => i === 0 || a[i - 1].collection >= p.collection));
  const p = await t.api.player('redbracket');
  assert.equal(p.player.name, 'RedBracket');
  assert.equal(p.collection.length, p.player.collection);
  const g = await t.api.graveyard({sort: 'fame'});
  assert.ok(g.rows[0].total_fame >= g.rows[1].total_fame);
  const d = await t.api.death(g.rows[0].account, g.rows[0].char_id);
  assert.equal(d.death.equipment.length, 12);
  assert.equal((await t.api.legends('all')).rows.length, 20);
  assert.ok((await t.api.search('red')).players.some(x => x.name === 'RedBracket'));
  await assert.rejects(() => t.api.rankings('nope'));
});
