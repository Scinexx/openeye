import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {setup, rows, one} from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(() => t.close());

const totalRequests = () => Object.values(t.mock.stats.requests).reduce((a, b) => a + b, 0);

test('a full collection run fills every table and stays under the request limit', async () => {
  const c = t.collector();
  assert.equal(await c.tick(true), true);
  assert.equal(c.lastError, null);
  assert.ok(totalRequests() <= t.settings.maxFetchesPerRun, `first run used ${totalRequests()} requests`);
  // Death records that did not fit carry over to the next runs.
  for (let i = 0; i < 3; i++) {
    const before = totalRequests();
    await t.collector().tick(['deaths']);
    assert.ok(totalRequests() - before <= t.settings.maxFetchesPerRun);
  }
  const n = await one(t.db, `SELECT (SELECT COUNT(*) FROM players) p, (SELECT COUNT(*) FROM collection_items) i,
    (SELECT COUNT(*) FROM deaths) d, (SELECT COUNT(*) FROM deaths WHERE detail_status='ok') ok,
    (SELECT COUNT(*) FROM legends) l, (SELECT COUNT(*) FROM server_status WHERE ok=1) s`);
  assert.equal(n.p, 25);
  assert.ok(n.i > 100, 'collections synced');
  assert.ok(n.d >= 20, 'deaths discovered from legends');
  assert.equal(n.ok, n.d, 'every death record fetched after a few runs');
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

test('a tiny request budget spreads work across runs without errors', async () => {
  const {setup} = await import('./helpers.js');
  const small = await setup({ticking: false});
  small.settings.maxFetchesPerRun = 6;
  try {
    for (let run = 0; run < 15; run++) {
      const before = Object.values(small.mock.stats.requests).reduce((a, b) => a + b, 0);
      const c = small.collector();
      await c.tick(run === 0 ? true : ['hiscores', 'deaths']);
      const used = Object.values(small.mock.stats.requests).reduce((a, b) => a + b, 0) - before;
      assert.ok(used <= 6, `run ${run} used ${used}`);
      assert.equal(c.lastError, null);
    }
    const synced = await one(small.db, 'SELECT COUNT(*) n FROM collection_sync');
    assert.equal(synced.n, 25, 'all collections synced eventually');
    const legends = await one(small.db, 'SELECT COUNT(*) n FROM legends');
    assert.ok(legends.n > 0, 'legends ran on the first run');
  } finally { small.close(); }
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
  // Before the full graveyard: ranked from the player deaths known so far, bots never.
  const game = await t.api.legends('all');
  assert.equal(game.source, 'game');
  assert.ok(game.rows.length > 0 && game.rows.length <= 20 && game.rows.every((d, i) => !d.is_bot && d.rank === i + 1));
  // Vanilla: the game's own list exactly, bots included.
  const vanilla = await t.api.legends('all', 'vanilla');
  const listed = await rows(t.db, "SELECT rank, char_id FROM legends WHERE timespan = 'all' ORDER BY rank");
  assert.deepEqual(vanilla.rows.map(d => [d.rank, d.char_id]), listed.map(r => [r.rank, r.char_id]));
  assert.ok(vanilla.rows.some(d => d.is_bot), 'the mock board has bots');
  assert.ok((await t.api.search('red')).players.some(x => x.name === 'RedBracket'));
  await assert.rejects(() => t.api.rankings('nope'));
});
