# CLAUDE.md

Context for working on this project. Read before changing anything.

## What this is

A browse-fast Plex client for an **LG OLED B8 (2018, webOS 4.0)**. The stock
Plex app streams fine on this TV but browsing the library is slow and awkward.
This app exists to fix browsing, and must handle playback itself — bouncing
back to the official app to play something defeats the purpose.

## Hard constraints — do not violate these

**webOS 4.0 ships Chromium 53, permanently.** LG does not update Chromium
within a major webOS version. Therefore:

- No `async`/`await` (Chrome 55). Use Promises with `.then()`.
- No CSS Grid (Chrome 57). Flexbox and inline-block only.
- No object spread, no `Object.entries` (Chrome 54).
- No `position: sticky` (Chrome 56).
- Animate only `transform` and `opacity`. No shadow, filter, or blur
  transitions — they force layout and paint on a 2018 SoC.
- Build target `es2015` if a bundler is introduced. Prefer no bundler.

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
is unit tested. Widen it only alongside `PROFILE` in `js/plex.js`, and only
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
  everything else. `js/panel.js` builds that declaration by asking the panel
  with `canPlayType`, so widening is a matter of evidence rather than editing
  a string. Only `"probably"` is acted on: `"maybe"` is what a TV says when it
  has not been asked precisely enough, and acting on it is how you get a black
  screen. The `panel` chip shows what was asked and what came back.
- What the panel can *decode* and what survives *HDMI ARC* are different
  questions. `js/panel.js` answers the first, `js/media.js` the second, and the
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
in the masthead badges so the user can see it before pressing OK.

## Layout

No bundler. Each file is one global, and `index.html` loads them in dependency
order — that script list *is* the dependency graph. `npm run check` fails if a
file in `js/` is missing from it.

Settings and services:

- `js/config.js` — the few settings that differ between the TV and a laptop:
  plex.tv base URL, TMDB key, debug beacon. Nothing else may hardcode these.
- `js/store.js` — IndexedDB cache. The rail paints from cache before any
  network call.
- `js/panel.js` — what this panel claims it can play, and the client profile
  built from it.
- `js/media.js` — the rules, as pure functions: audio and subtitle track
  selection, the UHD guard, certificate ages, markers, chapters, quality caps,
  film identity. No network, no DOM. These are the parts that must not be
  wrong, so they are the parts that are unit tested.
- `js/subs.js` — SRT and WebVTT in, cues out, and what should be on screen at
  time t. Pure, and unit tested. Subtitles are drawn over the video rather than
  burned into it, which is what makes them free — see the player, below.
- `js/servers.js` — the servers we can reach, which one an item came from, and
  which one is preferred.
- `js/merge.js` — one entry per film across servers: folding fetched lists, and
  the streaming merge behind the All row.
- `js/plex.js` — auth (PIN flow), server discovery, library paging, poster
  URLs, the decision call, timeline reporting. Every call takes a server.
- `js/tmdb.js` — TMDB client for the curated rows. Inert without a key.

Screen:

- `js/ui.js` — which view is showing, toast, the debug line, keycodes.
- `js/rows.js` — the row model. A 'list' row holds its items; a 'merge' row is
  virtual over the servers' own totals and walks them as you scroll.
- `js/rail.js` — draws rows from a fixed pool: 4 row elements, 12 tiles each,
  whatever the library size. Owns no state.
- `js/meta.js` — full metadata for a copy, debounced and cached per server.
- `js/guard.js` — will this copy play, and at what cost to someone else's
  server. Everything that reaches Player goes through it first.
- `js/masthead.js` — title, badges, and the audio track we would pick.
- `js/shows.js` — seasons and episodes of a show, merged across servers.
- `js/detail.js` — the page OK opens on a film or an episode: cast, ratings,
  extras, and every copy with its verdict, which is where playback is actually
  chosen.
- `js/showpage.js` — a show: its series across the top, its episodes down the
  side, each checked in place so OK means something.
- `js/devices.js` — whose viewing is this; filters Continue watching.
- `js/discovery.js` — turns a TMDB list into rows of what the servers have.
- `js/browse.js` — the state: sections, rows, focus, mode, paging, search.
- `js/player.js` — playback and everything you can do during it: the trackbar
  with its chapter ticks and marker bands, seeking, skip intro, and a menu of
  audio tracks, subtitle languages, quality and chapters.
  Seeks accumulate: every `currentTime` assignment on a direct-played file is a
  real range request, so holding a key aims first and seeks once.

  **Choosing an audio track is not free, and the reason is worth knowing.** On
  a direct play the server hands over the original file *whole*, with every
  track still in it, and the panel plays whichever it likes — the first one.
  `audioStreamID` on the decision call is advice to the decision engine and
  changes not one byte of that file. So a "switch" that stays a direct play is
  silent: the OSD renames the track and you go on hearing the old one. Exactly
  two things actually work:

  1. The panel exposes `audioTracks` and we select on it — instant, no restart,
     no server involvement. `js/panel.js` reports on the `panel` chip whether
     this pipeline has it.
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

  Keys while playing: ◀ ▶ nudge 30s · ▲ ▼ open the menu · RW/FF 5 min ·
  0–9 jump to that tenth · CH± next/previous chapter · red/green/yellow/blue
  jump straight to a menu section · OK pauses, or takes the skip when one is
  offered · BACK closes the menu, then dismisses a skip, then stops.
- `js/app.js` — boot, and where each key goes.

Tools:

- `dev/` — the laptop harness (see Testing). Never packaged.
- `tools/package.sh` — `npm run package`. Stages only what runs and builds the
  .ipk from that: `ares-package .` ignores `--exclude` here and would ship the
  git history and the harness to the TV.
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
- `npm test` — the pure rules in `js/media.js` and the row arithmetic.
- `npm run smoke` — drives the whole app in headless Chromium: link, browse,
  paging, kids, discovery, search, devices, the detail page, all three playback
  verdicts, and the player itself — the menu, a subtitle language fetched and
  drawn, an audio switch that restarts and keeps the subtitle language, skip
  intro, and the trackbar. The mock serves **two** servers sharing a library,
  so the deduplication and the copy-picking are covered end to end. The player
  steps need a fixture and skip without one. Keep it green; add a step when you
  add a screen.

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
