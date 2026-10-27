// Living characters and the full graveyard (OpenRotMG server PR #624). Both must stay
// dormant against servers without the PR, and bots must never be stored.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, rows, one} from './helpers.js';

const meta = async (db, key) => (await one(db, 'SELECT value FROM meta WHERE key = ?', key))?.value ?? null;

test('without the PR: no characters, the graveyard is never requested, graveyard stays off', async () => {
  const t = await setup({ticking: false});
  try {
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().tick(true);
    assert.equal((await one(t.db, 'SELECT COUNT(*) AS n FROM characters')).n, 0);
    assert.equal(await meta(t.db, 'characters_at'), null);
    // Switched on against a server without the endpoint: the request fails, nothing changes,
    // and it is not asked again for an hour.
    assert.equal(t.mock.stats.requests['/api/graveyard'], 1);
    await t.collector().tick(['graveyard']);
    assert.equal(t.mock.stats.requests['/api/graveyard'], 1);
    assert.ok(await meta(t.db, 'graveyard_missing_at'));
    assert.equal(await meta(t.db, 'graveyard_ok'), null);
    const s = await t.api.status();
    assert.deepEqual(s.features, {characters: false, graveyard: false});
    assert.ok(!('graveyard' in s.jobs));
    const p = await t.api.player(t.mock.players[0].name);
    assert.deepEqual(p.characters, []);
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
    assert.equal(g.totals.players, storedPlayers.length + 1);
  } finally { t.close(); }
});

test('with the full graveyard, Legends are ranked from every player death, never bots', async () => {
  const t = await setup({ticking: false, pr624: true, leakBots: true});
  try {
    await t.collector().syncHiscores();
    await t.collector().syncLegends();
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().syncGraveyard();
    const botAccounts = new Set(t.mock.bots.map(b => b.account));
    const at = Math.floor(Date.now() / 1000);
    for (const [span, window] of [['week', 7 * 86400], ['month', 30 * 86400], ['all', Infinity]]) {
      const l = await t.api.legends(span);
      assert.equal(l.source, 'graveyard');
      const expected = t.mock.deaths.filter(d => !botAccounts.has(d.account) && d.diedAt > at - window - 5)
        .sort((a, b) => b.total - a.total || a.diedAt - b.diedAt || a.charId - b.charId).slice(0, 20);
      assert.deepEqual(l.rows.map(d => d.char_id), expected.map(d => d.charId), span);
      assert.ok(l.rows.every((d, i) => d.rank === i + 1 && !d.is_bot));
    }
    // Profiles, death pages and graveyard tags follow the same players-only boards.
    const top = (await t.api.legends('all')).rows[0];
    const prof = await t.api.player(top.player);
    assert.ok(prof.legends.some(x => x.timespan === 'all' && x.rank === 1 && x.char_id === top.char_id));
    assert.ok((await t.api.death(top.account, top.char_id)).legends.some(x => x.timespan === 'all' && x.rank === 1));
    const g = await t.api.graveyard({sort: 'fame', per: 1000});
    assert.ok(g.rows.find(d => d.char_id === top.char_id).in_legends);
  } finally { t.close(); }
});

test('Best characters lists every living character of ranked players, never bots', async () => {
  const t = await setup({ticking: false, pr624: true, leakBots: true});
  try {
    await t.collector().syncHiscores();
    const {characters} = await t.api.characters();
    assert.equal(characters.length, t.mock.living.length);
    assert.ok(characters.every(c => c.name && Array.isArray(c.stats) && c.stats.length === 8 && c.equipment.length === 4));
    assert.ok(!characters.some(c => t.mock.bots.some(b => b.account === c.account)));
  } finally { t.close(); }
});

test('stats at death: from the graveyard when sent, else the last seen living stats', async () => {
  const t = await setup({ticking: false, pr624: true, deathStats: true});
  try {
    await t.collector().syncHiscores();
    // A living character that later dies keeps its last seen stats.
    const alive = t.mock.living[0];
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().syncGraveyard();
    const withStats = t.mock.deaths.find(d => t.mock.players.some(p => p.account === d.account));
    const got = await t.api.death(withStats.account, withStats.charId);
    assert.deepEqual(got.death.base_stats, withStats.baseStats);
    t.mock.deaths.push({account: alive.account, charId: alive.id, name: 'x', class: alive.class, level: alive.level, base: 1, total: 1,
      diedAt: Math.floor(Date.now() / 1000), killedBy: 'Pirate', equipment: [-1, -1, -1, -1], stats: {}, bonuses: []});
    await t.collector().syncGraveyard();
    assert.deepEqual((await t.api.death(alive.account, alive.id)).death.base_stats, alive.stats);
  } finally { t.close(); }
});

test('Best characters, dead: every recorded player death, never bots', async () => {
  const t = await setup({ticking: false, pr624: true, leakBots: true, deathStats: true});
  try {
    await t.collector().syncHiscores();
    await t.collector().syncLegends();
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().syncGraveyard();
    const {characters, dead} = await t.api.characters({dead: true});
    const botAccounts = new Set(t.mock.bots.map(b => b.account));
    assert.equal(dead, true);
    assert.equal(characters.length, t.mock.deaths.filter(d => !botAccounts.has(d.account)).length);
    assert.ok(characters.every(c => !botAccounts.has(c.account) && c.equipment.length === 4 && c.died_at));
    assert.ok(characters.some(c => Array.isArray(c.stats) && c.stats.length === 8));
  } finally { t.close(); }
});
