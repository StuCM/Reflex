---
id: 020
slug: split-the-stylesheet
status: building
branch: crew/020-split-the-stylesheet
model: sonnet
env: laptop
files:
  - css/
  - index.html
  - tools/check-es5.js
---

# One stylesheet per screen, and the tokens they share

## Goal
`css/app.css` becomes `css/base.css` plus one file per screen. Nothing looks
different afterwards — this is a move. What changes is that two UI tasks can
finally run at once, because they stop contending on a single 944-line file.

## Why now
Every UI task this session has declared `css/app.css`, so none could run beside
another even when they shared no logic at all: the palette, the film page, the
player and the browse screen were serialised purely by a stylesheet. Three more
UI tasks are queued behind it right now — the palette correction, the film page
and the player. Splitting once costs less than serialising those three.

It is also the moment to give the app the **design language** the user asked
for: radius, control sizes and spacing as tokens, read from
`design/Mantis Screens.dc.html`, so "the same radius" is one number rather than
a habit that has already drifted between the rail, the film page and the player.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing. 018 merged as
`f10d70a`; main verifies at 75/75.

`css/app.css` is 944 lines. Task 019 runs beside this one and owns
`dev/smoke.js`, `dev/smoke/` and `package.json` — do not touch them, and do not
add or move a smoke step.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `docs/backlog.md`, `CLAUDE.md` and the session that
produced this task. Workers must not go digging for more.

- **The design is authored at 1920×1080.** `design/Mantis Screens.dc.html` has
  `.frame{width:1920px;height:1080px;transform:scale(.5)}` — the canvas merely
  displays it at half size. Every pixel value in that file is already in the
  app's coordinate system. **Do not scale anything.**
- **The palette is `blurple-apricot`**, one of seven the design file carries as
  data: `bg #161826`, `tile #1f2233`, `ac #9d93d6`, `ac2 #e5a06d`,
  `scrim 9,10,17`. Two things in the app are currently wrong and this task
  fixes them: `--ac` is `#a79ce3` and should be `#9d93d6`, and the six
  hero-gradient literals fade to `rgba(22,24,38,…)` — the background itself —
  where the design fades to the darker `rgba(9,10,17,…)`.
- **Every colour comes from `:root`**, with two documented exceptions: the
  gradients, which spell a colour out as `rgba()` because a stop needs an alpha
  channel and `color-mix()` is Chrome 111; and the three verdict badges. Keep
  that rule, and keep it true after the split.
- **Timings are already tokens**: `--t-quick` 180ms, `--t-move` 340ms,
  `--t-fade` 620ms (hero layers only), `--ease`.
- **`tools/check-es5.js` scans `css/` and `js/`** and fails if a file in `js/`
  is missing from `index.html`'s script list. It currently reports "1
  stylesheets".
- **Chromium 53**: no CSS Grid, no `position: sticky`, no `color-mix()`.
  Animate only `transform` and `opacity`.
- **Do not use `@import`.** It serialises loading; several `<link>` tags in
  `index.html` do not.

## Constraints that bite here
- **Nothing may look different**, except the two palette corrections named
  above. This is a move plus two values. If a rule looks wrong while you are
  moving it, record it in the task file — do not fix it here.
- **The cascade must be preserved.** Order the `<link>` tags so that later files
  override earlier ones exactly as they do inside one file today. Where two
  rules currently rely on source order across what will become two files, say so
  rather than silently reordering.
- **Comments**: the existing prose comments explain *why* a rule is the way it
  is — several record real bugs. Move them with their rules; do not summarise.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`css/base.css`** — the reset, `html`/`body`, `.view`, `.centre`, the
   `:root` block, and the rules genuinely shared across screens: `.badge`,
   the round-button rules serving `.dt-act-btn` and `.osd-btn`, the `.menu-*`
   classes both hosts draw with, `.chip`, `.pill`, and the card treatment the
   rail, extras, chapters and recaps all use.

2. **The screen files**, each holding only what its screen draws:
   - `css/browse.css` — hero and its layers, masthead in both states, the rail,
     the sidebar
   - `css/detail.css` — the film page
   - `css/show.css` — the series page and the recaps strip
   - `css/player.css` — OSD, controls, chapter rail, subtitles, up-next, the
     recap overlay
   - `css/screens.css` — link, search, devices, message, toast, debug

3. **The design tokens the user asked for.** Read them out of
   `design/Mantis Screens.dc.html` — it is authored at 1920, so the numbers are
   literal — and add them to `:root` in `base.css` beside the palette and the
   timings:
   - a radius scale, named for what it is on (`--r-card`, `--r-panel`,
     `--r-pill`), taken from the design rather than invented
   - the control sizes the design uses for the round buttons and the primary
     action
   - a spacing scale
   Then **use them** in the rules you are moving, replacing the literals that
   currently disagree between the rail, the film page and the player. Where the
   design and the current app disagree, the design wins and the change is
   recorded in the task file.

4. **The two palette corrections**: `--ac` to `#9d93d6`, and every one of the
   six gradient literals from `rgba(22,24,38,…)` to `rgba(9,10,17,…)` with each
   alpha untouched. Grep for the literal; there were six last time and a spec
   that said two was wrong.

5. **`index.html`** — one `<link>` per file, `base.css` first, in an order the
   task file records and justifies.

6. **`tools/check-es5.js`** — mirror the rule it already applies to `js/`: fail
   if a file in `css/` is not linked from `index.html`. The split creates
   exactly the failure mode that rule exists to prevent.

7. **Do not edit `CLAUDE.md` or the worker role.** 019 is running beside this
   task and would collide on both. Instead, write into the task file what those
   documents need to say — the new layout, and that a task now declares one
   screen's stylesheet rather than the whole `css/` directory — and the
   orchestrator will apply it at close.

## Out of scope
- **Any visual change** beyond the two palette corrections in step 4.
- **The film page and player layout fixes** — cramped spacing, the 1000px body,
  button sizes, extras as a peeking row. Those are their own tasks and are
  *easier* after this one; do not start them.
- **Splitting `dev/smoke.js`** — that is 019.
- **Splitting the large `js/` files** — backlog.
- **A bundler, or `@import`.**

## Definition of done
- [ ] `css/app.css` is gone, replaced by `base.css` and one file per screen,
      each linked from `index.html` in a justified order.
- [ ] The app looks identical, save `--ac` now `#9d93d6` and the scrims fading
      to `rgba(9,10,17,…)`.
- [ ] Radius, control size and spacing are tokens in `:root`, taken from the
      design file, and the rules that had disagreeing literals now use them.
- [ ] Every colour still comes from `:root` bar the gradients and the three
      verdict badges.
- [ ] `npm run check` fails if a `css/` file is not linked from `index.html`.
- [ ] `npm run verify` passes with the same step count as before.
- [ ] The task file records the link order and why, and anything that looked
      wrong while being moved.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
