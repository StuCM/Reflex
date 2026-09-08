---
id: 014
slug: detail-page-face
status: done
branch: crew/014-detail-page-face
model: sonnet
env: laptop
files:
  - js/detail.js
  - js/art.js
  - index.html
  - css/app.css
  - dev/smoke.js
---

# The detail page's face

## Goal
The film page reads like the Mantis design: an amber kicker naming what it is,
the title, a row of chips, a row of ratings, the description, circular cast
portraits and extras as cards with their lengths. The copy chooser underneath
is left exactly as it is — this task changes what the page looks like, not how
playback is chosen.

## Why now
The palette landed in 013; this is the screen the user gave a design for. It is
also almost all presentation: every fact the design shows is already fetched.
`Meta.load` brings `rating`, `audienceRating`, `Genre[]`, `Director[]` and
`Role[]`; `Art.factsFor` brings the overview, the runtime and the billing. No
new requests.

Splitting the face from the choosers is deliberate. The design's circular
buttons are real menus for source, audio, subtitles and quality — that is an
interaction change needing the guard re-run on every switch, and it is task 015.
Doing both at once would put a restyle and a behaviour change in one diff.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching `js/detail.js`, `js/art.js`, `index.html`,
`css/app.css` or `dev/smoke.js`. No worktrees are in flight; 013 merged as
`fd9db18`.

Read these as they now are:

- `css/app.css` carries the Mantis palette and the `--t-quick` / `--t-move` /
  `--ease` tokens; every transition in the file already reads from them.
- `index.html` has `#hero-art` as a wrapper around `#hero-art-a` and
  `#hero-art-b`. That is the browse hero, not this page, but do not disturb it.
- `dev/smoke.js` is at 60 steps.
- `js/art.js` caches `{hero, poster, facts}` per tmdbId from one
  `/movie/{id}?append_to_response=images,credits` call. `vote_average` is
  already in that cached payload — step 1 only surfaces it.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **The palette is `:root`** — `--bg #161826`, `--surface #1f2233`,
  `--raised #252839`, `--ac #a79ce3` violet, `--ac2 #e5a06d` amber — with
  `--t-quick`, `--t-move` and `--ease` for every transition. Use the tokens.
  Six declarations in the file spell a colour out as `rgba()` because a
  gradient stop needs alpha; if you add a gradient, follow that pattern and use
  `rgba(22, 24, 38, …)`.
- **008 already gave this page a 320px header** (`#dt-header`) matching the
  browse screen's, with `#dt-art` behind it. That shape stays; this task fills
  it in.
- **The data is already on the page.** `metaLine` in `js/detail.js` already
  reads `md.rating`, `md.audienceRating` and `md.Genre`; `crewHtml` reads
  `md.Director` and `md.Writer`; `#dt-cast` already draws `Role[]` as 120px
  circles with an initials-free blank fallback. This task rearranges and
  restyles them — it does not fetch anything new.
- **`Art.factsFor(item)` answers synchronously from cache** and `Art.onReady`
  fires when a lookup lands. The page must paint from Plex first and fill in,
  never blank while waiting — the rule 008 established.
- **Chromium 53.** No CSS Grid, no `position: sticky`, no `color-mix()`, no
  `async`/`await`, no object spread, no `Object.entries`. Animate only
  `transform` and `opacity`.
- **`Array.prototype.sort` is not stable** before Chrome 70 (CLAUDE.md). If you
  sort cast or extras, sort indices with a tie-break on position.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16).

## Constraints that bite here
- **Do not label a score with a source it did not come from.** The design shows
  "IMDb". We do not have IMDb. Plex gives `rating` (critics) and
  `audienceRating`; TMDB gives `vote_average`. Label each as what it is. A
  number under the wrong badge is a lie the user cannot check.
- **Every element must survive missing data.** Plenty of a library has no
  genre, no director, no ratings and no cast photographs. Nothing may render an
  empty label, a stray separator, or a broken image.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/art.js`** — `Art.facts` gains `rating`: `payload.vote_average` rounded
   to one decimal, or `null`. It is already in the cached payload; this is one
   field, and the existing `test/art.test.js` cases for a malformed payload must
   still hold.

2. **`index.html`** — inside `#dt-header`, elements for the new rows:
   `#dt-kicker`, `#dt-chips`, `#dt-ratings`. The existing `#dt-title`,
   `#dt-meta`, `#dt-summary`, `#dt-crew`, `#dt-cast`, the sources list and the
   extras stay; `#dt-meta` is superseded by the chips row and is removed rather
   than left drawing a duplicate line.

3. **`js/detail.js` — the kicker.** `MOVIE · SCIENCE FICTION · DENIS VILLENEUVE`
   in amber caps: the item's type, its first genre, its first director. Any
   part that is missing drops out with its separator — never `MOVIE ·  · `.
   For an episode, name the show rather than the type.

4. **`js/detail.js` — the chips.** Certificate, year, runtime, and the quality
   of the copy that would play (`4K HDR`, `1080p`). The certificate and the
   quality chip are outlined; year and runtime are plain text. Runtime prefers
   TMDB's, falls back to the item's `duration`. A missing chip is absent, not
   empty.

5. **`js/detail.js` — the ratings.** Up to three, each a glyph, a number and a
   label, and each present only if we have it:
   - `md.rating` → `<n>% Critics` (Plex scores out of 10; ×10 for a percentage)
   - `md.audienceRating` → `<n>% Audience`
   - `Art.factsFor(item).rating` → `<n> TMDB`
   Use inline SVG for the glyphs as `index.html` already does for the search
   icon — the app runs from `file://` on the TV, so there is no icon font to
   fetch.

6. **`js/detail.js` and `css/app.css` — cast and extras.**
   - Cast: the existing 120px circles, restyled to the design — a `--surface`
     disc, the actor's photograph when Plex has one, and their **initials**
     when it does not, rather than today's empty disc. Name under, role under
     that in `--dim2`.
   - Extras: landscape cards in the rail's visual language (16px radius, violet
     focus ring), each with a play glyph and its length in a corner badge, and
     its title underneath.

7. **`css/app.css`** — the header block laid out to the design: kicker, title,
   chips, ratings, description down the left, the backdrop to the right. No
   grid — absolute positioning or inline-block, as the rest of the file does.
   Everything transitions on the shared tokens or not at all.

8. **`dev/smoke.js`** — extend the detail-page steps:
   - The kicker names the type, a genre and a director, with no stray
     separators, and a film with none of them renders no kicker rather than an
     empty line.
   - The chips carry certificate, year, runtime and the quality of the copy.
   - Each rating shown is labelled with the source it came from, and a film
     with no ratings shows none.
   - A cast member with no photograph shows initials.
   - Extras show a length badge.
   - The copy chooser still lists every copy and still plays — this task must
     not change that, and the existing steps that prove it must still pass.

## Out of scope
- **The action row and its choosers** — Play as a primary pill, and circular
  buttons opening menus for source, audio, subtitles and quality. That is task
  015, it changes behaviour, and it is where `#dt-sources` is replaced. Leave
  the sources list alone here, restyled only as far as the palette requires.
- **"My list"**, which has nowhere to store anything. Do not draw a button that
  does nothing.
- **The player, the show page, the browse screen.**
- **New network requests of any kind.** Everything shown is already fetched.
- **`js/guard.js`, `js/plex.js`, `js/media.js`.**

## Definition of done
- [ ] The page shows an amber kicker, the title, a chip row, a ratings row and
      the description, laid out as the design has them.
- [ ] Every rating is labelled with the source it actually came from; no score
      is labelled IMDb.
- [ ] A film with no genre, no director, no ratings and no cast photographs
      renders cleanly — no empty labels, no stray separators, no broken images.
- [ ] Cast without a photograph show their initials.
- [ ] Extras are cards with a length badge.
- [ ] The copy chooser still lists every copy, still shows each verdict, and
      still plays.
- [ ] Nothing blanks while TMDB is being waited on.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

**Round 1 — PASS.** Traced the kicker/chip/rating builders, confirmed no score
carries a source it did not come from, the Chromium 53 rules hold in the CSS,
the new smoke steps assert behaviour rather than restating the implementation,
and only the declared files changed. One soft observation, not blocking: no
single smoke scenario has a film with *nothing* — the generator in
`dev/library.js` always fills genre, director, ratings and cast, and that file
is outside `files:`. The pieces are each covered (empty-part guard on every
kicker, an episode proving the empty ratings row), and a dedicated fixture
would want `dev/library.js` in scope.

## What changed

- `js/art.js` — `Art.facts` gains `rating`: `vote_average` to one decimal, and
  `null` for TMDB's zero, which means "nobody voted", not "scored nothing".
- `index.html` — `#dt-kicker`, `#dt-chips` and `#dt-ratings` inside
  `#dt-header`; `#dt-meta` gone.
- `js/detail.js` — the kicker, the chip row and the ratings row; extras drawn
  as cards; cast without a photograph show initials; `close()` moves the
  generation on.
- `css/app.css` — the header laid out down the left at 300px with the backdrop
  to its right, chip and rating styles, the extras cards, the initials disc.
- `dev/smoke.js` — three new steps (the kicker and chips, the labelling of
  every score, initials with the photographs taken away); the two episode steps
  and the extras step retargeted from `#dt-meta` and `.dt-source` to the chips
  and the cards.

## What the spec got wrong

- **`vote_average` is not in the mock's details payload.** It is in the real
  API's `/movie/{id}` and in `dev/mock-tmdb.js`'s *list* rows, but
  `detailsFor()` does not emit it, and that file is outside `files:`. So the
  `<n> TMDB` rating is correct against a real server and unreachable in the
  harness — the smoke step covers the two Plex scores and asserts that nothing
  anywhere is labelled IMDb.
- **The header was 264px, not 320px.** It is 300px now, and `#dt-body` moved
  from 288px to 324px, because the description moved to the left column as step
  7 asks. A film with four copies can run the cast row into the bottom of the
  screen; it could before this change too, and shrinking the copy chooser is
  task 015's business.
- **Step 2 lists `#dt-meta` as staying and then removes it.** Removed.
  `#dt-tagline` and `#dt-names` are named in neither list; both were kept and
  re-placed in the left column.

## Graph writes proposed

**Pattern — a page that reads `item` must bump the generation when it closes.**
`js/detail.js` guarded every async landing with a generation counter but only
`open()` moved it on, so a `Meta.load` or `Guard.check` arriving after BACK
still called `renderSources()`. That was harmless while the source list read
only its own arrays; the moment the chip row read `item` it threw
`Cannot read properties of null`. The counter was already the mechanism — it
just was not moved on the way out. Cost a smoke round to find.

**Decision — a score is labelled with the source it came from, never IMDb.**
The Mantis design shows an IMDb badge. We have no IMDb: Plex gives `rating`
(critics, out of ten) and `audienceRating`, TMDB gives `vote_average`. Each is
drawn with its own label, and the smoke test asserts the string "IMDb" appears
nowhere on the page. Same rule as the HDR chip, which is only added when the
server actually says so.
