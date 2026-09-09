---
id: 023
slug: tmdb-first-discovery
status: done
model: opus
env: laptop
branch: crew/023-tmdb-first-discovery
files:
  - js/config.js
  - js/tmdb.js
  - js/discovery.js
  - js/browse.js
  - js/masthead.js
  - js/app.js
  - dev/mock-tmdb.js
  - dev/smoke/discovery.js
  - test/tmdb.test.js
---

# Discovery, drawn from TMDB, asking the servers only when it must

## Goal
The Discovery page becomes rows of **your** categories, defined in one place,
drawn entirely from TMDB — titles and posters straight from the CDN, **no Plex
request to paint the screen**. A title is looked up on your servers only when it
is focused, and opened only when you press OK. The library browse screen is left
exactly as it is.

## Why now
The user wants their own categories rather than the server's hubs, but sensibly
wants to **try it beside the existing screen** rather than replace it: *"build
this as a separate page, keeping all the original categories linked to the
server. I can then test to see how it runs and if it fits."*

The app already has that page — Discovery is an existing mode with a sidebar
entry and its own load path. This changes what it *is*, and touches nothing the
library screen depends on.

## The asymmetry this exists to fix
The server's hubs are **premade**: one `/hubs/sections/<key>` per server returns
every hub with `h.Metadata` already inside, so today's browse screen costs two
requests and arrives ready to draw. TMDB returns **id lists**, so
`Discovery.matchToLibrary` currently asks `/library/all?guid=tmdb://…` per title
per server — `MAX_LOOKUPS 40 × 2 servers = 80 requests per row`, six rows ≈ 480
against servers we do not own.

The user's insight, and the design: a tile only needs a **title and a picture**
to be drawn, and TMDB has both. Everything Plex-shaped — ratingKey, media, the
guard verdict — is needed only when acting on a title, not when showing it.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing. Nothing else is
in flight; main verifies at 81/81.

Read these as they now are:

- `dev/smoke.js` is the harness only; the steps live in `dev/smoke/<area>.js`,
  eleven of them, and `discovery.js` is the one this task owns. Iterate with
  `npm run smoke -- discovery` (about 4s) rather than the full 2m37s suite. A
  new area file must also be added to the `AREAS` list in `dev/smoke.js` — which
  this task does not own, so if you need one, say so rather than reaching.
- `css/app.css` no longer exists: `css/base.css` plus one file per screen. This
  task should need none of them — Discovery draws with the rail, which is
  already styled.
- `js/rail.js` now clears a tile's picture when the pool hands it a different
  item (task 021). A TMDB-only entry must therefore be a **stable object** for
  as long as it is in the row, or every render will look like a new film and
  clear the picture. Build the entries once when the row is built; do not
  rebuild them on each paint.
- `js/browse.js` gained `Theme music` and `Autoplay next` settings in `modes()`
  handling; leave both alone.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **`js/art.js` already prefers TMDB and needs only a tmdb id.** `Art.tile` and
  `Art.hero` answer from a cache keyed on `Plex.tmdbId(item)`, which reads
  `item.Guid[]` for a `tmdb://` entry. An entry carrying a synthetic
  `Guid: [{ id: 'tmdb://<id>' }]` therefore gets its poster and backdrop with no
  change to `js/art.js` at all. **Do not modify `js/art.js`** — if it looks like
  you must, the entry shape is wrong.
- **`Media.railTitle` / `railSub`** are what a tile is labelled with; they read
  `title`, `type`, `duration`, `year`. Missing fields yield an empty second
  line, not an error.
- **Never full-crawl a server we don't own** (CLAUDE.md), and the direction of
  travel is external-first: a small curated list, then ask Plex about it — never
  index the library against TMDB.
- **The rail defers what is not on screen** — off-screen rows get their titles
  but not their posters. A guid lookup is dearer than a poster; the same
  discipline applies, harder.
- **`Store` is a key/value cache** over IndexedDB, and `Browse.loadSection`
  already paints from `rows:` before any network call.
- **Everything that reaches `Player` goes through `Guard.check`.** An entry that
  is not on any server can never reach it, so the refusal must happen earlier and
  say something true.
- **Chromium 53**: no `async`/`await`, no object spread, no `Object.entries`.
- **Assertions that pass on nothing** are this suite's recurring failure
  (CLAUDE.md, Testing). A step bounding request counts must be run against an
  unbounded version and seen to fail.

## Constraints that bite here
- **The library browse screen must not change.** Its rows, its hubs, its
  ordering, its cost. If a change there seems necessary, stop and say so.
- **Inert without a key.** With `tmdbKey` empty, Discovery says what it needs,
  as it does today.
- **A row must never claim you own something you do not.** Showing a film you
  have not got is fine and is the point; implying otherwise is not.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no full
  stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/config.js` — the categories, as data the user edits.**
   ```
   categories: [
     { title: 'Trending this week', kind: 'trending' },
     { title: 'On Netflix',         kind: 'provider', id: 8 },
     { title: 'On Prime Video',     kind: 'provider', id: 9 },
     { title: 'Science fiction',    kind: 'genre',    id: 878 },
     { title: 'Because of what you have been watching', kind: 'recommended' }
   ]
   ```
   Order is the order on screen. Note in a comment where a genre id comes from
   (`/genre/movie/list`).

2. **`js/tmdb.js` — return titles, not just ids.** The calls already fetch full
   TMDB results and throw everything but the id away. Keep the whole thing:
   `{ id, title, year, poster_path, backdrop_path, vote_average }`. Add
   `byGenre(id)` on `/discover/movie`, and one `catalogue(category)` dispatching
   on `kind` so a new kind is one function rather than a new path elsewhere.

3. **`js/discovery.js` — an entry that is TMDB-shaped until it needs not to be.**
   `Discovery.entry(result)` builds what the rail can already draw:
   ```
   { type: 'movie', title, year,
     Guid: [{ id: 'tmdb://' + result.id }],
     _tmdb: result,        // what TMDB said
     _resolved: undefined  // unknown | the Plex entry | null for "not held"
   }
   ```
   No `_server`, no `ratingKey`. `Art` gives it a poster from the tmdb id;
   `Media.railTitle` names it. It is drawn with **no Plex request**.

4. **`js/discovery.js` — resolve one title, once, and remember.**
   `Discovery.resolve(entry)` → Promise of the Plex entry or `null`:
   - Answer from `Store` under `tmdb:<id>` first — a hit is permanent, a `null`
     is re-checked at most weekly, since a film can be added but is rarely
     removed.
   - Otherwise `Plex.findByGuid` on each server, folded with `Merge.lists`, and
     the answer written back with `_resolved` set on the entry.
   - Never call it for a tile that is merely on screen. Only for the **focused**
     one, and on OK.

5. **`js/browse.js` — `loadDiscover` builds the rows from step 1.** Each
   category is one TMDB call, cached in `Store` for the day, turned into
   entries, and published immediately. Rows appear as they resolve, as they do
   now. **Nothing else in this file changes** — `loadSection`, the hubs and the
   All row are untouched.

6. **`js/browse.js` — resolve on focus.** Where the masthead is already told
   what is focused, call `Discovery.resolve` for a Discovery entry, debounced on
   the same stillness the backdrop uses so sweeping a row resolves nothing. When
   it answers, the masthead says which it is: available, or **`not in your
   library`**. That line is the honest answer the user gets *before* pressing
   anything.

7. **`js/app.js` — OK on something you may not own.** For a Discovery entry:
   resolve first; if held, open the detail page for the resolved Plex entry
   exactly as today; if not, show a message naming the film and saying it is not
   on either server. Never a dead key, never a guard call on an entry with no
   server.

8. **`dev/mock-tmdb.js`** — `/discover/movie` with `with_genres`, results
   carrying titles and poster paths, and a fixture that can fail: a category
   whose titles the mock's servers mostly do **not** hold, so the
   not-in-your-library path is exercised rather than assumed.

9. **`test/tmdb.test.js`** — `catalogue` dispatching on each kind, an unknown
   kind resolving empty rather than throwing, the vote floor still applied, and
   `Discovery.entry` producing something `Plex.tmdbId` can read.

10. **`dev/smoke/discovery.js`**:
    - Discovery draws its configured categories, in order, with posters, and
      makes **zero** `/library/all?guid=` requests to paint — count them, and
      confirm the step fails against an implementation that resolves up front.
    - Focusing a tile resolves exactly one title; sweeping the row resolves none.
    - A focused title the servers do not hold says so in the masthead, and OK on
      it explains rather than doing nothing.
    - A held title opens the normal detail page and plays.
    - Revisiting Discovery resolves nothing again.
    - **The library browse screen's own steps still pass unchanged.**

## Out of scope
- **Replacing the library browse screen**, or moving the server's hubs. That is
  the decision this task exists to inform, not to pre-empt.
- **TV categories** (`/discover/tv`). Films first.
- **`js/art.js`, `js/rail.js`, `js/media.js`, `js/guard.js`, `js/plex.js`.** If
  the entry shape is right, none of them needs to know.
- **A settings screen for categories.**
- **Adding a title you do not own to a watchlist, or linking out to a provider.**

## Definition of done
- [ ] Discovery shows the categories from `js/config.js`, in order, with TMDB
      posters, and paints with **zero** Plex requests.
- [ ] The smoke step proving that fails against an implementation which resolves
      titles up front.
- [ ] Focusing a tile resolves exactly one title; sweeping resolves none;
      returning to Discovery resolves nothing again.
- [ ] A title not on either server is labelled as such in the masthead before OK
      is pressed, and OK explains rather than failing silently.
- [ ] A title that is held opens the detail page and plays exactly as from the
      library screen.
- [ ] The library browse screen is untouched — its steps pass unchanged and its
      request count is no higher.
- [ ] `js/art.js` is not modified.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## What changed

- `js/config.js` — `categories`, the five rows in screen order, as data.
- `js/tmdb.js` — the list calls keep the whole result rather than the id;
  `byGenre`, and `catalogue(category, seeds)` dispatching on `kind`. The
  hardcoded `PROVIDERS` list went with the config change.
- `js/discovery.js` — rewritten. `entry()` builds a TMDB-shaped item with a
  synthetic `tmdb://` Guid; `resolve()` answers from `Store` under `tmdb:<id>`
  and only then asks both servers; `load()` walks `Config.categories`, one TMDB
  request each, cached for the day.
- `js/browse.js` — `loadDiscover` builds from the config and passes seeds taken
  from the Continue watching row already in memory; `scheduleResolve` resolves
  the focused Discovery tile after the same 420ms stillness the backdrop uses.
- `js/masthead.js` — the meta line prefers `item._availability`.
- `js/app.js` — OK on a Discovery tile resolves first, then opens the ordinary
  page or says the film is on neither server.
- `dev/mock-tmdb.js` — `/discover/movie` answers `with_genres` with ids the fake
  servers deliberately do not hold, so the not-held path is walked.
- `dev/smoke/discovery.js` — five steps, counting guid lookups off the wire.
- `test/tmdb.test.js` — `catalogue` dispatch per kind, an unknown kind asking
  nothing, the vote floor, and an entry `Plex.tmdbId` can read.

## What the spec got wrong

- **`files:` omitted `js/masthead.js`.** Approach step 6 requires the masthead to
  say `not in your library`, and no declared file owns that render path — the
  meta line is `Media.railSub(item)` inside `js/masthead.js`, and `js/media.js`
  is out of scope. Added it to `files:` (one line changed) rather than writing
  into `#mh-meta` from `js/browse.js`, which would have been a layering
  violation to avoid a one-line file-list fix.
- **Seeds for the recommended row.** The spec kept `seedsFromViewing`, which
  calls `Plex.onDeck` per server — Plex requests to paint the page, against the
  Definition of done's first line. The seeds now come from `deckItems`, which
  `js/browse.js` already holds from the library section, so the page costs
  nothing.
- **The held-title smoke step does not press Play.** It asserts the ordinary
  detail page opens with a real verdict and a captioned Play button. Gating an
  actual play on `h.playable(verdict)` would be an assertion that passes on
  nothing whenever the mock gives that title an unplayable copy, and
  `dev/smoke/player.js` covers playback. Reviewer accepted.

## Review rounds

1. **PASS** (crew-reviewer). Confirmed the masthead amendment was right rather
   than a block, re-ran `npm run smoke -- discovery` (6/6) and `npm run verify`
   (85/85), and accepted the held-title deviation.

## Graph writes proposed

- **Decision — a Discovery tile is TMDB-shaped until it is acted on.** A tile
  needs only a title and a picture, and TMDB has both. Giving the entry a
  synthetic `Guid: [{ id: 'tmdb://<id>' }]` makes `js/art.js` and
  `Media.railTitle` work unchanged, so the page paints with zero Plex requests;
  a ratingKey is fetched when you rest on a title or press OK. Cost went from
  ~480 guid lookups to one per title rested on.
- **Pattern — a request-count assertion must be seen to fail.** The first
  version of the counting regex in `dev/smoke/discovery.js`
  (`/\/library\/all\?.*[?&]guid=/`) required a separator before `guid`, which
  the real URL (`/library/all?guid=...`) has not, so it matched nothing and the
  "zero lookups" step passed on nothing. Caught only because a sibling step
  asserts a count of *exactly one* — a bound that fails both ways is what keeps
  the counter honest. The negative test then showed 122 lookups against an
  implementation resolving up front.
- **Gotcha — a guid lookup costs one request per server.** `Discovery.resolve`
  asks every server, so "one title" is two requests here. A smoke assertion
  about lookups has to count distinct guids, not requests, or it reads as a
  double.
- **Gotcha — the rail pool is four rows.** A smoke step cannot find a row that
  has scrolled out of the pool; walk to it by its index in the configured list
  (`el._row` is the true row number) rather than by searching the drawn labels.
