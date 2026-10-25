// A fake OpenRotMG game server that returns the same formats as the real one
// (taken from Open-RotMG-Server src/server.rs, src/store/hiscores.rs, src/store/legends.rs).
// Used for tests and for previewing OpenEye with sample data:
//   node test/mock-game-server.js 18900
//   OPENEYE_API=http://127.0.0.1:18900 npm start
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'public/catalog/items.json'), 'utf8'));
const classes = JSON.parse(readFileSync(join(root, 'public/catalog/classes.json'), 'utf8'));

// Deterministic pseudo-random numbers so the sample world is stable.
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = a => a[Math.floor(rand() * a.length)];

const NAMES = ['RedBracket', 'Majstr', 'typ', 'Oryxbane', 'Tishy', 'Mulch', 'Petrichor', 'Vexil', 'Zakk', 'Brindle',
  'Quillon', 'Sorrel', 'Hexen', 'Lumen', 'Fennick', 'Grue', 'Ashlar', 'Kestrel', 'Nim', 'Ombra', 'Pyx', 'Rook', 'Sable', 'Tamsin', 'Wren'];
const KILLERS = ['Pirate', 'Snake', 'Lich', 'Ent Ancient', 'Red Demon', 'Cyclops God', 'Medusa', 'Oryx the Mad God', 'Ghost King', 'Sprite God', 'Beholder', 'Septavius the Ghost God'];
const collectible = catalog.filter(i => i.sprite && !i.soulbound).map(i => i.id);
const bySlot = slot => catalog.filter(i => i.slot === slot && i.sprite);

const start = Math.floor(Date.now() / 1000) - 21 * 86400;
const players = NAMES.map((name, i) => ({
  account: [5, 8, 45][i] ?? 50 + i * 3,
  name,
  discord_id: rand() < 0.5 ? String(100000000000000000n + BigInt(Math.floor(rand() * 1e15))) : null,
  base_fame: 0, total_fame: 0, collection: 0, quests: 0, stars: 0,
  items: new Map()
}));
for (const p of players) {
  const n = Math.floor(rand() * 70);
  for (let k = 0; k < n; k++) p.items.set(pick(collectible), start + Math.floor(rand() * 20 * 86400));
  p.base_fame = Math.floor(rand() * 900);
  p.quests = Math.floor(rand() * 40);
  p.stars = Math.floor(rand() * 66);
}

// Bots, like on the real server: they play and die, but never appear on the hiscores.
const BOT_NAMES = ['Amitbist', 'BaBlouGaa', 'Cake', 'DrZoidy', 'Greenape', 'HECTA', 'LucidOne', 'Nutzz', 'PlanBam', 'Wildnub'];
const bots = BOT_NAMES.map((name, i) => ({account: 9000 + i, name}));

let charSeq = 1000;
const deaths = [];
function addDeath(when) {
  const p = rand() < 0.35 ? pick(bots) : pick(players);
  const cls = pick(classes);
  const equipment = cls.slotTypes.map(slot => (rand() < 0.92 ? pick(bySlot(slot))?.id ?? -1 : -1));
  while (equipment.length < 12) equipment.push(rand() < 0.3 ? pick([2594, 2591, 2592, 2593, 2636, 2613]) : -1);
  const base = Math.floor(rand() * rand() * 2500) + 5;
  const bonus = Math.floor(base * rand() * 0.6);
  const d = {
    account: p.account, charId: charSeq++, name: p.name, class: cls.id, level: Math.min(20, 5 + Math.floor(rand() * 18)),
    tex1: 0, tex2: 0, equipment, base, total: base + bonus, diedAt: when, killedBy: pick(KILLERS),
    bonuses: bonus ? [{id: 'Ancestor', desc: 'First death of a character with this class', amount: Math.floor(bonus / 2)},
      {id: 'Tunnel Rat', desc: 'Completed every dungeon type', amount: bonus - Math.floor(bonus / 2)}] : []
  };
  d.stats = {
    shots: Math.floor(rand() * 40000), hits: 0, tiles: Math.floor(rand() * 9000), kills: Math.floor(rand() * 3000),
    gods: Math.floor(rand() * 400), oryx: rand() < 0.2 ? 1 : 0, quests: Math.floor(rand() * 60), assists: Math.floor(rand() * 30),
    caves: Math.floor(rand() * 5), lairs: Math.floor(rand() * 4), abysses: Math.floor(rand() * 3), pits: Math.floor(rand() * 4),
    dens: Math.floor(rand() * 5), sprites: Math.floor(rand() * 3), tombs: Math.floor(rand() * 2)
  };
  d.stats.hits = Math.floor(d.stats.shots * (0.4 + rand() * 0.4));
  if (p.items) p.total_fame += d.total;
  deaths.push(d);
}
for (let i = 0; i < 60; i++) addDeath(start + Math.floor(rand() * 21 * 86400));

function tick() {
  // The world moves a little between polls.
  const p = pick(players);
  p.base_fame += Math.floor(rand() * 40);
  if (rand() < 0.6) p.items.set(pick(collectible), Math.floor(Date.now() / 1000));
  if (rand() < 0.3) addDeath(Math.floor(Date.now() / 1000));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const guestBudget = new Map();
function admit(ip) {
  const nowMs = Date.now();
  const e = guestBudget.get(ip);
  if (!e || nowMs - e.start >= 60000) { guestBudget.set(ip, {start: nowMs, count: 1}); return true; }
  e.count++;
  return e.count <= 20;
}
const form = req => new Promise(res => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => res(new URLSearchParams(b))); });

export function createMock({ticking = true} = {}) {
  const stats = {requests: {}};
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    stats.requests[url.pathname] = (stats.requests[url.pathname] ?? 0) + 1;
    const sendJson = (v, s = 200) => { res.writeHead(s, {'content-type': 'application/json'}); res.end(JSON.stringify(v)); };
    const sendXml = (v, s = 200) => { res.writeHead(s, {'content-type': 'application/xml'}); res.end(v); };
    if (url.pathname === '/health') {
      return sendJson({status: 'development', uptime_seconds: 3600, worlds: 11, players: Math.floor(rand() * 9), bots: 20, revision: 'mock'});
    }
    if (url.pathname === '/api/bots') {
      return sendJson({bots: bots.slice(0, 8).map(b => ({name: b.name, age_ms: 12, viewers: 0, frame: null})), llm: {}, grounds: {}});
    }
    if (url.pathname === '/api/hiscores') {
      if (ticking) tick();
      for (const p of players) p.collection = p.items.size;
      return sendJson({updated_at: Math.floor(Date.now() / 1000), collectible_items: collectible,
        players: players.map(({items, ...p}) => p)});
    }
    const col = url.pathname.match(/^\/api\/collection\/(\d+)$/);
    if (col) {
      const p = players.find(x => x.account === Number(col[1]));
      if (!p) return sendJson({error: 'player has no competitive profile'}, 400);
      return sendJson({account: p.account, name: p.name, items: [...p.items].sort((a, b) => a[0] - b[0]).map(([item, found_at]) => ({item, found_at}))});
    }
    if (url.pathname === '/legacy-api/fame/list' && req.method === 'POST') {
      if (!admit(req.socket.remoteAddress)) return sendXml('<Error>Too many guest entry requests; retry in one minute.</Error>', 429);
      const f = await form(req);
      const span = f.get('timespan');
      const window = {week: 7 * 86400, month: 30 * 86400, all: Infinity}[span];
      if (!window) return sendXml('<Error>timespan must be week, month or all</Error>', 400);
      const cutoff = Date.now() / 1000 - window;
      const top = deaths.filter(d => d.diedAt > cutoff).sort((a, b) => b.total - a.total || a.diedAt - b.diedAt).slice(0, 20);
      return sendXml(`<FameList timespan="${span}">` + top.map(d =>
        `<FameListElem accountId="${d.account}" charId="${d.charId}"><Name>${esc(d.name)}</Name><ObjectType>${d.class}</ObjectType><Tex1>0</Tex1><Tex2>0</Tex2><Equipment>${d.equipment.join(',')}</Equipment><TotalFame>${d.total}</TotalFame></FameListElem>`).join('') + '</FameList>');
    }
    if (url.pathname === '/legacy-api/char/fame' && req.method === 'POST') {
      const f = await form(req);
      const d = deaths.find(x => x.account === Number(f.get('accountId')) && x.charId === Number(f.get('charId')));
      if (!d) return sendXml('<Error>Query returned no rows</Error>', 400);
      const s = d.stats;
      return sendXml(`<Fame><Char id="${d.charId}"><Account><Name>${esc(d.name)}</Name></Account><ObjectType>${d.class}</ObjectType><Level>${d.level}</Level><Tex1>0</Tex1><Tex2>0</Tex2></Char><CreatedOn>${d.diedAt}</CreatedOn><KilledBy>${esc(d.killedBy)}</KilledBy><TotalFame>${d.total}</TotalFame><Shots>${s.shots}</Shots><ShotsThatDamage>${s.hits}</ShotsThatDamage><TilesUncovered>${s.tiles}</TilesUncovered><MonsterKills>${s.kills}</MonsterKills><GodKills>${s.gods}</GodKills><OryxKills>${s.oryx}</OryxKills><QuestsCompleted>${s.quests}</QuestsCompleted><PirateCavesCompleted>${s.caves}</PirateCavesCompleted><UndeadLairsCompleted>${s.lairs}</UndeadLairsCompleted><AbyssOfDemonsCompleted>${s.abysses}</AbyssOfDemonsCompleted><SnakePitsCompleted>${s.pits}</SnakePitsCompleted><SpiderDensCompleted>${s.dens}</SpiderDensCompleted><SpriteWorldsCompleted>${s.sprites}</SpriteWorldsCompleted><TombsCompleted>${s.tombs}</TombsCompleted><LevelUpAssists>${s.assists}</LevelUpAssists><BaseFame>${d.base}</BaseFame>${d.bonuses.map(b => `<Bonus id="${b.id}" desc="${b.desc}">${b.amount}</Bonus>`).join('')}</Fame>`);
    }
    sendJson({error: 'not found'}, 404);
  }).on('listening', function () { this.stats = stats; this.players = players; });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 18900);
  createMock().listen(port, '127.0.0.1', () => console.log(`Mock OpenRotMG API on http://127.0.0.1:${port}`));
}
