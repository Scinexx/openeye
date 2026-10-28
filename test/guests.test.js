// Guests: a name of exactly Guest<account> is a person who never chose a name, not a bot.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.js';

test('guest accounts are people, not bots, even off the hiscores', async () => {
  const t = await setup({ticking: false});
  try {
    await t.collector().syncHiscores();
    const at = Math.floor(Date.now() / 1000);
    const add = (account, charId, name) => t.db.prepare(`INSERT INTO deaths(account, char_id, name, class, tex1, tex2, equipment, total_fame, base_fame, level, died_at, killed_by, discovered_at)
      VALUES(?, ?, ?, 768, 0, 0, '[-1,-1,-1,-1]', 73, 50, 20, ?, 'Pirate', ?)`).bind(account, charId, name, at, at).run();
    await add(809, 1, 'Guest809');      // a guest playing on purpose
    await add(9001, 2, 'Guest42');      // not its own account number: not a guest
    const g = await t.api.graveyard({sort: 'recent', bots: true, per: 100});
    const guest = g.rows.find(d => d.char_id === 1), other = g.rows.find(d => d.char_id === 2);
    assert.ok(!guest.is_bot);
    assert.ok(guest.is_guest);
    assert.ok(other.is_bot);
    assert.ok(!other.is_guest);
    const players = await t.api.graveyard({sort: 'recent', per: 100});
    assert.ok(players.rows.some(d => d.char_id === 1), 'guests are listed with players');
    assert.ok(!players.rows.some(d => d.char_id === 2));
  } finally { t.close(); }
});
