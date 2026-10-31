// Link previews, robots.txt and sitemap.xml (src/core/preview.js), through the local server.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {setup, one, quiet} from './helpers.js';
import {startServer} from '../src/node/server.js';

let t, server, base;
const meta = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];

before(async () => {
  t = await setup({ticking: false});
  await t.collector().tick(true);
  await t.collector().syncDeathDetails();
  server = startServer(t.db, t.settings, {port: 0, log: quiet});
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); t.close(); });

test('a player page carries the player in its title and preview', async () => {
  const p = await one(t.db, 'SELECT name, stars FROM players WHERE listed = 1 LIMIT 1');
  const html = await (await fetch(`${base}/player/${encodeURIComponent(p.name)}`)).text();
  assert.match(html, new RegExp(`<title>${p.name} \\| OpenEye</title>`));
  assert.equal(meta(html, 'og:title'), `${p.name} | OpenEye`);
  assert.match(meta(html, 'og:description'), new RegExp(`^${p.stars} stars? · `));
  assert.equal(meta(html, 'og:url'), `${base}/player/${encodeURIComponent(p.name)}`);
  assert.equal(meta(html, 'og:image'), `${base}/icons/og.png?v=3`);
});

test('a death page names the character, class and killer', async () => {
  const d = await one(t.db, `SELECT d.account, d.char_id, d.name, d.killed_by FROM deaths d
    JOIN players p ON p.account = d.account WHERE d.killed_by IS NOT NULL LIMIT 1`);
  const html = await (await fetch(`${base}/death/${d.account}/${d.char_id}`)).text();
  assert.match(meta(html, 'og:title'), new RegExp(`^${d.name}(&#39;|')s `));
  assert.match(meta(html, 'og:description'), new RegExp(`killed by ${d.killed_by}`));
});

test('item and enemy pages, and unknown pages fall back to the defaults', async () => {
  const item = await (await fetch(`${base}/item/2594`)).text();
  assert.match(item, /<title>[^<]+ \| OpenEye<\/title>/);
  assert.match(meta(item, 'og:description'), /Owned by \d+ players?\./);
  const missing = await (await fetch(`${base}/player/nobody-by-this-name`)).text();
  assert.match(missing, /<title>OpenEye<\/title>/);
  assert.equal(meta(missing, 'og:url'), `${base}/player/nobody-by-this-name`);
});

test('text from the database is escaped in the page head', async () => {
  await t.db.prepare(`INSERT INTO players(account, name, first_seen, last_seen) VALUES(99999, '<b>"x"</b>', 1, 1)`).run();
  const html = await (await fetch(`${base}/player/${encodeURIComponent('<b>"x"</b>')}`)).text();
  assert.ok(!html.includes('<b>"x"</b>'));
  assert.match(html, /&lt;b&gt;&quot;x&quot;&lt;\/b&gt; \| OpenEye/);
});

test('robots.txt points at the sitemap, which lists players', async () => {
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.match(robots, new RegExp(`Sitemap: ${base}/sitemap.xml`));
  assert.match(robots, /Disallow: \/api\//);
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  const p = await one(t.db, 'SELECT name FROM players WHERE listed = 1 LIMIT 1');
  assert.ok(sitemap.includes(`/player/${encodeURIComponent(p.name)}</loc>`));
});
