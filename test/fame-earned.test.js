// Fame earned: living fame at the start counts as earned the day before, then every rise adds up.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {setup, rows, one} from './helpers.js';

let t;
before(async () => { t = await setup({ticking: false}); });
after(() => t.close());

const poll = async () => {
  await new Promise(r => setTimeout(r, 1100)); // history rows are keyed by the second
  await t.collector().syncHiscores();
};
const earned = async account => (await one(t.db, 'SELECT fame_earned FROM players WHERE account = ?', account)).fame_earned;

test('living fame at the start is credited to the day before', async () => {
  await t.collector().syncHiscores();
  const since = Number((await one(t.db, "SELECT value FROM meta WHERE key = 'fame_earned_since'")).value);
  for (const p of t.mock.players) {
    assert.equal(await earned(p.account), p.base_fame, p.name);
    const gains = await rows(t.db, 'SELECT at, amount FROM fame_gains WHERE account = ?', p.account);
    assert.deepEqual(gains, p.base_fame ? [{at: since - 86400, amount: p.base_fame}] : []);
  }
});

test('rises are added, drops are ignored, and rises after a drop count again', async () => {
  const p = t.mock.players[0];
  const start = p.base_fame;
  p.base_fame = start + 120; await poll();
  assert.equal(await earned(p.account), start + 120);
  p.base_fame = 40; await poll(); // best character died; a weaker one is now the best
  assert.equal(await earned(p.account), start + 120);
  p.base_fame = 75; await poll();
  assert.equal(await earned(p.account), start + 155);
  await poll(); // no change, nothing added
  assert.equal(await earned(p.account), start + 155);
  const sum = (await one(t.db, 'SELECT SUM(amount) AS n FROM fame_gains WHERE account = ?', p.account)).n;
  assert.equal(sum, start + 155, 'the running total matches the recorded gains');
});

test('a player who appears later starts from their living fame', async () => {
  t.mock.players.push({account: 4242, name: 'Latecomer', discord_id: null, base_fame: 300, total_fame: 0, collection: 0, quests: 0, stars: 1, items: new Map()});
  await poll();
  assert.equal(await earned(4242), 300);
  t.mock.players.pop();
});

test('fame earned is a ranking board and is charted on the profile', async () => {
  const board = await t.api.rankings('fame_earned');
  assert.ok(board.players.every((p, i, a) => i === 0 || a[i - 1].fame_earned >= p.fame_earned));
  const p = t.mock.players[0];
  const profile = await t.api.player(p.name);
  assert.equal(profile.player.fame_earned, profile.fameGains.reduce((s, g) => s + g.amount, 0));
  assert.ok(profile.ranks.fame_earned >= 1);
  assert.ok((await t.api.summary()).top.fame_earned.length > 0);
});
