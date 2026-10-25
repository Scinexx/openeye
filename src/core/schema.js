// Database schema, shared by Cloudflare D1 and local SQLite. Every statement is
// idempotent, so it is safe to run on every start.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    account INTEGER PRIMARY KEY, name TEXT NOT NULL, discord_id TEXT,
    base_fame INTEGER NOT NULL DEFAULT 0, total_fame INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0, quests INTEGER NOT NULL DEFAULT 0, collection INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, listed INTEGER NOT NULL DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS players_name ON players(name COLLATE NOCASE)`,
  // One row each time any ranked number changes, used for history graphs.
  `CREATE TABLE IF NOT EXISTS player_history (
    account INTEGER NOT NULL, at INTEGER NOT NULL, base_fame INTEGER NOT NULL, total_fame INTEGER NOT NULL,
    stars INTEGER NOT NULL, quests INTEGER NOT NULL, collection INTEGER NOT NULL, PRIMARY KEY (account, at))`,
  `CREATE TABLE IF NOT EXISTS name_history (
    account INTEGER NOT NULL, name TEXT NOT NULL, first_seen INTEGER NOT NULL, PRIMARY KEY (account, name))`,
  `CREATE TABLE IF NOT EXISTS collection_items (
    account INTEGER NOT NULL, item INTEGER NOT NULL, found_at INTEGER NOT NULL, PRIMARY KEY (account, item))`,
  `CREATE INDEX IF NOT EXISTS collection_by_item ON collection_items(item, found_at)`,
  `CREATE INDEX IF NOT EXISTS collection_by_time ON collection_items(found_at)`,
  `CREATE TABLE IF NOT EXISTS collection_sync (
    account INTEGER PRIMARY KEY, synced_count INTEGER NOT NULL, synced_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS collectible_items (item INTEGER PRIMARY KEY)`,
  // Dead characters, discovered through the Legends lists, with full death details.
  `CREATE TABLE IF NOT EXISTS deaths (
    account INTEGER NOT NULL, char_id INTEGER NOT NULL, name TEXT NOT NULL, class INTEGER NOT NULL,
    tex1 INTEGER NOT NULL DEFAULT 0, tex2 INTEGER NOT NULL DEFAULT 0, equipment TEXT NOT NULL,
    total_fame INTEGER NOT NULL, base_fame INTEGER, level INTEGER, died_at INTEGER, killed_by TEXT,
    stats TEXT, bonuses TEXT, discovered_at INTEGER NOT NULL, detail_status TEXT NOT NULL DEFAULT 'pending',
    detail_error TEXT, detail_tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account, char_id))`,
  `CREATE INDEX IF NOT EXISTS deaths_by_time ON deaths(died_at)`,
  `CREATE INDEX IF NOT EXISTS deaths_by_fame ON deaths(total_fame)`,
  `CREATE INDEX IF NOT EXISTS deaths_pending ON deaths(detail_status, discovered_at)`,
  `CREATE TABLE IF NOT EXISTS legends (
    timespan TEXT NOT NULL, rank INTEGER NOT NULL, account INTEGER NOT NULL, char_id INTEGER NOT NULL,
    total_fame INTEGER NOT NULL, PRIMARY KEY (timespan, rank))`,
  `CREATE TABLE IF NOT EXISTS server_status (
    at INTEGER PRIMARY KEY, ok INTEGER NOT NULL, players INTEGER, bots INTEGER, worlds INTEGER, uptime INTEGER, revision TEXT)`,
  // Names of the server's bots from the public /api/bots list. Bots never appear on
  // the hiscores, so any account missing from players is also treated as a bot.
  `CREATE TABLE IF NOT EXISTS bots (name TEXT PRIMARY KEY COLLATE NOCASE, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`
];

/** Create every table and index if missing. `db` is a D1 database or the local adapter. */
export async function ensureSchema(db) {
  await db.batch(SCHEMA.map(sql => db.prepare(sql)));
}

export const now = () => Math.floor(Date.now() / 1000);

export async function getMeta(db, key) {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}
export function setMetaStmt(db, key, value) {
  return db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value));
}
export async function setMeta(db, key, value) {
  await setMetaStmt(db, key, value).run();
}
