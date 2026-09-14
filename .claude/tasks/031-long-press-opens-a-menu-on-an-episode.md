---
id: 031
slug: long-press-opens-a-menu-on-an-episode
status: done
branch: crew/031-long-press-opens-a-menu-on-an-episode
model: sonnet
env: laptop
rounds: 2
files:
  - src/screen/showpage.ts
  - src/view/menu.ts
  - src/app.ts
  - css/show.css
  - dev/smoke/show.js
  - tools/icons.js
  - src/view/glyphs.ts
gate: pass
gateSha: 36c28ee07d980576b7b37b138633cc906630e287
gateAt: 2026-09-14T16:38:04.394Z
---

<!-- files: amended by the worker. The spec's own constraints require the four
     new icons to come from the mapping in tools/icons.js, regenerated into
     src/view/glyphs.ts — neither path was declared. Nothing else was added. -->


# Holding OK on an episode opens a menu against the card

## Goal
On the show page, holding OK on an episode for half a second opens a small menu
anchored to that card — mark watched, mark all up to here, play from start,
episode details — with the rest of the page dimmed behind it. A normal press
still plays the episode.

## Why now
Stuart's first ask off the 2026-09-14 canvas: *"One key thing here is that we
introduce a long press to show menu items on episodes and on the main page. This
should be our next task."* Screen **6e** specifies it.

**This task is the episode surface only.** The canvas designs the long press on
an episode and nothing else; the rail's version would need a different menu
(Continue watching already has removal on the green key, task 018) and has no
drawing to build to. That is a second task, after this one proves the mechanism.

## Existing work
`npx crew collisions` printed nothing.

## Graph context
`npx crew graph` reports the memory-graph CLI is not on PATH; this is written
from `CLAUDE.md`, the design, and the code.

**The design, screen 6e in `design/Mantis Screens.dc.html`.** Read it — it is the
brief, and these are the numbers, taken from its markup rather than its picture:

- Scrim over the whole page: `var(--sc55)`, `pointer-events: none`, above the
  page and below the menu.
- The held card keeps **full brightness**; every other card drops to `.4`. The
  held card carries `0 0 0 3px var(--ac), 0 24px 54px rgba(0,0,0,.6)`.
- Menu box: `width: 512px`, `border-radius: 24px`, `padding: 24px 16px`,
  `background: var(--tile)`, `box-shadow: 0 0 0 1px rgba(238,241,243,.12),
  0 44px 100px rgba(0,0,0,.72)`. In the drawing it sits at `left: 96px;
  top: 606px` — that is *this* card's position, not a constant: anchor it to the
  focused card and clamp it on screen.
- Header inside the box: a kicker (`S2 E3`, 20px, `.18em` letter-spacing,
  uppercase, `var(--dim)`) over the episode title (28px, `var(--fg)`).
- A row is icon (27px) + label (25px) + optional right-aligned note (21px,
  `var(--dim)`). The focused row has `background: var(--ac14)` and
  `color: var(--fg)`; the others `rgba(238,241,243,.72)`.
- Bottom right of the screen: *Back closes · OK confirms*.

**Two decisions already taken. Do not revisit them.**

1. **The design's `HOLD_MENU` has five rows; build four.** *Watch recap ·
   YouTube* is omitted. The YouTube embed loads its shell on Chromium 53 and
   never fetches media — task 012 is closed on exactly that, and a menu row that
   cannot work is worse than an absent one. The four are:

   | icon | label | note |
   |---|---|---|
   | `check-circle` | Mark as watched | — |
   | `checks` | Mark all up to here | the span, e.g. `S2 E1–E3` |
   | `play-circle` | Play from start | the episode's duration |
   | `info` | Episode details | — |

2. **▲▼ move, OK confirms, ◀▶ and BACK close.** The 6e caption says "any
   direction key or Back closes it", but the menu has rows and the drawing
   highlights one — if every arrow closed it, four of the four rows would be
   unreachable. ▲▼ therefore walk the rows; ◀▶ close, which honours the caption
   for the axis with nothing else to do.

**The mechanism, and why it cannot be the obvious one.** `src/app.ts:522`
registers `keydown` and nothing else — there is no `keyup` anywhere in `src/` or
`dev/`. A long press needs one, and the reason it cannot instead fire on keydown
and correct itself afterwards is specific to this project: **OK on an episode
calls `playFocused()`** (`src/screen/showpage.ts:533`), which runs
`Guard.check` and the `/decision` call against a server we do not own. Acting
first and undoing is not an option when the side effect is a request to someone
else's Plex server.

So on the episodes zone **OK acts on release**. Everywhere else is untouched.

**What is assumed, and what would disprove it.** That the panel's remote emits
`keyup` for OK. It is ordinary Chromium under WAM so it almost certainly does,
and the player already relies on held keys auto-repeating `keydown`
(`CLAUDE.md`, the player's seek accumulation) — but nothing in this app has ever
listened for `keyup`, so it is untested here. If the panel turns out not to send
it, short presses on an episode stop working entirely — loudly, on the first
try, not subtly. That is the right failure: obvious beats silent. Say so in the
report so the panel check knows what to look at first.

## Constraints that bite here
- **Reuse `src/view/menu.ts`.** It already draws rows, takes ▲▼, confirms on OK
  and closes on BACK, and it swallows every other key. A single tab means its
  ◀▶ tab-switching is inert, so adding "◀▶ close" is the only key change. Do not
  write a second menu.
- `MenuRow` already carries `label`, `note`, `value` and `off`. If the anchored
  box needs anything `menu.ts` has no concept of — a position, a header — add it
  to that module's options rather than styling from the caller: a style belongs
  in the stylesheet and `menu.ts` owns this shell.
- `src/view/glyphs.ts` is generated by `tools/icons.js` from
  `@phosphor-icons/core`. Adding `check-circle`, `checks`, `play-circle` and
  `info` means editing the mapping in that tool and regenerating — not
  hand-pasting paths, and not a second icon set.
- Animate only `transform` and `opacity`; the scrim and the dim are opacity.
- `css/show.css` only. `css/base.css` holds the shared tokens and changing it
  changes every screen.

## Approach
1. `src/app.ts` — add a `keyup` listener beside the existing `keydown` one and
   route it the same way `onKey` routes, to a new `keyUp(code)` on the screen
   modules that want it. Screens that do not export one are unaffected.

2. `src/screen/showpage.ts`, episodes zone only — on OK **keydown**, record the
   time and start a 500ms timer that opens the menu; do **not** call
   `playFocused()`. On OK **keyup**, clear the timer; if the menu did not open,
   call `playFocused()` then. A `keydown` arriving with `repeat` set while the
   timer runs is also a hold — open the menu and let the timer be cleared,
   because that is the signal the player already trusts.

3. Build the four rows. "Mark all up to here" needs the span of episodes from
   the season's first to the focused one for its note; "Play from start" needs
   the episode's duration. Both are already on the episode.

4. Open through `menu.ts`, anchored to the focused card's position and clamped
   so the box cannot leave the screen — the player's `openPanelFor` already
   solves that clamp for its own panels; read it before writing a second one.

5. `css/show.css` — the scrim, the dim on unheld cards, the ring on the held
   one, and the menu box to the numbers above.

6. Wire the four actions. **Mark as watched** and **Mark all up to here**
   scrobble, exactly as task 018's deck removal does — reuse that path, do not
   write a second scrobbler. **Play from start** is `playFocused()` with the
   resume position ignored. **Episode details** opens the detail page the same
   way ▶ already does through `openCopies()`.

7. `dev/smoke/show.js` — a step that holds OK on an episode and asserts the menu
   appears with its four rows and the right episode title in the header; a step
   that presses OK normally and asserts it still plays; a step that walks with
   ▲▼ and confirms with OK. **The short-press step is the one that matters** —
   it is what catches a long-press implementation that has broken ordinary
   playback, which is the expensive way to get this wrong.

## Out of scope
- The long press on the rail / main page. A second task, once this proves out.
- *Watch recap*, and anything about making recaps play.
- Screen 6d, the series page redesign, even though 6e is drawn on top of it.
- Any change to what OK does outside the show page's episodes zone.
- `css/base.css` and the shared tokens.

## Definition of done
- [x] Holding OK on an episode for ~500ms opens a menu anchored to that card,
      with exactly four rows in the order above
- [x] A normal OK press still plays the episode, and the smoke suite proves it
- [x] The held card stays at full brightness while the others dim
- [x] ▲▼ walk the rows, OK confirms, ◀▶ and BACK close
- [x] Each of the four actions does what it says, and marking watched survives a
      reload — *the four actions yes; the reload half is asserted as "the
      scrobble was issued against every copy", because the mock does not model
      `viewCount` and `dev/mock-plex.js` is not in `files:`. See the judgements
      section.*
- [x] The menu is clamped on screen for the first and last episode in the list,
      not only a middle one
- [x] `npm run smoke -- show` passes, and `npm run verify` is green at **96/96
      plus the steps this adds** — no existing step removed or weakened
      (104/104, eight added)
- [x] the gate passes (`npx crew gate <this file>`)
- [x] no file outside `files:` is touched (`files:` amended by two, see above)
- [x] commits follow the convention (the hook enforces it)

## Docs the orchestrator applies at close
- `CLAUDE.md`'s show page bullet gains the long press and the keyup rule — that
  OK on an episode acts on release, and why.
- `docs/backlog.md` section 0c: the long-press ask is half done (episodes yes,
  rail no).

## What changed, per file
- `src/screen/showpage.ts` — the hold: OK starts a 500ms timer on keydown and
  plays on keyup if the timer is still running; a second keydown while it runs
  is the remote repeating and opens the menu at once. The four rows, the anchor
  and its clamp, and the four actions. `playFocused` gained an `at`, so "Play
  from start" is the same function with 0 rather than a second one.
- `src/view/menu.ts` — a per-row `icon`, a `head` (kicker over title) drawn in
  place of the tab strip, and ◀▶ closing a menu that has no second tab.
- `src/app.ts` — a `keyup` listener beside the `keydown` one, routed to
  `showpage.keyUp`; `onPlay` passes the start position through.
- `css/show.css` — the scrim, the dim, the ring, and the box to 6e's numbers.
- `tools/icons.js` / `src/view/glyphs.ts` — `check-circle`, `checks`,
  `play-circle`, `info`, regenerated. Additive: no existing path changed.
- `dev/smoke/show.js` — eight steps. The chain is split in two (`const suite`)
  because oxfmt re-indents the whole file above a certain chain length.

## What the spec got wrong, and two judgements
- **`files:` was incomplete.** Its own Constraints require the icons to come
  from `tools/icons.js` regenerated into `src/view/glyphs.ts`; neither was
  declared. Both added, nothing else.
- **◀▶ closes every single-tab menu, browse's confirmation included.** This is
  what the Constraints section asks for in as many words, and it is recorded
  here rather than narrowed because it is a real change outside this page: the
  confirmation now cancels on ◀▶. It lands on Cancel already (`on: true`), so
  ◀▶ does what BACK and the landed row both do, and no action is skipped — but
  it is behaviour on a screen this task does not otherwise touch.
- **Positioning stayed with the caller**, as `--menu-left` / `--menu-top`, which
  is the player's `openPanelFor` pattern that Approach step 4 points at. The
  header did go into `menu.ts`, as asked.
- **"Marking watched survives a reload" is not smoke-tested.** `dev/mock-plex.js`
  answers `/:/scrobble` without recording `viewCount`, and that file is not in
  `files:`. The step asserts instead that the scrobble was issued against every
  copy — one per episode for this show — with the rendered row reading
  *watched* as its control, which is how task 018 proved the same path.
  Persistence is Plex's, and the real servers do it.
- **The keyup assumption is untested on the panel.** Nothing in this app has
  ever listened for `keyup`. If the B8's remote does not send one, short presses
  on an episode stop playing anything — loudly, first try. That is the first
  thing to check on the panel.

## Review rounds
- **Round 1 — CHANGES.** (1) "Mark all up to here" was asserted by its label and
  note but never actually chosen, so the slice was untested. Added a step that
  holds OK on E3, confirms the row, and asserts exactly three scrobbles with
  E1–E3 reading *watched* and E4 not — it fails on `episodeIndex + 2`, checked.
  (2) Record the ◀▶ decision rather than leave it implicit: done above. Smoke
  104/104.
- **Round 2 — PASS.** Both fixes verified independently, `npm run verify` rerun
  at 104/104, and no file outside the amended `files:` touched.

## Graph writes proposed
- **Decision:** OK on an episode acts on `keyup`, not `keydown`. Rationale: a
  long press cannot fire the press action first and correct itself when that
  action is a `/decision` call against a server we do not own.
- **Pattern:** the app had no `keyup` listener at all before this. Any gesture
  needing press-and-hold has to add one, and the panel's remote emitting `keyup`
  is assumed rather than measured.
