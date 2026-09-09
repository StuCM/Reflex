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
  `js/api/youtube.js` is the pattern. Audited 2026-09-08: every other sort in `js/`
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
- Arrow functions (Chrome 45), and concise bodies. Nothing in `js/` uses
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
is unit tested. Widen it only alongside `PROFILE` in `js/api/plex.js`, and only
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
  everything else. `js/core/panel.js` builds that declaration by asking the panel
  with `canPlayType`, so widening is a matter of evidence rather than editing
  a string. Only `"probably"` is acted on: `"maybe"` is what a TV says when it
  has not been asked precisely enough, and acting on it is how you get a black
  screen. The `panel` chip shows what was asked and what came back.
- What the panel can *decode* and what survives *HDMI ARC* are different
  questions. `js/core/panel.js` answers the first, `js/rules/media.js` the second, and the
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

No bundler. Each file is one global, and `index.html` loads them in dependency
order — that script list *is* the dependency graph. `npm run check` fails if a
file in `js/` is missing from it, or is loaded from the wrong layer.

`js/` is layered, and the layering is enforced rather than suggested: the same
check fails on a request opened outside `js/api/`, on `Store` addressed outside
`js/data/`, and on the DOM, a request or the cache reached for from
`js/rules/`.

`js/core/` — what this build is, and what this device is.

- `js/core/config.js` — the few settings that differ between the TV and a
  laptop: plex.tv base URL, TMDB key, debug beacon. Nothing else may hardcode
  these.
- `js/core/panel.js` — what this panel claims it can play, and the client
  profile built from it.
- `js/core/ui.js` — which view is showing, toast, the debug line, keycodes.

`js/api/` — the only files that make a request.

- `js/api/http.js` — one XHR, for every client that talks to something. The
  three clients differ in the headers they send, the name an error uses, and
  whether a non-JSON body is an answer. Those are its options.
- `js/api/plex.js` — auth (PIN flow), server discovery, library paging, poster
  URLs, the decision call, timeline reporting. Every call takes a server.
- `js/api/tmdb.js` — TMDB client for the curated rows. Inert without a key.
- `js/api/youtube.js` — the recap channel, searched on a keypress and never on
  a page opening. Inert without a key.

`js/data/` — what we hold: fetched, merged, cached.

- `js/data/store.js` — IndexedDB cache. The rail paints from cache before any
  network call.
- `js/data/cache.js` — every key the cache holds and how long a hit lasts:
  kept until replaced, daily on a clock, or a hit kept while a miss is asked
  again. Nothing outside `js/data/` addresses `Store` directly.
- `js/data/servers.js` — the servers we can reach, which one an item came
  from, and which one is preferred.
- `js/data/merge.js` — one entry per film across servers: folding fetched
  lists, and the streaming merge behind the All row.
- `js/data/meta.js` — full metadata for a copy, debounced and cached per
  server.
- `js/data/art.js` — a title's picture and its facts from TMDB, queued, cached
  and published when they land.
- `js/data/shows.js` — seasons and episodes of a show, merged across servers.
- `js/data/discovery.js` — turns a TMDB list into rows of what the servers
  have.
- `js/data/devices.js` — whose viewing is this; filters Continue watching.
- `js/data/guard.js` — will this copy play, and at what cost to someone else's
  server. Everything that reaches Player goes through it first.

`js/rules/` — pure. No DOM, no request, no cache, which is what makes it the
half worth unit testing.

- `js/rules/media.js` — the rules, as pure functions: audio and subtitle track
  selection, the UHD guard, certificate ages, markers, chapters, quality caps,
  film identity. No network, no DOM. These are the parts that must not be
  wrong, so they are the parts that are unit tested.
- `js/rules/subs.js` — SRT and WebVTT in, cues out, and what should be on
  screen at time t. Pure, and unit tested. Subtitles are drawn over the video
  rather than burned into it, which is what makes them free — see the player,
  below.
- `js/rules/rows.js` — the row model. A 'list' row holds its items; a 'merge'
  row is virtual over the servers' own totals and walks them as you scroll.

`js/view/` — draws. Owns no state.

- `js/view/glyphs.js` — the action icons, as inline SVG. The film page and the
  player draw from the one set.
- `js/view/menu.js` — the menu shell both the detail page and the player draw
  with: tabs, rows, the winding transform, and an overlay that swallows every
  key. It knows nothing about playback or copies; a row carries a `value` and
  the caller decides what that means.
- `js/view/rail.js` — draws rows from a fixed pool: 4 row elements, 12 tiles
  each, whatever the library size. Owns no state.
- `js/view/masthead.js` — the backdrop, the title, and one line under it.
- `js/view/sidebar.js` — the section and category list, and select mode.

`js/screen/` — the state, and where each key goes.

- `js/screen/browse.js` — the state: sections, rows, focus, mode, paging,
  search.
- `js/screen/detail.js` — the page OK opens on a film or an episode: cast,
  ratings, extras, and an action row — Play, then Trailer, Quality, Source,
  Audio and Subtitles — where playback is actually chosen. Every choice goes
  back through `Guard.check` before it sticks, and Play's caption carries the
  verdict for the combination, so the cost is on screen before anything
  starts.
- `js/screen/showpage.js` — a show: its series across the top, its episodes
  down the side, each checked in place so OK means something.
- `js/screen/player.js` — playback and everything you can do during it: the
  trackbar with its chapter ticks and marker bands, seeking, skip intro, and —
  drawn with `js/view/menu.js`, the same shell the detail page uses — a menu
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
     no server involvement. `js/core/panel.js` reports on the `panel` chip
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

- `js/app.js` — boot, and where each key goes.

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

### Commits

Conventional commits, enforced by `.claude/crew/bin/commit-msg.js`:

    type(scope): summary

Lowercase, imperative, 72 characters at most, no full stop. Types are the
usual nine; scopes come from `js/` plus a short list in the config. A body is
optional and capped at four lines.

**No attribution footers.** No `Co-Authored-By`, no generated-by line. The
hook rejects them.

History before this convention is prose-imperative with long bodies. It stays
as it is; nothing is rewritten.

### Comments

One concise line on an exported function: what it does, and any non-obvious
why. Never restate the signature, and never narrate the reasoning that got
there — that goes in the memory graph and `docs/decisions.md`, where it can be
traversed and superseded. Source scattered with thinking is harder to read
than source with none.

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

- `npm run check` — scans `js/` and `css/` for anything newer than Chromium 53.
  Desktop Chrome will happily run code the TV cannot, and this is the only
  thing standing between that and a black screen. It is a text scan, not a
  parser: a clean run means nothing obviously wrong, not proof.
- `npm test` — the pure rules in `js/rules/media.js` and the row arithmetic.
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
attach cleanly.

Developer Mode expires after 1000 hours and removes sideloaded apps with it.
