---
id: 012
slug: recaps-rail
status: pending-tv
branch: crew/012-recaps-rail
model: sonnet
env: laptop
files:
  - js/config.js
  - js/youtube.js
  - js/showpage.js
  - js/app.js
  - index.html
  - css/app.css
  - tools/package.sh
  - dev/server.js
  - dev/mock-youtube.js
  - dev/smoke.js
  - test/youtube.test.js
---

# Season recaps on a show, but only when asked for

## Goal
Pressing down past the last episode of a show reaches a **Find recaps** action.
Pressing OK on it searches one YouTube channel — Man of Recaps — for that
show's season recaps and turns itself into a rail of them, each with its
thumbnail, title and length. OK on one plays it in an overlay without leaving
the app; if the panel cannot play it, the YouTube app is offered instead.

Nothing is fetched until that action is pressed. Ever.

## Why now
The user watches these recaps before picking a series back up, and does it on
another device today. The "only when asked" shape is theirs and it is the whole
reason this is cheap: YouTube's search costs 100 units of a 10,000/day quota,
so a rail that populated itself on every show page would burn the day's budget
in a hundred page views. A button spends nothing until it is wanted, and a
per-show cache means the second press is free.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching any of the eleven declared files. No worktrees are in
flight; 011 merged as `30b019f` and the board is 11/11 done.

Read these as they now are:

- `js/showpage.js` — episode rows are 106px with `EPISODE_POOL = 6`, so the
  list already reaches near the bottom of the screen. That is why the recaps
  strip needs room made by a transform rather than being placed below.
- `js/app.js` — `openShow(entry, at)` builds the options object handed to
  `ShowPage.open`; `onRecap` joins `onPlay` and `onChoose` there.
- `tools/package.sh` — the TMDB key block reads `TMDB_KEY` from the environment
  or `.env`, seds the staged `js/config.js`, and exits non-zero if the
  substitution did not match. Generalise it; do not copy it.
- `dev/server.js` — already injects `tmdbBase` and `tmdbImageBase` into
  `REFLEX_CONFIG` and routes `/__tmdb` and `/__tmdbimg`. The YouTube seams go
  in beside them, and `dev/mock-tmdb.js` is the model for the new mock.
- `dev/smoke.js` is at 52 steps.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **There is already a pattern for an external, key-gated service**: `js/tmdb.js`
  reads `Config.tmdbKey` and `Config.tmdbBase`, is inert when the key is empty,
  and talks through a plain `XMLHttpRequest` with a timeout. `js/youtube.js` is
  the same shape. Do not invent a different one, and do not add a dependency.
- **Nothing may hardcode a base URL** (CLAUDE.md): `js/config.js` owns them.
  This needs three settings, and they are how the mock stands in for YouTube.
- **The key is baked at package time, never committed.** `tools/package.sh`
  reads `TMDB_KEY` from the environment or a gitignored `.env` and writes it
  into the *staged* `js/config.js`, refusing to package if the substitution
  does not match. The repo is public; a second key must go through exactly that
  path. Generalise the existing block to cover both keys rather than copying it.
- **`dev/smoke.js` fails on any request that is not to `localhost:<PORT>`**
  (dev/smoke.js:171). That includes an iframe's `src`. So the mock has to serve
  both the API and a stand-in embed page, and the embed origin has to come from
  config like everything else.
- **The show page has two zones**, `seasons` and `episodes`, in `zone` in
  `js/showpage.js`. Seasons are chips at `top: 280px`; episodes are a list at
  `top: 340px`, six rows of 106px, so they already reach near the bottom of the
  screen. A third zone needs room made for it, not squeezed in.
- **Chromium 53 and a 2018 SoC.** Animate only `transform` and `opacity`. The
  room for the rail is made by translating the episode list, not by changing
  heights.
- **Never crawl a server we do not own** — and that now includes YouTube's, for
  which the day's quota is the hard limit rather than politeness.

## Constraints that bite here
- **No `async`/`await`, no object spread, no `Object.entries`, no CSS Grid, no
  `position: sticky`.** `npm run check` scans `js/` for these.
- **Inert without a key.** With `youtubeKey` empty the Find recaps action does
  not appear at all — not a button that fails when pressed. Everything else on
  the show page behaves exactly as it does now.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/config.js`** — three settings beside `tmdbKey`:
   - `youtubeKey: ''` — a free YouTube Data API v3 key. Empty means no recaps.
   - `youtubeBase: 'https://www.googleapis.com/youtube/v3'`
   - `youtubeEmbedBase: 'https://www.youtube.com/embed/'`
   Do **not** hardcode a channel id: see step 2.

2. **`js/youtube.js` (new)** — the client, same shape as `js/tmdb.js`:
   - `enabled()` → `!!Config.youtubeKey`.
   - `channelId()` → resolves the Man of Recaps channel **by handle**
     (`/channels?part=id&forHandle=@ManOfRecaps`) and caches the answer in
     `Store` for good. A guessed channel id in source would be wrong and
     unverifiable; a handle is what a human can check. If the handle resolves
     to nothing, recaps are simply unavailable — say so, do not guess.
   - `recaps(showTitle)` → `/search?part=snippet&channelId=<id>&q=<title>+recap&maxResults=25&type=video`,
     resolving to the raw items.
   - One request in flight at a time; a 403 (quota) resolves to an empty list
     with a `UI.debug` line rather than throwing.
   - `parse(items)` — **pure**, exported, unit tested. Turns the API payload
     into `[{ id, title, thumb, season }]`:
     - `season` is the season number read out of the title
       (`Season 3`, `S3`, `Series 3`), or `null` when there is none.
     - Drops anything with no `videoId` or no title. Never throws on a
       malformed or empty payload.
     - Orders by season ascending, `null` seasons last, otherwise preserving
       the order the API gave.
   - `pickForShow(parsed, showTitle)` — **pure**, exported, unit tested. Keeps
     only entries whose title plausibly names this show: normalise both (lower
     case, strip punctuation) and require the show's title to appear in the
     video's. This is the guard against the channel's other content coming back
     for a one-word show name, so it must be tested with a deliberately bad
     case.

3. **`js/showpage.js` — a third zone.** Add `'recaps'` to `zone`:
   - Down from the **last** episode enters it; up from it returns to the
     episodes. Left/right move along the rail. It does not exist at all when
     `!Youtube.enabled()`.
   - It starts as a single focusable item reading `Find recaps`. OK on it calls
     `Youtube.recaps` → `parse` → `pickForShow`, and replaces itself with the
     rail. While that is in flight the item reads `Searching…` and OK does
     nothing more — one search per press, not one per keypress.
   - Cache the result per show in `Store` under `recaps:<show identity>` so
     coming back costs nothing. Cache an empty result too, and say
     `No recaps found` rather than leaving the button looking untried.
   - OK on a rail item calls `opts.onRecap(video)`.

4. **`css/app.css` and `index.html` — room, and the overlay.**
   - A `#sh-recaps` strip below the episodes, landscape cards with the
     thumbnail, the title and the length, in the same visual language as the
     rail's tiles (28px radius, citron focus ring).
   - Entering the recaps zone translates `#sh-episodes` up by 240px and shows
     the strip; leaving reverses it. One transform each way, no height animates.
   - A `#recap` overlay, hidden by default: a full-bleed `<iframe>` plus a line
     saying BACK closes it.

5. **`js/app.js` — play it, or offer the app that can.**
   - `onRecap(video)` shows the overlay with
     `Config.youtubeEmbedBase + video.id + '?autoplay=1'`.
   - **The panel may simply refuse.** Chromium 53 is nine years old and
     YouTube's embed drops old browsers over time. So: if the iframe has not
     fired `load` within 8 seconds, or fires `error`, close the overlay and
     show a message offering the YouTube app, which is launched with
     `webOS.service.request('luna://com.webos.applicationManager', { method:
     'launch', parameters: { id: 'youtube.leanback.v4', params: { contentTarget:
     'v=' + video.id } } })`, guarded for `window.webOS` being absent on the
     laptop.
   - BACK closes the overlay and returns to the show page with the rail still
     focused.
   - Playback of a recap must **not** go anywhere near `Guard.check`,
     `Player.play` or the timeline reporting. It is not library content and
     must never open a session on anyone's Plex server.

6. **`tools/package.sh`** — generalise the existing key-baking block to handle
   `TMDB_KEY` **and** `YOUTUBE_KEY`, keeping its two properties: the repo's
   `js/config.js` stays empty, and it refuses to package when a key is set but
   its placeholder is not found. One loop over a list of
   `<env var> → <config field>` pairs, not a second copy of the block.

7. **`dev/mock-youtube.js` (new) and `dev/server.js`** — stand in for YouTube so
   the suite stays offline:
   - Inject `youtubeKey`, `youtubeBase: '/__yt'` and
     `youtubeEmbedBase: '/__ytembed/'` into `REFLEX_CONFIG`, alongside the TMDB
     ones already there.
   - `/__yt/channels` answers the handle lookup; `/__yt/search` answers with
     deterministic items derived from the query — several correctly-titled
     season recaps for a known show, **one item belonging to a different show**
     so `pickForShow` has something to reject, and one with no parseable season.
   - A show that yields **no** results, so the empty path is exercised.
   - `/__ytembed/<id>` serves a tiny page that loads, so the happy path is
     testable; and one id that never responds, so the 8-second fallback is too.

8. **`dev/smoke.js`** — with recaps enabled in the harness:
   - The show page has no recaps zone when the key is empty.
   - Down from the last episode reaches `Find recaps`, and **no YouTube request
     has been made** at that point — assert the request count, not the absence
     of a rail.
   - OK searches once and draws the rail, seasons in order, with the
     wrong-show item absent.
   - Returning to the same show makes no second search.
   - OK on a recap opens the overlay with the embed URL; BACK closes it and the
     rail is still focused.
   - The id that never loads falls back to the offer rather than hanging.
   - A show with no recaps says so instead of leaving the button untried.

9. **`test/youtube.test.js` (new)** — `parse` and `pickForShow` as pure
   functions: season numbers out of `Season 3`, `S3`, `Series 3` and none;
   ordering with nulls last; malformed and empty payloads returning `[]` rather
   than throwing; and `pickForShow` rejecting a video for a different show while
   keeping the right ones, including a one-word show title.

## Out of scope
- **The Claude Design redesign** of the detail page, the player or the palette.
  Separate tasks, blocked on the design import — do not restyle anything here
  beyond the new elements, and keep them in the current ink-and-citron palette
  so they do not have to be undone.
- **Recaps for films**, or any other channel. One channel, shows only.
- **Downloading, caching or re-hosting video.** Links only.
- **`js/player.js`, `js/guard.js`, `js/plex.js`.** A recap is not library
  content and must not touch the playback path or open a Plex session.
- **A settings screen for the channel.** The handle is a constant in
  `js/youtube.js` until there is a reason for it not to be.
- **Search quota accounting or a usage display.** The button is the budget.

## Definition of done
- [x] With no `youtubeKey`, the show page is exactly as it is today — no zone,
      no button, no requests.
- [x] With a key, down from the last episode reaches `Find recaps`, and nothing
      has been requested from YouTube until OK is pressed on it.
- [x] OK searches once, and draws a rail of that show's season recaps in season
      order with thumbnails, titles and lengths.
- [x] A video from a different show is rejected by `pickForShow`.
- [x] A show with no recaps says so rather than looking untried.
- [x] Coming back to a show already searched makes no second request.
- [x] OK on a recap plays it in an overlay without leaving the app; BACK closes
      it and the rail is still focused.
- [x] An embed that does not load within 8 seconds offers the YouTube app
      instead of hanging.
- [x] No recap playback path touches `Guard`, `Player` or Plex timeline
      reporting.
- [x] `parse` and `pickForShow` are pure and covered by `test/youtube.test.js`.
- [x] `npm run verify` passes, including "nothing left this machine".
- [x] `tools/package.sh` bakes both keys and still refuses on a missed
      substitution.
- [x] no file outside `files:` is touched
- [x] commits follow the convention (the hook enforces it)

## Review rounds

**Round 1 — PASS.** Reviewer re-ran `npm run verify` itself (check clean, 9/9 test
files, smoke 59/59), traced every DoD item to code and to a test that would fail
without it, and accepted both deviations below. No findings.

## What changed, per file

- `js/config.js` — `youtubeKey`, `youtubeBase`, `youtubeEmbedBase` beside the TMDB ones.
- `js/youtube.js` (new) — the client: `enabled`, `channelId` (by handle, cached in
  `Store` for good), `recaps`, and the pure `parse` / `pickForShow`. One request
  in flight at a time; a 403 answers with an empty list and a debug line.
- `js/showpage.js` — a third zone, `recaps`: down from the last episode reaches
  `Find recaps`, OK searches once and turns it into a rail, cached per show under
  `recaps:<Media.identity>`. Nothing is fetched to draw it.
- `js/app.js` — `onRecap` opens the `#recap` overlay, an 8-second load timeout or
  an `error` falls back to an offer of the YouTube app, BACK closes it. No Guard,
  no Player, no timeline.
- `index.html` — `#sh-recaps`, the `#recap` overlay, and `js/youtube.js` after
  `js/tmdb.js`.
- `css/app.css` — the strip, its cards, and the lift that makes room for it.
- `tools/package.sh` — one `bake <env var> <field> <what is lost>` function, called
  for `TMDB_KEY` and `YOUTUBE_KEY`; still refuses on a missed substitution.
- `dev/mock-youtube.js` (new) — channels, search, videos, thumbnails and a stand-in
  embed page, all off the query. One id never answers, so the fallback is testable.
- `dev/server.js` — routes `/__yt` and `/__ytembed`, injects the three settings.
- `dev/smoke.js` — 7 steps, 52 → 59.
- `test/youtube.test.js` (new) — `parse` and `pickForShow`.

## Where the spec was wrong

- **`parse` had no `length`, but the Goal and the DoD ask for one.** YouTube's
  search endpoint carries no duration at all, so `recaps` follows the search with
  `/videos?part=contentDetails` — one unit against the search's hundred — and
  `parse` reads it. A failure there keeps the items and drops the caption.
- **Lifting only `#sh-episodes` by 240px puts the episode rows over the show
  title.** `#sh-head` and `#sh-seasons` take the same lift, so the column moves as
  one page. Still transform-only.
- **The rail's tiles are 16px radius, not the 28px the spec's parenthetical
  claims** (`.tile-inner` says so, and says why). The cards match the tiles.
- `dev/smoke.js` was at 52 steps as the spec said, but the steps after these ones
  assume the rail is resting one row into the TV Shows section — searching for the
  two shows leaves it in Movies, so the last recaps step puts it back.

## Graph writes proposed

- **Pattern — an external service is a keyed client plus a mock behind a config
  base URL.** `js/tmdb.js` and `js/youtube.js` are now the same shape: the key
  from `js/config.js`, a plain `XMLHttpRequest`, inert without the key, baked in
  at package time by `tools/package.sh`, and stood in for by a `dev/mock-*.js`
  behind a `Config.*Base` the dev server overrides. A third service should copy
  this rather than invent anything.
- **Decision — the recaps search is spent on a keypress, never on a page.**
  YouTube search costs 100 units of 10,000 a day, so a rail that populated itself
  on every show page would burn the budget in a hundred page views. The Find
  recaps action is the budget, and the per-show `Store` cache makes the second
  press free.
- **Gotcha — Chromium 53's `Array.prototype.sort` is not stable** (V8 made it
  stable in Chrome 70). Anything that has to preserve an incoming order within a
  sort key must sort the *positions* and read the list back through them, as
  `Youtube.parse` does for videos of the same season.
- **Gotcha — a `Youtube.enabled` stub is how a keyless build is tested from the
  smoke suite.** The key is read once at load and the harness always sets one, so
  the only honest way to see a keyless show page without a second page load is to
  switch the gate off and reopen the page.
