---
id: 022
slug: series-theme-music
status: draft
branch: crew/022-series-theme-music
model: sonnet
env: laptop
files:
  - js/plex.js
  - js/showpage.js
  - js/app.js
  - js/sidebar.js
  - js/browse.js
  - index.html
  - dev/mock-plex.js
  - dev/smoke/show.js
---

# The series theme, on the show page

## Goal
Opening a series plays its theme tune quietly, the way the official client does,
and stops the instant anything else wants the audio. Off by default is *not*
the ask — it plays — but a sidebar setting turns it off, and it never fights
playback.

## Why now
The user asked whether music tied to what is selected was possible; I said there
was no source, and they corrected me — Plex plays it on the movie page. They are
right, and it is a field the app already receives and ignores: a show item
carries `theme`, a path like `/library/metadata/<showKey>/theme/<id>`, sourced
from TheTVDB.

It is much cheaper than it first looked. A theme is a **static file GET**, not a
transcode: no decision call, no session opened on servers the user does not own,
nothing a kill-stream rule would notice. `grep theme js/` currently returns
nothing.

## Existing work
<!-- filled in by preflight before dispatch -->

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **`theme` is a show field.** Films do not have one. "Shows have a theme,
  films are silent" is the honest shape; do not invent a substitute for films.
- **`Plex.metadata` returns the whole payload** and already sets
  `includeGuids`, so `theme` should arrive on a show without a new parameter.
  Confirm that against `dev/mock-plex.js` and say in the task file whether a
  real server needs anything extra.
- **HDMI ARC is the most delicate path in this project** (CLAUDE.md, "Audio: the
  live problem"). Audio is over plain ARC, not eARC. Two sources contending is
  exactly the class of fault that has cost the most time here. The theme must
  be stopped — not paused, not faded over seconds — **before** `Player.play`
  touches the video element.
- **`js/app.js` owns every route into playback.** `playChecked` is the single
  entry, and `openShow`/`openEpisode` are where the show page is opened and
  left. That is where a stop belongs, not scattered through `js/showpage.js`.
- **The sidebar already carries cycling settings**: `Prefer <server>`,
  `Autoplay next: off | 5s | …` — `modes()` in `js/sidebar.js`, dispatched by
  `kind` in `Browse.activate`, persisted in `localStorage` behind a try/catch.
  Copy that shape exactly; do not invent a settings screen.
- **Everything must be d-pad reachable** — the sidebar is where a setting lives
  for that reason.
- **Chromium 53**: no `async`/`await`, no object spread, no `Object.entries`.
  An `<audio>` element is fine; the Web Audio API is not worth the risk.
- **Assertions that pass on nothing** are this suite's recurring failure
  (CLAUDE.md, Testing).

## Constraints that bite here
- **Never let the theme and playback overlap.** Stopping is a hard stop before
  anything else starts. If in doubt, stop it earlier than feels necessary.
- **Autoplaying audio on a TV must be escapable.** The setting has to be
  reachable without hunting, and off must stay off across launches.
- **It must not follow the user around.** The theme belongs to the show page.
  Leaving that page — BACK, opening an episode, opening the copy chooser,
  starting playback, the screensaver — stops it.
- **A missing theme is normal, not an error.** Most libraries have them for
  some shows and not others. No toast, no debug shouting; silence.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/plex.js`** — `themeUrl(server, item)`: `server.base + item.theme +
   '?X-Plex-Token=' + server.token`, or `''` when the item has no `theme`. It is
   a plain file URL, the same shape as `photoUrl`. No new request, no decision
   call, nothing that opens a session.

2. **`index.html`** — one `<audio id="theme" preload="none">`. One element for
   the life of the app, like `#video`.

3. **`js/showpage.js` — play it, own it.**
   - When a show's metadata resolves and it has a `theme`, start it at a low
     volume (**0.35**) and loop it. The show page is already the thing you land
     on from Continue watching, so this is where a series announces itself.
   - Fade in over the shared `--t-move` by stepping `volume`, not by touching
     the element's playback — a fade is kind, a hard start is jarring, and
     volume is cheap.
   - Expose `ShowPage.silence()` that stops it dead: pause, `currentTime = 0`,
     drop the `src`. Call it from the page's own close path.
   - Autoplay may be refused by the platform. If `play()` rejects, that is
     information, not a failure: write one debug line and carry on silently.

4. **`js/app.js` — the hard stop.** Call `ShowPage.silence()` at the top of
   `playChecked`, and on every route that leaves the show page — `openDetail`
   from the show, BACK to browse, the up-next panel. One call site per route is
   better than a listener that might miss one, because the failure mode here is
   two audio sources on an ARC link.

5. **`js/sidebar.js` and `js/browse.js` — the setting.** `Theme music: on | off`
   beside `Autoplay next`, cycled the same way, persisted under
   `reflex.theme` in `localStorage` behind the same try/catch. Default **on**;
   a browser that refuses storage reads as on, because that is what the user
   asked for.

6. **`dev/mock-plex.js`** — give some shows a `theme` and serve a short audio
   file at that path, so the smoke test can assert the element actually has a
   source and is playing. Leave at least one show **without** a theme, so the
   silent path is exercised rather than assumed.

7. **`dev/smoke/show.js`**:
   - Opening a show with a theme leaves `#theme` playing, with a source under
     the mock's origin.
   - Opening a show without one leaves it silent and shows no error.
   - Starting playback stops it — assert `paused` **and** that the `src` is
     gone, since a paused element with a source is still holding the pipeline.
   - BACK from the show page stops it.
   - With the setting off, nothing plays, and off survives a reload.

## Out of scope
- **Music for films.** No source; do not invent one.
- **Anything on the browse screen.** The theme belongs to the series page.
- **The Web Audio API, crossfading between shows, ducking.**
- **`js/player.js`, `js/guard.js`, `js/media.js`.** A theme is not library
  content and never goes near the guard or a session.
- **Trailer video on the hero** — a separate idea with a real session cost,
  recorded in the backlog.

## Definition of done
- [ ] Opening a series with a theme plays it, looping, quietly, fading in.
- [ ] A series without one is silent, with no error and no toast.
- [ ] Playback stops it dead before the video element starts — asserted by both
      `paused` and the source being dropped.
- [ ] Leaving the show page by any route stops it.
- [ ] `Theme music: on | off` is in the sidebar, defaults to on, and off
      survives a reload.
- [ ] A refused autoplay writes one debug line and nothing else.
- [ ] No new request is made that could open a session on a Plex server.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
