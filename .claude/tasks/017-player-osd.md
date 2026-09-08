---
id: 017
slug: player-osd
status: building
branch: crew/017-player-osd
model: sonnet
env: laptop
files:
  - js/player.js
  - js/media.js
  - index.html
  - css/app.css
  - dev/smoke.js
---

# The player's controls, to the design

## Goal
The OSD becomes the Mantis one: the title top-left behind a back affordance,
the trackbar across with the elapsed and total either side, and a row of round
controls — rewind, play/pause, forward on the left; Audio, Subtitles, Quality
and Chapters on the right, each captioned with what is currently chosen and
ringed in violet when it is the one open. Each opens a panel anchored to it
rather than one tabbed block, and Chapters opens a rail of cards.

## Why now
The detail page took this shape in 016 and the menu shell is already shared, so
the player can wear the same face for far less than it would have cost before.
It is also the last screen the user gave a design for.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching `js/player.js`, `js/media.js`, `index.html`,
`css/app.css` or `dev/smoke.js`. No worktrees are in flight; 016 merged as
`7c3b288`, main verified at 67/67.

Read these as they now are:

- `js/menu.js` exists and `js/player.js` already draws with it. `js/player.js`
  is ~850 lines, down from 1022.
- `js/detail.js` has the round-button action row this task matches. Its CSS is
  in `css/app.css`; factor the shared button rules rather than writing a second
  set, and do not change how the detail page looks while doing it.
- `CLAUDE.md` was updated with 016: it now describes `js/menu.js` as the shared
  shell and says the player owns what the tabs hold, not the drawing. It is
  current — trust it.
- `dev/smoke.js` is at 67 steps.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **`js/menu.js` is the shared shell** (016): tabs, rows, the winding
  transform, the d-pad, an overlay that swallows every key. Tabs take a **row
  builder**, built when shown — that laziness is deliberate, because building
  all tabs at open froze the current-chapter marker. Do not make it eager.
- **`js/player.js` owns what the tabs hold and what choosing does**, and lost
  171 lines to the extraction. Keep that division: anything about drawing or
  walking belongs in `js/menu.js`.
- **A promise and its implementation must not drift.** 016's review found the
  audio row's cost note and the `forceStream` given to the guard coming from two
  different tests. `needsMux(st)` is now the single predicate. If this task
  moves that note anywhere, it moves the predicate with it.
- **Choosing audio is not free.** On a direct play the server hands over the
  file whole and `audioStreamID` changes nothing; either the panel exposes
  `audioTracks` (instant) or direct play has to be given up, which on a 4K file
  the guard refuses. Every quality, version and audio change goes through
  `Guard.check` and a refusal leaves playback alone with a toast — never stops
  the film to deliver a message.
- **Seeks accumulate**: every `currentTime` assignment on a direct-played file
  is a real range request, so holding a key aims first and seeks once. Do not
  disturb that while moving the trackbar's markup.
- **`Media.chapters(item)`** returns `{title, start, end}` — **no thumbnail**.
  Plex may carry a `thumb` on a Chapter; it often does not.
- **Palette and timings are tokens**: `--ac` violet, `--ac2` amber,
  `--t-quick`, `--t-move`, `--t-fade` (hero only), `--ease`.
- **Chromium 53, 2018 SoC.** No CSS Grid, no `position: sticky`, no
  `async`/`await`, no object spread, no `Object.entries`. Animate only
  `transform` and `opacity` — over video, that matters more than anywhere else.
- **`Array.prototype.sort` is not stable** before Chrome 70.

## Constraints that bite here
- **Do not invent an "Auto" quality.** The design shows `Auto — follows the
  connection` above `Original`. We do not implement adaptive bitrate: a direct
  play has no ladder, and a capped transcode is a fixed ceiling, not a
  connection-following one. Offer what `Media.qualities` actually gives. A row
  that claims to follow the connection and does not is the same class of lie as
  labelling a TMDB score "IMDb".
- **Chapter cards must degrade.** Use a chapter's `thumb` where Plex supplies
  one; where it does not, the card is the timecode and the name with no broken
  image and no different height. Do not start generating frames.
- **Nothing may cover the subtitles.** `#subtitle` lifts to `bottom: 320px`
  when the OSD is up; whatever the new controls' height is, that number follows
  it rather than being left where it was.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`index.html` and `css/app.css` — the OSD.** `#osd` keeps its title, bar and
   times, and gains `#osd-controls`: on the left, round rewind, play/pause and
   forward; on the right, round Audio, Subtitles, Quality and Chapters, each
   with a caption underneath naming the current choice. Same round-button
   language as the detail page's action row — factor the shared rules into one
   class rather than a second copy. The open one carries the violet ring.
   `#osd-tracks` is superseded by the captions and goes; `#osd-hint` stays, as
   the key map is not on the buttons.

2. **`js/player.js` — buttons, not tabs.** The four right-hand buttons each open
   `Menu` with a **single** section anchored near them, rather than one block of
   four tabs:
   - Left and right along the control row move between buttons; up opens the
     one focused; down and BACK close.
   - Which button is open is what the violet ring means, and the caption always
     reflects the *current* choice, not the highlighted row.
   - Keep every colour-key shortcut working: red/green/yellow/blue still jump
     straight to their section, and now light the matching button.
   - The keys documented in CLAUDE.md keep their meanings — ◀ ▶ nudge, RW/FF
     five minutes, 0–9 tenths, CH± chapter, OK pause or take the skip.

3. **`js/player.js` — the quality panel.** Rows from `Media.qualities` for the
   current copy, each with a note saying what it costs: `direct play` for the
   original where the guard allows it, `transcode · N Mbps` for a cap. The
   current one is checked. No `Auto` row.

4. **`js/media.js` — chapters keep their thumbnail.** `Media.chapters` gains
   `thumb: c.thumb || null`, passed through unchanged. Pure, and the existing
   tests for it must still hold — add one for a chapter without a thumb.

5. **`js/player.js` and `css/app.css` — the chapter rail.** Chapters opens a
   horizontal strip of cards under the controls rather than a list: each a
   thumbnail where there is one, the timecode, and the name; the chapter
   containing the playhead is ringed. Left and right walk it, OK seeks, BACK
   closes. Reuse the rail's card language (16px radius, violet ring) and the
   shared timing tokens.

6. **`css/app.css` — the subtitle lift.** `#subtitle.lifted` moves with the new
   controls' height so a line of dialogue is never behind a button.

7. **`dev/smoke.js`** — extend the player steps, do not replace them:
   - The control row shows four captioned buttons, each naming the current
     choice; opening one rings it.
   - The quality panel offers no row claiming to follow the connection.
   - Chapters opens a rail; OK on a card seeks to that chapter; a chapter
     without a thumbnail still renders a card of the same size.
   - Subtitles drawn while the OSD is up sit above the controls.
   - **The existing audio-switch, subtitle, quality-cap and skip-intro steps
     must still pass** — their assertions may need re-pointing at the new
     markup, but their behaviour must not change.

## Out of scope
- **Adaptive bitrate.** If a real Auto is wanted it is its own task, and it has
  to answer what it does on a direct play.
- **Generating chapter thumbnails** from the video, or Plex's BIF index.
- **The up-next panel** (018) and **clearing Continue watching** (019).
- **`js/guard.js`, `js/plex.js`, `js/app.js`.** The rules and the routes are
  right; this changes what the controls look like and how they are reached.
- **The detail page.** 016 settled it; only shared CSS rules should be touched,
  and only to factor them.

## Definition of done
- [ ] The OSD shows the trackbar with elapsed and total, and a control row with
      rewind / play-pause / forward and four captioned round buttons.
- [ ] Each caption names the current choice; the open one is ringed.
- [ ] Each button opens a panel anchored to it; Chapters opens a rail of cards
      and OK on one seeks there.
- [ ] A chapter with no thumbnail renders a card of the same size, with no
      broken image.
- [ ] No quality row claims to follow the connection.
- [ ] Every quality, version and audio change still goes through `Guard.check`,
      and a refusal toasts without stopping playback.
- [ ] Subtitles are never behind the controls.
- [ ] The existing audio-switch, subtitle, quality-cap, skip-intro and trackbar
      steps still pass with their behaviour unchanged.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
