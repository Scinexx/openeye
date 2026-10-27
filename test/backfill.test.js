// History before tracking: filled in day by day once the full graveyard is on record.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, rows, one} from './helpers.js';
import {creationEstimator, accountHistory} from '../src/core/backfill.js';

test('character creation times are interpolated from ids', () => {
  const est = creationEstimator([{char_id: 10, created_at: 1000}, {char_id: 20, created_at: 2000}]);
  assert.equal(est(15), 1500);
  assert.equal(est(5), 1000);
  assert.equal(est(30), 2000);
});

test('one account: starts at 0, exact collection, server star rule, the lump kept exactly', () => {
  const D = 86400, start = 10 * D;
  const chars = [
    {class: 1, created: 1 * D, ended: 3 * D, dead: true, fame: 300, total: 450},   // dies day 3
    {class: 2, created: 5 * D, ended: 12 * D, dead: false, fame: 700, total: 0}    // alive, 5/7 of the way at start
  ];
  const {history, gains} = accountHistory({chars, finds: [2 * D, 2 * D + 5, 6 * D], first: {stars: 9, quests: 40, total_fame: 450}, lump: 1000, start});
  assert.deepEqual(history[0], {at: D - 60, base_fame: 0, total_fame: 0, stars: 0, quests: 0, collection: 0});
  assert.ok(history.every(h => h.at < start));
  const at = t => history.filter(h => h.at <= t).at(-1);
  assert.equal(at(2 * D + 100).collection, 0, 'the day ends after the finds');
  assert.equal(at(3 * D - 1).collection, 2);
  assert.equal(at(7 * D - 1).collection, 3);
  // Day 4 ends: the first character is dead with 450 total fame -> 3 stars (20, 150, 400).
  assert.equal(at(4 * D - 1).stars, 3);
  assert.equal(at(4 * D - 1).base_fame, 0, 'nobody alive');
  assert.equal(gains.reduce((n, g) => n + g.amount, 0), 1000);
  assert.ok(gains.length > 3, 'spread over days');
  assert.ok(gains.every(g => g.at < start));
});

test('backfill keeps fame earned totals, fills days before tracking, and runs once', async () => {
  const t = await setup({ticking: false, pr624: true});
  try {
    await t.collector().syncHiscores();
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().syncGraveyard();
    for (const p of t.mock.players) await t.collector().syncCollection(p.account);
    const before = await rows(t.db, 'SELECT account, fame_earned FROM players ORDER BY account');
    while ((await one(t.db, 'SELECT COUNT(*) AS n FROM players WHERE backfilled = 0')).n) await t.collector().syncBackfill();
    const after = await rows(t.db, 'SELECT p.account, p.fame_earned, (SELECT SUM(amount) FROM fame_gains g WHERE g.account = p.account) AS gained, p.first_seen FROM players p ORDER BY account');
    assert.deepEqual(after.map(r => r.fame_earned), before.map(r => r.fame_earned));
    for (const r of after) assert.equal(r.gained ?? 0, r.fame_earned, `account ${r.account}: gains add up`);
    const busy = after.find(r => t.mock.deaths.some(d => d.account === r.account));
    const hist = await rows(t.db, 'SELECT * FROM player_history WHERE account = ? AND at < ? ORDER BY at', busy.account, busy.first_seen);
    assert.ok(hist.length > 5, 'a point per day');
    assert.equal(hist[0].stars + hist[0].collection + hist[0].base_fame, 0, 'starts at 0');
    const days = await one(t.db, 'SELECT COUNT(*) AS n FROM fame_gains WHERE account = ? AND at < ?', busy.account, busy.first_seen);
    assert.ok(days.n > 1, 'fame earned spread over days');
    // Exact collection at a day's end.
    const mid = hist[Math.floor(hist.length / 2)];
    const found = await one(t.db, 'SELECT COUNT(*) AS n FROM collection_items WHERE account = ? AND found_at <= ?', busy.account, mid.at);
    assert.equal(mid.collection, found.n);
    // Second run changes nothing.
    const count = (await one(t.db, 'SELECT COUNT(*) AS n FROM player_history')).n;
    await t.collector().syncBackfill();
    assert.equal((await one(t.db, 'SELECT COUNT(*) AS n FROM player_history')).n, count);
  } finally { t.close(); }
});
