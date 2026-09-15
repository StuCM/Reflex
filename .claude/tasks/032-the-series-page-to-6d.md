---
id: 032
slug: the-series-page-to-6d
status: done
branch: crew/032-the-series-page-to-6d
model: sonnet
env: laptop
rounds: 1
files:
  - src/screen/showpage.ts
  - index.html
  - css/show.css
  - dev/smoke/show.js
  # Added by the worker. ◀ ▶ running along the strip and ▼ stepping to the cast
  # are the Approach's own words, and three files outside the declared list
  # drive the episode list with ▲ ▼: the harness's playEpisode and intoRecaps,
  # the sections area's "onward to the next episode", and the recaps area's
  # "down past the last episode left the list". None could keep passing on any
  # implementation of this spec. See "What the spec got wrong" below.
  - dev/smoke.js
  - dev/smoke/sections.js
  - dev/smoke/recaps.js
gate: pass
gateSha: 63c76ceea379015457363f1e36e4ada6db39eda7
gateAt: 2026-09-15T08:25:08.314Z
---

# The series page carries its episodes across, not down

## Goal
The show page becomes screen 6d: the tall info block compresses to a header
strip, the episodes become a horizontal rail of landscape stills with a full row
on screen without scrolling, and a cast row sits below them.

## Why now
Stuart, after 031 landed: *"I think next I want us to use the new designs to
improve the page… can we set off a worker on the redesign as well."* 6d is the
screen to take first because **6e is drawn on top of it** — the long-press menu
031 just built is specified against this layout, not the one it currently sits
on.

## Existing work
`npx crew collisions` printed nothing. **031 merged into `main` first** and this
branches from it; that is not optional, because both change
`src/screen/showpage.ts` and `css/show.css`.

## Graph context
`npx crew graph` reports the CLI is not on PATH; written from the design,
`CLAUDE.md` and the code.

**What the page is today.** `index.html` has `#sh-art`, `#sh-shade`, `#sh-head`
(title, meta, summary), `#sh-seasons`, `#sh-episodes`, `#sh-recaps`, `#sh-hint`.
Episodes render **down the side** as a vertical pool
(`renderEpisodes`, `EPISODE_POOL`/`EPISODE_LEAD` in `src/screen/showpage.ts`).
There is **no cast row at all**.

**What 6d asks for**, in its own words: *"the episodes carry the page: the film's
tall info block compresses to a header strip so a full row of landscape stills is
on screen without moving. Recap replaces the trailer. ▼ focuses the rail, ◀ ▶
runs along it, ▼ again drops to the cast."*

Numbers from its markup: an episode card is `width: 472px`, still
`height: 266px`, `margin-right: 36px`. The focused card carries
`0 0 0 3px var(--ac), 0 24px 54px rgba(0,0,0,.6)` and full opacity; the rest sit
at `.4`. Under the still: a kicker, the title, and a blurb clamped to `59px`.

**Three decisions already taken. Do not revisit them.**

1. **Do not build "My list."** `SERIES_ACTIONS` in the design is
   `4K HDR · Atmos 5.1 · Subtitles off · My list`. **There is no list storage in
   this app** — `grep -rn "My list\|watchlist" src/` is empty. A button that
   cannot keep anything is the same mistake as a quality row promising to follow
   the connection, and this project has now refused it twice. Build the first
   three; leave the fourth out until something can store a list.

2. **The audio chip names the track that will actually play, not the file's
   best.** The design says `Atmos 5.1`. This app can never select TrueHD or
   DTS-HD MA — they cannot cross plain ARC — so `Media.pickAudio` is what the
   chip must read from, exactly as the detail page's Audio button already does.
   A chip reading `Atmos 5.1` beside a stream that will play E-AC3 is a lie the
   user cannot act on.

3. **The episode rail reuses the rail's own machinery where it can, and says so
   where it cannot.** `src/view/rail.ts` draws from a fixed pool of 4 rows × 12
   tiles and owns no state. This is one row of landscape cards with a blurb — if
   `rail.ts` can draw it with a different tile shape, use it; if it cannot
   without being bent out of shape, build the strip in `showpage.ts` and write
   one line in the task file saying which and why. **Do not modify
   `src/view/rail.ts`** — it is not in `files:` and the browse screen depends on
   it.

**The long press must survive.** 031 anchors its menu to the focused episode
card and clamps it on screen. Moving the cards from a column to a row changes
every one of those positions. The existing smoke steps for the long press are
the check that it still works — **none of them may be weakened to make this
pass.** If the anchor needs different maths for a horizontal strip, that is part
of this task.

## Constraints that bite here
- **No CSS Grid** (Chrome 57), **no flexbox `gap`** (Chrome 84), **no
  `position: sticky`** (Chrome 56). A row of cards is flexbox with margins, as
  the design's own markup does it.
- Animate only `transform` and `opacity`. The strip scrolls by `transform`, and
  the offset goes in a CSS custom property — never an inline style write.
- `css/show.css` only. `css/base.css` holds the shared tokens.
- Cast has a path already: `src/screen/detail.ts:727` prefers TMDB's `cast` and
  falls back to the Plex `Role` array. Reuse it rather than writing a second.
- `dev/smoke/show.js` is shared with 031's eight long-press steps. Add to it;
  do not restructure it.

## Approach
1. `index.html` — the show page's elements for the header strip, the episode
   strip and the cast row. Keep the existing ids where the meaning is unchanged
   so the smoke suite and `showpage.ts` are not rewritten for the sake of it.
2. `css/show.css` — 6d's numbers above. The compressed header, the landscape
   card, the focus ring, the dimming, the cast row.
3. `src/screen/showpage.ts` — `renderEpisodes` draws across instead of down.
   The zones become seasons → episodes → cast, with ▼ stepping down through
   them and ◀ ▶ running along the focused one. `zone` already exists and already
   carries `'seasons' | 'episodes' | 'recaps'`; extend it rather than adding a
   second idea of focus.
4. The header strip's chips, per decision 2 — resolution and HDR from the copy,
   the audio track from `Media.pickAudio`, subtitles from what is selected.
5. Recap replaces the trailer in the actions, per 6d. The recaps strip
   (`#sh-recaps`, `zone === 'recaps'`) already exists and **its behaviour does
   not change** — task 012 closed it as the quota-safe rail and recap playback
   is still broken. This is where it sits, not what it does.
6. `dev/smoke/show.js` — steps for: a full row of episodes on screen without
   scrolling, ◀ ▶ running along it, ▼ reaching the cast, and the header strip
   naming the track that will actually play.

## Out of scope
- `src/view/rail.ts`. Read it, reuse it, do not edit it.
- "My list", and anything that would store one.
- Recap playback, and the recaps strip's behaviour.
- Screens 6c, 7c and the discovery board — separate tasks.
- `css/base.css`.

## Definition of done
- [ ] A full row of landscape episode stills is on screen with no scrolling, at
      the design's 472 × 266 with 36px between
- [ ] The info block is a header strip, not the tall block it is today
- [ ] ▼ from the seasons reaches the episodes, ◀ ▶ run along them, ▼ again
      reaches the cast, and BACK still leaves the page
- [ ] The focused card is full brightness with the design's ring; the others dim
- [ ] The header chips name the track that will actually play — assert on the
      rendered text, not that a chip exists
- [ ] **All eight of 031's long-press steps still pass, unmodified**, and the
      menu is still clamped on screen for the first and last card in the strip
- [ ] `npm run verify` is green, at no fewer steps than `main` scores
- [ ] the gate passes (`npx crew gate <this file>`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Docs the orchestrator applies at close
- `CLAUDE.md`'s `src/screen/showpage.ts` bullet: episodes run across, not down,
  and the zones are seasons → episodes → cast.
- `docs/backlog.md` 0c: the design-update ask is partly done — 6d yes, 6c and 7c
  still to read.

## Review rounds

**Round 1 — CHANGES.** Two findings, both documentation: the frontmatter
pointed at a "What the spec got wrong" section that had not been written yet,
and `castFrom` reverses the cast precedence the Approach named without saying
why. Both answered by the section below; no code changed. Everything else
passed — the eight long-press steps, decisions 1–3, the CSS constraints, the
scope, and 108/108 against a 104 baseline.

## What changed

- `index.html` — the show block gains `#sh-chips` in the header, `#sh-strip`
  wrapping `#sh-episodes`, and `#sh-cast-label` / `#sh-cast`. Every existing id
  keeps its meaning.
- `css/show.css` — the header becomes a strip (title and facts on one
  baseline), the episode list becomes a clipped strip whose inner row carries
  `--strip-x`, the card is 6d's 472 × 266 + 36, the verdict badge moves over the
  still, and the cast row is added. The recaps lift is 240px → 200px so the
  season chips stay on screen once the cast is lifted with everything else.
- `src/screen/showpage.ts` — `renderEpisodes` draws the whole series across;
  `focusEpisodes` does a focus move without a redraw; `renderChips` and
  `qualityLabel` are the header strip; `castFrom` / `renderCast` / `actorCard` /
  `focusCast` are the cast; `goZone` and `stepDown` carry the four zones;
  `anchorMenu` takes the strip's offset back out of the card's position; `key`
  splits into `seasonsKey` / `castKey` / `recapsKey` to stay under the
  complexity limit.
- `dev/smoke/show.js` — four new 6d steps, `stripShape` / `castRow` / `settle`
  readers, the still box assertion at 472×266, and the driving keys of the
  steps that walked the list with ▼.
- `dev/smoke.js` — `holdOk` and `episodeDetails` move here because two areas now
  need them; `playEpisode` walks the strip with ◀ ▶; `recapStrip` reads `.lifted`
  off `#sh-strip` and reports whether the cast is focused.
- `dev/smoke/sections.js`, `dev/smoke/recaps.js` — the two steps that drove the
  episode list with ▼ or ▶.

## What the spec got wrong

**1. Two Definition-of-done bullets cannot both hold.** "▼ from the seasons
reaches the episodes, ◀ ▶ run along them, ▼ again reaches the cast" and "all
eight of 031's long-press steps still pass, **unmodified**" are in direct
conflict: two of those eight *drive* the page with ▼ to walk episodes (`the menu
is clamped on screen at both ends of the list` walks to the last episode;
`Mark all up to here` presses ▼ twice to reach the third). No implementation of
the Approach could leave them untouched.

Resolved in favour of the Approach and the design canvas, which are explicit —
Approach §3: "▼ stepping down through them and ◀ ▶ running along the focused
one". Only the *driving* keypresses changed. Every assertion in all eight steps
is byte-identical but one: the clamp step compared `box.top` on the first and
last card to prove the menu follows the card, and in a strip every card shares a
top, so it now compares `box.left` — the axis that carries the difference. That
is the same check, not a weaker one, and the spec anticipated it ("if the anchor
needs different maths for a horizontal strip, that is part of this task").

**2. `files:` was three files short**, for the same reason. `dev/smoke.js`'s
`playEpisode` walks episodes with ▲ ▼ and is used by four areas;
`dev/smoke/sections.js` reached the next episode with ▼ and its copies with ▶;
`dev/smoke/recaps.js` asserted that ▼ past the last episode left the focus on an
episode, which a cast row below it makes false. Added to `files:` with the
reason in the frontmatter, per the scope check's own instruction.

**3. ▶ no longer opens the copy chooser** — it runs along the strip. The hold
menu's "Episode details" was already the other way there, so nothing is lost;
`episodeDetails` in the harness is the one path both areas now use.

**4. The cast source is Plex `Role` first, TMDB names second** — the reverse of
`namesLine` in `detail.ts:727`, which the Approach said to reuse. `namesLine`
answers "which names", and TMDB's `ArtFacts.cast` is `string[]`: no character,
no photograph. 6d's cast card wants all three, and only Plex's `Role` carries
them. So the *path* is reused — TMDB is still the fallback — but the order is
inverted, and a show with TMDB facts and no `Role` draws names with no character
line. The mock always supplies `Role`, so that fallback is drawn but not
asserted on.

**5. "Recap replaces the trailer in the actions" has nothing to replace.** The
show page has no action row — Play, Trailer and the rest live on the detail page
— so there was no trailer here to swap. The recaps strip keeps its behaviour
untouched and now sits below the cast in the ▼ chain, which is what "where it
sits, not what it does" leaves room for. Building a Resume/Recaps action row is a
separate screen's worth of work and is not in the Definition of done.

**6. Decision 3 — `src/view/rail.ts` could not be reused, so the strip is built
in `showpage.ts`.** `rail.ts` is bound to `#rows`, the browse `Row` model and
`itemAt`, a 4-row × 12-tile pool, portrait 209 × 314 tiles and `data/art`'s
poster queue. One row of 472 × 266 landscape cards with a blurb, fed from Plex
episode thumbs, shares none of that. It is untouched.

**7. The dim is 6e's, not 6d's.** The spec says "the rest sit at `.4`", but that
number is in the design's `holdEpisodes` — 6e. 6d's own episode markup carries
no opacity at all: the unfocused card dims by losing the ring and by its title
dropping to `rgba(238,241,243,.72)`. Built to 6d, which is also what keeps the
long-press step asserting every card back at opacity 1 once the menu closes.

## Left for the panel

Everything in the Definition of done is laptop-provable and proven. One thing is
not, and is not what this task is about: the strip draws the whole season rather
than a window of six, so a 24-episode series is 24 cards and 24 stills where it
used to be 6. It was the plainest way to get a transform that actually slides —
a window that moves with the focus jumps instead. If it stutters on the B8, the
fix is a larger window with a buffer either side, not a redraw per keypress.

## Graph writes proposed
- **Decision:** the series page draws episodes across rather than down, to 6d.
  The zones are seasons → episodes → cast → recaps, ▼ steps between them and
  ◀ ▶ run along the focused one.
- **Pattern:** a design can draw a control the app cannot honour. "My list" with
  no list storage is the third instance in this project, after a quality row
  promising to follow the connection and a score labelled IMDb that came from
  TMDB. Check every control in a new screen against what the app can actually
  do before building it.
- **Pattern:** *changing an axis changes every smoke helper that drove it.*
  Turning the episode list from a column into a strip broke five steps in three
  files that were never about layout — they only used ▼ to get somewhere. A spec
  that changes a navigation axis has to declare the harness, not just the screen:
  `grep -rn "ArrowDown\|ArrowUp" dev/` before writing `files:` would have found
  all of them in one pass.
- **Gotcha:** *a focus move that only toggles a class leaves the transition
  running, and a smoke step reads the middle of it.* Rebuilding the cards on
  every move hid this — new elements start at their final opacity with no
  transition — so dropping the redraw for a class toggle made the long-press
  step read 0.86 where it wanted 1. Two halves to the fix: don't transition what
  a test reads synchronously, and read the strip's committed `--strip-x` rather
  than a `getBoundingClientRect` taken mid-slide.
