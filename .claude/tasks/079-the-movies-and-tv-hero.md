---
id: 079
slug: the-movies-and-tv-hero
status: building
branch: crew/079-the-movies-and-tv-hero
model: sonnet
env: laptop
rounds: 0
work: v2-movies-tv
files:
  - src/view/masthead.ts
  - src/data/discovery.ts
  - src/app.ts
  - index.html
  - css/browse.css
  - css/v2.css
  - dev/smoke/movies.js
  - dev/smoke/discovery.js
  - dev/smoke/sections.js
  - dev/smoke/search.js
---

# The hero says what the focused title is, where it streams, and if we lack it

## Goal
On Movies and TV the hero is the Movies board's: eyebrow (the row title, or
"#3 in the top 10 today" on the ranked row), title, then **one row** of
service (logo in the board's 44px box, and name), meta (year · certificate ·
runtime or "N seasons" · ★ rating), an "OK Details" chip and the yellow "Add to
list" dot, then the synopsis — and, when the servers lack it, "Not on server"
under the synopsis. OK opens the page, where the trailer is. Yellow on these
pages toasts "Lists are coming" until lists exist.

## Why now
v2 group 2. Stuart, 2026-11-26: "If its not on the server, say below desc and
you can still go to the page and watch a trailer"; hero: "do the board". The
JustWatch credit TMDB requires goes to Settings when it exists, not the hero.

## Existing work
After 076 (`facts.service`) and 078 (ranked row). Base `feat/v2`.

## Background
- `src/view/masthead.ts:95 render(row, item, hasRows)`; DOM in
  `index.html:38-44` (`#mh-row`, `#mh-title`, `#mh-meta`, `#mh-desc`,
  `#mh-cast`). `#mh-meta` is `railSub` today; the fade key is built at l.103.
- `_availability` is set in `src/data/discovery.ts:46-50` ("Not in your
  library" / "In your library · N min") and drawn into `#mh-meta` (l.126).
- `ArtFacts` already has `runtime`, `rating`; `facts.service` from 076.
- Unheld detail page offers Trailer (`detail.ts:521-532`, via `openDetail`,
  app.ts:239) — already works; not asserted.
- Smoke asserting this text: `discovery.js:133-140, 296-336, 313, 399-403, 447`
  ("Not in your library" in `#mh-meta`), `search.js:34` (`#mh-row`),
  `sections.js:728`.

## Graph context
- "Assert on positive content": each moved string is asserted where it now
  appears, not only that it left `#mh-meta`.
- Only the focused tile is resolved (`scheduleResolve`, 420 ms) — do not
  resolve more to fill the hero.

## Board values
`designs/v2/Movies.dc.html:37-50` — hero left 96, top 160, width 1300.
Eyebrow 24px 600, letter-spacing 3px, uppercase, `--ac`. Title Space Grotesk
700 96px, line-height 1, letter-spacing -1px, uppercase, margin-top 10. Info
row: flex, margin-top 16, items 32 apart (margins, no `gap`): service = 44×44
radius-12 box + name 26px 600, 14 apart; meta 28px rgba(255,255,255,.78); "OK"
chip 1px rgba(255,255,255,.5) border, radius 10, padding 3px 14px, 24px, then
"Details"; a 22px #F5C84C dot then "Add to list". Synopsis 28px/1.4, width 800,
margin-top 12, rgba(255,255,255,.88), two lines. Worker reads the board for any
value not listed here and adds it to this list.

## Differs from board, because
Only Stuart's calls or what the board itself forces belong here. A worker may not add its own; if something cannot match, stop and ask. The reviewer refuses any entry with neither reason.
- The service box holds the real TMDB `logo_path` image, not a coloured box
  with a drawn glyph: the board's services are placeholders.
- "#N in the top 10 today" uses the real rank.
- `#mh-avail` "Not on server" under the synopsis: Stuart; not on the board.
- Real titles, meta and synopses.

## Constraints that bite here
- `src/screen/browse.ts` is at its 1548-line `max-lines` limit (`.oxlintrc.json`). Net-zero or shrink it; new logic goes in `src/screen/pages.ts` (077 did this).

## Approach
1. `index.html`: `#mh-info` row (`#mh-service` with `img` + name, `#mh-meta`,
   `.mh-chip` OK Details, `.mh-add` dot + Add to list) after the title;
   `#mh-avail` after `#mh-desc`. Built nodes, no innerHTML.
2. `discovery.ts`: `_availability` becomes `'absent' | 'held' | undefined`
   (resolving), with the held runtime kept where the meta line can read it.
3. `masthead.ts`: meta from year, certificate, `facts.runtime` (TV: seasons),
   `facts.rating`, skipping missing parts; service hidden when
   `facts.service` is null; `#mh-avail` "Not on server" when absent; ranked
   eyebrow `#N in the top 10 today`. Home's hero and held Plex items elsewhere
   keep today's look.
4. CSS for the movies/tv pages to **Board values**.
5. `app.ts`: yellow on the movies/tv pages toasts "Lists are coming"
   (elsewhere unchanged).
6. Smoke: every Board value by computed style or rect; a mock title with a
   service shows its name and logo, one without shows none; an unheld title
   shows "Not on server" in `#mh-avail` and OK opens a page with a Trailer
   action; the Top 10's third tile shows "#3 in the top 10 today"; yellow
   toasts. Update the discovery/search/sections assertions to the new places.

## Out of scope
- Adding to a list (Collections group). The JustWatch credit (Settings). Fading tiles on the rail.

## Definition of done
- [ ] Meta, service and eyebrow render on Movies from the mock (smoke, positive text).
- [ ] "Not on server" appears under the synopsis for an unheld title, and its page offers Trailer (smoke).
- [ ] Discover's hero still shows availability, in its new place (smoke).
- [ ] Every value under **Board values** is asserted in the smoke by computed style or rect (px, colour, alpha, font, weight); anything that differs is listed under **Differs from board, because**, and nothing else may differ. The reviewer opens the board (`designs/v2/<board>.dc.html`, now rendering with `support.js`) beside the app at 1920×1080 and checks both lists.
- [ ] the gate passes (`crew gate .claude/tasks/079-the-movies-and-tv-hero.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Worker notes

## Graph writes proposed
