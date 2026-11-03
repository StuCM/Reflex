---
title: The browse rework
description: Home, Movies, TV, genre and collection pages, the filter overlay and the settings behind them — designed 2026-10-04, not yet built.
---

# The browse rework

Designed in conversation on 2026-10-04, from the planning brief of the same
day. Nothing here is built. The tasks it produces are section 0e of the
[backlog](/backlog), in the order they should be taken.

## What the server is, and why that decides everything

The library holds almost every film ever made and lacks only what is new in
cinemas. TV is current. That changes the problem from "what do we have" to
"which of the things we have is worth showing" — a Plex genre listing for
Science Fiction is thousands of titles nobody has heard of, and Plex has no
measure of fame to sort them by.

So **TMDB chooses and Plex answers where.** Every row and every grid is a TMDB
query; Plex is asked only for the copy of the film the focus lands on. The
vote-count floor is the fame dial: popularity says what is talked about this
week, vote count says what has been known for decades.

Consequences worth keeping in view:

- Rows never need an index to be filtered — TMDB does the filtering.
- "Not on the server" is rare and almost always means *in cinemas*. Such titles
  are shown marked, not hidden: hiding needs every tile resolved before it is
  drawn, which is the crawl.
- New films come from TMDB's **digital** release type (`with_release_type=4`,
  `region=GB`, released in the last ~60 days), not from cinema release dates.
  That is roughly what the server has just been given.

## Three things that block all of it

1. **The guard refuses non-4K files it could have transcoded.** When the server
   offers direct play (it applies its Chrome profile, because we say Chrome) of
   a format the panel does not list — a `.mov` trailer is the likely case —
   `guard.check` returns `state: 'codec'` and refuses. It never asks again with
   `directPlay=0`. Below 4K it should, and accept the transcode. 4K is
   unaffected: the owner's kill-stream is about the transcode, not the audio.
2. **Discovery never finds anything on the real server.** It asks
   `/library/all?guid=tmdb://<id>`. The mock answers that; a real server almost
   certainly matches only `plex://` guids, which is why the film page's
   other-copies lookup works (it tries the `plex://` guid first) and discovery
   does not. Confirm with one request against a real server before building.
   If confirmed: resolve on focus by title and year, and verify against the TMDB
   id in the result's `Guid` array. One request per focused tile, cached.
3. **TMDB rows end.** `trending()` and `onProvider()` in `src/api/tmdb.ts` fetch
   page 1 and stop, then drop anything under the vote floor — so a row is often
   a dozen titles. They should be virtual the way the All row's `merge` rows
   already are: near the end, fetch the next page. TMDB serves 500.

The one-time index from the brief is **no longer required** by any of this. It
would make resolution instant, and stays a candidate if focus-time lookups feel
slow on the B8 — as one pass per server, then incremental, which is a change to
CLAUDE.md's "do not full-crawl" rule and should be written as one.

## The pages

| Page | Holds |
|---|---|
| **Home** | What is happening: Trending, Popular films, Popular TV, and new on each chosen service. |
| **Movies** | Rows across every film — New to home release, Popular now, Top rated, Classics — a row of collection tiles, and *All films* as a grid. |
| **TV** | The same shape, on TMDB's TV genres (which are coarser: Sci-Fi & Fantasy is one). |
| **Collection page** | One per collection. The same row types, narrowed to the collection, plus *All of it* as a grid. |
| **Server grid** | Plex's own A–Z listing, paged as it is scrolled. For when you know it is there. |

Movies and TV are sidebar entries, not a choice screen: that is a page and a
press saved on every visit.

Server hubs leave the menu. Plex's Recently Added is dropped outright — on this
server it is a firehose of obscurity.

### Rows are filters

A row is a title plus a query. *Classics* is "before 1990, at least 2,000 votes,
by rating"; *Newly released* is "digital release in the last 60 days, by
popularity". OK on a row's header opens the same query as a full grid with its
filters already set in the overlay, where any of them can be changed.

That is what lets rows and filters share a page without contradicting each
other: a page with no filter applied is rows; applying one turns it into the
grid. It is also what makes pages configuration rather than code.

### Classics, and any row whose point is variety

A pool of ~200 (ten TMDB pages) cached weekly; a sample of 20 shown. **Shuffled
once a day, not per visit** — reshuffling on every return means BACK loses the
film you were looking at. Fisher–Yates, never `sort(() => Math.random() - 0.5)`:
that is biased everywhere and worse on Chromium 53's unstable sort.

## Collections, not genres

A genre is too blunt — Sharknado and Arrival are both science fiction. What is
actually wanted is **curated collections**: a named recipe over everything TMDB
can filter on, of which a plain genre is just the simplest case. So there is one
concept, and genre pages are collections whose recipe is one genre id.

What TMDB's `/discover/movie` gives a recipe to work with:

| Ingredient | Parameter | Example use |
|---|---|---|
| Genres in / out | `with_genres`, `without_genres` (`,` is AND, `\|` is OR) | Sci-fi without Horror |
| Keywords in / out | `with_keywords`, `without_keywords` | disaster, heist, time travel, creature feature |
| Production company | `with_companies` | The Asylum — the Sharknado house |
| People | `with_people`, `with_cast`, `with_crew` | a director's films |
| Release window | `primary_release_date.gte/.lte` | a decade |
| Fame | `vote_count.gte/.lte` | the floor; a ceiling for deep cuts |
| Quality | `vote_average.gte/.lte` | a *ceiling* is how "so bad it's good" is found |
| Runtime | `with_runtime.gte/.lte` | under 100 minutes |
| Language | `with_original_language` | Korean cinema, anime |
| Certification | `certification_country`, `certification.lte` | family; ties to kids mode |
| Services | `with_watch_providers`, `watch_region` | Home's service rows |

Plus two non-query sources: a **TMDB list** by id (someone else's curation,
fetched), and a **fixed set of ids** (ours, frozen until re-snapshotted). That
is the brief's category/collection split, kept where it is real — whether
membership changes by itself — and dropped as a menu heading, since it is about
where data comes from and nobody browses by that.

Starting set to build and tune, every one a recipe rather than a code change:

- **By genre, sharpened:** Space opera · Cyberpunk · Time travel · Heists ·
  Spy films · Martial arts · Westerns · War films · Courtroom dramas
- **By shape:** Disaster films · Creature features · Survival · Heist ·
  One location · Under 100 minutes
- **By taste:** So bad it's good (The Asylum, low average, enough votes to be
  known) · Cult classics · Overlooked (high rating, low vote count)
- **By subject:** Historical epics · True stories · Documentaries ·
  Nature documentaries · Music documentaries · Sports
- **By origin:** Korean cinema · Anime films · French cinema · Bollywood
- **By people:** Directors' collections, one recipe per director

TMDB keyword ids are resolved by name at authoring time (`/search/keyword`),
never typed from memory, and a recipe is checked by running it and reading the
first page before it ships — keywords are user-tagged and some are noise.

## The filter overlay

One colour key opens it on any page with rows or a grid. It is small and
central, and the grid stays visible around it.

```
                 ▲  Type: Space opera
                       (next: Cyberpunk)

 ◀ Period: 1980s        [ Sci-fi ]        Sort: Top rated ▶
   (next: 1970s)         1,240 films         (next: Newest)

                 ▼  Well known
                       (next: Deep cuts)
```

- Each arrow is one filter, and a press steps it to the next value, wrapping.
  What the next press gives is printed under the current value.
- The grid behind refreshes live, one TMDB request ~400ms after the last press.
- Number keys set the decade outright: 7, 8, 9 for the 70s–90s, 0, 1, 2 for the
  2000s–2020s.
- OK, BACK or the same colour key closes and keeps the filters; another colour
  key resets them.
- With no collection chosen ▲ has no sub-genre to offer, so it carries Runtime
  or Language instead.

The cost of stepping one way: a filter with *n* values can take *n*−1 presses to
go back one. So **no filter carries more than six values**, and Period is exempt
because the number keys make it one press. Collection is never a filter — there
are too many — it is chosen from the tiles.

"80s top-rated space opera" from the Movies page: the tile, the colour key, 8,
▶. Four presses.

To be tried as a laptop mock driven by the keyboard before it is specced:
whether one-way stepping feels right is a question for the hand, not the page.

## Settings

Settings are the same configuration the pages are built from, with the user's
changes laid over the defaults. Two kinds, and they belong in different places.

**Choosing — on the TV.** Everything that is a toggle or an order:

- Home: which services feed it (Netflix 8, Prime Video 9, Disney+ 337,
  Apple TV+ 350 — ids to be checked against `/watch/providers/movie` for GB),
  and which rows show, in what order.
- Movies and TV: which rows show, in what order.
- Collections: which appear as tiles, in what order; hide any.
- Genres excluded everywhere — a global `without_genres` on every query, so
  "never show me horror" is one setting rather than a filter per page.
- The default fame floor.

All of it is lists of on/off rows with ▲▼ to move one, which the existing menu
shell (`src/view/menu.ts`) already draws.

**Authoring — not on the TV.** Writing a recipe means keyword lookups,
companies and vote ranges; doing that with a d-pad is miserable and nobody
would. New collections are written as JSON off the TV and loaded at boot. The
mechanism exists: `window.REFLEX_CONFIG` already overrides `core/config`. The
open question is where the file lives — baked into the package, or fetched from
the VPS so a new collection needs no reinstall.

**Where settings are stored is a decision, not a detail.** They are the first
user-made data the app holds. `localStorage` survives a reinstall over the same
app id but not an uninstall, which also takes the Plex token. Store only the
user's *differences* from the defaults, so a wiped store falls back to something
sensible, and give them an export — or keep them on the VPS beside the authored
collections, which answers both questions at once.

## Still open

- Does a real server answer `guid=tmdb://`? Decides how task 2 is built.
- Is "rows are preset filters, a filter turns the page into a grid" right in the
  hand, or should filters apply across the rows?
- Should *In cinemas* be a row at all, given none of it plays?
- Collection JSON: packaged, or fetched from the VPS?
- Settings storage: local with export, or the VPS.
- IMDb's Top 250 has no API. TMDB's rating with a vote floor is the stand-in,
  labelled as TMDB's; OMDb is the alternative at another key and 1,000 a day.
