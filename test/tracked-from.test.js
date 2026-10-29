// Profiles say when OpenEye began keeping records, so only players who were around before
// then get the "estimated" note on their graphs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.js';

test('a profile carries the moment records began', async () => {
  const t = await setup({ticking: false});
  try {
    await t.collector().syncHiscores();
    const {results: rows} = await t.db.prepare('SELECT name, first_seen FROM players ORDER BY account LIMIT 2').all();
    await t.db.prepare('UPDATE players SET first_seen = first_seen - 86400 WHERE name = ?').bind(rows[0].name).run();
    await t.db.prepare('UPDATE players SET first_seen = first_seen + 86400 WHERE name = ?').bind(rows[1].name).run();
    const early = await t.api.player(rows[0].name), late = await t.api.player(rows[1].name);
    assert.equal(early.trackedFrom, rows[0].first_seen - 86400);
    assert.equal(late.trackedFrom, early.trackedFrom, 'the same moment on every profile');
    assert.ok(late.player.first_seen > late.trackedFrom);
  } finally { t.close(); }
});

test('a profile knows when the player wore the daily fame crown', async () => {
  const t = await setup({ticking: false});
  try {
    await t.collector().syncHiscores();
    const at = Math.floor(Date.now() / 1000);
    const {results: ps} = await t.db.prepare('SELECT account, name FROM players ORDER BY account LIMIT 2').all();
    const [a, b] = ps;
    await t.db.prepare('DELETE FROM fame_gains').run();
    await t.db.prepare("UPDATE meta SET value = ? WHERE key = 'fame_earned_since'").bind(String(at - 3 * 86400)).run();
    const gain = (account, when, amount) => t.db.prepare('INSERT INTO fame_gains(account, at, amount) VALUES(?, ?, ?)').bind(account, when, amount).run();
    const t0 = at - 2 * 86400;
    await gain(a.account, t0, 100);          // a leads from t0...
    await gain(b.account, t0 + 3600, 150);   // ...until b passes them an hour later
    await gain(a.account, t0 + 7200, 10);    // a still behind (110 < 150)
    // b's gain leaves the 24-hour window at t0 + 3600 + 86400; a's 10 is still in it then.
    const reigns = (await t.api.player(a.name)).crowns;
    const of = acc => reigns.filter(r => r[2] === acc).map(r => r.slice(0, 2));
    const ca = of(a.account), cb = of(b.account);
    assert.deepEqual(reigns[0].slice(0, 3), [at - 3 * 86400, t0, null], 'nobody held it before any fame was earned');
    assert.equal(reigns.find(r => r[2] === b.account)[3], b.name);
    // The homepage gets the same reigns, cut to the period shown.
    const week = (await t.api.fameEarned(7)).crowns;
    assert.equal(week[0][0] >= at - 7 * 86400, true);
    assert.deepEqual(week.filter(r => r[2] === b.account).map(r => r.slice(0, 2)), cb);
    assert.deepEqual(ca, [[t0, t0 + 3600], [t0 + 3600 + 86400, t0 + 7200 + 86400]]);
    assert.deepEqual(cb, [[t0 + 3600, t0 + 3600 + 86400]]);
  } finally { t.close(); }
});
