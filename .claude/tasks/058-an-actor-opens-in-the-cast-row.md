---
id: 058
slug: an-actor-opens-in-the-cast-row
status: approved
branch: crew/058-an-actor-opens-in-the-cast-row
model: sonnet
env: laptop
rounds: 0
work: actors-in-place
files:
  - src/view/person.ts
  - src/data/people.ts
  - src/data/art.ts
  - src/screen/detail.ts
  - src/screen/showpage.ts
  - css/detail.css
  - css/show.css
  - css/browse.css
  - dev/mock-tmdb.js
  - dev/library.js
  - dev/smoke/detail.js
  - dev/smoke/show.js
  - test/people.test.ts
---

# An actor opens inside the cast row: their face, their posters, their story

## Goal
On the film page and the series page, OK on an actor slides their photo to
the far left of the cast row, fades the other actors out, and fills the row
with poster tiles of their films and shows, styled like the home rows.
Underneath: their name, a short bio, and born/died/place. No panel over the
page. It works for every actor in the row.

## Why now
Stuart, 2026-11-10, after 050/055: "In my head it appeared on the same page.
The picture of the selected actor moved to the far left of the row. Fade out
the other actors and in its place show a row with the movie images as we do
on the standard home page. Underneath we show the name and description and
some info about the actor. No overlay page." And on the film page, "towards
the end of the row clicking didn't show anything".

## Existing work
After 057 (shares `showpage.ts`, `css/show.css`, `dev/smoke/show.js`).

## Background
- Today (050/055): `src/view/person.ts` builds a `.sh-person` panel with a
  credits *list* (`paintList`, `windowStart`); `detail.ts` adds `#detail.person`
  hiding the header, actions and extras (`css/detail.css:188-191`);
  `showpage.ts` moves `#sh-cast` to top 330 at height 620
  (`css/show.css:168-198`). Both go.
- Credits already carry `poster_path`, `title`, `year`, `media`;
  `art.url(path, 'w342')` builds a poster URL. No new request is needed.
- **Not** reusable: `src/view/rail.ts` (one module-level pool bound to `#rows`).
  Build a small strip instead — at most 30 tiles — reusing the tile CSS
  (`.tile`, `.tile-inner`, `.tile-title`, `.tile-sub`, `css/browse.css:243-300`,
  209×388) and the series page's `--strip-x` shift pattern
  (`showpage.ts:~53, 342`).
- **The end-of-row bug.** Measured 2026-11-10 on four real films (Inception,
  The Dark Knight, Paddington 2, Toy Story): every one of the first 8 Plex
  actors matches a TMDB credit name exactly, within the first 30 — **the name
  match is not the cause**. What remains: `openPerson` (`detail.ts:993`)
  returns silently on three paths (no match; a generation/strip/index change
  while `/person` is in flight; an empty filtered credit list), and the panel
  is drawn inside `#dt-cast` (240px, `overflow: hidden`). Find which one it is
  by test, fix it, and make every remaining no-op say why (toast + debug line).
- The series page shows at most 4 actors: `castFrom` uses `facts.cast`, capped
  at `CAST = 4` (`src/data/art.ts:18`), though `CAST_MAX` is 6. Use the Plex
  roles (or `castIds`) so six can show.

## Graph context
- "Bigger element, fixed-height clipped parent": a 388px poster strip will
  not fit `#dt-cast`/`#sh-cast` at 240px with `overflow: hidden`. Name the new
  heights; assert the bio line is inside its container's rect.
- "Smoke steps share one IndexedDB cache": delete `tmdb2:` keys a step wrote.
- "Layout smoke needs data past threshold": test the **last** actor of an
  8-actor film.
- 055's smoke injected `castIds` through the `Art` seam because mock film
  credits never match mock Plex roles — that hid the real match path.

## Approach
1. **`src/view/person.ts`**: replace the list with `buildStrip(credits)` →
   poster tiles (`.tile` markup, `art.url(poster, 'w342')`, title and year
   below), and `buildAbout(person)` → name, bio paragraph (clamped to 3
   lines), `Born … · Died … · Place`. Keep `date`, `bio`, `step`.
2. **Film page (`detail.ts`, `css/detail.css`)**: in the person state the
   chosen face gets a class that translates it to the row's start (transform
   only); others fade to opacity 0; the strip sits right of the face, the
   about block underneath. The header, actions and extras stay visible above
   — only the cast area grows (move the extras below or hide them by class
   while open; nothing overlays). ◀ ▶ walk the posters, OK opens one through
   `onOpenTitle` (unchanged), ▲ or BACK closes and returns focus to that actor.
3. **Series page (`showpage.ts`, `css/show.css`)**: the same, with the page
   lifted (as the recaps lift it) so the strip and about block fit below the
   face; episodes hidden by class while open. Show six actors (see Background).
4. **No silent returns**: reproduce the end-of-row case in smoke first (last
   actor of an 8-actor mock film), see it fail on `main`, fix the cause, and
   give every remaining early return a toast and debug line.
5. **Mock**: `dev/mock-tmdb.js` film credits mirror the Plex role names
   (`dev/library.js` gives films 8 roles), more than 8 credits, and the person
   endpoint returns enough credits to scroll. Remove the `castIds` injection
   from `dev/smoke/detail.js`.
6. **Smoke**: on both pages, open the **last** actor: the other faces have
   opacity 0, the chosen face's rect is at the row's left, the strip holds
   one tile per credit with the first title's text, the about block text
   includes the birth year and is inside its container; → then OK opens the
   credit; BACK returns to the actor, ▲ to the cast. Replace the old
   `.sh-person*` / `.sh-credit*` selectors.
7. `test/people.test.ts`: unchanged behaviour still covered.

## Out of scope
- Matching actors by search when TMDB has no credit of that name.
- Changing what a credit opens.

## Definition of done
- [ ] Both pages: the actor opens inside the cast row as described, with no overlay (smoke, positive geometry and text).
- [ ] The last actor of an 8-actor film opens (smoke, failing on `main`).
- [ ] No silent no-op remains in opening an actor.
- [ ] The series page shows up to six actors.
- [ ] Nothing in the cast area is clipped (bio inside its container).
- [ ] the gate passes (`crew gate .claude/tasks/058-an-actor-opens-in-the-cast-row.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
