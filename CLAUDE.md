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

**The user does not own the Plex server.** He is a shared user on someone
else's remote server, connecting directly (not via relay).

- The server's rule is **no transcoding of 4K**. Enforcement appears to be
  Tautulli-style kill-stream, which fires *after* a session starts — so an
  accidental transcode still registers on the admin's dashboard.
- Therefore: always call `/video/:/transcode/universal/decision` with
  `hasMDE=1` before playback. It returns the verdict without opening a
  session. Refuse 4K playback if the decision is anything but `directplay`.
- Never widen the direct play profile to "make something work" without
  confirming the panel can actually decode it. Claiming a codec it can't
  gives a black screen; omitting one it can pushes needless load onto
  someone else's hardware.
- Sync library data incrementally and infrequently. Do not full-crawl a
  server we don't own.

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
- `js/media.js` — the rules, as pure functions: audio track selection, the UHD
  guard, certificate ages. No network, no DOM. These are the parts that must
  not be wrong, so they are the parts that are unit tested.
- `js/plex.js` — auth (PIN flow), server discovery, library paging, poster
  URLs, the decision call, timeline reporting.
- `js/tmdb.js` — TMDB client for the curated rows. Inert without a key.

Screen:

- `js/ui.js` — which view is showing, toast, the debug line, keycodes.
- `js/rows.js` — the row model. A 'list' row holds its items; an 'all' row is
  virtual over a server-supplied total and pages in what you look at.
- `js/rail.js` — draws rows from a fixed pool: 4 row elements, 12 tiles each,
  whatever the library size. Owns no state.
- `js/meta.js` — full metadata for the focused item, debounced and cached.
- `js/masthead.js` — title, badges, and the audio track we would pick.
- `js/devices.js` — whose viewing is this; filters Continue watching.
- `js/discovery.js` — turns a TMDB list into rows of things this server has.
- `js/browse.js` — the state: sections, rows, focus, mode, paging, search.
- `js/player.js` — direct play, resume, progress.
- `js/app.js` — boot, the playback guard, and where each key goes.

Tools:

- `dev/` — the laptop harness (see Testing). Never packaged.
- `probe.py` — runs the decision endpoint under several client profiles to
  find which declared capability flips transcode → direct play. Safe to run
  repeatedly; starts no sessions.

## Next tasks, in order

1. Set TV audio output to Auto, re-run `probe.py` on a file that currently
   transcodes, and record which profile row direct plays. **Outstanding, and
   it needs the actual TV** — nothing on the laptop can answer it.
2. ~~Audio track selection~~ — done: `Media.pickAudio`, passed as
   `audioStreamID` on the decision call, shown in the masthead before you press
   OK. The rules are unit tested but have never met the real ARC path.
3. Show/episode drill-down (currently movies only).
4. ~~Search~~ — done. Filters: only the kids certificate filter so far, and it
   is applied server side. Anything else (year, unwatched, resolution) is still
   to do.
5. Only if browsing is still slow after all this: a caching backend on the
   existing Hetzner box (Docker Compose + Caddy) that pre-sizes posters and
   serves a pre-baked section index. Deliberately deferred — the point is to
   find out whether it's needed.

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

The three checks, and what each is for:

- `npm run check` — scans `js/` and `css/` for anything newer than Chromium 53.
  Desktop Chrome will happily run code the TV cannot, and this is the only
  thing standing between that and a black screen. It is a text scan, not a
  parser: a clean run means nothing obviously wrong, not proof.
- `npm test` — the pure rules in `js/media.js` and the row arithmetic.
- `npm run smoke` — drives the whole app in headless Chromium: link, browse,
  paging, kids, discovery, search, devices, and all three playback verdicts.
  Keep it green; add a step when you add a screen.

None of that says anything about how it feels on the panel, which is still the
question. When benchmarking on the TV, use the **second** pass through a
section. The first pays for server-side poster generation and the cold
IndexedDB write. If pass two isn't smooth, the bottleneck is network latency to
the remote server, not the panel.

`ares-inspect --device <tv> --app com.stu.plexlite` gives a real Network tab
and console on the TV. Use a Chromium build close to 53; newer DevTools won't
attach cleanly.

Developer Mode expires after 1000 hours and removes sideloaded apps with it.
