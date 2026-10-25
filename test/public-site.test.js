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

test('visitors are rate limited', async () => {
  let limited = false;
  for (let i = 0; i < 260 && !limited; i++) limited = (await fetch(base + '/api/status')).status === 429;
  assert.ok(limited);
});
