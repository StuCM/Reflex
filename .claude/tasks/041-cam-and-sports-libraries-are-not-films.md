---
id: 039
slug: cam-and-sports-libraries-are-not-films
status: approved
branch: crew/039-cam-and-sports-libraries-are-not-films
model: sonnet
env: laptop
rounds: 0
work: plex-collections-sidebar
files:
  - src/api/plex/library.ts
  - types/plex.d.ts
  - docs/decisions.md
  - dev/library.js
  - dev/mock-plex.js
  - dev/smoke/sections.js
---

# Cam copies and sports matches never appear as films

## Goal
No film entry, row, search result or detail-page copy ever comes from a cam
library (`Movies - LQ`) or the sports library (`vSports - FV`). They are
dropped where the server's libraries are read, so the rest of the app never
sees them.

## Why now
Stuart, 2026-10-11, while scoping 038: "make sure we exclude the cam low
quality footage from entries", then chose to drop LQ **and** vSports
everywhere.

## Background
Measured read-only against the real servers, 2026-10-11:
- Apollo 2.0 `Movies - LQ` (key 11): 16 films, every file tagged `[CAM]`,
  `[TELESYNC]` or `[TELECINE]`. The newest 40 in every other movie library on
  both servers have none.
- Apollo 2.0 `vSports - FV` (key 12): 6,456 items of `type: movie` (tennis,
  cricket, football), so today they are a part of Movies.
- `/library/all?guid=<plex guid>` across a server returns the LQ copy with
  `librarySectionTitle: "Movies - LQ"` and `librarySectionID: 11`. That is how
  a cam copy reaches the detail page's other copies today
  (`allVersions` → `copiesByGuid`), even with the library gone from Movies.

## Existing work
CLI not installed; checked by hand. 038 (the collections spec) also touches
`src/api/plex/library.ts` (adds two functions; this changes `sections`,
`copiesByGuid`, `search`), `dev/library.js`, `dev/mock-plex.js` and
`dev/smoke/sections.js`. **Run after 038**, not in parallel.

## Graph context
- Decision 2026-09-07 "A copy is a library on a server, not a server"
  (`docs/decisions.md:204`, commit `5f7eb5b`) made every movie library a part
  of Movies and named `Movies - LQ` as one of them. This reverses that for two
  libraries; it is not a bug fix, and gets its own dated entry.
- Every server-wide lookup routes through `src/api/plex/library.ts`:
  `sections` (→ `setSections` in `src/screen/browse.ts`), `copiesByGuid`
  (→ `findByGuid` in discovery, `allVersions` in detail and shows) and
  `search`. Filtering there is one place for every caller; filtering in the
  callers is four.

## Constraints that bite here
- Match on the **library title**, which is the only signal Plex gives. Do not
  parse file names for `[CAM]`.

## Approach
1. `src/api/plex/library.ts`: one predicate,
   `const NOT_FILMS = /\bLQ\b|\bvSports\b/i;` with a one-line comment naming
   what each library holds (the comment passes the delete test: the pattern
   reads as arbitrary without it).
   - `sections()`: drop a library whose title matches.
   - `copiesByGuid()` and `search()`: drop an item whose
     `librarySectionTitle` matches.
   Add `librarySectionTitle?: string` to `PlexItem` in `types/plex.d.ts` (it
   is not there today).
2. `docs/decisions.md`: a dated entry, 2026-10-11, saying which two libraries
   are excluded, why (cams; sports are not films), and that it narrows the
   2026-09-07 decision. Three to six lines.
3. Mock: give the second mock server an `LQ Films` movie library and a
   `vSports` movie library, each with a film title found nowhere else
   (e.g. `Zz Cam Copy`, `Zz Match Highlights`), and make the LQ one also hold a
   copy of an ordinary film that the main library has, so the detail page's
   copies lookup would find it.
4. Smoke (`dev/smoke/sections.js`), new step:
   - the sidebar's Movies section and the All films row contain an ordinary
     film from the second server (the control, positive);
   - walking All films to the end, neither `Zz Cam Copy` nor
     `Zz Match Highlights` appears;
   - searching for `Zz` returns no results from those libraries;
   - the detail page of the shared ordinary film lists its copies, and none is
     from `LQ Films`; the count of copies is the exact expected number.
   Run it against `main` first and watch it fail.

## Out of scope
- A setting to choose excluded libraries.
- File-name detection of cams in other libraries.
- TV libraries.
- Anything in 038 (collections).

## Definition of done
- [ ] On the laptop, no film from the mock's `LQ Films` or `vSports`
      libraries appears in All films, search, or a detail page's copies.
- [ ] Ordinary films from the same mock server still appear (control).
- [ ] `docs/decisions.md` has the 2026-10-11 entry.
- [ ] The new smoke step passes, and was observed failing against `main`.
- [ ] `npm run verify` and the gate pass.
- [ ] No file outside `files:` is touched.
- [ ] Commits follow the convention.

## Review rounds

## Graph writes proposed
- Decision: exclude LQ and vSports libraries from films.
