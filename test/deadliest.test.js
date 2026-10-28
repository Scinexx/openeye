// Deadliest enemies: player deaths by killer, never bots, optionally level 20 only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.js';

test('deadliest enemies count player kills, never bots, with a level 20 view', async () => {
  const t = await setup({ticking: false, pr624: true, leakBots: true});
  try {
    await t.collector().syncHiscores();
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().syncGraveyard();
    const bots = new Set(t.mock.bots.map(b => b.account));
    const players = t.mock.deaths.filter(d => !bots.has(d.account));
    const count = (list, name) => list.filter(d => d.killedBy === name).length;
    const all = await t.api.deadliest(false), top20 = await t.api.deadliest(true);
    assert.ok(all.enemies.length > 0);
    for (const r of all.enemies) {
      assert.equal(r.kills, count(players, r.name), r.name);
      assert.equal(r.kills20, count(players.filter(d => d.level === 20), r.name), r.name);
    }
    for (let i = 1; i < all.enemies.length; i++) assert.ok(all.enemies[i - 1].kills >= all.enemies[i].kills);
    assert.ok(top20.enemies.every(r => r.kills === r.kills20 && r.kills > 0));
    assert.deepEqual(top20.enemies.map(r => r.rank), top20.enemies.map((_, i) => i + 1));
  } finally { t.close(); }
});
