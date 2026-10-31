# Hosting your own OpenEye

OpenEye can track any Open RotMG server whose public web API is reachable: the official one, or your own. This guide covers running it locally, putting it on Cloudflare, pointing it at a different game server, and keeping it working as Open RotMG changes.

- [What you need](#what-you-need)
- [Try it locally](#try-it-locally)
- [Deploy on Cloudflare](#deploy-on-cloudflare)
- [Point it at your own game server](#point-it-at-your-own-game-server)
- [Game data (items, enemies, sprites)](#game-data-items-enemies-sprites)
- [Make it yours](#make-it-yours)
- [Running it](#running-it)
- [When Open RotMG changes](#when-open-rotmg-changes)
- [Ground rules](#ground-rules)

## What you need

- [Node.js](https://nodejs.org) 22.13 or newer.
- A [Cloudflare](https://dash.cloudflare.com/sign-up) account. The free plan is enough: the site, API, database (D1) and the 2-minute collector all fit in it.
- A GitHub repository with this code (a fork is fine), if you want deploys on every push and the daily game data update.
- A game server that serves the public endpoints below.

| Endpoint | Needed for |
| --- | --- |
| `GET /health` | Server status and players online |
| `GET /api/bots` | Telling bots apart from players |
| `GET /api/hiscores` | Players, rankings and history (required) |
| `GET /api/collection/{account}` | Item collections and Latest loot |
| `POST /legacy-api/fame/list` | Legends, and finding deaths |
| `POST /legacy-api/char/fame` | Full death records |
| `GET /api/graveyard?since=` | Every death (optional, see below) |

Living characters, the full graveyard and guilds turn on by themselves when the server's hiscores include them ([server PR #624](https://github.com/OpenRotMG/Open-RotMG-Server/pull/624) added characters and the graveyard). Without them those pages and sections stay hidden.

## Try it locally

No Cloudflare account is needed for this. `npm run local` runs the website and the collector with Node and a SQLite file (`data/openeye.db`).

```sh
npm install
npm test                                   # the test suite, against a built-in fake game server
OPENEYE_API_BASE=https://your.game.server npm run local
```

Then open http://127.0.0.1:3000. Without `OPENEYE_API_BASE` it reads the official server.

To work on the site with no game server at all, run the fake one from the tests in a second terminal:

```sh
node test/mock-game-server.js 18951 --pr624 --death-stats
OPENEYE_API_BASE=http://127.0.0.1:18951 npm run local
```

Every setting in `src/core/settings.js` can be set the same way, as `OPENEYE_` plus the name in capitals (for example `OPENEYE_LEGENDS_MINUTES=30`). `OPENEYE_PORT`, `OPENEYE_HOST` and `OPENEYE_DB` choose where it listens and which database file it uses.

## Deploy on Cloudflare

1. **Sign in** from this folder: `npx wrangler login`.
2. **Create the database:** `npx wrangler d1 create openeye`. It prints a `database_id`.
3. **Edit `wrangler.jsonc`:**
   - `d1_databases[0].database_id`: the id from step 2.
   - `routes`: your own domain (it must be on your Cloudflare account), or delete the `routes` block to use the free `openeye.<your-subdomain>.workers.dev` address.
   - `vars.SITE_URL`: your site's address. The collector names it in its user-agent so the game server's operator can see who is calling.
   - In `public/index.html`, the `og:url` and `og:image` addresses, so links to your site preview correctly.
   - `name`, if you want the Worker called something else.
4. **Deploy:** `npx wrangler deploy`. The tables are created on the first request, and the collector starts on the next 2-minute tick. The site fills in over the following minutes.
5. **Deploy on every push (optional):** in the Cloudflare dashboard, open Workers & Pages → your Worker → Settings → Builds, and connect your GitHub repository. Every push to `main` then deploys.

Then, once the game server has a `/api/graveyard` endpoint, switch on the full graveyard in the D1 console (Storage & Databases → D1 → your database → Console):

```sql
INSERT OR REPLACE INTO meta(key, value) VALUES('graveyard_enabled', '1');
```

`'0'` switches it off again. Until then deaths are found through the Legends lists only.

## Point it at your own game server

Set `API_BASE` to your server's public address: as a Worker variable in the dashboard (Settings → Variables and Secrets), or in `wrangler.jsonc` under `vars`. `keep_vars` is on, so variables set in the dashboard survive deploys. Locally, use `OPENEYE_API_BASE`.

The other settings are in `src/core/settings.js`, each with a note on what it does. The ones you are most likely to change:

| Setting | Default | What it does |
| --- | --- | --- |
| `API_BASE` | `https://game.openrotmg.org` | The game server's public API |
| `SITE_URL` | empty | Your address, for the user-agent |
| `HISCORES_MINUTES` | 5 | How often players are read |
| `LEGENDS_MINUTES` | 15 | Legends uses the server's guest login budget; keep it at 3 or more |
| `REQUEST_GAP_MS` | 1200 | Pause between requests to the game server |
| `MAX_FETCHES_PER_RUN` | 45 | Requests per collector run; the free plan allows 50 |

## Game data (items, enemies, sprites)

Item names, tooltips, sprites, classes, enemies and their drops live in `public/catalog/`. They are built from the game's own repositories by `tools/update-catalog.mjs`:

- `objects.xml` and the item sprite sheet from Open-RotMG-Server and Open-RotMG-Website,
- sprites, sounds and the map loading screen from the client (`client.swf`, read by `tools/codex/swf.mjs`),
- drop tables from running the server's own loot code: `tools/codex/loot_export.rs` is appended to the server's `src/loot.rs` and run as a test, which writes every enemy's possible drops to `loot.json`.

**Automatically:** `.github/workflows/update-game-data.yml` does all of this every day and commits any change. In a fork, enable it under the Actions tab. If your server is a fork of Open RotMG, set the repository variable `OPENROTMG_OWNER` to the GitHub owner of your copies of `Open-RotMG-Server`, `Open-RotMG-Website` and `Open-RotMG-Client` (the names must match).

**By hand:**

```sh
mkdir -p .openrotmg && cd .openrotmg
for r in Open-RotMG-Server Open-RotMG-Website Open-RotMG-Client; do git clone --depth 1 https://github.com/OpenRotMG/$r.git; done
cd Open-RotMG-Server
cat ../../tools/codex/loot_export.rs >> src/loot.rs
OPENEYE_LOOT_OUT=../loot.json cargo test openeye_export
git checkout src/loot.rs && cd ../..
node tools/update-catalog.mjs --from .openrotmg --loot .openrotmg/loot.json
```

Without `--loot` the catalog is still built, but enemies keep the drops they already had.

## Make it yours

- **Name and address:** "OpenEye" appears in `public/index.html` (title, footer, link preview tags), `public/manifest.webmanifest` and page titles in `public/app.js`. The link preview tags in `public/index.html` (`og:url`, `og:image`) also carry the site's address; change them to yours.
- **Icons:** draw one square mark and run `python3 tools/build-icons.py`; it makes the favicon, app icons, header logo and link preview image. `design/templates/README.txt` explains the sizes.
- **About page and footer:** `about()` in `public/app.js` and the footer in `public/index.html`.
- **Colours:** the default theme's colours are CSS variables at the top of `public/style.css`. The potion, key and consumable themes are further down, each under `:root[data-theme="…"]`.

## Running it

- **Logs:** Workers & Pages → your Worker → Logs. The collector logs each job and any error from the game server.
- **Freshness:** the About page shows when each job last succeeded. If players have not updated for 20 minutes, every page shows a note saying so.
- **Database:** the D1 console runs SQL directly. Collector state is kept in the `meta` table (`last_ok:<job>`, `last_error:<job>`, cursors and switches such as `graveyard_enabled`).
- **Backups:** D1 keeps its own history ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)); `npx wrangler d1 time-travel restore openeye --timestamp=…` rolls the database back. For a copy you keep, `npx wrangler d1 export openeye --remote --output=backup.sql`.
- **Starting over:** delete the database and create a new one; the tables are recreated on the next request. History before tracking began is estimated from what the server publishes (`src/core/backfill.js`).

## When Open RotMG changes

Open RotMG is still being developed, so expect to adjust OpenEye now and then. Where to look:

| What changed in the game | Where it shows up in OpenEye |
| --- | --- |
| A public endpoint's format | `src/core/gameapi.js` parses every response and rejects anything unexpected, so the job fails loudly (About page, logs) rather than storing bad data. Update the parser, then the fake server in `test/mock-game-server.js` so the tests cover the new format. |
| New items, enemies or classes | The daily game data update. If it fails, the Actions log has the error as an annotation. |
| The server's loot code | `tools/codex/loot_export.rs` calls the server's own loot functions, so it is the first thing to break when they are renamed. The workflow fails at "Export enemy drops". |
| The client's sprite sheets | The client's sheet names are partly obfuscated; `tools/codex/enemies.mjs` lists the ones it needs by name. A new client build can rename them. |
| A new kind of death or killer | `tools/codex/killers.mjs` maps object ids the server records to the names the client shows, and is rebuilt with the catalog. |
| New data in the hiscores | `src/core/collector.js` stores it and `src/core/schema.js` adds the columns (every schema statement runs on each start, so add new columns with `ALTER TABLE … ADD COLUMN`). |

`npm test` runs the whole collector and site against the fake server, so it is the quickest check after any change.

## Ground rules

These keep OpenEye welcome on the servers it reads:

- **Read only.** OpenEye has no accounts, admin pages or anything that writes to the game. Keep it that way if the site is public.
- **Players only.** Bots are kept out of rankings, loot and the graveyard. Leave that in place: the game's own boards do the same.
- **Be gentle with the game server.** Requests go one at a time with a pause between them. Ask the server's operator before raising the rates or adding endpoints they have not made public.
