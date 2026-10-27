// Guilds, once the server's hiscores share them: standings, memberships, and member deaths
// paying their fame to the guild, as in the game. Dormant against servers without them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, one, rows} from './helpers.js';

test('without guilds in the hiscores, nothing about guilds shows', async () => {
  const t = await setup({ticking: false, pr624: true});
  try {
    await t.collector().syncHiscores();
    assert.equal((await t.api.status()).features.guilds, false);
    assert.deepEqual((await t.api.guilds()).guilds, []);
    assert.equal((await t.api.player(t.mock.players[0].name)).guild, null);
  } finally { t.close(); }
});

test('guilds are ranked by total fame, with members, ranks and hall progress', async () => {
  const t = await setup({ticking: false, pr624: true, guilds: true});
  try {
    await t.collector().syncHiscores();
    assert.equal((await t.api.status()).features.guilds, true);
    const {guilds} = await t.api.guilds();
    assert.equal(guilds.length, 3);
    assert.deepEqual(guilds.map(g => g.rank), [1, 2, 3]);
    for (let i = 1; i < guilds.length; i++) assert.ok(guilds[i - 1].earned >= guilds[i].earned);
    const g = await t.api.guild(guilds[0].name.toUpperCase());
    assert.equal(g.guild.name, guilds[0].name);
    assert.equal(g.guild.rank, 1);
    assert.equal(g.members.length, g.guild.members);
    assert.equal(g.members[0].rank, 40, 'the founder comes first');
    assert.equal(g.guild.next, [10000, 100000, 250000][g.guild.level - 1] ?? null);
    // No "joined" news for people who were already members when guilds first appeared.
    assert.equal(g.events.length, 0);
    const member = t.mock.players[0];
    const p = await t.api.player(member.name);
    assert.equal(p.guild.name, 'Mad Gods');
    assert.equal(p.guild.rank, 40);
    assert.ok((await t.api.search('Mad')).guilds.some(x => x.name === 'Mad Gods'));
  } finally { t.close(); }
});

test('a member death after tracking began is credited to their guild', async () => {
  const t = await setup({ticking: false, pr624: true, guilds: true});
  try {
    await t.collector().syncHiscores();
    await t.db.prepare("INSERT INTO meta(key, value) VALUES('graveyard_enabled', '1')").run();
    await t.collector().syncGraveyard();
    // Deaths from before guilds were followed are not credited: who they paid is unknown.
    assert.equal((await one(t.db, 'SELECT COUNT(*) AS n FROM deaths WHERE guild_id IS NOT NULL')).n, 0);
    const member = t.mock.players[0], loner = t.mock.players[3];
    const at = Math.floor(Date.now() / 1000) + 5;
    for (const [p, id] of [[member, 777001], [loner, 777002]]) {
      t.mock.deaths.push({account: p.account, charId: id, name: p.name, class: 768, level: 20, tex1: 0, tex2: 0,
        equipment: [-1, -1, -1, -1], base: 400, total: 520, diedAt: at, killedBy: 'Pirate', bonuses: []});
    }
    await t.collector().syncGraveyard();
    const d = await one(t.db, 'SELECT guild_id FROM deaths WHERE char_id = 777001');
    assert.equal(d.guild_id, 1);
    assert.equal((await one(t.db, 'SELECT guild_id FROM deaths WHERE char_id = 777002')).guild_id, null);
    const g = await t.api.guild('Mad Gods');
    assert.ok(g.deaths.some(x => x.char_id === 777001 && x.total_fame === 520));
    assert.equal((await t.api.death(member.account, 777001)).death.guild_name, 'Mad Gods');
    // The guild's numbers move with the death, and the graph gets a point.
    await new Promise(r => setTimeout(r, 1100));
    await t.collector().syncHiscores();
    assert.ok((await rows(t.db, 'SELECT * FROM guild_history WHERE guild = 1')).length >= 2);
  } finally { t.close(); }
});
