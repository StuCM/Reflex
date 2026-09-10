# Backlog

Moved out of CLAUDE.md so it is not loaded into every agent's context.
The orchestrator reads this; workers do not need it.

Ordered so that the thing closest to the screen comes first: if playback is
wrong, nothing further out matters. Take one group at a time. Anything marked
**TV** cannot be answered on the laptop.

Section 0 is the exception to that ordering and outranks all of it: while the
refactor is open, nothing else is taken.

### 0. The refactor — and nothing else until it lands

**Feature freeze, decided 2026-09-10.** No new features are taken until this
section is empty. The layering merged at 0.0.2; what follows is the rest of the
same job. A feature added on top of a tree that is about to become modules is a
feature that has to be written twice.

Ordered. Each step is green before the next starts.

**The plan is `docs/refactor-plan.md`** — the stack, the layout, the style, the
configs and the migration order, all settled 2026-09-10. Read it before
starting any of the steps below; they are the summary, it is the spec.

- **Stage 1 — bundle with esbuild, keep the globals.** No source changes: the
  file list already exists as `index.html`'s script order. `esbuild
  --target=chrome53` is a *real* check where `tools/check-es5.js` is a text
  scan its own header calls "not proof", and it downlevels `async`/`await` and
  object rest, so the syntax bans in CLAUDE.md can go. Proven end to end on the
  B8: 30 files → one bundle, 92/92 smoke on the laptop, browse painting at 3.0s
  on the panel. Spike: branch `spike/bundle`.
  - Blocked on the key-baking bug below. Fix that first or the build ships with
    TMDB and YouTube dead.
  - `npm run check` keeps its CSS rules and its layer rules; its JS syntax
    rules and its `index.html` manifest check retire.
- **Stage 2 — real `.ts` and ES modules.** Only reachable with a bundler:
  Chromium 53 has no `<script type="module">` (Chrome 61), so `import`/`export`
  needs one. The script order becomes an import graph the compiler enforces,
  the layer rules become import lint, and the data-structure models become real
  types rather than JSDoc. Bigger than stage 1 — it rewrites `test/load.js`,
  which today runs raw files through `vm.runInContext` and cannot load a
  module. Spike of the JSDoc half: branch `spike/ts-typecheck`, 254 → 94
  errors, models in `types/plex.d.ts`.
- **Split the four screen files.** Deferred from the layering pass on purpose —
  they are long files of small functions and the layers had to settle first.
  See the entry under Housekeeping for what moves and what cannot.

### 0b. Bugs found deploying 0.0.2 to the panel

- **Push `main`.** Before 2026-09-10 it had 217 commits that had never left
  this laptop, so `origin/main` sat at `035773d` — which is exactly where the
  cloud session's PR #1 branched, and why it could never merge. Any session
  that is not this one branches from GitHub. If `main` is stale there, their
  work is born conflicted.

- **`tools/package.sh` bakes keys into the file that no longer ships.** It
  `sed`s `TMDB_KEY`/`YOUTUBE_KEY` into the *staged* `js/core/config.js`, then
  verifies the patch against that same file — so its guard passes while a
  bundled build compiled from the unbaked source ships with both keys empty.
  Confirmed on the TV: `Config.tmdbKey` was `false` on the bundled build and
  `true` on the normal one. **Blocks stage 1.** The fix is to build the bundle
  inside `package.sh`, after the bake, and to verify the artifact that actually
  ships rather than the one that was patched.
- **The All films line calls library parts "servers".**
  `js/screen/browse.js:522` reports `row.state.streams.length`, which is one
  stream per server × section × tag, as a server count. Two servers with
  several libraries each reads as "across 12 servers" on the panel. Cosmetic,
  one line, but it is the only number on that screen and it is wrong.

### 1. Playback itself

- **TV** Does an MKV direct play through the HTML5 video element on webOS 4 at
  all? The media pipeline handles MKV from USB; the element may still refuse
  the container. This is the single assumption everything rests on.
- **TV** Does the converted stream play? `Plex.transcodeUrl` hands the element
  an HLS playlist; webOS plays HLS natively, but that is untested here.
- **TV** Audio output to Auto, then `probe.py` on a file that currently
  transcodes: which declared capability flips it. The oldest open question.
- Mark watched. We report progress every 10s but never scrobble, so a film
  played to the end stays half-watched everywhere else.
- Report `stopped` when the app is backgrounded or the TV sleeps. A session
  left open on someone else's server is the rudest thing this app could do.
- Next episode: play the following one when this one ends, with a countdown
  that can be cancelled. The main reason a show is easier to watch in the
  official app.
- ~~Subtitles~~ — done, and `subtitles=none` stays on the decision call
  deliberately. Burning in is a transcode; the track is fetched as text from
  `/library/streams/<id>`, parsed by `js/rules/subs.js` and drawn over the video, so
  it costs the server one GET and no session. **TV**: none of it has met the
  panel, and `js/core/panel.js` will say on the first deploy whether the pipeline
  exposes `textTracks` at all — if it does, handing it a track is worth
  comparing against drawing them ourselves.

### 2. The player on screen

- **A theme on a real server may only be on `/library/metadata/<key>`.** Task
  022 found `theme` already present on the show entry the rail holds in the
  mock, so the show page makes no request at all — but whether a *real* Plex
  server puts it in a listing, rather than only on the full metadata payload,
  is unverified and the laptop cannot prove it. If it is absent there, no theme
  plays, which is the already-defined silent path; the fix is one `Meta.load`
  on the show page. Check this on the panel before concluding the feature is
  broken.

- **The Magic Remote's pointer.** The app is entirely d-pad driven and sets
  `cursor: none`. On an LG Magic Remote the pointer is the primary control for
  most people, and webOS raises ordinary mouse events for it plus a
  `cursorStateChange` event on `document` saying whether it is visible. Wanted:
  show the cursor while the pointer is active, hover to move the focus the
  d-pad would have moved, and click to do what OK would do. Best done centrally
  — one module translating pointer events into the focus and activate calls each
  screen already has, rather than handlers sprinkled through the rail, the
  menus, the sidebar and the player.

  **Settled 2026-09-08: the user does have colour buttons.** So the comments in
  `js/view/sidebar.js:7`, `js/screen/browse.js:123` and `js/data/servers.js:93` — all asserting
  the Magic Remote has none, and citing that as the reason the sidebar exists —
  are wrong as written and should be corrected once 018 releases those files.
  An earlier session recorded that the B8's bundled Magic Remote (AN-MR18BA) has
  none and that search was moved off red because red did not register, so the
  likeliest truth is that a second, standard remote is in use as well. Word the
  correction as "not every remote has colour buttons" rather than flipping the
  claim: **every action stays d-pad reachable**, which is what makes the app
  work from the Magic Remote, a standard remote and the pointer alike.

- **Correct the palette to `blurple-apricot`, the design's own named option.**
  `design/Mantis Screens.dc.html` carries seven palettes as data and the export
  defaults to `sage`, which is why the file appeared to disagree with the
  screenshots. The user's is **Blurple + apricot**: `bg #161826`,
  `tile #1f2233`, `ac #9d93d6`, `ac2 #e5a06d`, `scrim 9,10,17`. Sampling the
  screenshots got `bg`, `tile` and `ac2` exactly right; two things are wrong in
  the shipped app and both are one-line fixes once `css/app.css` is free:
  `--ac` is `#a79ce3` and should be `#9d93d6`, and the six hero-gradient
  literals fade to `rgba(22,24,38,…)` — the background itself — where the design
  fades to a *darker* `rgba(9,10,17,…)`, which is why the scrims read flat.

- **A design language, written down.** The user's point: radius, button sizes
  and spacing differ between the film page, the player and the rail because each
  was built to a screenshot rather than to a shared set of numbers. Wanted: one
  token block — radius, control sizes, spacing steps — in `css/app.css` beside
  the palette and the timings, used everywhere and documented in CLAUDE.md, so
  "the same radius" is one number rather than a habit. To be settled against
  `design/Mantis Screens.dc.html`, which the user is supplying.
- **The player does not match the design**: Play and the next/previous controls
  are different sizes when they should match, the option panels are not rounded
  enough, the buttons are too big, and the panels should not be translucent —
  the user does not want opacity there.
- **The player's keys are wrong.** Wanted: ▲ controls the **trackbar** (scrub),
  and a menu opens **only** on OK on its button. Today ▲ focuses the control row
  and a second press opens a panel. Needs the reachability of the buttons
  settling — probably ▼ — before it is specced.
- **Some subtitles fail with a 501.** The image-track guard is right
  (`Media.isTextSub` is checked in both `js/screen/player.js` and `js/screen/detail.js`), so
  this is a *text* track the server will not serve: `Plex.subtitleUrl` falls back
  to `/library/streams/<id>` when a stream has no `key`, which asks the server to
  extract an embedded track, and some answer 501. The app reports a generic
  "returned no text" and leaves the entry in the menu. At minimum it should say
  what happened with the status, mark that track unavailable, and log the codec
  and whether the stream had a `key`, so the real cause is learnable from the
  panel.

- ~~A scrub bar~~ — done: position, duration, buffered, a knob, chapter ticks
  and bands for the intro and end credits.
- ~~Subtitle and audio track pickers in one place~~ — done: one menu on the
  arrows with Audio, Subtitles, Quality and Chapters, and the colour buttons
  as shortcuts into it. Quality is versions plus bitrate caps, and every cap
  goes back through the guard, so a 4K cap is refused as the transcode it is.
- The OSD titles an episode by its own name only — it should say the show and
  the number, as everywhere else does.
- Next/previous episode while playing.
- **TV** The quality menu has never met a real transcode: a cap restarts
  playback against `Plex.transcodeUrl`, and whether the panel seeks inside a
  Plex HLS playlist is unknown.

### 3. The pages that lead into playback

- **Clear things out of Continue watching.** The list grows and never shrinks.
  Wanted: a coloured button on the browse screen that turns the Continue
  watching row into a multi-select, and the same action on a title's own page.
  **The mechanism needs deciding before this is specced.** "Mark watched" is the
  obvious answer and is wrong for shows: a series you are two seasons into is
  removed by marking all thirty watched, which destroys the fact that you have
  seen two. Plex has `PUT /actions/removeFromContinueWatching?ratingKey=` on
  newer servers, which hides the item without touching watch state — exactly the
  intent — so the task should use that where the server has it and fall back to
  `PUT /:/scrobble` only where it does not.

  Resolved while waiting on 013: **do not sniff the server version for this.**
  Discovery already has `productVersion` from plex.tv's `/api/v2/resources`,
  but a version number lies — forks, Plex Pass differences, and a fallback has
  to exist regardless. Try `removeFromContinueWatching` and fall back to
  `scrobble` on a 404. Capability detection by trying beats version sniffing,
  and it needs no probe script and no write to a server we do not own just to
  find out what it supports.

- **TMDB categories as the default rows, server hubs in the menu.** Today the
  browse screen shows the server's own hubs (Recently Added, Recently Released,
  Top Rated) and TMDB's curated rows live in a separate Discovery *mode*. The
  user wants that inverted: their own TMDB categories — trending, what is on
  Netflix / Prime / Disney+, recommendations — as the rows shown by default,
  with the server's hubs still reachable but demoted into the sidebar. Also
  wants a say in which TMDB categories exist rather than the four hardcoded in
  `js/api/tmdb.js`. Touches `js/screen/browse.js`, `js/data/discovery.js`, `js/view/sidebar.js`.

- **The film page's layout is wrong in five ways**, all seen on the panel:
  1. `#dt-body` and `#dt-extras` are `width: 1000px` on a 1920px screen — a
     leftover from when `#dt-art` occupied 1100px on the right. 008 and 014
     replaced that with a full-width header and nobody widened the body, so cast
     and extras have been squeezed into half the screen since.
  2. Spacing throughout is cramped.
  3. Extras should be a row you navigate **down** to with only its top showing —
     the same peek the rail uses and the user already approved there — rather
     than a strip inside the body.
  4. `.dt-act.primary` is 280×88 while every other button is 88×88: Play is too
     big and the rest too small.
  5. **No way to play from the start** when a film is part-watched. Play
     resumes; there is no second action.
  Best done against `design/Mantis Screens.dc.html` if the user can export it —
  screenshots carried the palette losslessly but carry no type scale and no
  spacing, which is exactly what is wrong here.

- **Rebuild the film and series pages to the design language the rail now
  uses** — portrait posters, the 264px header, ink & citron. The flow they have
  to serve is: search a title, land on its page, switch between servers and
  copies there. That flow already *works* — `Detail.addOtherVersions` asks every
  server `/library/all?guid=` on open, which is global across sections and so
  finds the 4K-library copy the row never knew about — but the page looks
  nothing like the rest of the app. Blocked behind 008 (which reshapes
  `js/screen/detail.js`) and 009 (`js/screen/showpage.js`, `css/app.css`).
- ~~Episode stills~~ — task 009. The show page is a wall of text; episodes
  carry a landscape `thumb` we never draw.
- Cast and crew on the show page, as the film page has.
- "Play next unwatched" at the top of a show, so a series you are part way
  through is one press, not two and a scroll.
- Watched state is drawn from `viewCount` and `viewOffset` but never updated
  after playback, so it is stale until the section is reloaded.
- Mark watched / unwatched by hand.
- Related items (`includeRelated=1`) and collections.

### 4. The rail

- **Two Continue watching rows, on a real server only.** `mergeHubs` in
  `js/screen/browse.js` passes through every hub `/hubs/sections/<key>` returns, and a
  real Plex server serves one called `Continue Watching` — so the app shows its
  own onDeck row *and* the server's hub. `dev/mock-plex.js` serves only Recently
  Added, Recently Released, Top Rated and Directors, so no test has ever been
  able to see it. Fix: drop hubs that duplicate what we build ourselves
  (`continue watching`, `on deck`, case-insensitively) **and** make the mock
  serve one so the step can fail.
- **Tiles show the previous item's poster while scrolling.** 015 deliberately
  keeps a swept-past tile's existing picture rather than blanking it, on the
  reasoning that a held poster beats an empty box. On a recycled tile that means
  showing the *wrong* film for 160ms and then swapping, which reads as the image
  jumping. A neutral placeholder on recycle, or a crossfade on the swap, is
  what was actually wanted.
- **The scrolled header should be laid out like the first screen**, not in two
  columns. The description is hard to read where it is, and the lower rows'
  layout is off. Replicate the tall hero's arrangement, and **add the ratings
  row** the detail page has.

- **The motion is jarring.** With one row fitting under the header, every press
  of down scrolls a whole 466px row, and the tall-to-dense change moves the
  header, the rail and the backdrop at once. `#rows` already eases over 340ms
  and `.strip` over 180ms, so the fix is consistency and timing, not adding
  transitions.
- **The hero backdrop hard-swaps.** `Masthead.paintArt` assigns
  `background-image` outright, so the picture cuts rather than fades. Two
  stacked layers alternating `opacity` gives a crossfade for the price of a
  composited layer, which is inside what the SoC allows — unlike a filter or a
  blur.
- **The browse screen needs redesigning** to the Mantis look, once the palette
  lands. It works; it does not match.

- **Jump to a letter.** 30,000 films is not d-pad-able, and this is the
  biggest single gap left in browsing.
- Filters beyond the kids cut: year, unwatched, resolution, genre — all
  server side, as the certificate filter already is.
- Sort: title, recently added, year.
- A top-level "recently added across both servers" row, above the sections.
- Search could filter and remember; it currently does neither.

### 5. Boot, cache and the servers

- A server added to the account after the cache was written is never found —
  discovery only rediscovers when every cached server fails.
- IndexedDB never evicts. Page entries from a since-changed section linger
  for ever; a cursor sweep is the fix.
- The metadata cache drops all 500 entries when it fills, rather than the
  oldest.
- The debug line is always on screen. It should be a setting, not a constant.

### 6. Only if browsing is still slow after all that

- A caching backend on the existing Hetzner box (Docker Compose + Caddy) that
  pre-sizes posters and serves a pre-baked section index. Deliberately last:
  the point is to find out whether it is needed, and the numbers so far say
  the cost is round trips, not the panel.

### Housekeeping

- ~~A flaky smoke step~~ — found and fixed by task 019, and it was **not** a
  timing margin as this entry guessed. `pressButton` counted keypresses against
  a row that grew a trailer button as the extras loaded, so the focus landed on
  Subtitles instead of Remove. Fixed in the harness by walking, re-reading and
  repeating; no assertion changed. **`menuChoose`, `sidebarWalkTo` and
  `focusDeck` count once the same way** and have the same latent race — worth
  the same treatment before one of them bites.

- **`css/app.css` is what serialises the crew loop.** Every UI task declares it,
  so no two can run at once even when they share nothing else. It is 944 lines
  covering the rail, the hero, the sidebar, the show page, the detail page, the
  player, the menus and the overlays. Splitting it per screen — with the tokens
  and the shared button rules in a `base.css` the others build on — would let
  two UI tasks run in parallel, which is worth more than the tidiness. Do it
  once rather than serialising three more UI tasks behind it. (`dev/smoke.js`,
  the other contended file, is task 019.)
- **The big `js/` files, in order:** `js/screen/player.js` 1,221 lines,
  `js/screen/browse.js` 886, `js/screen/detail.js` 727, `js/api/plex.js` 703.
  The layering pass moved every file into `js/core|api|data|rules|view|screen`
  and enforced the boundaries in `npm run check`, but it deliberately split no
  screen file: they are long files of small functions, and the layers had to
  settle first. Not blocked by Chromium 53 — the app has no bundler by choice,
  and a new file is one more global and one more `<script>` in `index.html`,
  which `npm run check` already enforces. `js/view/menu.js` was carved out of
  `js/screen/player.js` in 016 with no behaviour change and is the pattern to
  follow.

- **Each screen file still holds its own decisions next to its own DOM.** The
  four in `js/screen/` are the only place that is still true, and the split
  that would pay is per screen rather than per layer: the part of
  `js/screen/detail.js` that decides which copy and which track (`check`,
  `adoptDefault`, `defaultAudio`, `needsMux`) has no DOM in it and would move
  to `js/rules/` with a unit test, and the same shape exists in
  `js/screen/showpage.js`. `js/screen/player.js` is the exception: its audio
  decision needs the live `audioTracks` list off the video element, so it
  cannot be made pure and should stay where it is.

- `js/screen/browse.js` and `js/api/plex.js` are both past 700 lines and are
  the next split candidates — search, kids and the discovery rows would go
  cleanly.
- `js/data/guard.js` has no unit test. It is the most important logic in the app
  and is only covered end to end.

