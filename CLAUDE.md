# CLAUDE.md

Context for working on this project. Read before changing anything.

## What this is

A browse-fast Plex client for an **LG OLED B8 (2018, webOS 4.0)**. The stock
Plex app streams fine on this TV but browsing the library is slow and awkward.
This app exists to fix browsing, and must handle playback itself — bouncing
back to the official app to play something defeats the purpose.

## Hard constraints — do not violate these

**webOS 4.0 ships Chromium 53, permanently.** LG does not update Chromium
within a major webOS version. So there is a line, and it is worth knowing
which side of it things are on — this list used to say only what was banned,
and the code came out written in ES5 as a result, which nothing here asks for.

Not available, do not use:

- No `async`/`await` (Chrome 55). Use Promises with `.then()`.
- No object spread or rest (Chrome 60), no `Object.entries` (Chrome 54).
- No optional chaining or `??` (Chrome 80), no `padStart` (57), no `flat` (69),
  no `Promise.prototype.finally` (63).
- No CSS Grid (Chrome 57), no `position: sticky` (Chrome 56), no flexbox `gap`
  (Chrome 84).
- **`Array.prototype.sort` is not stable** (V8 got a stable sort in Chrome 70).
  Above ten elements equal items reorder arbitrarily. Where the original order
  matters, sort the *indices* and tie-break on position — `bySeason` in
  `src/api/youtube.ts` is the pattern. Audited 2026-09-08: every other sort in `src/`
  keys on something unique (season index, chapter start, cue start, server
  name) or is a small cosmetic ordering, so nothing else needs changing.
- Animate only `transform` and `opacity`. No shadow, filter, or blur
  transitions — they force layout and paint on a 2018 SoC.
- Build target `es2015` if a bundler is introduced. Prefer no bundler.

Available, and preferred — Chromium 53 is ES2015 apart from the above:

- `const` and `let` (Chrome 49). Not `var`: `npm run check` rejects it
  anywhere but column 0, where a module's own binding lives. That one has to
  be `var`, because only `var` puts a property on the global object for
  `index.html`'s next script tag and for `test/load.js`.
- Arrow functions (Chrome 45), and concise bodies. Nothing in `src/` uses
  `this` or `arguments`, so there is no binding to preserve.
- Template literals (Chrome 41). Prefer them to `+` chains once there is more
  than one thing being joined.
- Destructuring, default and rest *parameters*, shorthand and computed keys
  (Chrome 49), `for...of`, `Map` and `Set` (Chrome 38).

`tools/check-es5.js` is the arbiter, not this list. It is a text scan, so it
proves nothing — but if it and this file disagree, fix both.

**Never send `X-Plex-Platform: webOS`.** Measured against both servers on
2026-08-13: `/video/:/transcode/universal/decision` answers `400 Bad Request`
(an HTML page, not a Plex error) for a platform of `webOS`, `WebOS`, `LG`,
`Linux`, or absent — and returns a decision for `Chrome`, `Safari`, `Android`,
`Roku`, `tvOS`. No query parameter affects it; all of them were bisected first.
The app says `Chrome` with platform version `53.0`, which is honest — it is
Chromium 53 under WAM — while product, device, model and device name still say
Reflex on a B8, so the admin's dashboard shows what it really is.

Consequence: the server may now apply its Chrome profile and offer direct play
of something Chrome decodes and this panel does not. `Media.canDecode` refuses
anything outside H.264/HEVC in MKV/MP4/MPEG-TS before the decision call, and it
is unit tested. Widen it only alongside `PROFILE` in `src/api/plex/`, and only
after `probe.py` says the panel really manages it.

With that fixed, 4K HEVC direct plays on these servers.

**The user does not own the Plex servers.** He is a shared user on someone
else's two remote servers, connecting directly (not via relay).

- The server's rule is **no transcoding of 4K**, and only 4K. Enforcement
  appears to be Tautulli-style kill-stream, which fires *after* a session
  starts.
- Therefore: always call `/video/:/transcode/universal/decision` with
  `hasMDE=1` before playback. It returns the verdict without opening a
  session. Refuse 4K playback if the decision is anything but `directplay`.
- **Below 4K, a transcode is allowed.** Prefer direct play, but do not insist
  on it: the server is perfectly able to refuse work it does not want, and
  insisting is what made every TrueHD remux unplayable. `Media.allows` is the
  whole rule, and it is unit tested. A converted stream is fetched as HLS from
  `Plex.transcodeUrl`, which *does* open a session.
- Never widen the direct play profile to "make something work" without
  confirming the panel can actually decode it. Claiming a codec it can't
  gives a black screen; omitting one it can pushes needless load onto
  someone else's hardware.
- Codec support is the panel's, but **Plex cannot see the panel** — it obeys
  what the client declares in `X-Plex-Client-Profile-Extra` and transcodes
  everything else. `src/core/panel.ts` builds that declaration by asking the panel
  with `canPlayType`, so widening is a matter of evidence rather than editing
  a string. Only `"probably"` is acted on: `"maybe"` is what a TV says when it
  has not been asked precisely enough, and acting on it is how you get a black
  screen. The `panel` chip shows what was asked and what came back.
- What the panel can *decode* and what survives *HDMI ARC* are different
  questions. `src/core/panel.ts` answers the first, `src/rules/` the second, and the
  audio rules below are not affected by any of this.
- Sync library data incrementally and infrequently. Do not full-crawl a
  server we don't own.

**Films and shows both.** A show is not playable; an episode is. Everything
the guard cares about therefore lives on the episode, and the show and season
exist to be browsed through — one level at a time, never `/allLeaves` on a
library we do not own. Episodes are matched across servers by the show's
identity plus season and episode number, because episodes rarely carry ids of
their own and "Pilot" is not a unique title.

**There are two servers, and they share much of the same library.** Plex syncs
watch state between them at the account level, by matching the item's global
ids — so the same film picked up on one resumes in the right place on the
other.

- The app shows **one entry per film**, never one per server. Identity is
  `Media.identities`: any external id in common (imdb, tmdb, tvdb, the plex://
  guid), falling back to normalised title and year.
- Which copy an entry is *shown* as follows the preferred server
  (`Servers.preferred`, the `prefer:` chip). A film the preferred server does
  not have simply appears as whoever does have it — the preference is a
  preference, not a filter.
- Every copy is kept on the entry as `_sources`, and the detail page lists them
  all. This matters because the copies differ: the same film is often a 4K
  TrueHD remux on one server and a 1080p E-AC3 file on the other, and only one
  of those will direct play.
- A copy can itself hold several versions — `Media[]` on one item — so a source
  is *server × version*, and each is decided separately.
- Every request is made against a named server. There is no "current server",
  and nothing may assume one. Items are stamped with `_server` so posters,
  decisions, playback and progress all go back to the right place.

## Audio: the live problem

Audio is over **HDMI ARC (not eARC)** on a 2018 set. The official Plex app
currently transcodes audio, and the output was set to **PCM** — which makes
the TV declare 2-channel only, forcing a downmix of every 5.1 track.

First fix to verify: switch the TV to **Auto** (pass-through).

ARC ceiling regardless of settings:

- AC3 / E-AC3 5.1 — passes fine.
- DTS — depends on both the B8 and the ARC device; LG dropped DTS on many
  sets of this generation.
- TrueHD / DTS-HD MA — **cannot** pass over plain ARC, ever. Always needs an
  audio transcode.

Consequence: a 4K remux with only a TrueHD track is unplayable — video direct
plays, audio transcodes, session counts as a transcode, server kills it.

Audio track choice therefore has two tiers: the best track that passes over ARC
as-is (`Media.pickAudio`), and failing that the film's own track
(`Media.bestAudio`) with the server re-encoding it. Never a commentary in
either.

**A commentary track is not the film.** It is an ordinary AC3 or AAC track by
codec and channel count, so nothing in the ranking excludes it by accident — and
on a remux whose main track is TrueHD it is the *only* passable track left, so
it wins and two hours of someone talking over the film is what you get.
`Media.isCommentary` matches the word in the stream title (Plex does not flag
it), and such a track can never be selected. If it is the only passable one, the
file is refused and the message lists what was actually on offer.

**So audio track selection is required, not optional.** Prefer, in order:
E-AC3 → AC3 → AAC stereo. Never select TrueHD or DTS-HD MA. Pass the chosen
track as `audioStreamID` on the decision call, and surface the selected track
where the copy is chosen — the detail page, whose Audio button names the track
and says what choosing it costs before OK is pressed. It used to be badged in
the masthead as well; that came out, because working it out means a metadata
fetch for every tile you rest on, against a server we do not own, to answer a
question you cannot act on until OK.

## Layout

One entry, one bundle. `index.html` loads `src/main.ts` and nothing else, and
the import graph *is* the dependency order — a file nothing imports is not in
the bundle, which is a better manifest check than the list this used to be.
Vite rewrites the module tag to a classic deferred script, because Chromium 53
has no module scripts (Chrome 61).

`src/` is layered, and the layering is enforced rather than suggested:
`npm run check` fails on a request opened outside `src/api/`, on IndexedDB
addressed outside `src/data/`, and on the DOM, a request or the cache reached
for from `src/rules/`. It is still a regex scan — it catches what a file
reaches *for*, not what it imports — and becomes `no-restricted-imports` in
step 7.

`src/core/` — what this build is, and what this device is.

- `src/core/config.ts` — the few settings that differ between the TV and a
  laptop: plex.tv base URL, TMDB key, debug beacon. Nothing else may hardcode
  these.
- `src/core/panel.ts` — what this panel claims it can play, and the client
  profile built from it.
- `src/core/ui.ts` — which view is showing, toast, the debug line, keycodes.

`src/api/` — the only files that make a request.

- `src/api/http.ts` — one XHR, for every client that talks to something. The
  three clients differ in the headers they send, the name an error uses, and
  whether a non-JSON body is an answer. Those are its options.
- `src/api/plex.ts` — auth (PIN flow), server discovery, library paging, poster
  URLs, the decision call, timeline reporting. Every call takes a server.
- `src/api/tmdb.ts` — TMDB client for the curated rows. Inert without a key.
- `src/api/youtube.ts` — the recap channel, searched on a keypress and never on
  a page opening. Inert without a key.

`src/data/` — what we hold: fetched, merged, cached.

- `src/data/store.ts` — IndexedDB cache. The rail paints from cache before any
  network call.
- `src/data/cache.ts` — every key the cache holds and how long a hit lasts:
  kept until replaced, daily on a clock, or a hit kept while a miss is asked
  again. Nothing outside `src/data/` addresses `Store` directly.
- `src/data/servers.ts` — the servers we can reach, which one an item came
  from, and which one is preferred.
- `src/data/merge.ts` — one entry per film across servers: folding fetched
  lists, and the streaming merge behind the All row.
- `src/data/meta.ts` — full metadata for a copy, debounced and cached per
  server.
- `src/data/art.ts` — a title's picture and its facts from TMDB, queued, cached
  and published when they land.
- `src/data/shows.ts` — seasons and episodes of a show, merged across servers.
- `src/data/discovery.ts` — turns a TMDB list into rows of what the servers
  have.
- `src/data/devices.ts` — whose viewing is this; filters Continue watching.
- `src/data/guard.ts` — will this copy play, and at what cost to someone else's
  server. Everything that reaches Player goes through it first.

`src/rules/` — pure. No DOM, no request, no cache, which is what makes it the
half worth unit testing.

- `src/rules/media.ts` — the rules, as pure functions: audio and subtitle track
  selection, the UHD guard, certificate ages, markers, chapters, quality caps,
  film identity. No network, no DOM. These are the parts that must not be
  wrong, so they are the parts that are unit tested.
- `src/rules/subs.ts` — SRT and WebVTT in, cues out, and what should be on
  screen at time t. Pure, and unit tested. Subtitles are drawn over the video
  rather than burned into it, which is what makes them free — see the player,
  below.
- `src/rules/rows.ts` — the row model. A 'list' row holds its items; a 'merge'
  row is virtual over the servers' own totals and walks them as you scroll.

`src/view/` — draws. Owns no state.

- `src/view/glyphs.ts` — the action icons, as inline SVG. The film page and the
  player draw from the one set.
- `src/view/menu.ts` — the menu shell both the detail page and the player draw
  with: tabs, rows, the winding transform, and an overlay that swallows every
  key. It knows nothing about playback or copies; a row carries a `value` and
  the caller decides what that means.
- `src/view/rail.ts` — draws rows from a fixed pool: 4 row elements, 12 tiles
  each, whatever the library size. Owns no state.
- `src/view/masthead.ts` — the backdrop, the title, and one line under it.
- `src/view/sidebar.ts` — the section and category list, and select mode.

`src/screen/` — the state, and where each key goes.

- `src/screen/browse.ts` — the state: sections, rows, focus, mode, paging,
  search.
- `src/screen/detail.ts` — the page OK opens on a film or an episode: cast,
  ratings, extras, and an action row — Play, then Trailer, Quality, Source,
  Audio and Subtitles — where playback is actually chosen. Every choice goes
  back through `Guard.check` before it sticks, and Play's caption carries the
  verdict for the combination, so the cost is on screen before anything
  starts.
- `src/screen/showpage.ts` — a show: its series across the top, its episodes
  down the side, each checked in place so OK means something.
- `src/screen/player.ts` — playback and everything you can do during it: the
  trackbar with its chapter ticks and marker bands, seeking, skip intro, and —
  drawn with `src/view/menu.ts`, the same shell the detail page uses — a menu
  of audio tracks, subtitle languages, quality and chapters. What the tabs
  hold and what choosing does live here; the drawing and the d-pad do not.
  Seeks accumulate: every `currentTime` assignment on a direct-played file is
  a real range request, so holding a key aims first and seeks once.

  **Choosing an audio track is not free, and the reason is worth knowing.** On
  a direct play the server hands over the original file *whole*, with every
  track still in it, and the panel plays whichever it likes — the first one.
  `audioStreamID` on the decision call is advice to the decision engine and
  changes not one byte of that file. So a "switch" that stays a direct play is
  silent: the OSD renames the track and you go on hearing the old one. Exactly
  two things actually work:

  1. The panel exposes `audioTracks` and we select on it — instant, no restart,
     no server involvement. `src/core/panel.ts` reports on the `panel` chip
     whether this pipeline has it.
  2. Failing that, give up direct play (`directPlay=0`) so the server muxes the
     stream itself. That is a real session, and on a 4K file the guard refuses
     it — which is the honest answer, not a bug.

  The menu says which of the two a row will cost before you press OK, and when
  neither applies the OSD stops claiming a track and says *panel's choice*
  instead. Another version and a quality cap are the same shape of move, and
  all of them go back through `Guard.check` first, so a quality cap on a 4K
  file is refused by the ordinary rule rather than a special case. A refused
  switch leaves the film playing and says why in a toast; it never stops
  playback to deliver a message.

  Keys while playing: ◀ ▶ nudge 30s · ▲ ▼ focus the control row, and from
  there the arrows walk it and OK opens a panel · RW/FF 5 min · 0–9 jump to
  that tenth · CH± next/previous chapter · red/green/yellow/blue focus and open
  a panel in one press · OK pauses, or takes the skip when one is offered ·
  BACK closes the panel, then the row, then dismisses a skip, then stops.

  The control row is a **mode**, and that is what keeps the rest of this list
  true: while it is unfocused every key above means what it says, and only once
  ▲ has put a focus on the row do the four arrows belong to it. The cost is that
  a panel is two presses rather than one, which is why the colour keys still do
  it in one.

- `src/app.ts` — boot, and where each key goes.

Tools:

- `dev/` — the laptop harness (see Testing). Never packaged.
- `tools/package.sh` — `npm run package`. Stages only what runs and builds the
  .ipk from that: `ares-package .` ignores `--exclude` here and would ship the
  git history and the harness to the TV.

  **The launcher caches the app icon.** Changing `icon.png` / `largeIcon.png`
  and reinstalling over the same app id leaves the old icon on the tile — the
  title updates, because `appinfo.json` is read fresh, while the icon is not.
  A power cycle of the TV rebuilds the cache. Uninstalling clears it too but
  wipes `localStorage`, taking the Plex token and the discovered servers with
  it, so the app comes back at the `plex.tv/link` screen.
- `probe.py` — runs the decision endpoint under several client profiles to
  find which declared capability flips transcode → direct play. Safe to run
  repeatedly; starts no sessions.

## The backlog

Lives in `docs/backlog.md`, ordered outward from the video. It is not here
because CLAUDE.md is loaded into every agent, and a worker implementing one
task pays for the whole backlog it will never read.

## How work gets done

Through the crew loop — see `.claude/crew/README.md`. Spec approved by the
user, then worker, then a deterministic gate, then review. Two rounds and a
human decides.

**Feature freeze, 2026-09-10.** No new features until section 0 of
`docs/backlog.md` is empty. The migration finished at 0.3.1: `js/` is gone and
`src/` is TypeScript modules throughout. What is left of step 7 is deleting the
bridge and turning the layer check into import lint. Bugs and the
refactor itself are the only work taken. If asked for a feature, say this and
point at section 0.

### Commits

Conventional commits, enforced by `.claude/crew/bin/commit-msg.js`:

    type(scope): summary

Lowercase, imperative, 72 characters at most, no full stop. Types are the
usual nine; scopes come from `src/` plus a short list in the config. A body is
optional and capped at four lines.

**No attribution footers.** No `Co-Authored-By`, no generated-by line. The
hook rejects them.

History before this convention is prose-imperative with long bodies. It stays
as it is; nothing is rewritten.

### Comments

**The test: would a competent reader delete or simplify this, and be wrong?**
If yes, write the comment. If no, delete it. That is answerable, unlike "is
this useful", and it is the only reason a comment survives review.

Everything else belongs elsewhere and is already there: what a parameter is,
say it in the type; why a decision was taken, `docs/decisions.md` and the
memory graph, where it can be superseded rather than left to rot beside the
code. A file carrying its own design history has two copies of it, and they
drift.

One line on an export. Never restate the signature. Audited 2026-09-10: the
tree was **22% comments** with blocks up to 20 lines, and `src/core/config.ts`
was 42%. The rule above was already written and nothing enforced it, so CI now
ratchets the density per file — see `docs/refactor-plan.md`.

The comments worth keeping look like `panelIndexOf` in the player: it explains
why two list lengths are compared before the panel's track order is trusted,
and without it that check reads as redundant and gets simplified away into a
silent wrong-track bug. That is the shape.

### Types

**If changing the type and changing the code that uses it would be one commit,
they belong in one file.** That splits three ways:

- `types/*.d.ts` — shapes we do not own. The Plex wire format is read by 19
  files and changes when Plex changes, not when we do. Ambient is right for it,
  and so is being generous: everything optional that a real server has ever
  omitted.
- `export interface` in the module that owns it — `MenuTab`, `PlayOptions`,
  `RailTileElement`. These *are* the module's API, and separating them lets the
  two drift.
- A plain `interface` at the top of the file — `Copy`, `Source`, `Action` in
  `screen/detail.ts`. Private, and putting them in `types/` would advertise a
  shared vocabulary that does not exist.

The reason is not tidiness. **An ambient `.d.ts` is invisible to the import
graph**, so `import/no-cycle`, the layer rules, and "what does this file depend
on" cannot see it — and turning the script order into a graph the compiler
enforces is the whole point of the migration. `types/legacy.d.ts` is ambient by
necessity and dies with the bridge.

### The DOM

**Build nodes; do not spell them.** `innerHTML` with a value interpolated into
it cannot escape, re-parses the whole subtree, and throws away every node
underneath — which on a recycled tile pool is the expensive half of drawing.
`createElement` and `textContent` instead.

**A style belongs in the stylesheet.** `element.style.opacity = …` is a design
decision that has escaped `css/`, where nobody looking at the design will find
it. Toggle a class.

The exception is a value genuinely computed per frame — a strip's scroll
offset, a progress width. Those cannot live in CSS as constants, but they can
live there as *variables*: set `element.style.setProperty('--offset', …)` and
let the stylesheet do `transform: translateX(var(--offset))`. The number comes
from JavaScript; the design stays in CSS.

`eslint.config.mjs` enforces both over `src/`. As of 0.3.1 there is no
`innerHTML` and no inline style write left in the tree.

**`replaceChildren` is Chrome 86 and `append` is Chrome 54.** Both read as
ordinary DOM and neither is caught by anything: `tsconfig`'s `lib: ES2015`
governs ES built-ins, and TypeScript's `DOM` lib is one unversioned blob that
types every modern API as available. `src/view/dom.ts` holds `fill` and `put`
over `appendChild`, and `no-restricted-properties` keeps the two out of the
rest of `src/`. Found 2026-09-10, after 34 uses had already landed across five
converted files.

## Testing

Work on the laptop first. Sideloading an .ipk to see a change is slow enough
that it stops you trying things.

```sh
npm run dev        # the app at localhost:8080, against a fake Plex server
npm run verify     # check + unit tests + headless smoke test
```

`npm run dev` serves the real app unmodified and stands in for both plex.tv and
a media server, generating a library on the fly (`--films 30000` for the real
thing, `--latency 140` to feel a distant server). Nothing leaves the machine —
the smoke test fails if a request does. Press `?` in the browser for the key
mapping.

The one thing it cannot generate is a video, so playback needs `npm run fixture`
first (or any playable file at `dev/fixtures/sample.mp4`). Until then, OK on a
film reaches the player's error path rather than playing.

The three checks, and what each is for:

- `npm run check` — the layer rules over `src/`: no request outside `api/`, no
  IndexedDB outside `data/`, nothing impure in `rules/`. The Chromium 53 syntax
  scan retired with the bundler; `build.target` lowers syntax, `lib: ES2015`
  catches the built-ins, stylelint reads browserslist for CSS, and eslint's
  `no-restricted-properties` covers the DOM methods none of those can see.
- `npm test` — the pure rules in `src/rules/` and the row arithmetic.
- `npm run smoke` — drives the whole app in headless Chromium: link, browse,
  paging, kids, discovery, search, devices, the detail page, all three playback
  verdicts, and the player itself — the menu, a subtitle language fetched and
  drawn, an audio switch that restarts and keeps the subtitle language, skip
  intro, and the trackbar. The mock serves **two** servers sharing a library,
  so the deduplication and the copy-picking are covered end to end. The player
  steps need a fixture and skip without one. Keep it green; add a step when you
  add a screen.

  `npm run smoke` runs every area; `npm run smoke -- <area>` runs one, which is
  what iterating wants — the areas are `link`, `browse`, `show`, `recaps`,
  `sections`, `discovery`, `search`, `devices`, `detail`, `player`, `deck`, and
  an unknown name lists them. The steps live in `dev/smoke/<area>.js`, one file
  per area, and `dev/smoke.js` is the harness they are given. The mock takes
  whatever port the OS hands out, so two suites can run at once.

  **An assertion that can pass on nothing is worse than no assertion**, and this
  suite has produced three in one day. Each was a check that something was
  *absent* or that indexed into markup: a lookup counter matching
  `/__tmdb/movie/<id>/images` after the endpoint moved, so it passed on zero
  lookups; a request bar set from an assumed cost of one per tile when it is
  two; `indexOf("0:00 /")` after the clock split into two elements, so it
  matched nothing and passed instantly. Assert on **positive content** — the
  rendered text, the actual count — and when a step exists to catch a specific
  bug, run it against `main` and watch it fail. If it does not fail there, it is
  not testing what you think. Splitting an element means re-reading every
  assertion that indexed into its text, not only the ones that go red.

  **And a step can be structurally unable to see the thing it tests.** Task 021
  went looking for a wrong picture on a tile *during* a sweep; a Playwright
  round trip is slower than the rail's 160ms settle, so every reading landed
  after the rail had stopped and the step passed on the broken code. Readings
  that must catch a transient state have to be taken **page-side** — in a
  listener registered after the app's own — and "what is on screen" derived from
  committed transforms, because a rect read mid-transition is the position the
  element is leaving. The row matters too: Continue watching is short enough
  that the strip stops winding, so a sweep there never recycles a tile.

  **A counting step needs a control.** Task 023's request counter matched
  nothing — `/library/all\?.*[?&]guid=` wants a separator the real
  `/library/all?guid=…` has not got — so "zero lookups" passed on an empty
  count. It was caught only because a sibling step asserted *exactly one* and
  failed at zero. Any step that counts should have a companion asserting a
  non-zero count on the same collector, or a deliberate run against an
  implementation that does the wrong thing.

**Never judge playback on the laptop.** A desktop browser decodes far less than
this panel: Firefox has no AC3/E-AC3 and no HEVC at all, Chrome has no
Matroska. A silent film or a decode error there is the browser, not the app —
and it looks exactly like the bugs that matter. Browsing, the guard, the audio
choice and the merge are all fair to test on the laptop; smoothness and sound
are not.

None of that says anything about how it feels on the panel, which is still the
question. When benchmarking on the TV, use the **second** pass through a
section. The first pays for server-side poster generation and the cold
IndexedDB write. If pass two isn't smooth, the bottleneck is network latency to
the remote server, not the panel.

`ares-inspect --device <tv> --app com.stu.plexlite` gives a real Network tab
and console on the TV. Use a Chromium build close to 53; newer DevTools won't
attach cleanly. Two things about it are worth knowing before you conclude
anything from what you see:

- **`ares-package` minifies what it packages, and there is no flag to stop
  it.** The rules shipped as 7.5KB of `function n(e)` from 22KB of named
  functions and comments even before the bundler. The panel has never run the source in this
  repo, so a stack trace names nothing, and a source map cannot survive the
  pipeline — whatever you hand `ares-package`, it re-minifies. This is also why
  bundling costs nothing in debuggability: it is already at the floor.
- **The inspector does not emit `Runtime.consoleAPICalled`.** It speaks the
  legacy `Console` domain, so a CDP client that only enables `Runtime` and
  `Log` sees an empty console on a perfectly healthy app. Enable
  `Console.enable` and read `Console.messageAdded`.

The TV is rooted, so Developer Mode and its 1000-hour expiry do not apply —
the ares device profile is `ose` against `root@<tv>:22`.
