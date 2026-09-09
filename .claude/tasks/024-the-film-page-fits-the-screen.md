---
id: 024
slug: the-film-page-fits-the-screen
status: review
model: sonnet
env: laptop
branch: crew/024-the-film-page-fits-the-screen
files:
  - js/detail.js
  - js/app.js
  - css/detail.css
  - dev/smoke/detail.js
---

# The film page fills the screen, and Play stops being the biggest thing on it

## Goal
The film page uses the whole 1920, breathes, sizes its controls the way the
design does, offers **play from the start** when you are part way through, and
puts the extras in a row you step *down* to with only its top showing — the same
peek the rail uses.

## Why now
Five faults the user reported from the panel, recorded and then not acted on
while other work went ahead. They are things that are wrong now, which outrank
anything new.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing. Nothing else is
in flight; main verifies at 85/85.

The stylesheet and the smoke suite were split a few hours ago: iterate with
`npm run smoke -- detail` or `-- player` (seconds, not the full 2m37s), and the
mock takes an OS-assigned port so the task running beside you cannot clash.
`design/Mantis Screens.dc.html` is in the repo — read the numbers out of it.

## The five, and what is actually wrong

1. **`#dt-body` and `#dt-extras` are `width: 1000px`** on a 1920px screen. That
   was right when `#dt-art` occupied 1100px down the right-hand side; tasks 008
   and 014 replaced that with a full-width header and nobody widened the body.
   The cast and extras have been rendering into just over half the screen since.
2. **Spacing is cramped throughout.**
3. **Extras should be a row you navigate down to**, showing only its top until
   you reach it — the pattern the user already approved on the rail, where one
   row shows and the next peeks.
4. **`.dt-act.primary` is 280×88 while every other button is 88×88.** The user:
   *"the buttons are too big for play and everything else is too small."*
5. **There is no play-from-start.** Play resumes and that is the only action.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md`, `design/Mantis Screens.dc.html` and the
session that produced this task. Workers must not go digging for more.

- **The design is authored at 1920×1080** — `design/Mantis Screens.dc.html` has
  `.frame{width:1920px;height:1080px;transform:scale(.5)}`, so every pixel value
  in it is already in this app's coordinate system. **Do not scale anything.**
  Screen **6c** is this page. Read the numbers out of it rather than inventing
  them; that file is the reason the header came out right first time.
- The design's Play is `font: 500 27px Inter; padding: 17px 44px;
  border-radius: 999px` — a **pill sized by its content**, not a 280px slab —
  with a `400 20px` caption under it reading `from start`.
- **Margins are the one real inconsistency** task 020 found: 96px on the browse
  screen, 64px on the pages and the player. Two margin tokens exist for that
  reason. Making this page agree with the browse screen is probably most of
  fault 2.
- **Tokens live in `css/base.css`**: the palette, `--t-quick`/`--t-move`/
  `--ease`, and the radius, control-size and spacing tokens 020 added. Use them;
  do not add literals that disagree.
- **The rail's peek is the pattern for fault 3** — `#viewport` is
  `top: 500px; height: 580px` so one row shows whole and the next shows its
  label and a sliver. Whatever this page does should read the same way.
- **`js/detail.js` holds the action row** (Play, Trailer, Quality, Source,
  Audio, Subtitles) from 016, each button captioned with the current choice and
  Play's caption carrying the guard's verdict. `Detail.close()` moves the
  generation counter on so late metadata cannot redraw.
- **`js/app.js`'s `playChecked(item, verdict, isExtra, resumeAt, back, subLang)`
  already takes a resume position** — `resumeAt` in seconds. Play-from-start is
  that argument set to `0`, not a new route into `Player.play`.
- **Chromium 53**: no CSS Grid, no `position: sticky`, no `async`/`await`, no
  object spread. Animate only `transform` and `opacity`.
- **Assertions that pass on nothing** are this suite's recurring failure — five
  in one day (CLAUDE.md, Testing). A step asserting a width or a count needs to
  be seen failing before it is trusted passing.

## Constraints that bite here
- **Do not change what the buttons do.** 016 settled the choosers, the guard
  re-runs and the refusal wording. This is size, spacing and one new action.
- **Play from start must go through the guard like everything else** — it is the
  same verdict with `resumeAt` of 0, not a bypass.
- **The extras row must not strand the page.** If you can step down into extras,
  you must be able to step back up to the actions, and BACK must still leave.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no full
  stop, no attribution footers. The hook enforces it.

## Approach

1. **`css/detail.css` — take the width back.** `#dt-body` and `#dt-extras` to
   the full width less the page margin, matching screen 6c. Everything inside
   them — cast, extras, the description — re-flows to that width.

2. **`css/detail.css` — the spacing, from the design.** Read 6c's own values for
   the gaps between the kicker, title, chips, ratings, description and the
   action row, and between the sections below. Where the design and the current
   page disagree, the design wins, and the change is recorded in the task file.

3. **`css/detail.css` and `js/detail.js` — the controls.** Play becomes a pill
   sized by its content as the design has it (`27px` text, `17px 44px` padding,
   fully rounded) with its caption underneath; the round buttons grow to the
   design's size. They must stay one set of shared rules with the player's —
   the classes are already factored across `.dt-act-btn` and `.osd-btn` in
   `css/base.css`, so a size that belongs to both goes there, and only what is
   genuinely page-specific goes here.

4. **`js/detail.js` and `js/app.js` — play from the start.** When the item has a
   resume position, the action row offers **two** plays: `Play · resume at
   1:12` and `Play from start`. Both run the same `Guard.check`; the second
   passes `resumeAt` of 0 into `playChecked`. With no resume position there is
   one Play, captioned `from start`, exactly as the design shows.

5. **`js/detail.js` and `css/detail.css` — extras as a row you step down to.**
   Below the actions and the cast, the extras strip sits mostly below the fold,
   showing its label and the top of its cards. Down from the action row reaches
   it, up returns, left and right walk it, OK plays one. Use the rail's numbers
   so the peek reads the same, and the card treatment already in `css/base.css`.

6. **`dev/smoke/detail.js`** — extend, and make each step fail first:
   - The body and the extras strip are wider than 1600px on a 1920 viewport —
     run it against `main` and watch it fail at 1000.
   - Play is narrower than it is today and the round buttons are wider; assert
     the numbers, not merely that they differ.
   - A part-watched film offers both plays, and `Play from start` starts at 0 —
     assert the position the player receives, not just that something played.
   - Extras are below the fold until stepped into, and stepping down then up
     returns to the action row.

## Out of scope
- **The series page**, which has no design and is a separate question.
- **The player** — task 025 runs beside this one and owns `js/player.js`,
  `css/player.css` and `dev/smoke/player.js`.
- **`css/base.css`** beyond a shared control size that genuinely belongs to both
  screens — and if that is needed, say so in the task file, because 025 may want
  it too.
- **`index.html`.** If markup is genuinely needed, stop and say so rather than
  reaching for it — 025 may need it as well.
- **The choosers' behaviour**, the guard, and `js/menu.js`.

## Definition of done
- [ ] The film page's body and extras use the full width; nothing renders into
      half the screen.
- [ ] Spacing follows screen 6c, and the task file records where the design and
      the old page disagreed.
- [ ] Play is a content-sized pill and the round buttons are the design's size;
      the shared rules still serve both screens.
- [ ] A part-watched film offers **play from start**, and it starts at 0 through
      the ordinary guard.
- [ ] Extras are a row you step down to, showing only their top until reached,
      and stepping back up returns to the actions.
- [ ] Each new step was seen to fail before it was trusted to pass, and the task
      file says so.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## What changed

- `css/detail.css` — the page relaid out on 6c's numbers: `--sp-edge` margins,
  1728px body and extras strip, 6c's header sizes and gaps, Play as a
  content-sized pill, the cast and the extras placed absolutely so the design's
  order survives index.html's, and the extras as a peek that lifts on `.down`.
- `js/detail.js` — `resumeAt()`; a second primary action, `From start`, when
  there is something to resume; `start()` takes a position and passes it on;
  the `down` class follows the focus into the extras; the chooser anchors on 96.
- `js/app.js` — `onPlay` carries `resumeAt` through to `playChecked`, and the
  start position is traced.
- `dev/smoke/detail.js` — four steps: the width, the pill, the peek, and the
  two plays.

## Where the design and the old page disagreed

The design won everywhere below except three, each noted because the reviewer
will look for them:

- **The round buttons.** 6c draws them at 70px, which is *smaller* than the
  app's 88 — the approach said "grow to the design's size" but the design has
  no such size to grow to. Shrinking them would have made everything but Play
  smaller, which is the opposite of the reported fault, so `--c-btn` is
  untouched at 88 and only Play changed (280 → ~154 laid out, sized by its
  text). `css/base.css` was therefore not touched at all, which also keeps 025
  clear of it. **`--c-play` in base.css is now unused** — detail.css overrides
  the width — and is left for whoever next edits that file.
- **The cast disc** stays 120px rather than 6c's 88, for the same reason; its
  column took the design's 176px width so a two-word name has somewhere to go.
- **Extras cards** stay 240×135 rather than 236×133: a still is 16:9 and the
  existing numbers are exactly that. Their gap, title and label are 6c's.

Two things the design does not have to say anything about: the page keeps its
tagline and its names line, each given a 6c-sized gap; and the extras are a
peek rather than fully drawn, which is fault 3 and the user's instruction over
the design's layout.

Consequences worth knowing:

- The header is 200px taller, so the chooser no longer fits below the action
  row. It is anchored to the bottom edge instead (still along from the button
  that opened it), which is also how the player's menu sits.
- Stepping down into the extras fades the cast and the key hint out — the
  extras land where the cast is drawn, and the rail already dims the hero when
  you step down into it. Transform and opacity only.
- The hint moved to the right of the Extras label, because the bottom-left is
  where the extras now peek in.

## Fail-first

Every new step was run against the unfixed code first and watched fail:

- the width — `the body is 1000px and the extras strip 1000px wide`
- the pill — `Play is still 297px wide`
- the peek — `fully on screen at rest — it ends at 782`
- the two plays — `no play-from-start button on a part-watched film`

The pill step failed for a second reason on the first draft: it measured
`getBoundingClientRect`, which includes the focus scale, so the pill and an
unfocused round button could never have equal heights. It measures the laid-out
box now.

`npm run verify`: **89/89**, against 85/85 on main.

## Review rounds

## Graph writes proposed
