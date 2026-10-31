// Link previews and crawler files. The site is a single page app, so every page is the same
// index.html; this fills in its <title> and Open Graph tags for the page asked for, so a link
// pasted into Discord (or found by a search engine) shows the player, death, item, enemy or
// guild rather than just "OpenEye". It only reads the database, a few light queries per page.
import enemiesCatalog from '../../public/catalog/enemies.json' with {type: 'json'};
import classesCatalog from '../../public/catalog/classes.json' with {type: 'json'};

const SITE = 'OpenEye';
const DEFAULT_DESCRIPTION = 'Player stats, rankings, graveyard and item tracker for Open RotMG.';
const fmt = n => (n ?? 0).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const className = id => classesCatalog.find(c => c.id === id)?.name ?? 'Character';
const decode = s => { try { return decodeURIComponent(s); } catch { return null; } };

// Titles for the pages that have no subject of their own (the same names as the site's menu).
const STATIC = {
  '/': [SITE, DEFAULT_DESCRIPTION],
  '/graveyard': ['Graveyard', 'Every player death on the Open RotMG server, with killer, gear and fame.'],
  '/legends': ['Legends', 'The highest-fame deaths this week, this month and of all time.'],
  '/loot': ['Loot', 'Every item players have looted on the Open RotMG server.'],
  '/items': ['Items', 'Every item in Open RotMG, with who found it first.'],
  '/enemies': ['Enemies', 'Every enemy in Open RotMG with its HP, defense, shots and drops.'],
  '/crown': ['The Crown', 'Who has earned the most fame in the last 24 hours, and for how long.'],
  '/guilds': ['Guilds', 'Open RotMG guilds ranked by total fame.'],
  '/about': ['About', DEFAULT_DESCRIPTION]
};

/** {title, description} for a page, or null to keep the defaults. Never throws. */
export async function pageMeta(db, {items}, pathname) {
  try {
    if (STATIC[pathname]) {
      const [title, description] = STATIC[pathname];
      return {title: title === SITE ? SITE : `${title} | ${SITE}`, description};
    }
    if (pathname.startsWith('/rankings')) return {title: `Rankings | ${SITE}`, description: 'Open RotMG players ranked by stars, fame, collection and quests.'};
    let m;
    if ((m = /^\/player\/([^/]+)$/.exec(pathname))) {
      const name = decode(m[1]);
      if (!name) return null;
      const p = await db.prepare(`SELECT account, name, stars, total_fame, fame_earned, collection FROM players
        WHERE name = ? COLLATE NOCASE AND listed = 1 LIMIT 1`).bind(name).first();
      if (!p) return null;
      const alive = await db.prepare('SELECT COUNT(*) AS n FROM characters WHERE account = ?').bind(p.account).first().catch(() => null);
      const parts = [plural(p.stars, 'star'), `${fmt(p.total_fame)} fame`, `${fmt(p.collection)} items collected`];
      if (alive?.n) parts.push(plural(alive.n, 'living character'));
      return {title: `${p.name} | ${SITE}`, description: `${parts.join(' · ')}. Open RotMG player profile.`};
    }
    if ((m = /^\/death\/(\d+)\/(\d+)$/.exec(pathname))) {
      // Players only: a bot's death (an account never on the hiscores) keeps the plain preview.
      const d = await db.prepare(`SELECT d.name, d.class, d.level, d.total_fame, d.killed_by FROM deaths d
        JOIN players p ON p.account = d.account WHERE d.account = ? AND d.char_id = ?`).bind(Number(m[1]), Number(m[2])).first();
      if (!d) return null;
      const who = `${d.level ? `Level ${d.level} ` : ''}${className(d.class)}`;
      return {title: `${d.name}'s ${className(d.class)} | ${SITE}`,
        description: `${who}${d.killed_by ? `, killed by ${d.killed_by}` : ''}. ${fmt(d.total_fame)} fame.`};
    }
    if ((m = /^\/item\/(\d+)$/.exec(pathname))) {
      const it = items.find(i => i.id === Number(m[1]));
      if (!it) return null;
      const owners = await db.prepare('SELECT COUNT(*) AS n FROM collection_items WHERE item = ?').bind(it.id).first();
      const kind = it.untiered ? 'Untiered' : it.tier !== null ? `T${it.tier}` : '';
      const lead = [kind, it.slotName].filter(Boolean).join(' ');
      return {title: `${it.name} | ${SITE}`,
        description: `${lead ? `${lead}. ` : ''}${it.description ? `${it.description} ` : ''}Owned by ${plural(owners?.n ?? 0, 'player')}.`.trim()};
    }
    if ((m = /^\/enemy\/(\d+)$/.exec(pathname))) {
      const e = enemiesCatalog.enemies.find(x => x.id === Number(m[1]));
      if (!e) return null;
      return {title: `${e.name} | ${SITE}`,
        description: `${fmt(e.hp)} HP, ${fmt(e.def)} defense${e.drops.length ? `, drops ${plural(e.drops.length, 'item')}` : ''}.`};
    }
    if ((m = /^\/guild\/([^/]+)$/.exec(pathname))) {
      const name = decode(m[1]);
      if (!name) return null;
      const g = await db.prepare('SELECT name, level, members, earned FROM guilds WHERE name = ? COLLATE NOCASE AND listed = 1 LIMIT 1').bind(name).first();
      if (!g) return null;
      return {title: `${g.name} | ${SITE}`, description: `Guild Hall ${g.level} · ${plural(g.members, 'member')} · ${fmt(g.earned)} total fame.`};
    }
  } catch { /* fall back to the defaults */ }
  return null;
}

/** index.html with absolute Open Graph URLs for this site and, when known, the page's own text. */
export function renderIndex(html, origin, pathname, meta) {
  const title = esc(meta?.title ?? SITE), description = esc(meta?.description ?? DEFAULT_DESCRIPTION);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${description}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${description}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${esc(origin + pathname)}`)
    .replace(/(<meta property="og:image" content=")\//, `$1${origin}/`);
}

export function robotsTxt(origin) {
  return `User-agent: *\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
}

/** Every listed player and the main pages. */
export async function sitemapXml(db, origin) {
  const {results = []} = await db.prepare('SELECT name, last_seen FROM players WHERE listed = 1 ORDER BY name').all();
  const day = t => new Date(t * 1000).toISOString().slice(0, 10);
  const urls = [
    ...Object.keys(STATIC).map(p => `<url><loc>${esc(origin + p)}</loc></url>`),
    `<url><loc>${esc(origin)}/rankings/stars</loc></url>`,
    ...results.map(p => `<url><loc>${esc(`${origin}/player/${encodeURIComponent(p.name)}`)}</loc><lastmod>${day(p.last_seen)}</lastmod></url>`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
