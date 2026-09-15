---
id: 032
slug: the-series-page-to-6d
status: building
branch: crew/032-the-series-page-to-6d
model: sonnet
env: laptop
rounds: 0
files:
  - src/screen/showpage.ts
  - index.html
  - css/show.css
  - dev/smoke/show.js
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

## Graph writes proposed
- **Decision:** the series page draws episodes across rather than down, to 6d.
- **Pattern:** a design can draw a control the app cannot honour. "My list" with
  no list storage is the third instance in this project, after a quality row
  promising to follow the connection and a score labelled IMDb that came from
  TMDB. Check every control in a new screen against what the app can actually
  do before building it.
