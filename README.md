<div align="center">

<img src="public/icons/icon-192.png" alt="" width="96" height="96">

# OpenEye

**Player stats, rankings and loot tracking for [Open RotMG](https://openrotmg.org)**

[**openrotmgeye.com**](https://openrotmgeye.com)

</div>

---

OpenEye is a RealmEye-style tracker for Open RotMG, the open-source recreation of Realm of the Mad God as it was in 2012. It reads the game's public data every few minutes, keeps a history of it, and presents it as a fast, mobile-friendly website.

## Features

- **Rankings** across stars, living fame, fame earned, collection and quests, with rank stars coloured exactly as in the 2012 client; empty guest accounts are left out
- **Fame earned**: every rise in a player's living fame, added up from each 5-minute check. Living fame players already had when tracking began is counted as earned the day before
- **Most fame earned in the last 24 hours** on the home page; the leader wears a crown next to their name across the site
- **Player profiles** with ranks, a progress graph for every stat, Legends placements, and a full item collection that can be filtered by tier
- **Living characters** on each profile: class, level, fame, equipment and base stats against the class maximum
- **Graveyard** of every player death, searchable by name, with complete death records: killer, equipment, fame bonuses, accuracy, kills and dungeons cleared
- **Legends boards** for this week, this month and all time, players only: ranked from every recorded player death once the full graveyard is collected (same rules as the game: last 7 or 30 days or ever, most total fame, top 20), and until then from the player deaths that reached the game's own lists
- **Latest loot** showing rare untiered drops and top-tier items as players find them
- **Loot history** of every item players have looted, filterable by tier, item type, time range and player
- **Item browser** with who found each item first and who died wearing it
- **Enemies**: every enemy in the current game code with its HP, defense, projectiles (damage, range, effects) and every item it can drop, read from the server's own loot code; item pages list what drops them
- **In-game item tooltips**: hover any item icon to see the same tooltip the game shows, built by the same rules as the 2012 client
- **Bot separation**: the server's bots are kept out of rankings, loot and the player graveyard
- **Themes**: a settings cog with nine colour themes, the default plus one for each stat potion, remembered per browser
- **Live server status** with current and 24-hour peak player counts

## How it works

OpenEye runs entirely on Cloudflare. Every push to `main` is deployed automatically by Workers Builds.

```
            every 2 min                       on page visit
Open RotMG ────────────▶  Collector  ──▶  D1  ◀──  Worker /api/*  ◀──  Browser
 game API               (Cron Trigger)                                   │
                                                 static site (public/) ◀─┘
```

| Component | Cloudflare product | Defined in |
| --- | --- | --- |
| Website | Workers static assets | `public/` |
| API | Workers | `src/worker.js` |
| Database | D1 | `wrangler.jsonc` |
| Collector | Cron Triggers | `src/core/collector.js` |
| Rate limiting | Workers Rate Limiting | `wrangler.jsonc` |
| Domains | Custom Domains | `wrangler.jsonc` |

The site is read-only. It has no accounts, admin pages or write endpoints, every API request is rate limited per visitor, and all pages are served with a strict Content Security Policy.

### Data collection

OpenEye only uses the public endpoints that the official Open RotMG website and Discord bot use, and never signs in as anyone.

| Endpoint | Frequency | Provides |
| --- | --- | --- |
| `GET /health` | 2 min | Players online |
| `GET /api/bots` | 2 min | Bot names |
| `GET /api/hiscores` | 5 min | Stars, fame, quests and collection size for every registered player |
| `GET /api/collection/{account}` | On change, and daily | Items each player has looted, with dates |
| `POST /legacy-api/fame/list` | 15 min | Legends lists, which is how deaths are discovered |
| `POST /legacy-api/char/fame` | Once per death | Full death record |
| `GET /api/graveyard?since=` | 5 min | Every player death |

Requests are sent one at a time with a pause between them, capped at 45 per run. The Legends endpoint shares the server's guest login limit, so it is called only three times every 15 minutes.

### Living characters and the full graveyard

[OpenRotMG server PR #624](https://github.com/OpenRotMG/Open-RotMG-Server/pull/624) added living characters to `/api/hiscores` and a `/api/graveyard` endpoint, both without bots.

- **Characters** are stored on every hiscores poll and shown on profiles. No extra requests are made.
- **The graveyard** reads `/api/graveyard` from a cursor every 5 minutes, and each new death then gets its full record from `/legacy-api/char/fame`. It only runs while the meta key `graveyard_enabled` is `1` (set in the D1 SQL console; `0` stops it).

Characters and graveyard deaths are only kept for accounts on the hiscores, so bots are left out even if the server ever sent them.

### Game data

Items, tooltips, enemies and their drops are rebuilt every day by a GitHub Action (`.github/workflows/update-game-data.yml`). It downloads the latest Open RotMG server, website and client, runs the server's own loot tables (`tools/codex/loot_export.rs`) to list what each enemy can drop, reads enemy stats from `objects.xml` and sprites from the client, and commits any change. Cloudflare then deploys it. It can also be started by hand from the repository's Actions tab.

### Bots

The game server keeps bot accounts off the hiscores and out of item collections, so bot loot never reaches OpenEye. Bot deaths do appear on the Legends lists; any death from an account that has never been on the hiscores is treated as a bot's and left out of the graveyard.

### Notable loot

The home page's Latest loot lists untiered items and the best tier that can drop in each slot (T12 weapons, T13 armour, T6 abilities). Common untiered drops are excluded automatically using the server's own loot tables: anything with a drop chance of 10% or more, plus Wand of the Bulwark, Ring of Divine Faith and St. Abraham's Wand. Untiered items already owned by half the ranked players and T5 rings are excluded too. These rules live in `tools/update-catalog.mjs`.

## Development

Requires [Node.js](https://nodejs.org) 22.13 or newer.

```sh
npm install        # installs Wrangler
npm test           # runs the test suite against a built-in fake game server
npm run dev        # runs the real Workers runtime locally with a local database
npm run local      # runs without Cloudflare, using Node and a SQLite file
```

| Script | Purpose |
| --- | --- |
| `npm run update-catalog` | Rebuilds item names, tiers, tooltips, sprites and classes from the OpenRotMG repositories after a game update |
| `python3 tools/build-icons.py` | Rebuilds every icon (favicon, app icons, header logo, link preview) from `design/mark.png` |

### Configuration

Polling intervals, the game server address and the loot thresholds are defined in `src/core/settings.js`. Any setting can be overridden without a code change by adding a Worker variable with the same name in capitals (for example `LEGENDS_MINUTES`) under **Settings → Variables and Secrets** in the Cloudflare dashboard.

### Operations

- **Logs:** Workers & Pages → openeye → Logs
- **Database:** Storage & Databases → D1 → openeye (SQL console available)

## Project structure

```
public/            Website: HTML, CSS, JavaScript, fonts, icons and the item catalog
src/worker.js      Cloudflare entry point (API and scheduled collector)
src/core/          Shared logic: collector, API, schema, game API client, settings
src/node/          Local server and SQLite adapter for development and tests
tools/             Catalog and icon build scripts
design/            Logo source and icon templates
test/              Test suite and fake game server
```

## Limitations

- **History before tracking is estimated.** Once every death is on record, each player's graphs are filled in back to their first character, one point per day: collection exactly (from loot dates), stars by the server's own rule, fame earned spread over the days it was most likely earned (the total is unchanged), living fame from each character's fame assumed to grow evenly, and quests as a steady rise. See `src/core/backfill.js`.

## Credits

Item and class sprites and game data come from the [Open RotMG](https://github.com/OpenRotMG) project. Fonts are [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans), [Atkinson Hyperlegible](https://fonts.google.com/specimen/Atkinson+Hyperlegible) and [Source Sans 3](https://fonts.google.com/specimen/Source+Sans+3), all under the SIL Open Font License. See [`THIRD_PARTY.md`](THIRD_PARTY.md) for details.

OpenEye is a fan project by spankmaster. It is not run by or affiliated with the Open RotMG developers.

## Reuse

OpenEye is open source. Feel free to reuse, copy or build on it, for example for your own Open RotMG fan site.
