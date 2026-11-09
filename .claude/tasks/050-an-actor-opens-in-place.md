---
id: 050
slug: an-actor-opens-in-place
status: approved
branch: crew/050-an-actor-opens-in-place
model: sonnet
env: laptop
rounds: 0
work: actors-in-place
files:
  - src/api/tmdb.ts
  - src/data/people.ts
  - src/data/cached.ts
  - src/data/art.ts
  - src/view/person.ts
  - src/screen/showpage.ts
  - src/app.ts
  - types/plex.d.ts
  - css/show.css
  - dev/mock-tmdb.js
  - dev/smoke/show.js
  - test/people.test.ts
---

# On the series page, OK on an actor shows their work in place

## Goal
On the series page, OK on a cast member hides the other actors, shows that
actor's photo larger, their films and shows beside it newest first, and a
short bio below (born, died, where). OK on a title opens it — its own page if
held, the not-available page if not. BACK or ▲ returns to the full cast. The
cast photos are larger in general.

## Why now
Stuart, 2026-11-09: select an actor, "hide the other actors and then show a
list of their movies next to them and maybe a brief description below of born
death etc., so you don't have to leave the page"; "increase the size of the
profile picture". Both pages (the film page is 055), films and shows newest
first, OK opens "the normal or not available" page, BACK or Up returns.

## Existing work
After 048 (`showpage.ts`, `app.ts`) and 051 (`tmdb.ts`, `types/plex.d.ts`,
`dev/mock-tmdb.js`), and after 049 (same page, `css/show.css`).

## Background
- Series cast is already focusable: zone `'cast'` (`showpage.ts:72`),
  `castIndex`, `castKey` (:810, no OK branch today), `focusCast` (:267),
  `actorCard` (:253), `castFrom` (:235: Plex `Role`, TMDB names as fallback),
  `CAST_MAX = 6`. Faces `.sh-actor-face` 118px (`css/show.css:140`), asked
  of Plex at 160×160 (`showpage.ts:257`).
- No TMDB person id is held. `details()` (`tmdb.ts:166`) already appends
  `credits`, whose `cast[]` carries `id` and `profile_path`, but
  `TmdbDetails.credits.cast` is typed `{name?}[]` (`types/plex.d.ts:410`)
  and `art.facts` (`art.ts:61`) keeps four names.
- Opening a TMDB title: `discovery.entry(tmdbFilm)` → `app.ts openItem` →
  `openDiscovered` (resolve; held → its page, else the 044 page). `film()`
  in `tmdb.ts:36` shapes a result and is module-private.

## Graph context
- TMDB film and TV ids overlap: build credits through `discovery.entry`, which
  keys shows `tv/<id>`.
- Resolve only on OK, never for every credit on draw (requests to servers we
  do not own).
- `Array.prototype.sort` is unstable: sort indices, tie-break on position
  (`bySeason` in `src/api/youtube.ts`).
- Smoke rejects any non-localhost request: the mock must answer `/person/`.

## Approach
1. **Person id**: `art.facts` keeps `castIds: { name, id, profile }[]` from
   `credits.cast` (type it in `types/plex.d.ts`). A Plex actor's TMDB id is
   the credit whose name matches exactly (case- and accent-insensitive). No
   match, or no TMDB key → OK on that actor does nothing.
2. **`src/api/tmdb.ts`**: export `film()`; `person(id)` →
   `/person/{id}?append_to_response=combined_credits` returning
   `{ name, birthday, deathday, placeOfBirth, profile, credits: TmdbFilm[] }`,
   credits from `combined_credits.cast` through `film()` with `media` from
   `media_type`, filtered by `goodEnough`.
3. **`src/data/people.ts`** (new): `person(id)` cached with `kept('person:')`
   (`src/data/cached.ts`); `newestFirst(credits)` — by year descending,
   undated last, ties by original position (index sort). Cap 30.
4. **`src/view/person.ts`** (new, owns no state): builds the panel — large
   face (TMDB `profile` at w300, else the Plex photo), name, the credits list
   (title · year · Film/Show), the bio line (`Born 12 May 1962, London ·
   Died …`). Exposes the list-focus arithmetic as pure functions.
5. **`src/screen/showpage.ts`**: OK in `castKey` on an actor with an id opens
   zone `'person'`: other cast cards hidden by class, the panel drawn in the
   cast area, the episode strip hidden by class to make room. ◀ ▶ / ▲ ▼ walk
   the list; OK calls a new `options.onOpenTitle(film)`; BACK or ▲ from the
   top of the list → zone `'cast'` with the same actor focused.
6. **`src/app.ts`**: `onOpenTitle` → `openItem(discovery.entry(film))` with a
   back that reopens the series page in the person view.
7. **Larger faces**: `.sh-actor-face` 118 → 160px (Plex request 240×240);
   reflow the cast row to keep six.
8. **Mock** `dev/mock-tmdb.js`: credits with `id`/`profile_path` whose names
   match the mock Plex Roles; `/person/<id>` with dates, a place and
   `combined_credits` mixing films and shows, one held by the mock servers.
9. **Tests**: `test/people.test.ts` for `newestFirst` (12+ items with equal
   years keep their order; undated last) and the name match. Smoke
   `dev/smoke/show.js`: OK on an actor → other cards hidden, the panel shows
   the bio text and the credits in year order (assert the rendered list);
   OK on a held credit opens its page; on an unheld one the not-available
   page; BACK returns to the person view, BACK again to the full cast.

## Out of scope
- The film page (055). Searching TMDB by actor name. Crew (directors).

## Definition of done
- [ ] On the series page OK on an actor shows the in-place view with photo, credits newest first, and bio (smoke, positive text).
- [ ] OK on a credit opens the held page or the not-available page; BACK comes back to the actor, then the cast.
- [ ] Cast faces are 160px.
- [ ] `newestFirst` is stable for equal years (unit test with >10 items).
- [ ] the gate passes (`crew gate .claude/tasks/050-an-actor-opens-in-place.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
