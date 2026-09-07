---
id: 008
slug: header-carries-the-film
status: draft
branch: crew/008-header-carries-the-film
model: sonnet
env: laptop
files:
  - js/tmdb.js
  - js/art.js
  - js/masthead.js
  - js/detail.js
  - js/browse.js
  - js/rail.js
  - index.html
  - css/app.css
  - dev/mock-tmdb.js
  - dev/smoke.js
  - test/art.test.js
---

# The header carries the film, on both screens

## Goal
Stepping down into the rows no longer throws the picture away. The hero becomes
a 264px header that keeps a backdrop, the title, the run time or episode, a
description and the key actors — and the detail page gets the same shape, so
pressing OK reads as one screen deepening rather than two designs. Two rows
still fit under it, with a third peeking so it is obvious there is more.

## Why now
Today the hero collapses to a 132px band the moment the focus leaves row 0 and
the backdrop is set to `opacity: 0` outright — so the moment you start browsing,
the screen is a title and some tiles. The user asked for the title, run time,
description and key actors to survive that, with a picture behind them and the
rows visibly continuing below.

The description and cast cost nothing new: `js/art.js` already makes one TMDB
request per title for its backdrops, and `append_to_response` carries the
overview, the runtime and the credits on that same request. Asking Plex instead
would mean a metadata fetch for every tile the focus rests on, against servers
we do not own — which is exactly what `42f5ef9` removed.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing, but that is
because task 007 has not committed yet — it asks git, and an empty branch
carries nothing to find.

**The board says otherwise, and the board wins here.** Task 007 is in flight
and claims `js/browse.js` and `dev/smoke.js`, both of which this task also
needs. **008 must not be dispatched until 007 is merged and its branch is
gone.** Re-run the collision check then, against 007's landed commits, before
handing this over.

Already on `main` and not to be redone here: the two lines under a tile and
`Media.railTitle`/`railSub` (`a206671`), the tile radius (`10a1e89`), and the
hero scrim gradients (`de1fe59`).

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **`js/art.js` is where a title's TMDB payload already lives.** It caches
  `tmdbId -> {hero, tile}` in memory and in `Store` under `art:<tmdbId>`,
  fetches at most 4 at a time, one per tmdbId however many tiles ask, and
  caches misses as well as hits so an obscure film is not re-fetched every
  time its row is walked past. All of that stays; only the payload widens.
- **Nothing may wait on TMDB.** `Art.tile` and `Art.hero` answer synchronously
  from cache or fall back to Plex, and `Art.warm` notifies listeners when a
  lookup lands so the one tile and the backdrop repaint in place. The facts
  added here follow the same rule: the header draws immediately with what Plex
  gave it and fills in when TMDB answers. A header that blanks while waiting is
  a regression, not a loading state.
- **The masthead was deliberately stripped** (`42f5ef9`): the decorative
  controls, the summary, the key hints and the codec/audio badges all came out,
  and `Meta.schedule` no longer runs from `Browse.render`. This task brings the
  *description* back, but from TMDB, not from a per-item Plex fetch. Do not
  reintroduce `Meta.schedule` into the rail, and do not bring the badges back.
- **`Media.railTitle` / `Media.railSub`** (`a206671`) are the single source of
  what a thing is called and the one line under it, shared by the tile and the
  header, and unit tested in `test/labels.test.js`. Use them; do not write a
  second set of rules. An episode is named by its show.
- **The rail geometry is derived, not hand-picked** (`bff3d6e`). `BIG_DROP` is
  `VIEWPORT_H - ROW_H`. If the viewport height changes here, the constants that
  depend on it must be recomputed from it rather than typed in — a hand-picked
  number is what put 119px of the second row above the fold the first time.
- **Chromium 53 and a 2018 SoC.** Animate only `transform` and `opacity`. No
  blur, no shadow or filter transitions. The collapse is one transform on
  `#rows`; keep it that way.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16).
  `dev/smoke.js` fails on any request that is not to `localhost:<PORT>`, so the
  widened TMDB payload has to come from `dev/mock-tmdb.js`.

## Constraints that bite here
- **No CSS Grid, no `position: sticky`, no object spread, no `Object.entries`,
  no `async`/`await`.** `npm run check` scans for these.
- **`js/browse.js` is shared with task 007**, which is in flight and may merge
  first. Touch only `render()`'s `dense` toggle in that file. If a merge
  conflict looks likely anywhere else in it, stop and say so rather than
  reshaping the file.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/tmdb.js`** — replace `images(tmdbId)` with `details(tmdbId)`:
   `GET /movie/{id}?append_to_response=images,credits&include_image_language=en,null`.
   The language parameter matters: without it the appended `images` block is
   filtered to the request language and most backdrops disappear. Export
   `details`; drop `images`, and update its one caller.

2. **`js/art.js` — widen what is cached, keep the shape.**
   - `Art.pick(payload)` stays **pure** and keeps returning `{hero, tile}` from
     `payload.images.backdrops` — its existing tests must still pass, so accept
     both `{backdrops: []}` and `{images: {backdrops: []}}`.
   - Add a second pure function `Art.facts(payload)` →
     `{ overview: string, runtime: minutes|null, cast: [name, ...] }`:
     - `cast` is the first **4** of `payload.credits.cast`, already ordered by
       billing, taking `name` only.
     - Missing, empty or malformed input gives `{overview: '', runtime: null,
       cast: []}`. Never throws.
   - Cache `{hero, tile, facts}` under the existing `art:<tmdbId>` key. A cache
     entry written by task 006 has no `facts` — treat that as a miss for facts
     and re-fetch once, rather than showing nothing for ever.
   - Add `Art.factsFor(item)` returning the cached facts or `null`,
     synchronously, alongside the existing `Art.tile` / `Art.hero`.

3. **`index.html`** — the masthead gains two elements after `#mh-meta`:
   `<div id="mh-desc"></div>` and `<div id="mh-cast"></div>`. The detail page
   gains `#dt-header` wrapping its existing title/meta/summary block, so the
   same CSS can shape both.

4. **`js/masthead.js`** — render the description and the cast:
   - Description: `Art.factsFor(item).overview`, falling back to `item.summary`
     (which Plex gives on the list item, so something shows immediately),
     falling back to empty.
   - Cast: `key actors` joined with `  ·  `. Nothing at all if the list is
     empty — never the label on its own.
   - Both repaint through the existing `Art.onReady` listener when the lookup
     lands. Draw with the Plex fallback first; do not wait.

5. **`css/app.css` — the header, in both states.** The numbers are settled here
   so the worker does not have to invent them:
   - **Tall (row 0 focused)**: unchanged — `#masthead` at `top: 96px`, the
     backdrop full bleed. Description and cast appear under `#mh-meta`:
     description `max-height: 68px` (two lines at 22px/1.45), cast 20px in
     `--dim2`.
   - **Dense (any other row)**: `#masthead` becomes a **264px** header across
     the full width, *not* the 132px band. Title left at 46px, `#mh-meta` under
     it, description and cast to the **right** of the title in a second column
     so the header stays short. The backdrop and both scrims **stay visible**
     at reduced opacity (`0.5`) rather than going to `0` — delete the
     `#browse.dense #hero-art { opacity: 0 }` rule and give it that value.
   - **`#viewport`**: `top: 264px; height: 816px`. With `ROW_H` at 361 that is
     two whole rows (722px) and a 94px peek of the third — which is the "show
     that there are rows below" affordance, and must not be tuned away.
   - **Detail page**: `#dt-header` takes the same 264px shape and the same
     two-column split, with `#dt-art` behind it at the same opacity, so the two
     screens read as one.

6. **`js/rail.js`** — recompute from the new viewport, do not type numbers in:
   - `VIEWPORT_H` becomes a named constant of `816`, and `BIG_DROP` stays
     `VIEWPORT_H - ROW_H`.
   - `ROWS_FIT` is `Math.floor(VIEWPORT_H / ROW_H)` = 2, `ROWS_VISIBLE` is
     `ROWS_FIT + 1` = 3. Derive them; the comment explaining the difference
     between the two stays.

7. **`js/browse.js`** — `render()` still toggles `dense` on `rowIdx !== 0`.
   Nothing else in this file changes.

8. **`js/detail.js`** — move the existing title, meta and summary into
   `#dt-header`, and add the key actors line from `Art.factsFor`. The existing
   `#dt-cast` strip of actor photographs stays as it is; the header's cast line
   is names only, and the two must not contradict each other — take both from
   the same source, preferring TMDB.

9. **`dev/mock-tmdb.js`** — answer `/__tmdb/movie/<id>` with the widened
   payload: `images` as now, plus a deterministic `overview`, `runtime` and a
   `credits.cast` of at least 5 named entries derived from the id. Keep at
   least one id with exactly one backdrop, and add at least one with **no**
   `credits` block at all, so the empty-cast path is exercised.

10. **`dev/smoke.js`** — extend rather than replace:
    - The description and the key actors are on screen in the tall hero, and
      the cast names came from TMDB, not from the Plex summary.
    - Stepping down to row 1 keeps the backdrop visible (`#hero-art` opacity
      greater than 0) and keeps the description on screen — the band regression
      this task exists to fix.
    - Three rows are in the DOM under the dense header, the second is fully
      inside the viewport, and the third is partly visible — the "more below"
      affordance.
    - The detail page shows the same description and the same key actors as the
      header did.

11. **`test/art.test.js`** — extend for `Art.facts`: four names taken in
    billing order from a longer cast; a payload with no `credits`; one with
    `credits.cast` empty; a malformed one; and `Art.pick` still passing on both
    the old `{backdrops}` and the new `{images:{backdrops}}` shapes.

## Out of scope
- **Episode artwork and the show page.** Episode tiles taking the *show's*
  backdrop, and episode stills on the series page, are task 009. Do not touch
  `js/showpage.js`, and leave `Art`'s episode branch exactly as it is.
- **The sidebar and the section grouping** — task 007 owns `js/sidebar.js` and
  the rest of `js/browse.js`.
- **TV artwork or facts from TMDB's `/tv` endpoints.** Films only here.
- **Bringing back the codec and audio badges**, the decorative Play/More info
  controls, or the bottom key hints. All removed deliberately.
- **`js/meta.js` and `Meta.schedule`.** The rail must not fetch Plex metadata
  per tile.
- Tile radius, tile size and the two lines under a tile — already landed in
  `a206671` and `3118da9`.

## Definition of done
- [ ] Stepping off the top row keeps the backdrop on screen and keeps the
      title, run time or episode line, description and key actors readable.
- [ ] Two whole rows sit under the dense header and a third is partly visible.
- [ ] The description and the key actors come from one TMDB request per title —
      the same request that already fetched the backdrops, with no second call
      and no Plex metadata fetch per tile.
- [ ] A title with no TMDB id, or one TMDB has no overview for, shows the Plex
      summary instead, and a title with no cast shows no cast line rather than
      an empty label.
- [ ] Nothing blanks while waiting: the header paints from Plex first and fills
      in when TMDB answers.
- [ ] The detail page shows the same header shape, description and key actors.
- [ ] `Art.pick` and `Art.facts` are pure, and `test/art.test.js` covers the
      cases in step 11 and fails if they regress.
- [ ] Boot still lands on the Continue watching row with the tall hero and no
      second row visible.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
