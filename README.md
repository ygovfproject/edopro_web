# EDOPro Web

Play EDOPro online duels in the browser, without installing the game client.

```
 Browser (Next.js + MUI, static site)          Your asset server         EDOPro server (Multirole)
 ┌─────────────────────────────────────┐       ┌──────────────────┐      ┌────────────────────────┐
 │ deck upload (.ydk), lobby, board UI │──GET──│ cards.cdb        │      │ runs the duel (ocgcore │
 │ EDOPro protocol + board model (TS)  │       │ card images      │      │ + card scripts)        │
 │ card DB via sql.js (WASM)           │       │ strings.conf     │      │                        │
 └──────────────┬──────────────────────┘       │ lflists          │      └───────────▲────────────┘
                │ WebSocket (raw EDOPro bytes)  └──────────────────┘                  │ TCP
                ▼                                                                     │
        ┌──────────────────────────┐                                                  │
        │ proxy/ (Node, 0 deps)    │──────────────────────────────────────────────────┘
        │ WS⇄TCP bridge + room list│
        └──────────────────────────┘
```

- **web/**: the client. It speaks the EDOPro network protocol itself, keeps the board
  model, renders it, and answers every duel prompt. It builds to a static site (`out/`).
- **proxy/**: the only backend piece. Browsers can't open TCP sockets, so it bridges a
  WebSocket to the EDOPro server's TCP port, byte for byte. It also relays the room list,
  because Multirole's list endpoint doesn't send CORS headers. It only connects to servers
  listed in its config, so it isn't an open proxy.

## Quick start

You need **3 things running**:

| What        | Why                                                                                | How                                                                                       |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `proxy/`    | Browsers can't open TCP connections to EDOPro servers. The proxy does it for them. | `cd proxy` → `copy config.example.json config.json` → `npm start` (port 7000)             |
| `web/`      | The game itself (the page you open).                                               | `cd web` → `copy .env.example .env` → `npm install` → `npm run dev` (port 3000)            |
| Card images | Loaded from 3rd party server by default.                                           | Nothing to run. Change `NEXT_PUBLIC_CARD_IMAGE_URL` in `web/.env` to use your own server. |

Then open http://localhost:3000, set your name, upload a `.ydk` in **Decks**, and go to **Online**.

Checklist if something doesn't work:

- "Cannot reach the proxy" → the proxy isn't running, or `NEXT_PUBLIC_PROXY_URL` in `web/.env` is wrong.
- Cards show as `#12345` → the card databases didn't load (see the warning on the home page).
- No images → wrong `NEXT_PUBLIC_CARD_IMAGE_URL` in `web/.env`.
- "Version mismatch" → the client retries with the server's version by itself and remembers it.
- The proxy only connects to servers listed in `proxy/config.json`. Add your own Multirole there.

### What runs where

In online play the **EDOPro server runs the duel**: Multirole executes ocgcore and the Lua
card scripts and sends each client the game messages. So the browser never needs `.lua`
files. It needs:

| File                      | Why                                                     | Configured in                |
| ------------------------- | ------------------------------------------------------- | ---------------------------- |
| `cards.cdb` (one or more) | names, text, stats, deck view, card search              | `NEXT_PUBLIC_DATABASES`      |
| card images               | everything visual                                       | `NEXT_PUBLIC_CARD_IMAGE_URL` |
| `strings.conf`            | prompt texts, victory reasons, counter names            | `NEXT_PUBLIC_STRINGS_URL`    |
| `*.lflist.conf`           | banlist picker when hosting, banlist names in the lobby | `NEXT_PUBLIC_BANLISTS`       |

The `.cdb` should match the server's database. Cards the client doesn't know still work,
but they show as `#code`.

## Running it locally (Windows)

Requires Node.js 20 or newer.

**1. Proxy**

```bat
cd proxy
copy config.example.json config.json
npm start
```

It listens on port 7000. `config.json` lists the EDOPro servers players can reach. The
example has the official Project Ignis servers and a `local` entry for your own Multirole.

**2. Web client**

```bat
cd web
copy .env.example .env
npm install
npm run dev
```

Open http://localhost:3000. `npm install` also copies sql.js into `public/sqljs`.

**3. Card data and images**

By default the client downloads everything except images straight from ProjectIgnis on
GitHub (raw.githubusercontent.com allows cross-origin requests):

Everything is set in `web/.env`, copied from `web/.env.example` (it is not committed):

```ini
NEXT_PUBLIC_PROXY_URL=http://localhost:7000
NEXT_PUBLIC_CARD_IMAGE_URL=https://images.ygoprodeck.com/images/cards/{code}.jpg
NEXT_PUBLIC_CARD_BACK_URL=
NEXT_PUBLIC_DATABASES=github:ProjectIgnis/BabelCDB
NEXT_PUBLIC_STRINGS_URL=https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf
NEXT_PUBLIC_BANLISTS=github:ProjectIgnis/LFLists
NEXT_PUBLIC_BASE_PATH=
```

These are baked in at build time: restart `npm run dev` or rebuild after editing.

- `"github:owner/repo[/folder][@branch]"` loads every `.cdb` (or `.lflist.conf`) in that
  repo, the same set the official servers use. `cards.cdb` loads first; the rest override it,
  like EDOPro expansions. The file list comes from the GitHub API (60 anonymous requests per
  hour per IP). If that limit is hit, the client falls back to `cards.cdb` / `OCG` + `TCG`
  banlists only.
- You can mix in plain URLs, e.g. your own custom-card database after the ProjectIgnis one:
  `NEXT_PUBLIC_DATABASES=github:ProjectIgnis/BabelCDB,http://localhost:3001/cdb/custom.cdb`.
  Your own server must then send CORS headers for that file. For a Next.js server:

```js
async headers() {
  return [{ source: "/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
}
```

- Images: `{code}` in `NEXT_PUBLIC_CARD_IMAGE_URL` is replaced by the passcode. The default is
  YGOPRODeck (`https://images.ygoprodeck.com/images/cards/{code}.jpg`). YGOPRODeck asks
  apps to download images rather than hotlink them, and may block IPs that pull too many,
  so for a public deployment mirror the images on your own server and point this there.
  Cards YGOPRODeck doesn't have (anime, prerelease, custom) show as a name tile.

## Deploying

- **Web on GitHub Pages**: `.github/workflows/pages.yml` builds `web/` and publishes it on
  every push to `main`/`master` that touches `web/` (or by hand from the Actions tab).
  One-time setup in the repo:
  1. Settings → Pages → Source: **GitHub Actions**.
  2. Settings → Secrets and variables → Actions → **Variables** → add `PROXY_URL`
     (your proxy's `https://` URL). `CARD_IMAGE_URL`, `CARD_BACK_URL`, `DATABASES`,
     `STRINGS_URL` and `BANLISTS` can be overridden the same way; unset ones use the built-in defaults (the values in `web/.env.example`).
  3. Add `https://<owner>.github.io` to the proxy's `allowedOrigins`.

  The sub-path (`/<repo>`) is detected automatically, so no base path setup is needed.

- **Web elsewhere**: `npm run build` writes a static site to `web/out/`. Host it anywhere
  (nginx, S3...). For a sub-path, build with `NEXT_PUBLIC_BASE_PATH=/sub-path`. URLs from
  `.env` are baked in at build time, so rebuild after changing them.
- **Proxy**: `node src/server.mjs config.json` on any host with Node 22.13+ (`npm start`). Put it behind
  TLS (nginx/Caddy) and use `https://` in `NEXT_PUBLIC_PROXY_URL` when the site is served over HTTPS:
  browsers block `ws://` from `https://` pages. Set `allowedOrigins` to your site's origin.
  Set `trustProxy: true` if it sits behind a reverse proxy, so the per-IP limit uses the
  real client IP.

## Accounts and cloud decks

Players can create an account and keep up to 10 decks on the server, to load them on any
device (Decks tab → **Cloud decks**). Decks stored in the browser keep working without an
account. The API is part of the proxy (`proxy/src/accounts.mjs`) and is on when the proxy
config has `"accounts": { "dbPath": "data/accounts.db" }`.

- **Storage**: one SQLite file (Node's built-in `node:sqlite`, no extra packages) with
  tables `users`, `sessions` and `decks`. Schema migrations run on startup
  (`proxy/src/db.mjs`). The database is a file on the server, never reachable from the
  network. Decks keep the `.ydk` exactly as uploaded (max 100 KiB each).
- **Accounts**: a unique username (3–19 characters: letters, digits, `_ . -`, compared
  case-insensitively) and a password (8–128 characters), hashed with scrypt. There is no
  email, so **a forgotten password can't be recovered**; the sign-up form says so. Players
  can delete their own account (with their password).
- **Sessions**: a random token sent as `Authorization: Bearer …` (the site and the API are
  on different domains, where browsers block cookies). The database only stores a SHA-256 of
  each token. Sessions expire 30 days after their last use; at most 20 per user (the least
  recently used are dropped); signing out deletes the session.
- **Limits** (429 with `Retry-After` when exceeded), counted in memory by the proxy:

  | What | Limit |
  |---|---|
  | Any request, signed in | 120 / minute per user |
  | Any request, not signed in | 60 / minute per IP |
  | Listing decks | 30 / minute per user |
  | Saving, updating, deleting decks | 10 / minute per user |
  | Login attempts | 5 / 15 minutes per IP |
  | Failed logins to one account | 10 / 15 minutes per username (from any IP) |
  | Password checks when deleting the account | 5 / 15 minutes per user |
  | New accounts | 5 / hour per IP |

  "Per IP" counts an IPv6 client's whole /64 as one address. The per-username limit means
  someone guessing a password can make that account wait up to 15 minutes to sign in;
  existing sessions keep working. At most 4 password hashes are computed at once; beyond
  that the API answers 503 ("busy, try again"), so a login flood can't starve the duels.

  Other protections: request size caps (4 KiB for sign-in, ~200 KiB for decks; 413), a
  30-second request timeout, input validation, parameterised SQL only, the same response
  time and error for unknown users and wrong passwords, another user's deck answers like a
  missing one, and the 10-deck limit is enforced inside a write transaction plus a
  database trigger, so parallel requests can't exceed it. Malformed requests get 400 and
  never stop the service.
- **Inactive accounts**: every sign-in and signed-in request counts as activity. **Accounts
  with no activity for 90 days are deleted automatically, with their decks and sessions.**
  `npm run maintenance` (`proxy/src/maintenance.mjs`) does that, deletes expired sessions
  and writes a backup copy of the database to `backups/` next to it, keeping the newest 7.
  On the Oracle server a systemd timer runs it daily (see `infra/oracle`). **Backups are
  daily copies kept for 7 days, so a deleted account (by its owner or by the 90-day
  cleanup) can remain in a backup for up to 7 more days**, after which the last copy
  holding it is removed.

API (JSON; all paths need a session except register and login):

```
POST   /api/auth/register  {username, password}  -> 201 {token, user}
POST   /api/auth/login     {username, password}  -> 200 {token, user}
POST   /api/auth/logout                          -> 204
GET    /api/auth/me                              -> 200 {user}
DELETE /api/auth/account   {password}            -> 204   (deletes the account and its decks)
GET    /api/decks                                -> 200 {decks: [{id, name, ydk, createdAt, updatedAt}], limit}
POST   /api/decks          {name, ydk}           -> 201 {deck}   (409 at 10 decks)
PUT    /api/decks/:id      {name, ydk}           -> 200 {deck}
DELETE /api/decks/:id                            -> 204
```

## Things to know

- **Per-IP limits on the server side.** Multirole limits connections per IP
  (`lobbyMaxConnections`, 4 in its example config) and remembers kicks by IP. Every browser
  player reaches the server from the proxy's IP, so with many players on one proxy you can
  hit that limit. Also, a kick from one room blocks everyone using that proxy from that
  room. On your own Multirole, set `"lobbyMaxConnections": -1`. Ask the server operators
  before pointing a public deployment at the official servers.
- **Version.** The client reports `clientVersion`. If the server answers with a version
  error that includes its version, the client switches to that version, reconnects once,
  and remembers it.
- **Scope.** Online only: room list, host, join, spectate, Single/Match (with side
  decking), rematch, chat. No AI, LAN, replays or deck editor. Decks come from `.ydk`
  files or `ydke://` links and are kept in the browser's local storage, and optionally
  in the cloud (see above).

## Project layout

```
proxy/src/server.mjs        HTTP + WebSocket server, room-list relay
proxy/src/websocket.mjs     minimal RFC 6455 implementation (binary frames)
proxy/src/accounts.mjs      accounts and cloud decks API
proxy/src/db.mjs            SQLite database and schema migrations
proxy/src/ratelimit.mjs     rate limits
proxy/src/maintenance.mjs   daily cleanup of inactive accounts + database backup
proxy/test/                 node --test suite (npm test)

web/src/lib/protocol/       EDOPro packets, HostInfo, game messages, queries, responses, banlists, .ydk
web/src/lib/ocg/            message parsers vendored from ocgcore-wasm (MIT), see its README
web/src/lib/game/client.ts  connection + room state machine
web/src/lib/game/duel.ts    board model rebuilt from game messages
web/src/lib/game/actions.ts board prompts → per-card actions and selectable zones
web/src/lib/data/           runtime config, card DB (sql.js), strings, deck storage
web/src/components/         UI (lobby, room, duel board, prompt dialogs, deck manager)
```

## How it was tested

- The proxy has a `node --test` suite (`npm test`): WebSocket framing including
  64 KiB+ frames, room list relay with CORS, per-IP limits, unknown servers, and malformed
  URLs that must not crash the service; and for
  accounts: registration, login, logout, session expiry and limits, input validation,
  deck create/update/delete with the `.ydk` kept byte for byte, the 100 KiB and 10-deck
  limits (also with 15 parallel saves), access to another user's decks, every rate limit
  (including per-username and IPv6 /64 grouping), oversized bodies with and without
  `Content-Length`, the cap on concurrent password hashing, forged `X-Forwarded-For`
  headers, the 90-day cleanup and backups.
- The protocol, board model and action mapping were run headless against a test server
  using the **real ygopro-core and Project Ignis card scripts**, through this proxy. That
  test server re-implements Multirole's room flow, message filtering and query refreshes.
  Two clients played complete duels against each other, around 20 full games, with a bot
  answering every prompt type the decks produced. After every server refresh of hand,
  Monster and Spell/Trap zones, the client's board was compared with the server's data,
  and the two clients' views were compared at the end. There were no mismatches and no
  rejected answers.
- The Next.js/MUI screens have **not** been built or run yet: the sandbox they were written
  in had no npm access. Expect a few small fixes on the first `npm install && npm run dev`.

## License

EDOPro Web is licensed under the [GNU Affero General Public License v3.0](LICENSE), the same
license as the EDOPro duel engine (ygopro-core). If you run a modified version as a public
website, you must offer its source code to its users.

`web/src/lib/ocg/` is vendored from [ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) under
the MIT License (see its `LICENSE.md`).

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or sponsored by
Konami, the Project Ignis / EDOPro team, or YGOPRODeck. Yu-Gi-Oh! and all related names,
card text and artwork are trademarks and copyrights of Konami Digital Entertainment and
Kazuki Takahashi / Studio Dice. Card data and images are loaded at runtime from third-party
sources and are not part of this repository.
