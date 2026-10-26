// Client for the public Open RotMG game API. Only endpoints that need no login are used.
// Runs unchanged in Cloudflare Workers and in Node.
const HEADERS = {'user-agent': 'OpenEye/1.0 (+https://openrotmgeye.com)'};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// ---- tiny XML helpers for the fixed legacy formats ----
export const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const child = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? unescape(m[1]) : null;
};
const num = (xml, name) => {
  const v = child(xml, name);
  return v === null || v === '' ? null : Number(v);
};
function errorIn(xml) {
  const e = child(xml, 'Error');
  if (e !== null) throw new ApiError(e, 200);
}

const DEATH_STATS = {
  shots: 'Shots', shotsThatDamage: 'ShotsThatDamage', tilesUncovered: 'TilesUncovered',
  monsterKills: 'MonsterKills', godKills: 'GodKills', oryxKills: 'OryxKills',
  questsCompleted: 'QuestsCompleted', pirateCaves: 'PirateCavesCompleted',
  undeadLairs: 'UndeadLairsCompleted', abysses: 'AbyssOfDemonsCompleted',
  snakePits: 'SnakePitsCompleted', spiderDens: 'SpiderDensCompleted',
  spriteWorlds: 'SpriteWorldsCompleted', tombs: 'TombsCompleted', levelUpAssists: 'LevelUpAssists'
};

const int = v => Number.isSafeInteger(v);
const intList = (v, n) => Array.isArray(v) && v.length === n && v.every(int);
function validCharacter(c) {
  return c && int(c.account) && int(c.id) && int(c.class) && int(c.level) && int(c.fame)
    && intList(c.stats, 8) && intList(c.equipment, 4);
}
function validDeath(d) {
  return d && int(d.account) && int(d.id) && int(d.class) && int(d.died_at) && typeof d.name === 'string'
    && int(d.total_fame) && Array.isArray(d.equipment) && d.equipment.every(int);
}

export function createGameApi(apiBase) {
  // Outgoing requests made by this client. Cloudflare caps requests per Worker run
  // (50 on the free plan), so the collector checks this before each request.
  let used = 0;
  async function request(path, {form, timeout = 15000} = {}) {
    used++;
    // Workers' fetch has no redirect: 'error', so redirects are refused by hand.
    const init = {headers: {...HEADERS}, redirect: 'manual', signal: AbortSignal.timeout(timeout)};
    if (form) {
      init.method = 'POST';
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])).toString();
    }
    const res = await fetch(apiBase + path, init);
    if (res.status >= 300 && res.status < 400) throw new ApiError(`${path}: unexpected redirect (${res.status})`, res.status);
    const text = await res.text();
    if (!res.ok) {
      const xmlErr = text.match(/<Error>([\s\S]*?)<\/Error>/)?.[1];
      let jsonErr = null;
      try { jsonErr = JSON.parse(text).error; } catch {}
      throw new ApiError(`${path}: ${res.status} ${unescape(xmlErr ?? jsonErr ?? text.slice(0, 120))}`, res.status);
    }
    return text;
  }
  const json = async path => JSON.parse(await request(path));

  return {
    used: () => used,

    /** All ranked players: {updated_at, players:[...], collectible_items:[...]} */
    async hiscores() {
      const data = await json('/api/hiscores');
      if (!Array.isArray(data?.players) || !Number.isSafeInteger(data.updated_at)) throw new ApiError('Malformed hiscores response');
      for (const p of data.players) {
        if (!Number.isSafeInteger(p.account) || typeof p.name !== 'string') throw new ApiError('Malformed hiscores player');
      }
      // Living characters arrive with OpenRotMG server PR #624. Older servers leave the
      // field out; anything malformed is dropped rather than failing the whole poll.
      if (data.characters !== undefined) {
        data.characters = Array.isArray(data.characters) ? data.characters.filter(validCharacter) : undefined;
      }
      return data;
    },

    /**
     * Every player death (bots and non-competitors excluded by the server) from `since`
     * (unix seconds, inclusive), oldest first, at most 500 per call. Server PR #624.
     */
    async graveyard(since) {
      const data = await json(`/api/graveyard?since=${Math.max(0, Math.floor(since))}`);
      if (!Array.isArray(data?.deaths)) throw new ApiError('Malformed graveyard response');
      return data.deaths.filter(validDeath);
    },

    /** Items a player has personally looted: {account, name, items:[{item, found_at}]} */
    async collection(account) {
      const data = await json(`/api/collection/${account}`);
      if (data.account !== account || !Array.isArray(data.items)) throw new ApiError('Malformed collection response');
      return data;
    },

    /** Server health: players online, bots, uptime. */
    health: () => json('/health'),

    /** Names of the server's currently running bots. */
    async bots() {
      const data = await json('/api/bots');
      if (!Array.isArray(data?.bots)) throw new ApiError('Malformed bots response');
      return data.bots.map(b => b?.name).filter(n => typeof n === 'string' && /^[A-Za-z0-9]{1,20}$/.test(n));
    },

    /**
     * Legends list (top 20 deaths) for 'week' | 'month' | 'all'.
     * NOTE: counts against the server's 20-per-minute guest login budget for the caller's IP.
     */
    async legends(timespan) {
      const xml = await request('/legacy-api/fame/list', {form: {timespan, accountId: 0, charId: 0}});
      errorIn(xml);
      const entries = [];
      for (const m of xml.matchAll(/<FameListElem accountId="(\d+)" charId="(\d+)">([\s\S]*?)<\/FameListElem>/g)) {
        const body = m[3];
        entries.push({
          account: Number(m[1]),
          charId: Number(m[2]),
          name: child(body, 'Name'),
          class: num(body, 'ObjectType'),
          tex1: num(body, 'Tex1') ?? 0,
          tex2: num(body, 'Tex2') ?? 0,
          equipment: (child(body, 'Equipment') ?? '').split(',').filter(Boolean).map(Number),
          totalFame: num(body, 'TotalFame')
        });
      }
      return entries;
    },

    /** Full death record of a dead character. Not rate limited by the server, but we pace it anyway. */
    async deathDetail(account, charId) {
      const xml = await request('/legacy-api/char/fame', {form: {accountId: account, charId}});
      errorIn(xml);
      const charXml = xml.match(/<Char id="(\d+)">([\s\S]*?)<\/Char>/);
      if (!charXml || Number(charXml[1]) !== charId) throw new ApiError('Malformed death record');
      const stats = {};
      for (const [key, tag] of Object.entries(DEATH_STATS)) stats[key] = num(xml, tag) ?? 0;
      const bonuses = [...xml.matchAll(/<Bonus id="([^"]*)" desc="([^"]*)">(-?\d+)<\/Bonus>/g)]
        .map(([, id, desc, amount]) => ({id: unescape(id), desc: unescape(desc), amount: Number(amount)}));
      return {
        name: child(charXml[2], 'Name'),
        class: num(charXml[2], 'ObjectType'),
        level: num(charXml[2], 'Level'),
        tex1: num(charXml[2], 'Tex1') ?? 0,
        tex2: num(charXml[2], 'Tex2') ?? 0,
        diedAt: num(xml, 'CreatedOn'),
        killedBy: child(xml, 'KilledBy'),
        totalFame: num(xml, 'TotalFame'),
        baseFame: num(xml, 'BaseFame'),
        stats,
        bonuses
      };
    }
  };
}
