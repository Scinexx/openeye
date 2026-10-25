// Bots, the loot filter, and the rules that make OpenEye safe to put on the internet.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setup, rows, one, quiet, root, catalogItems} from './helpers.js';
import {startServer} from '../src/node/server.js';

const catalog = new Map(catalogItems.map(i => [i.id, i]));
let t, server, base;

before(async () => {
  t = await setup({ticking: false});
  await t.collector().tick(true);
  await t.collector().syncDeathDetails();
  await t.collector().syncDeathDetails();
  server = startServer(t.db, t.settings, {port: 0, log: quiet});
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); t.close(); });

test('bot names from /api/bots are recorded', async () => {
  assert.equal((await one(t.db, 'SELECT COUNT(*) n FROM bots')).n, 8);
});

test('bot deaths are separated from player deaths', async () => {
  const players = await t.api.graveyard({bots: false});
  const bots = await t.api.graveyard({bots: true});
  assert.ok(bots.total > 0, 'the mock world has bot deaths');
  assert.ok(players.rows.every(d => !d.is_bot && d.account < 9000));
  assert.ok(bots.rows.every(d => d.is_bot && d.account >= 9000));
  assert.equal(players.totals.players + players.totals.bots, (await one(t.db, 'SELECT COUNT(*) n FROM deaths')).n);
  assert.ok(bots.rows.some(d => d.bot_confirmed));
});

test('bots never appear on the home page, rankings, search or item pages', async () => {
  const s = await t.api.summary();
  assert.ok(s.recentDeaths.every(d => !d.is_bot));
  assert.equal(s.counts.botDeaths, (await t.api.graveyard({bots: true})).total);
  const botNames = new Set((await rows(t.db, 'SELECT name FROM bots')).map(r => r.name));
  assert.ok((await t.api.rankings('stars')).players.every(p => !botNames.has(p.name)));
  assert.equal((await t.api.search('Cake')).players.length, 0);
  for (const id of [...catalog.keys()].slice(0, 150)) assert.ok((await t.api.item(id)).deaths.every(d => !d.is_bot));
});

test('latest loot lists only rare untiered and top-tier drops, never T5 rings', async () => {
  const finds = (await t.api.summary()).recentFinds;
  assert.ok(finds.length > 0);
  for (const f of finds) {
    const it = catalog.get(f.item);
    assert.ok(it.notable && !it.commonUt, `${it.name} should not be in latest loot`);
    assert.ok(!(it.slot === 9 && it.tier === 5), `${it.name}: T5 rings are too common`);
  }
  const hidden = [...catalog.values()].filter(i => i.commonUt).map(i => i.name);
  for (const name of ['Sprite Wand', 'Snake Skin Armor', 'Snake Skin Shield', 'Snake Eye Ring', 'Wand of the Bulwark', "Spider's Eye Ring", 'Poison Fang Dagger']) {
    assert.ok(hidden.includes(name), `${name} is treated as common`);
  }
  assert.ok(!hidden.includes('Doom Bow') && !hidden.includes('Demon Blade'));
});

test('the website has no way to change anything', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const path of ['/api/refresh', '/api/summary', '/']) {
      const res = await fetch(base + path, {method});
      assert.equal(res.status, 405, `${method} ${path}`);
    }
  }
  const app = readFileSync(join(root, 'public/app.js'), 'utf8');
  assert.ok(!/method:\s*'POST'|\/api\/refresh|Update now/.test(app), 'no admin controls in the front end');
  const worker = readFileSync(join(root, 'src/worker.js'), 'utf8');
  assert.ok(!/request\.method\s*===\s*'POST'/.test(worker));
});

test('responses carry security headers and hide internal details', async () => {
  const res = await fetch(base + '/api/summary');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const status = await (await fetch(base + '/api/status')).json();
  for (const j of Object.values(status.jobs)) assert.deepEqual(Object.keys(j).sort(), ['delayed', 'lastOk']);
  const headers = readFileSync(join(root, 'public/_headers'), 'utf8');
  assert.match(headers, /Content-Security-Policy: default-src 'self'/, 'static files on Cloudflare get the same policy');
});

test('files outside the site cannot be read', async () => {
  for (const path of ['/..%2fsrc%2fworker.js', '/catalog/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/catalog/%00', '/_headers']) {
    const text = await (await fetch(base + path)).text();
    assert.ok(!text.includes('export default') && !text.includes('"scripts"') && !text.includes('root:') && !text.includes('X-Frame'), path);
  }
});


test('loot history filters by tier, type, common items, player and time', async () => {
  const get = async qs => (await fetch(`${base}/api/loot${qs}`)).json();
  const all = await get('');
  const total = (await one(t.db, 'SELECT COUNT(*) n FROM collection_items')).n;
  assert.ok(all.total > 0 && all.total <= total);
  assert.ok(all.rows.every((r, i, a) => i === 0 || a[i - 1].found_at >= r.found_at), 'newest first');
  assert.ok(all.rows.length <= 50);

  const ut = await get('?tier=ut&common=0');
  assert.ok(ut.rows.length > 0);
  for (const r of ut.rows) {
    const it = catalog.get(r.item);
    assert.ok(it.untiered && !it.commonUt, `${it.name} should be a rare untiered item`);
  }
  const withCommon = await get('?tier=ut');
  assert.ok(withCommon.total >= ut.total);

  const rings = await get('?type=ring');
  assert.ok(rings.rows.every(r => catalog.get(r.item).slot === 9));
  const top = await get('?tier=12&type=weapon');
  assert.ok(top.rows.every(r => { const it = catalog.get(r.item); return [1, 2, 3, 8, 17].includes(it.slot) && it.tier === 12; }));
  const lowTiers = await get('?tier=0,1,2&type=weapon,armor');
  assert.ok(lowTiers.rows.every(r => [0, 1, 2].includes(catalog.get(r.item).tier)));

  const name = all.rows[0].name;
  const mine = await get(`?player=${encodeURIComponent(name.toLowerCase())}`);
  assert.ok(mine.total > 0 && mine.rows.every(r => r.name === name), 'player filter is case-insensitive and exact');
  assert.equal((await get('?player=NobodyAtAll')).total, 0);
  assert.ok((await get('?days=1')).total <= all.total);
  const named = await get('?item=RING');
  assert.ok(named.total > 0);
  assert.ok(named.rows.every(r => catalog.get(r.item).name.toLowerCase().includes('ring')), 'item search ignores case');
  assert.ok(named.rows.some(r => !catalog.get(r.item).name.toLowerCase().startsWith('ring')), 'matches in the middle of a name too');
  assert.equal((await get('?item=zzzz-no-such-item')).total, 0);

  const page2 = await get('?page=2');
  if (all.total > 50) assert.notDeepEqual(page2.rows[0], all.rows[0]);
  const botAccounts = new Set((await rows(t.db, 'SELECT DISTINCT account FROM deaths d WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.account = d.account)')).map(r => r.account));
  assert.ok(all.rows.every(r => !botAccounts.has(r.account)), 'no bot loot');
  assert.equal((await get('?tier=nonsense&type=weapon')).total, 0, 'unknown values select nothing');
  const potions = await get('?type=consumable');
  assert.ok(potions.total > 0, 'with every tier selected, consumables with no tier show');
  assert.equal((await get('?type=consumable&tier=ut')).total, 0, 'narrowing tiers hides items with no tier');
});

test('guest accounts with no stat above 5 are left off the leaderboards', async () => {
  const now = Math.floor(Date.now() / 1000);
  await t.db.prepare(`INSERT INTO players(account, name, base_fame, total_fame, stars, quests, collection, first_seen, last_seen, listed)
    VALUES (77001, 'Guest901', 0, 0, 0, 0, 3, ?, ?, 1), (77002, 'Guest902', 0, 0, 0, 6, 0, ?, ?, 1), (77003, 'Tiny', 0, 0, 0, 0, 1, ?, ?, 1)`)
    .bind(now, now, now, now, now, now).run();
  try {
    const ranked = new Set((await t.api.rankings('collection')).players.map(p => p.name));
    assert.ok(!ranked.has('Guest901'), 'guest with every stat 5 or lower: hidden');
    assert.ok(ranked.has('Guest902'), 'guest with a stat above 5: shown');
    assert.ok(ranked.has('Tiny'), 'non-guest with low stats: shown');
    const s = await t.api.summary();
    assert.equal(s.counts.players, ranked.size);
    for (const board of Object.keys(s.top)) assert.ok(s.top[board].every(p => p.name !== 'Guest901'));
    const profile = await t.api.player('Guest901');
    assert.ok(Object.values(profile.ranks).every(r => r === null), 'profile still exists but is unranked');
  } finally {
    await t.db.prepare('DELETE FROM players WHERE account IN (77001, 77002, 77003)').run();
  }
});

// Runs last: it uses up this test client's request allowance.
test('visitors are rate limited', async () => {
  let limited = false;
  for (let i = 0; i < 260 && !limited; i++) limited = (await fetch(base + '/api/status')).status === 429;
  assert.ok(limited);
});
