---
id: 044
slug: a-title-we-lack-still-has-a-page
status: approved
branch: crew/044-a-title-we-lack-still-has-a-page
model: sonnet
env: laptop
rounds: 0
work: discovery-matches-and-tv
files:
  - src/app.ts
  - src/screen/detail.ts
  - src/api/tmdb.ts
  - src/data/art.ts
  - types/plex.d.ts
  - css/detail.css
  - dev/mock-tmdb.js
  - dev/smoke/discovery.js
---

# A title we do not have still opens a page, with its trailer

## Goal
OK on a Discovery film or show that neither server holds opens its page: the
TMDB description, cast and ratings, a trailer, and a line saying it is not
available on the server. No Play.

## Why now
Stuart, 2026-11-03: "If its not on the platform it would be nice to at least
go to the page to see a desc and watch the trailers" — "yes just a message
saying not available on the server". On trailers: "should be able to pull from
tmdb for a trailer or from plex".

## Existing work
Builds on 043 and 045 (both edit `dev/smoke/discovery.js`, 045 `art.ts` and
`tmdb.ts`). Run after both merge.

## Graph context
- Constraint: an in-app YouTube iframe is unreliable on webOS 4. The app
  already handles that for recaps: `src/app.ts` `openRecap(video)` (~l.131)
  loads `settings.youtubeEmbedBase + id`, and `recapFailed` falls back to
  `launchYouTube(id)` (~l.166) when the embed does not play. **Reuse that path
  for a TMDB trailer**; do not build a second YouTube player.
- Plex trailers already work: `detail.ts:506` uses `extras[0]` from Plex
  `Extras` and plays it through the guard. That stays as it is for titles we hold.

## Constraints that bite here
- `detail.open` (`detail.ts:135`) builds `copies` from `merge.sources(entry)`
  and `loadDetails` → `meta.load(copy.item)`; Play, the guard and the
  Source/Audio/Subtitle actions (`actions()`, l.479) all assume a copy. With no
  copy, none of those may run or draw.
- DOM via `fill`/`put`, a class for the "not available" line, no inline style.

## Approach
1. `src/api/tmdb.ts` `details()`: add `videos` to `append_to_response`.
   Pick the trailer: first `site === 'YouTube'` and `type === 'Trailer'`,
   official first, else the first YouTube teaser. Expose it via
   `src/data/art.ts` `facts()` as e.g. `trailerKey` (with `types/plex.d.ts`).
2. `src/screen/detail.ts`: decide the no-copy mode with `discovery.isEntry(item)`
   — **not** "copies is empty": `merge.sources(item)` (`src/data/merge.ts:106`)
   is never empty, and for an entry it returns the entry itself, which has no
   `ratingKey` or `_server`. For an entry, set `copies = []` in `open()` before
   `loadDetails` and the guard run. The page then draws from
   `art.factsFor(item)` (description already does, l.716), skips
   `loadDetails`'s `meta.load` and the guard, and its action row is just
   Trailer (when there is a key) — plus a line *Not available on the server*
   in place of Play's caption.
3. `DetailOptions` gains `onTrailer?: (youtubeKey: string) => void`; the
   Trailer action calls it for a TMDB trailer. In `src/app.ts`, `openDetail`
   passes one that calls `openRecap` with that key, and BACK from it returns to
   the page.
4. `src/app.ts` `openDiscovered` (~l.66): when `resolve` finds nothing, call
   `openDetail(item, toBrowse)` instead of `message('Not in your library', …)`.
5. Held titles keep the Plex trailer; if one has no Plex extra but TMDB has a
   key, offer the TMDB one through the same `onTrailer`.
6. Mock `dev/mock-tmdb.js`: `videos` in `/movie/{id}` and `/tv/{id}` details.
7. Smoke `dev/smoke/discovery.js`: rewrite "a title neither server has says so
   before OK" (l.241): OK opens the page, its text includes the TMDB overview
   and *Not available on the server*, there is no Play action, and a Trailer
   action exists; pressing it sets the recap frame's `src` to the embed base
   plus the mock's key. Once for a film, once for a show.

## Out of scope
- Requesting the title (Overseerr etc.), watchlists.
- Changing how a held title's page or Plex trailer behaves, beyond step 5.
- A new YouTube player.

## Definition of done
- [ ] OK on an unheld Discovery film opens a page with its overview, cast and *Not available on the server*, and no Play.
- [ ] The same for an unheld show.
- [ ] Its Trailer action loads the TMDB trailer through the recap player (`#recap-frame` src = embed base + key).
- [ ] A held film's page is unchanged (existing detail smoke steps pass).
- [ ] No guard check or Plex metadata request is made for an unheld title (assert with a request collector, with a non-zero control on a held title).
- [ ] the gate passes (`crew gate .claude/tasks/044-a-title-we-lack-still-has-a-page.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
