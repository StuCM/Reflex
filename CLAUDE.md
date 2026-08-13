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

## Current state

- `js/plex.js` — auth (PIN flow), server discovery, library paging, poster
  URLs, decision call, timeline reporting.
- `js/store.js` — IndexedDB cache. Rail paints from cache before any network.
- `js/app.js` — remote keys, windowed rail (14 tiles in the DOM), masthead.
- `js/player.js` — direct play, resume, progress, the 4K guard.
- `probe.py` — runs the decision endpoint under several client profiles to
  find which declared capability flips transcode → direct play. Safe to run
  repeatedly; starts no sessions.

## Next tasks, in order

1. Set TV audio output to Auto, re-run `probe.py` on a file that currently
   transcodes, and record which profile row direct plays.
2. Implement audio track selection per the rules above.
3. Show/episode drill-down (currently movies only).
4. Search and filters.
5. Only if browsing is still slow after all this: a caching backend on the
   existing Hetzner box (Docker Compose + Caddy) that pre-sizes posters and
   serves a pre-baked section index. Deliberately deferred — the point is to
   find out whether it's needed.

## Testing

Benchmark on the **second** pass through a section. The first pays for
server-side poster generation and the cold IndexedDB write. If pass two isn't
smooth, the bottleneck is network latency to the remote server, not the panel.

`ares-inspect --device <tv> --app com.stu.plexlite` gives a real Network tab
and console on the TV. Use a Chromium build close to 53; newer DevTools won't
attach cleanly.

Developer Mode expires after 1000 hours and removes sideloaded apps with it.
