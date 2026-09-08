---
id: 020
slug: split-the-stylesheet
status: done
branch: crew/020-split-the-stylesheet
model: sonnet
env: laptop
files:
  - css/*
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

## One line hands off to the orchestrator (settled, not open)

`dev/smoke.js:2224` asserts `--ac === '#a79ce3'` — the *old* accent, in a step
called "the Mantis palette is what the stylesheet is serving". Step 4 of this
spec orders `--ac` to `#9d93d6`, so that assertion fails: **74/75, and the one
failure is the spec doing what it was told**. Every other step passes, and
`npm run check` and `npm test` are green.

Neither task could fix it: 019 owns `dev/smoke.js`, and its own spec forbids it
changing an assertion. **The orchestrator has taken it** — the constant is
applied at merge, in whichever file the step lands in after 019's split.

    dev/smoke.js:2224   '#a79ce3'  ->  '#9d93d6'

So the gate reads as passing but for that one known line, and the palette
correction stands exactly as specced. An accepted hand-off, not an open
question.

Worth keeping: 019 and 020 were cleared to run in parallel because their
`files:` lists do not overlap, which does not catch a token in one task's file
that a test in the other's asserts. When a spec changes a value, grep the suite
for the old one before deciding who owns which file.

## How the move was proved, and how to repeat it

Two throwaway scripts, both against `git show HEAD:css/app.css` and the
concatenation of the new files in `<link>` order. Worth re-running for any
future stylesheet split; neither needs anything installed.

1. **Nothing renders differently.** Strip comments from both sides, substitute
   every new token back to its literal (`var(--r-card)` → `16px`, and so on),
   drop the token declarations themselves, then parse each into
   `selector { decl; decl }` and diff the two *sorted* lists. Both sides came to
   204 rules, and what survived the diff was exactly the intended change: `--ac`,
   the gradient literals, and the five radii where `999px` renders identically to
   half the element's width. Anything else in that diff is a mistake.

2. **The cascade did not move.** Diff the *unsorted* selector lists. Reading the
   git diff cannot answer "does a rule now win that used to lose"; this can. The
   output is the three groups that moved — the shared rules up into base, detail
   ahead of show, screens down past player — and each was then walked for a
   same-element, same-property, equal-specificity pair. `.msg-hint`/`.dt-hint` is
   the only one in the app, which is what fixes screens.css last in the order.

## What changed, per file

- `css/app.css` — gone. Every rule moved verbatim; 204 rules before, 204 after,
  and a token-resolved diff of the two shows only the intended differences.
- `css/base.css` — the header, `:root` (palette, timings and the new shape,
  control and margin tokens), the reset, `.view`/`.centre`, `.pill`, `.badge`,
  `.chip`, the round-button rules `.dt-act-btn`/`.osd-btn` share, the `.menu-*`
  shell and `#confirm`.
- `css/browse.css` — hero and its two scrims, masthead in both states, the
  search pill's position, the sidebar, the rail and its tiles.
- `css/detail.css` — the film page: art and shade, the header lines, the action
  row's own columns, `#dt-menu`, extras, cast, the hint.
- `css/show.css` — the series page, the episode list, the recaps strip and
  `#recap`.
- `css/player.css` — video, OSD and trackbar, chapter rail, skip, up next,
  subtitles and `#menu`.
- `css/screens.css` — link, search, devices, message, toast, debug.
- `index.html` — six `<link>` tags in place of one, with the order's reason.
- `tools/check-es5.js` — the js/-must-be-in-index.html rule now runs for `css/`
  too, through one `loaded()` helper serving both. Verified in both directions:
  an unlinked stylesheet and a link to a missing file each fail the check.

## The link order, and why

    base · browse · detail · show · player · screens

- **base first** — it is the only file the others depend on. `:root`, and the
  shared classes a screen may want to override.
- **screens last** is load-bearing, not tidiness. `.msg-hint` and `.dt-hint`
  both style the film page's hint element with equal specificity, and in
  `app.css` `.msg-hint` came later and won — so `.dt-hint`'s `margin-top: 0` was
  already dead. screens.css after detail.css keeps that exactly as it was.
- **browse · detail · show · player** between them is free: their selectors are
  disjoint. Every cross-screen rule that could tie is in base (which is earlier,
  so overriding it still works) or is id-qualified (`#dt-menu .menu-list`,
  `#menu .menu-list`, `#confirm .menu-list`), which wins on specificity whatever
  the order.

Checked, not assumed: the rule order was diffed before and after, and each of
the three groups that moved was walked for a same-element, same-property,
equal-specificity pair. `.msg-hint`/`.dt-hint` is the only one in the app.

## The tokens, and where the design and the app disagree

Added to `:root`: `--r-pill/-card/-panel/-tag/-badge`, `--c-btn/-play/-ctl`,
`--sp-edge/-page`. They carry the app's current values, because "nothing may
look different" is a Definition-of-done line and "the design wins" is not. What
the design says instead is recorded here, which is where the three queued UI
tasks will want it:

- **The literals did not in fact disagree.** The premise in "Why now" — that
  radius and control sizes had drifted between the rail, the film page and the
  player — did not survive contact: cards were already 16px in all five places,
  tags 6px in six, panels 8px in four, badges 4px in three, and the round button
  is one rule serving both screens. The tokens name what was already true. The
  one real inconsistency is **margins**: browse sits at 96px, the film page, the
  show page and the player at 64px, and `#osd-skip`/`#upnext` at 96px inside a
  player that is otherwise at 64px. Hence two tokens rather than a scale.
- **The design puts every screen at 96px** (`padding:0 96px`, `left:96px`,
  including the player's trackbar). Moving `--sp-page` to 96 is now a one-line
  change, and belongs to the film-page and player tasks.
- **The design's cards scale their corner with their size** — 28px on a 209px
  card, 20px on a 151px one, 16px on a 133px one — so there is no single card
  radius to take from it. 16px is kept.
- **The design's round buttons are 76–104px and its icon buttons 64px**, where
  the app has one 88px button on both screens. Kept at 88; the player's layout
  task owns it.
- **The design's panels are the scrim, not the ground**: `--sc94` is
  `rgba(9,11,12,.94)`, where the app's four panels and two timecode tags are
  `rgba(22,24,38,.94/.78)` — the same "flat because it is the background" fault
  as the scrims, and out of scope here (step 4 names the gradients only). Six
  literals remain, listed by `grep -n "22, 24, 38" css/*.css`.
- **`.sh-recap-thumb` keeps a 12px literal**, with a comment: it is `--r-card`
  less the 4px its card pads it by, so the two corners nest. A token for it
  would be a token for one rule.
- **Card gaps are not tokenised on purpose.** `js/player.js` has
  `CARD_W = 260` (240 + the 20px margin) and `js/showpage.js` sizes its pool
  "at 222px each" (208 + 14). The CSS margin and a JS constant have to agree,
  and `js/` is outside this task's `files:`. Changing a gap here would desync
  the two silently. Worth fixing properly — the stride should be measured, not
  written twice — and it is a backlog item, not this task.

## What looked wrong while moving it

- `.dt-hint { margin-top: 0 }` is dead, and has been since it was written:
  `.msg-hint` ties on specificity and comes later. Harmless — the element is
  absolutely positioned with `bottom`, so `margin-top` does not move it — and
  left exactly as it was rather than "fixed" into a change of behaviour.
- The three verdict badge colours are still literals, as documented.
- **Step 4 says six gradient literals; there are ten**, in eight lines: the
  `-webkit-` and standard forms are written out twice each, and `#hero-scrim-x`
  carries two stops. Five logical stops across four rules. All ten changed, each
  alpha untouched. Worth knowing that four of the five are `alpha: 0`, and
  Chromium interpolates gradients premultiplied, so a fully transparent stop's
  colour has no effect — only `#hero-scrim-x`'s `.74` stop actually changes what
  is on screen. The other four are correctness for the next person to read them.
- **`files:` said `css/`, which `scope-check.js` cannot read.** It matches an
  exact path or a trailing `*`, so `css/` matched nothing and every new file
  read as scope creep. Amended to `css/*`, which passes. 019's spec has the same
  shape (`dev/smoke/`) and will hit it too — the durable fix is one line in
  `scope-check.js`'s `match()`, treating a trailing `/` as a prefix, and that
  file belongs to neither task.

## For CLAUDE.md, at close (step 7 — not edited here, 019 owns the file)

Under **Layout**, replace "No bundler. Each file is one global…" with a note
that `index.html`'s two lists are both dependency graphs — the scripts and now
the stylesheets — and add, before the settings list:

> Screen:
>
> - `css/base.css` — the tokens (palette, timings, radius, control sizes,
>   margins) and the parts more than one screen draws with: the reset, the
>   badge, the pill, the chip, the round button the film page and the player
>   share, and the menu shell. Loaded first, so a screen file can override it.
> - `css/browse.css`, `css/detail.css`, `css/show.css`, `css/player.css` — one
>   per screen, holding only what that screen draws.
> - `css/screens.css` — link, search, devices, message, toast and debug.
>   **Loaded last on purpose**: `.msg-hint` has to keep beating `.dt-hint`.
>
> A UI task now declares its own screen's stylesheet, not `css/`. Two of them
> can run at once.

`npm run check` fails if a file in `css/` is not linked from `index.html`, the
same way it does for `js/` — worth a line beside the existing one under
**Testing**.

## Review rounds

**Round 1 — PASS** (crew-reviewer). Verified independently: the move is verbatim
(token-resolved rule diff shows only the intended changes), the link order and
its `.msg-hint`/`.dt-hint` reason hold, both palette corrections are complete
and correctly scoped (ten literals across eight lines; the panel and tag
backgrounds rightly untouched), the tokens change nothing that renders,
`check-es5.js` reuses one `loaded()` helper for both `js/` and `css/` with both
failure directions confirmed, and scope and commit conventions are respected.
The `dev/smoke.js` constant was not re-raised — it is the orchestrator's.

## Graph writes proposed

- **Decision — one stylesheet per screen, cascade order fixed in index.html.**
  `css/app.css` split into `base.css` plus one file per screen, so two UI tasks
  can run in parallel. The order in `index.html` is the cascade: base first
  because everything depends on it, `screens.css` last because `.msg-hint` ties
  with `.dt-hint` and must keep winning. Supersedes nothing; enables the palette,
  film-page and player tasks to run beside each other.
- **Pattern — prove a stylesheet move by resolving the tokens and diffing the
  rules.** Splitting a stylesheet is only safe if you can show nothing changed.
  Parse both the old file and the concatenation of the new ones into
  selector-plus-declarations, substitute each new token back to its literal, and
  diff: what survives is exactly the intended change. Diff the *unsorted*
  selector list too — that is what shows whether the cascade moved. Both are ten
  lines of Python and they caught the real question (does any rule now win that
  used to lose?) that reading the diff cannot answer.
- **Pattern — a CSS length that a JS constant also knows is not a token
  candidate.** `js/player.js`'s `CARD_W = 260` is `.osd-chap`'s 240px plus its
  20px margin, written twice in two languages. Tokenising the margin without
  touching `js/` desyncs the rail's scrolling silently. The tell is a comment
  like "at 222px each" next to a pool size.
- **Gotcha — `scope-check.js` does not understand a directory in `files:`.**
  It matches an exact path or a trailing `*`. `css/` and `dev/smoke/` both match
  nothing, so every file under them reads as scope creep. Write `css/*` in a
  spec until `match()` learns the trailing slash.
- **Gotcha — a smoke assertion can hold the value a later task is told to
  change.** `dev/smoke.js` asserted `--ac === '#a79ce3'`, which is exactly what
  020 was specified to correct, in a file 020 was forbidden to touch. Two
  parallel specs, each embargoing the other's file, and one constant that
  belongs to both. When a spec changes a value, grep the test suite for the old
  one before deciding who owns which file.
