---
id: 053
slug: the-kids-page
status: approved
branch: crew/053-the-kids-page
model: sonnet
env: laptop
rounds: 0
work: kids-discovery
files:
  - src/screen/browse.ts
  - src/view/sidebar.ts
  - dev/mock-tmdb.js
  - dev/smoke/browse.js
  - dev/smoke/deck.js
  - dev/smoke/sections.js
  - src/rules/ratings.ts
  - src/api/plex/library.ts
  - dev/mock-plex.js
  - dev/library.js
  - test/rating.test.ts
---

# The Kids page: their Continue watching, then TMDB's kids rows

## Goal
Kids opens one page of films and shows: a Continue watching of kids titles
at the top, then 051's rows filtered to what the servers hold (052), with
New and coming unfiltered for its trailers. It replaces today's
certificate-filtered Kids mode.

## Why now
Stuart, 2026-11-09 (see 051): "Should also have a continue watching of the
kids stuff"; "only show what we have or actually a new and coming for
trailers". No certificate filter.

## Existing work
After 046 and 048 (both edit `browse.ts`; 046 also `dev/smoke/deck.js`) and
after 051 and 052.

## Graph context
- Kids today: `loadKids` (`src/screen/browse.ts:1057`), per section, filters
  by `isKidsRating` on library certificates and builds a "Kids · carry on
  watching" row and an `allRow`. Mode `'kids'`; BACK → `leaveMode()` (l.1197).
- `loadDiscover` (l.1156) is the shape to copy: `discovery.load` with an
  `add` callback, `rowModel.paged` + `categoryOf` for paging.
- Deck items carry `librarySectionTitle`. Films live in big Movies
  libraries, so a kids film is known by the 052 index; an episode by its
  library title matching `/kids/i` or its show being in the index.
- Smoke steps touching Kids: `dev/smoke/browse.js:982-1010`,
  `dev/smoke/deck.js:406-417`, `dev/smoke/sections.js:48,103`.

## Approach
1. `src/screen/browse.ts` `loadKids`: `reset('kids')`; one page whatever
   section is current. First row **Continue watching** from the current deck
   (`deckItems`, after 046's fold) keeping items whose `librarySectionTitle`
   matches `/kids/i` or whose TMDB key (show's for an episode) is in
   `kids.held()`; omitted when empty. Then `discovery.load({ categories:
   settings.kidsCategories, keep: (e) => isHeld(set, e), … })` with the same
   `add` as `loadDiscover`. Drop the `isKidsRating` path and its `allRow`.
2. OK on a tile behaves as in Discovery (044's page for an unheld
   new-and-coming title). BACK leaves Kids as today.
3. `src/view/sidebar.ts`: Kids stays one entry; nothing per section.
4. `dev/mock-tmdb.js`: kids lists include titles the mock servers hold and
   ones they do not; one upcoming film nobody holds.
5. Delete what Kids leaves dead: `isKidsRating` and `KIDS_MAX_AGE`
   (`src/rules/ratings.ts:23,37`), `contentRatings` (`src/api/plex/library.ts:84`),
   the mock's content-ratings endpoint (`dev/mock-plex.js:698`,
   `dev/library.js:1016`) and their test (`test/rating.test.ts:50`). Grep
   first: only `browse.ts` should call them. `ageLimit` stays.
6. Smoke: rewrite the Kids steps — the page's row titles in order (positive
   list); a row holds only held titles (assert each tile's title is a mock
   library title) and the unheld ones are absent; New and coming holds the
   unheld upcoming film and OK opens its page with a Trailer; the kids
   Continue watching holds a Kids-library episode and not an adult film on
   the deck; BACK returns to the library.

## Out of scope
- The colour key (054). A lock or PIN. Hiding adult rows anywhere else.

## Definition of done
- [ ] Kids shows Continue watching (kids only), then the 051 rows in order, filtered to held titles except New and coming (smoke, positive assertions).
- [ ] An adult film on the deck is not in the kids Continue watching; a Kids-library episode is.
- [ ] New and coming's unheld film opens the 044 page with a Trailer.
- [ ] `isKidsRating`, `KIDS_MAX_AGE` and `contentRatings` are gone, with their mock endpoint and test.
- [ ] the gate passes (`crew gate .claude/tasks/053-the-kids-page.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
