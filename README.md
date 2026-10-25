# OpenEye

A RealmEye-style tracker for [Open RotMG](https://openrotmg.org), the open-source 2012 Realm of the Mad God recreation. Live at **[openrotmgeye.com](https://openrotmgeye.com)**.

OpenEye collects public player data from the game server every few minutes, keeps the history, and shows it as a website: rankings, player pages with progress graphs and item collections, the Legends graveyard, Legends boards, an item browser and server status.

## How it runs

OpenEye runs entirely on Cloudflare:

| Piece | Cloudflare product | Where it is defined |
| --- | --- | --- |
| Website (everything in `public/`) | Workers static assets | `wrangler.jsonc` → `assets` |
| JSON API (`/api/*`) | Worker | `src/worker.js` |
| Database | D1 (database `openeye`) | `wrangler.jsonc` → `d1_databases` |
| Collector | Cron Trigger, every 2 minutes | `wrangler.jsonc` → `triggers` |
| Rate limiting | Workers Rate Limiting | `wrangler.jsonc` → `ratelimits` |
| Domain | Custom Domains for openrotmgeye.com and www | `wrangler.jsonc` → `routes` |

Every push to `main` deploys automatically through Workers Builds. The database tables are created automatically on first run.

## What gets collected

OpenEye only uses endpoints that the official Open RotMG website and Discord bot already use, and it never logs in as anyone.

| Game endpoint | How often | Used for |
| --- | --- | --- |
| `GET /health` | 2 min | Players online |
| `GET /api/bots` | 2 min | Names of the server's bots |
| `GET /api/hiscores` | 5 min | Every registered player's stars, fame, quests and collection size |
| `GET /api/collection/{account}` | When a player's count changes, and daily | Items a player has looted, with dates |
| `POST /legacy-api/fame/list` | 15 min | Legends lists; how deaths are discovered |
| `POST /legacy-api/char/fame` | Once per new death | Full death record |

Requests go out one at a time with a pause between them. The Legends list shares the server's limit of 20 guest logins per minute per IP, so OpenEye uses only 3 of those every 15 minutes.

Each run makes at most 45 requests to the game server (`maxFetchesPerRun`), because Cloudflare's free plan allows 50 outgoing requests per run. Work that does not fit, such as a big batch of new deaths, carries over to the next run two minutes later. On Workers Paid you can raise it with a `MAX_FETCHES_PER_RUN` Worker variable if the player count grows into the hundreds.

## Players and bots

The game server runs bots that play alongside people. It keeps every bot account off the hiscores and out of item collections, so bot loot can never reach OpenEye. Bot deaths do appear on the Legends lists: OpenEye treats any death from an account that has never been on the hiscores as a bot's and shows it only in the graveyard's Bots tab. The Legends page mirrors the game's own board, so bots appear there with a "Bot" badge.

## What counts as notable loot

The home page's Latest loot shows:

- **Untiered items**, except common ones: any untiered item with a drop chance of 10% or more in the server's loot tables (Snake Pit, Spider Den, Sprite World and Forbidden Jungle gear), anything in `COMMON_UT_EXTRA` in `tools/update-catalog.mjs` (currently Wand of the Bulwark), and any untiered item that half the ranked players already own.
- **The best tier that can drop** in each slot: T12 weapons, T13 armor and T6 abilities. T5 rings are left out (`TOP_TIER_NOT_NOTABLE`).

To change these, edit `tools/update-catalog.mjs`, run `npm run update-catalog` and push.

## Making changes

| Command | What it does |
| --- | --- |
| `npm install` | Install Wrangler (only needed for the commands below) |
| `npm test` | Run the tests against a built-in fake game server |
| `npm run dev` | Run the real Workers runtime locally with a local database |
| `npm run local` | Run without Cloudflare at all (Node 22.13+ and a SQLite file) |
| `npm run update-catalog` | Rebuild item names, sprites, tiers and classes from the OpenRotMG GitHub after a game update |

Settings (polling intervals, the game server address, the loot thresholds) are in `src/core/settings.js`. Any of them can be overridden without a code change by adding a Worker variable with the same name in capitals, for example `API_BASE` or `LEGENDS_MINUTES`, under the Worker's **Settings → Variables and Secrets** in the Cloudflare dashboard.

## Logo and icons

All icons are built from one master image. Put `mark.png` (and optionally `favicon-16.png` and `logo.png`) in `design/`, run `python3 tools/build-icons.py` (needs Python 3 and Pillow), and push. The output in `public/icons/` covers the browser tab (`favicon.ico`, `icon.svg`), iPhone and Android home screens (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`), the site header (`logo.png`) and link previews (`og.png`). Blank canvases, drawing guides and a preview of every output are in `design/templates/`; its `README.txt` explains the sizes.

## Logs and data

- **Logs:** Cloudflare dashboard → Workers & Pages → openeye → Logs. Collector progress and any errors show up there.
- **Data:** Cloudflare dashboard → Storage & Databases → D1 → openeye. You can run SQL against it from the Console tab.

## Known limits

- **Living characters' gear and stats are not shown.** The game server has no public endpoint for them. Adding one would need a change to the [server](https://github.com/OpenRotMG/Open-RotMG-Server) itself.
- **Small deaths may be missing.** Deaths are discovered through the top 20 Legends lists.
- **History starts when OpenEye started.** Anything earlier only shows as a jump in the graphs.

## Project layout

```
public/          the website: HTML, CSS, JavaScript, fonts, icons/, and catalog/ (item and class data, sprites)
design/          logo source files and icon templates
src/worker.js    Cloudflare entry point
src/core/        shared logic: collector, API, database schema, game API client, settings
src/node/        local server and SQLite adapter (development and tests only)
tools/           catalog builder
test/            tests and a fake game server
```

See `THIRD_PARTY.md` for credits.
