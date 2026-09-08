---
id: 013
slug: palette-and-motion
status: building
branch: crew/013-palette-and-motion
model: sonnet
env: laptop
files:
  - css/app.css
  - index.html
  - js/masthead.js
  - dev/smoke.js
---

# The Mantis palette, and motion that does not jar

## Goal
The app changes from ink-and-citron to the Mantis palette — a violet accent on a
bluer ground, with amber as the second colour. The hero backdrop **crossfades**
instead of cutting, and the rail's movements share one set of timings so that
stepping between rows reads as one motion rather than three.

## Why now
The user is redesigning the app in Claude Design and this is the part of that
redesign a screenshot carries losslessly. And the motion is the thing they hit
on every keypress: "the rails move around a lot which is jarring", and the hero
picture hard-swaps.

Both are `css/app.css` work, which is why they are one task. Every UI task
serialises on that file, so splitting small style work costs a whole extra
round for nothing.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching `css/app.css`, `index.html`, `js/masthead.js` or
`dev/smoke.js`. No worktrees are in flight; 012 merged as `c0ad5e5`.

Read these as they now are:

- `css/app.css` gained a `#recap` overlay and a `#sh-recaps` strip from 012.
  Both need the palette applied like everything else, and 012's cards are
  **16px** radius — matching the rail's tiles, which is the number to keep.
- `index.html` gained the `#recap` overlay markup.
- `dev/smoke.js` is at 59 steps, seven of them about recaps. The backdrop steps
  it already has are the ones that must be adapted to two hero layers.
- `CLAUDE.md` now records that `Array.prototype.sort` is not stable before
  Chrome 70. Nothing in this task sorts, but do not add one that assumes it.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **The palette is evidence, not taste.** It was measured off the user's own
  design screenshots by counting saturated pixels, and is recorded in
  `docs/decisions.md` under "The Mantis palette, taken from screenshots rather
  than source". Use exactly these values; do not improve them.
- **Every colour already comes from `:root`.** That is a rule the stylesheet has
  kept, and it is why this is cheap. There are exactly two kinds of exception,
  both of which must be updated by hand:
  - the two hero gradients, which spell `--bg` out as `rgba(12, 15, 22, …)`
    because a gradient stop needs a real colour with an alpha channel and
    `color-mix()` is Chrome 111;
  - the three verdict badge colours (`.badge.good/.warn/.bad`), which are
    literal greens, ambers and reds.
  Search for `rgba(` and for `#` in `css/app.css` and make sure nothing else has
  crept in.
- **Animate only `transform` and `opacity`** (CLAUDE.md). No shadow, filter or
  blur transitions — they force layout and paint on a 2018 SoC. A crossfade of
  two stacked layers is opacity only, which is why it is affordable where a
  blur is not.
- **CSS custom properties work** (Chrome 49), including inside a `transition`
  shorthand. CSS Grid, `position: sticky` and `color-mix()` do not.
- **`Masthead.art(item)` already debounces** on 280ms of stillness and
  short-circuits when the URL has not changed (`lastArt`), so sweeping a row
  costs one full-screen transcode rather than one per key. That behaviour stays
  exactly as it is; only the painting changes.
- **The rail already has transitions**: `#rows` 340ms
  `cubic-bezier(.2,.7,.2,1)`, `.strip` 180ms ease-out, `.tile-inner` 180ms
  ease-out, `#sidebar` 180ms. The jarring is not missing transitions — it is
  that they disagree, and that with `ROWS_FIT` at 1 every down-press scrolls a
  whole 466px row.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16).

## Constraints that bite here
- **No CSS Grid, no `position: sticky`, no `color-mix()`.** `npm run check`
  scans `css/` for these.
- **No `async`/`await`, no object spread, no `Object.entries`** in `js/`.
- **The crossfade must not double the work.** Two layers exist; only one holds a
  picture at a time plus the one fading out. Do not keep a stack of layers.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`css/app.css` — the palette.** Replace the `:root` block's values:
   ```
   --bg:      #161826
   --surface: #1f2233
   --raised:  #252839
   --ac:      #a79ce3      /* violet, hue 249° */
   --ac2:     #e5a06d      /* amber, hue 25° */
   ```
   `--fg`, `--dim`, `--dim2` and `--soft` are all derived from `#eef0f2` with
   alpha and stay as they are. Update the comment above the block: it says
   "Palette 5a, ink & citron", which will no longer be true.

2. **`css/app.css` — the two gradients.** `#hero-scrim-x` and `#hero-scrim-y`
   spell the background out as `rgba(12, 15, 22, …)`. That is the *old* `--bg`.
   Change every one of those literals to `rgba(22, 24, 38, …)`, keeping each
   alpha exactly as it is — the stop positions were tuned against the rail and
   must not move. Both the `-webkit-` and the standard declaration.

3. **`css/app.css` — the verdict badges.** `.badge.good`, `.badge.warn` and
   `.badge.bad` are literal colours chosen against the old, darker, greener
   ground. Re-pick them against `#161826` so they still read as
   good / caution / refused, keeping the same shape (a dark tinted fill with a
   light tinted text). These are the only three colours in the file allowed to
   be literals, and they must stay legible: they are the playback verdict.

4. **`css/app.css` — one set of timings.** Add three custom properties on
   `:root` and use them everywhere a transition is declared:
   ```
   --t-quick: 180ms;   /* a tile lifting, a strip sliding */
   --t-move:  340ms;   /* a row change, the hero collapsing */
   --ease:    cubic-bezier(.2, .7, .2, 1);
   ```
   Replace the hand-written durations and easings in `#rows`, `.strip`,
   `.tile-inner`, `#sidebar`, `#sidebar-list`, `#menu-inner`, `#hero-art` and
   the scrims. **`.strip` moves to `--t-move` and `--ease`**: it is the same
   gesture as a row change and currently disagrees with it, which is the
   specific thing that reads as jarring when both happen at once.

5. **`index.html` and `js/masthead.js` — crossfade the backdrop.** `#hero-art`
   becomes two stacked layers, `#hero-art-a` and `#hero-art-b`, identical in
   every way and both transitioning `opacity` over `--t-move`:
   - `paintArt` writes the new picture into whichever layer is *not* showing,
     then swaps their opacities. Keep the existing `lastArt` short-circuit, so
     an unchanged URL still costs nothing.
   - Wait for the new layer's image to have loaded before swapping, or the fade
     reveals an empty box: preload with `new Image()` and swap in its `onload`,
     falling back to swapping anyway on `onerror` so a broken URL cannot leave
     the old picture up for ever.
   - The `dense` rule that drops the backdrop to `opacity: .5` now has to apply
     to whichever layer is showing. Keep that working — the simplest way is a
     wrapper element that carries the dense opacity while the two layers inside
     carry the crossfade, so the two concerns never fight over one property.
   - Anything else that reads `#hero-art` must be updated with it. `dev/smoke.js`
     does, in the backdrop steps.

6. **`dev/smoke.js`** — extend:
   - Both hero layers exist, and after moving along a row the picture that is
     showing is the focused item's — the existing "hero art is the focused item"
     steps must keep passing, adapted to whichever layer is visible.
   - Stepping into the rows still leaves the backdrop visible (the `dense`
     opacity), which is 008's behaviour and must not be broken by the wrapper.
   - A step asserting the palette landed: the computed `--ac` is the new violet.
     Cheap, and it catches a half-applied swap.

## Out of scope
- **Any layout change.** No element moves, resizes or is added except the
  second hero layer and its wrapper. The rail geometry, the 320px header, the
  portrait tiles and the type scale are all settled and are not this task.
- **The browse screen, detail page and player redesigns** — 014, 015 and 016.
  This lays the palette they will build on; it does not start them.
- **New transitions on anything that has none.** Adding motion is not the job;
  making the motion that exists agree is.
- **`js/rail.js`, `js/browse.js`, `js/player.js`, `js/detail.js`,
  `js/showpage.js`.** None of them need to change for this.
- Touching `Masthead.art`'s 280ms debounce or the `lastArt` short-circuit.

## Definition of done
- [ ] The app uses the Mantis palette, and `grep` finds no colour literal in
      `css/app.css` outside `:root`, the two hero gradients and the three
      verdict badges.
- [ ] The verdict badges still read as good / caution / refused against the new
      background.
- [ ] The hero backdrop crossfades rather than cutting, and never fades to an
      empty box while an image is still loading.
- [ ] An unchanged backdrop URL still repaints nothing.
- [ ] Stepping into the rows still leaves the backdrop visible at reduced
      opacity.
- [ ] Every transition in `css/app.css` uses the shared timing properties, and
      a row change and a strip slide take the same time with the same easing.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
