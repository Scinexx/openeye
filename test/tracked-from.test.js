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
