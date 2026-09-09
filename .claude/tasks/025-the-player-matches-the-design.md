---
id: 025
slug: the-player-matches-the-design
status: building
model: sonnet
env: laptop
branch: crew/025-the-player-matches-the-design
files:
  - js/player.js
  - css/player.css
  - dev/smoke/player.js
---

# The player, to the design — and up goes to the trackbar

## Goal
The transport controls and Play match each other in size, the option panels are
opaque and properly rounded, the buttons come down to the design's size, and
**▲ takes you to the trackbar** while a panel opens only on OK on its own
button.

## Why now
The user's own list, from the panel, recorded and then not acted on while other
work went ahead: *"The play button and navigate next buttons are different
sizes. The boxes showing the options are [not] rounded enough… I don't want
opacity here, the buttons seem too big. Only clicking the button should open the
menu, pressing up should allow you to control the navigation bar."* They later
confirmed **▼ goes back to the buttons**.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing. Nothing else is
in flight; main verifies at 85/85.

The stylesheet and the smoke suite were split a few hours ago: iterate with
`npm run smoke -- detail` or `-- player` (seconds, not the full 2m37s), and the
mock takes an OS-assigned port so the task running beside you cannot clash.
`design/Mantis Screens.dc.html` is in the repo — read the numbers out of it.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md`, `design/Mantis Screens.dc.html` and the
session that produced this task. Workers must not go digging for more.

- **The design is authored at 1920×1080** — `.frame{width:1920px;height:1080px;
  transform:scale(.5)}` — so every value in it is already in this app's
  coordinate system. **Do not scale anything.** Screens **7a** (controls), **7b**
  (a setting opened from the row) and **7c** (chapters) are this task. Read the
  sizes, radii and opacities out of the file rather than inventing them.
- **The control row is a mode**, which is what keeps CLAUDE.md's key map true:
  unfocused, ◀ ▶ still nudge 30s, RW/FF still jump five minutes, 0–9 still jump
  to a tenth, CH± still steps chapters. Only once the row has focus do the four
  arrows belong to it. That stays; what changes is where ▲ goes.
- **`js/menu.js` is the shared shell** (016) — tabs, rows, the winding
  transform, an overlay swallowing every key. Its tabs take a **row builder**,
  built when shown; that laziness is deliberate, because building all tabs at
  open froze the current-chapter marker. Do not make it eager, and do not fork
  it — the detail page draws with the same module.
- **A promise and its implementation must not drift**: the audio row's cost note
  and the `forceStream` handed to the guard come from one predicate,
  `needsMux(st)`. If a note moves, the predicate moves with it.
- **Every quality, version and audio change goes through `Guard.check`**, and a
  refusal toasts and leaves the film playing — it never stops playback to
  deliver a message.
- **Seeks accumulate**: every `currentTime` assignment on a direct-played file
  is a real range request, so holding a key aims first and seeks once. Whatever
  ▲ now does to the trackbar must not break that.
- **Nothing may cover the subtitles.** `#subtitle.lifted` was raised for the
  taller OSD; if the controls change height, that number follows.
- **Tokens live in `css/base.css`** — palette, timings, and the radius,
  control-size and spacing tokens 020 added. The round-button rules are shared
  with the film page across `.dt-act-btn` and `.osd-btn`.
- **Chromium 53, 2018 SoC**: animate only `transform` and `opacity`; no blur or
  filter transitions — over video that matters more than anywhere.
- **Assertions that pass on nothing** are this suite's recurring failure — five
  in one day (CLAUDE.md, Testing), one of them because a Playwright round trip
  was slower than the state it was watching for.

## Constraints that bite here
- **Do not break the key map.** Every key CLAUDE.md documents keeps its meaning
  while the row is unfocused. The colour keys still open a panel in one press.
- **Opacity goes from the panels, not from everything.** The user's objection is
  to translucent option boxes; the backdrop dimming and the crossfades are
  separate and stay.
- **Task 024 runs beside this one** and owns `js/detail.js`, `css/detail.css`
  and `dev/smoke/detail.js`. A control size that genuinely belongs to both
  screens lives in `css/base.css` — which **neither** task owns, so if you need
  to change it, say so in the task file rather than reaching for it.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no full
  stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/player.js` — ▲ goes to the trackbar.** Three states, and they must be
   distinguishable without looking anything up:
   - **Nothing focused** (the default): every documented key means what it says.
   - **▲ → the trackbar.** ◀ ▶ scrub, OK seeks there, ▼ or BACK leaves. Respect
     the existing aim-then-seek behaviour — a scrub must not fire a range
     request per keypress.
   - **▼ → the control row.** ◀ ▶ walk the buttons; **OK opens that button's
     panel** and nothing else does; ▲ returns to the trackbar, BACK leaves.
   The colour keys still focus and open a panel in one press.

2. **`css/player.css` — the panels.** Opaque, using the palette's surface rather
   than a translucent black, and rounded to the design's radius via the token.
   No `rgba()` background on a panel; if a value looks like it needs one, it is
   the wrong token.

3. **`css/player.css` — the sizes.** Play and the transport controls match each
   other, at 7a's numbers. The round buttons come down to the design's size.
   Where a size belongs to both this screen and the film page, it belongs in
   `css/base.css` — see the constraint above.

4. **`css/player.css` — the subtitle lift** follows whatever height the controls
   end up, so a line of dialogue is never behind a button.

5. **`dev/smoke/player.js`** — extend, and make each step fail first:
   - ▲ focuses the trackbar and ◀ ▶ scrub it; ▼ moves to the control row; OK on
     a button opens that panel and ▲ alone does not.
   - Every key the map documents still works while nothing is focused — assert
     a nudge and a chapter step explicitly, since that is what a mode change
     most easily breaks.
   - A panel's computed background has an alpha of 1.
   - Play and the transport controls report the same width.
   - Subtitles drawn with the OSD up sit above the controls.
   - The existing audio-switch, subtitle, quality-cap, skip-intro and chapter
     steps still pass — behaviour unchanged.

## Out of scope
- **The 501 subtitle failure** — a real bug, its own task, and it needs a real
  server to diagnose rather than a restyle.
- **An "Auto — follows the connection" quality row**, which the app does not
  implement and must not claim to.
- **Chapter thumbnails beyond Plex's own `thumb`.**
- **The film page** — 024 owns it.
- **`js/menu.js`, `js/guard.js`, `js/app.js`, `index.html`.** If markup is
  genuinely needed, stop and say so; 024 may need it too.

## Definition of done
- [ ] ▲ focuses the trackbar and scrubs it; ▼ reaches the control row; a panel
      opens only on OK on its button.
- [ ] Every key CLAUDE.md documents still means what it says while nothing is
      focused, asserted for at least a nudge and a chapter step.
- [ ] Option panels are opaque and rounded to the design's radius.
- [ ] Play and the transport controls are the same size, at the design's
      numbers, and the buttons are smaller than they are today.
- [ ] Subtitles are never behind the controls.
- [ ] The existing player steps pass with their behaviour unchanged.
- [ ] Each new step was seen to fail before it was trusted to pass, and the task
      file says so.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
