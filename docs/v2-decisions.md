# v2: where the spec is overruled

`docs/v2-spec.md` is the design agent's handoff, kept as delivered. The agent
did not know this repository, so some of it is wrong for it. Where this file and
the spec disagree, this file wins. Decided by Stuart, 2026-11-16.

## Code

- **Keep the repository's way of working**, not the spec's §1 "ES5, no
  async/await, plain JS". The app stays TypeScript, bundled by Vite to
  `build.target: 'chrome53'`, with `async`/`await` preferred, as `CLAUDE.md`
  says. The spec's other Chrome 53 rules (no grid, no flex `gap`, no
  `backdrop-filter`, animate only `transform` and `opacity`) all stand.
- The crew loop, the layering in `eslint.config.mjs` and the smoke suite carry
  over unchanged.

## Servers

- **Two shared servers, not "one person's Plex server".** Everything about
  merging copies across servers stays: `Media.identities`, `_sources`, the
  preferred server, every request made against a named server.
- **The guard warns instead of refusing.** Today a 4K title that would not
  direct play is refused (`CLAUDE.md`, "The user does not own the Plex
  servers"). In v2 the decision is still asked first and its cost still shown,
  but the user can play anyway after a clear warning. It has blocked things
  Stuart wanted to watch too often. `CLAUDE.md` must be updated in the same
  change.
- **A Servers entry in the menu.** Not designed. It lists each server and,
  inside one, that server's own libraries and their categories, browsed the
  way Plex shows them. It is a way round when the curated pages fail, not a
  main route.

## Pages

- **Kids is the fourth page in the top menu**: Home, Movies, TV, Kids,
  Collections, Discover (spec §Kids). Its design (`designs/v2/Kids*.dc.html`)
  is approved by Stuart, 2026-11-16: "I'm happy with the kids page". Until it
  is built, the tile opens v1's Kids page (`loadKids`).
- **More** sits after Discover and opens today's sidebar (Search, Devices,
  Autoplay and the rest) until those find v2 homes. The per-server browser
  is its own later task.

- **The boards are exact** (Stuart, 2026-11-26: "The designs must match
  exactly, time was spent getting these correct"). Where a page differs on
  purpose, its task lists why.
- **The menu's tiles** are the board's with Home first and Servers last
  (Servers opens each server's own libraries), and **no Streaming tile**:
  "I don't think streaming is needed this is folded in with movies and tvs".
  More is gone; Settings and Servers open the sidebar until they have pages.
- **Movies and TV are our rows, from TMDB**, never the servers' hubs: the
  board's rows, then a row per service (Netflix, Prime Video, Apple TV+,
  Disney+), then genre rows. Continue watching lives on Home only; TV keeps
  Your next episodes.

## Type

- Space Grotesk and Inter are the starting point, not final. Stuart,
  2026-11-16: "Not 100% on the fonts across the rest of the app so this may
  change in the future." Every font is set through a token (`--font-title`,
  `--font-body`), never named in a rule, so a change is one line. Kids'
  Fredoka is separate and settled.

## Accounts and storage

- **TMDB sign-in is fine.** Watchlist and lists live on TMDB as the spec says,
  so the app writes to Stuart's TMDB account.
- **The background service on the rooted TV is fine** for the backup file
  (spec §6).

## Order

1. The handoff is committed to `feat/v2` (this commit).
2. `tools/motion-lab.html` runs on the TV first; its measured numbers decide
   the focus style, timings and `will-change` use (spec §7).
3. The spec's §10 device checks.
4. A map of v2 against the existing code, then tasks in groups: the shell,
   Home and Movies/TV, the detail pages, the player, Discover, Collections,
   profiles and Settings, Kids and Servers.
