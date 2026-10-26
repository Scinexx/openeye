// Living characters and the full graveyard (OpenRotMG server PR #624). Both must stay
// dormant against servers without the PR, and bots must never be stored.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, rows, one} from './helpers.js';

const meta = async (db, key) => (await one(db, 'SELECT value FROM meta WHERE key = ?', key))?.value ?? null;

test('without the PR: no characters, the graveyard is never requested, wording stays limited', async () => {
  const t = await setup({ticking: false});
  try {
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().tick(true);
    assert.equal((await one(t.db, 'SELECT COUNT(*) AS n FROM characters')).n, 0);
    assert.equal(await meta(t.db, 'characters_at'), null);
    // Switched on against a server without the endpoint: the request fails and nothing changes.
    assert.equal(await meta(t.db, 'graveyard_ok'), null);
    const s = await t.api.status();
    assert.deepEqual(s.features, {characters: false, graveyard: false});
    assert.ok(!('graveyard' in s.jobs));
    const p = await t.api.player(t.mock.players[0].name);
    assert.deepEqual(p.characters, []);
    assert.equal((await t.api.graveyard({})).full, false);
  } finally { t.close(); }
});

test('with the PR but not switched on: /api/graveyard is never called', async () => {
  const t = await setup({ticking: false, pr624: true});
  try {
    await t.collector().tick(true);
    assert.equal(t.mock.stats.requests['/api/graveyard'] ?? 0, 0);
    assert.equal((await t.api.status()).features.graveyard, false);
    // Characters need no switch: they come with the hiscores OpenEye already polls.
    assert.equal((await t.api.status()).features.characters, true);
  } finally { t.close(); }
});

test('with the PR: characters are stored per character, replaced each poll, and bots are dropped', async () => {
  const t = await setup({ticking: false, pr624: true, leakBots: true});
  try {
    const c = t.collector();
    await c.syncHiscores();
    const stored = await rows(t.db, 'SELECT char_id, account, stats, equipment FROM characters ORDER BY char_id');
    assert.equal(stored.length, t.mock.living.length, 'every living player character, several per account allowed');
    assert.ok(!stored.some(r => r.char_id === 99999), 'the leaked bot character is not stored');
    const multi = t.mock.players.find(p => t.mock.living.filter(x => x.account === p.account).length > 1);
    assert.ok(multi, 'the sample has a player with more than one character');
    const prof = await t.api.player(multi.name);
    assert.equal(prof.characters.length, t.mock.living.filter(x => x.account === multi.account).length);
    assert.equal(prof.characters[0].stats.length, 8);
    assert.equal(prof.characters[0].equipment.length, 4);
    assert.ok(prof.characters.every((x, i, a) => i === 0 || a[i - 1].fame >= x.fame), 'sorted by fame');

    // A character that died or was deleted disappears on the next poll.
    const gone = t.mock.living.shift();
    await c.syncHiscores();
    assert.equal(await one(t.db, 'SELECT char_id FROM characters WHERE char_id = ?', gone.id), null);
    t.mock.living.unshift(gone);
  } finally { t.close(); }
});

test('with the PR and switched on: every player death is backfilled once, bots never', async () => {
  const t = await setup({ticking: false, pr624: true, leakBots: true});
  try {
    await t.collector().syncHiscores();
    // Only legends-board deaths before the switch.
    await t.collector().syncLegends();
    const before = (await one(t.db, 'SELECT COUNT(*) AS n FROM deaths')).n;
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().syncGraveyard();
    const botAccounts = new Set(t.mock.bots.map(b => b.account));
    const playerDeaths = t.mock.deaths.filter(d => !botAccounts.has(d.account));
    const stored = await rows(t.db, 'SELECT account, char_id, level, died_at, killed_by, base_fame, detail_status FROM deaths');
    const storedPlayers = stored.filter(d => !botAccounts.has(d.account));
    assert.equal(storedPlayers.length, playerDeaths.length, 'every player death');
    assert.ok(storedPlayers.length > before);
    // Bots only ever come in through the Legends board (shown under the separate Bots tab), never from the graveyard.
    const legendsBots = (await rows(t.db, 'SELECT char_id FROM legends')).map(r => r.char_id);
    for (const d of stored.filter(d => botAccounts.has(d.account))) assert.ok(legendsBots.includes(d.char_id), 'bot death only from Legends');
    assert.ok(storedPlayers.every(d => d.died_at && d.level), 'graveyard rows carry died_at and level');
    assert.equal(Number(await meta(t.db, 'graveyard_since')), Math.max(...t.mock.deaths.map(d => d.diedAt)));

    // Running again adds nothing; a new death is picked up from the cursor.
    await t.collector().syncGraveyard();
    assert.equal((await one(t.db, 'SELECT COUNT(*) AS n FROM deaths')).n, stored.length);
    const p = t.mock.players[1];
    t.mock.deaths.push({account: p.account, charId: 77777, name: p.name, class: 782, level: 12, base: 50, total: 60,
      diedAt: Math.floor(Date.now() / 1000), killedBy: 'Pirate', equipment: [-1, -1, -1, -1], tex1: 0, tex2: 0, stats: {}, bonuses: []});
    await t.collector().syncGraveyard();
    const fresh = await one(t.db, 'SELECT detail_status, killed_by FROM deaths WHERE char_id = 77777');
    assert.deepEqual({...fresh}, {detail_status: 'pending', killed_by: 'Pirate'}, 'new deaths still get their full record');

    const s = await t.api.status();
    assert.equal(s.features.graveyard, true);
    assert.ok('graveyard' in s.jobs);
    const g = await t.api.graveyard({});
    assert.equal(g.full, true);
    assert.equal(g.totals.players, storedPlayers.length + 1);
  } finally { t.close(); }
});
