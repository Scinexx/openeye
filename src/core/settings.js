// OpenEye settings. On Cloudflare, any of these can be overridden with a Worker
// variable of the same name in SCREAMING_SNAKE_CASE (for example API_BASE).
export const DEFAULTS = {
  // Public game API of the hosted Open RotMG server.
  apiBase: 'https://game.openrotmg.org',
  // How often each collection job runs, in minutes.
  healthMinutes: 2,
  hiscoresMinutes: 5,
  // Legends shares a 20-requests-per-minute budget with game logins from the same IP.
  // Each legends cycle uses 3 requests, so keep this well above 1 minute.
  legendsMinutes: 15,
  deathsMinutes: 2,
  // Full collection re-check for every player, in hours (changed players sync every cycle).
  collectionResyncHours: 24,
  // Pause between consecutive requests to the game server, in milliseconds.
  requestGapMs: 1200,
  // Death records fetched per cycle.
  deathDetailsPerRun: 25,
  // Latest loot hides untiered items that this share of ranked players already own,
  // once at least popularUtMinPlayers players are ranked.
  popularUtShare: 0.5,
  popularUtMinPlayers: 8
};

const toEnvName = k => k.replace(/[A-Z]/g, c => `_${c}`).toUpperCase();

/** Merge defaults with overrides from an env-like object (Worker vars or process.env with OPENEYE_ prefix). */
export function loadSettings(env = {}, prefix = '') {
  const s = {...DEFAULTS};
  for (const key of Object.keys(DEFAULTS)) {
    const v = env[prefix + toEnvName(key)];
    if (v === undefined || v === '') continue;
    s[key] = typeof DEFAULTS[key] === 'number' ? Number(v) : String(v);
  }
  s.apiBase = s.apiBase.replace(/\/+$/, '');
  if (s.legendsMinutes < 3) throw new Error('legendsMinutes must be at least 3 so game logins are never rate limited');
  return s;
}
