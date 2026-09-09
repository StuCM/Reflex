# Decisions

The readable record. The memory graph owns the *links* — what supersedes what,
what a decision touches, where it lives in code. This file owns the *prose*,
and is the fallback when the graph is not running.

Neither restates the other. A decision here carries enough for a human to
understand it without the graph; the graph carries enough for an agent to
traverse it without this file.

Newest first. One entry per decision, appended by the orchestrator at
`/crew-close`.

---

## 2026-09-10 — The layering, and the case for a bundler

`js/` became six directories — `core`, `api`, `data`, `rules`, `view`,
`screen` — and the boundaries are checked rather than trusted: `npm run check`
now fails on a request opened outside `api/`, on `Store` addressed outside
`data/`, and on the DOM, a request or the cache reached for from `rules/`.
Every rule was confirmed by planting a violation and watching it go red, and
the first run found a real one — the debug beacon in `core/ui.js` had its own
`XMLHttpRequest`.

The premise it started from was only half right. "Separate the frontend from
the functionality" was already true of most of the tree: fifteen files touched
no DOM and four were view-only. What was genuinely wrong was the cache.
`store.js` was a key/value store that knew nothing about what it held, and
seven files had invented their own key strings, five key conventions, two
incompatible ways of stamping an entry with a time, and an invalidation that
wrote `null` into a row. `data/cached.js` now owns all of it, and there are
zero `Store` call sites outside `data/`.

Three real duplications went with it: `api/http.js` (three copies of the same
forty lines of XHR, plus a byte-identical `qs()`), `view/glyphs.js` (two copies
of the same SVG builder), and the cache above. A fourth — a shared audio/
subtitle/quality row model between the film page and the player — was specced
and then abandoned on reading the code: they ask the same question from
genuinely different information, `Panel.features()` with nothing playing versus
the live `audioTracks` list, so there is no shared implementation to extract.
Only five duplicated strings, which is not an abstraction.

PR #1's ES2015 pass was redone here rather than merged. It had branched 217
commits back, and `git merge-tree` gave twelve conflicting files where GitHub
reported the branch mergeable — its diff was `var`→`const` applied to text that
no longer existed. The lesson is cheap to apply: GitHub's mergeable flag is
computed against a cached base, and `git merge-tree --write-tree` is the local
truth. Redone by acorn codemods that splice source text rather than reprint it,
so comments and alignment survived, and that refused what they could not prove —
notably a loop counter captured by a closure, where `let` gives one binding per
turn and `var` gives one, which is a behaviour change and not a rename.

Then the harder question, asked by the user rather than by us: is "no bundler"
a constraint or a habit? It is a consequence — Chromium 53 has no
`<script type="module">`, so `import`/`export` is only reachable through a
bundler, which is why `js/` is thirty globals and a hand-ordered script list.
But the consequence points *at* bundling, not away from it, and the case turned
out stronger than expected. `esbuild --target=chrome53` downlevels `async`/
`await` and object rest, so the syntax bans in CLAUDE.md are the price of
having no compiler rather than anything the panel imposes; `tools/check-es5.js`
is a regex scan its own header calls "not proof", where a compiler is proof.
Proven: the thirty files bundled and put on the B8 browse at 3.0s with 92/92
smoke, and `data/meta.js` rewritten as a real `async` function produced a
bundle with no occurrence of `async` in it.

The one reservation was debugging on the panel, and the deploy killed it.
`ares-package` minifies every file in `js/` unconditionally — `rules/media.js`
ships as 7.5KB of `function n(e)` — so the TV has never run the source in this
repo, and a source map cannot survive a pipeline that re-minifies whatever it
is given. Bundling cannot make that worse.

So: bundle, then modules, then types — but not in the same branch as the
layering, which was already thirteen commits across forty files and exactly the
shape PR #1 died in. Features are frozen until it is done.

---

## 2026-09-09 — A night of refactors, and five tests that proved nothing

Two files made every task wait on every other: `dev/smoke.js` at 3,344 lines and
`css/app.css` at 944. Every UI task declared both, so no two could run at once
even when they shared no logic. Splitting them bought real parallelism — the
next pair of feature tasks ran concurrently for the first time, and a worker now
iterates against one smoke area in 4–50 seconds instead of the full 2m37s.

The stylesheet split carried the design tokens and the palette correction:
`--ac` to the design's own `#9d93d6`, and the hero gradients to the darker
`rgba(9,10,17,…)` the design fades to rather than to the background itself. Both
came from `design/Mantis Screens.dc.html`, which carries **seven palettes as
data** with `sage` as the export default — the file and the screenshots never
disagreed, the default simply was not the author's selection.

The lasting finding is about the suite. **Five assertions in one day passed on
nothing**, each failing differently:

- a lookup counter matching a path the endpoint no longer visited;
- a request bar set from an assumed cost of one per tile when it is two;
- `indexOf("0:00 /")` after the clock split into two elements;
- a step looking for a wrong picture *during* a sweep, when a Playwright round
  trip is slower than the 160ms settle — it read after the rail had stopped and
  passed on the broken code;
- a request counter whose regex wanted a separator the real URL has not got, so
  "zero lookups" passed on an empty count.

The first three are one mistake: asserting an absence, or indexing into markup
that moved. The fourth is worse — the right assertion at the wrong moment, which
re-reading never catches; a transient state must be read page-side, in a listener
registered after the app's own. The fifth is worse again, because "zero" cannot
be told from "broken collector": a counting step needs a companion asserting a
non-zero count, or a run against an implementation that does the wrong thing.

All five are rules in CLAUDE.md now, and one habit caught the last three: run the
step against `main` and watch it fail before trusting it pass.

Two specs also contradicted themselves. 018's "for a show, scrobble the show's
rating key" branch was unreachable — `Plex.onDeck` only yields movies and
episodes — and scrobbling the episode merely advances the deck, so the
prescribed behaviour would not have fixed the complaint it was written for.
023's Definition of done demanded zero Plex requests while its own Approach left
`seedsFromViewing` calling `Plex.onDeck` per server.

---

## 2026-09-08 — What landed between the artwork and the refactors

Recorded late and together, because the entries for these were written with
string replacements whose anchors silently failed to match — the same shape of
no-op the tests above kept producing, in the tooling used to write them down.

- **The rail went portrait** (209×314, seven across). A poster is never a
  backdrop, so "the tile must not repeat the hero" stopped needing a fallback
  ladder, and Plex hands an episode its show's poster as `grandparentThumb` for
  nothing. Choosing the right shape deleted the machinery rather than organising
  it. It also found `Rail.render` holding `firstVisible = rowIdx - 1` — a
  hand-typed row of context from when two rows fitted.
- **An episode is never a dead end**: OK on one opens its series at that
  episode. Resolution runs upward, since episodes rarely carry ids of their own
  but shows do.
- **Up next waits by default**, and never counts down across a season boundary —
  these are someone else's servers, and an unattended chain is load on hardware
  we do not own.
- **Recaps are fetched only when asked for.** A search costs 100 of a 10,000/day
  quota, so a self-filling rail would spend the budget in a hundred page views.
- **The choosers replaced the copy list**, and the player's menu was shared
  rather than written twice — `js/menu.js`, with `js/player.js` losing 171 lines.
- **The player's controls** took the design's shape. Two things in that design
  were deliberately not built: an "Auto — follows the connection" quality row we
  do not implement, and chapter thumbnails Plex often has not got.

---

## 2026-09-07 — The header keeps the picture, and one request carries the film

Stepping off the top row used to throw the screen away: the hero collapsed to a
132px band and the backdrop was set to `opacity: 0` outright, so the moment you
started browsing you had a title and some tiles. It is now a 264px header that
keeps the backdrop at half opacity, with the title and the run time or episode
on the left and a description and the key actors on the right. The detail page
wears the same shape, so OK reads as one screen deepening rather than a second
design.

The description, the run time and the cast cost **nothing**. `js/art.js` was
already making one TMDB request per title for its backdrops;
`append_to_response=images,credits` carries the overview and the billing on that
same request. The alternative — Plex's own metadata — is a fetch against servers
we do not own for every tile the focus rests on, which is exactly what had been
removed earlier the same day. `include_image_language=en,null` is not optional:
without it the appended images block is filtered to the request language and
most backdrops vanish.

Two couplings the spec missed and the worker found. `dev/smoke.js` counted
artwork lookups by matching `/__tmdb/movie/<id>/images`, a path the new endpoint
no longer visits — so the "looked up once per title" step would have gone on
passing against zero lookups. And `js/detail.js` overwrote the summary with
Plex's once metadata landed, which would have had the detail page describe a
film differently from the header it is meant to echo. Both are the same shape of
bug: an assertion or a fallback that keeps working after the thing underneath it
has moved.

`crew/bin/scope-check.js` defaulted its base to `origin/main` on the reasoning
that a stale local main makes every commit since the fork look like scope creep.
In this repo the assumption is inverted — workers never push, so `origin/main`
is the stale one, and the gate reported twenty files of already-landed work.
It now uses the merge base of HEAD and the base branch, which is right whichever
tip is ahead.

---

## 2026-09-07 — A copy is a library on a server, not a server

Six libraries across two servers — `Movies - 4K UHD`, `Movies - LQ`,
`TV Shows`, `TV Shows 4K`, `TV Shows - Anime` — meant six entries in a menu
driven by a d-pad, and, because every section builds its own Continue watching
row, a growing pile of identical `Continue watching` entries beside them. That
pile was self-inflicted: dropping the per-section type filter earlier the same
day made those rows identical.

Sections are now grouped by `type` rather than by title and type, so every
movie library on every server is one Movies section and every show library one
TV Shows. `artist` and `photo` libraries are dropped outright — this app plays
neither. Continue watching is promoted above the sections with Movies and TV
Shows as cuts of it. Almost none of this cost anything: a section was already
`parts: [{server, key}]` and `Merge.stream` already walked any number of them,
so folding six libraries into two is a change to how they are *grouped*.

What it did cost was a rule nobody had had to state. `Merge.combine` returned
early when two copies shared a `_server`, with a comment explaining that a film
listed twice by one server is two editions in one library and not what
`_sources` is for. That was true while one section meant one library. It stops
being true the moment a section spans several: the same film in a 4K library
and an LQ one is two copies that play differently, and folding them kept
whichever the walk reached first. On this account that is often the 4K TrueHD
remux the guard refuses — leaving the playable copy invisible, which is worse
than the six-section browse this replaced.

So a copy is identified by `_server + '/' + _part`, with `_part` stamped in
`fetchInto` where the stream already knows which library a page came from, and
carried through `slim`. The compatibility line is that `Merge.lists` — onDeck,
the hubs, search — has no parts at all, so those items key as `server/` and
fold per server exactly as before. The consequence, accepted rather than
overlooked: **search results and hub rows still show one copy per server**, so a
film's second same-server copy is reachable only by browsing the All row.

The spec asserted `js/merge.js` needed no change and put it out of scope. It
was wrong, the worker stopped rather than guessing, and the block was upheld —
the alternative was relaxing the definition of done and shipping the hidden
copy. Widening `files:` mid-flight is the orchestrator's call precisely because
the deciding fact — what this user's libraries actually look like — is one the
worker cannot see.

A quieter finding matters as much. The mock gave Main's `4K Films` library the
*same objects* as its `Films` library, same `ratingKey` and all, so no test
could have told a correct deduplication from a dropped copy. A fixture that
cannot fail is worse than no fixture, because it reads as coverage. The 4K
library now holds its own copies, and reverting `copyKey` to `_server` was
confirmed to turn the suite red.

---

## 2026-09-07 — The hero stops being the tile blown up, and TMDB is why

The browse screen looked unfinished because the backdrop behind the focused
tile was the same picture as the tile. That was not a layout mistake: Plex
holds exactly two images per item, `art` and `thumb`, and both surfaces reached
for `art` first. There was no second picture to reach for.

TMDB holds many backdrops per title and was already wired into this app for the
discovery rows, inert only because no key was set. `js/art.js` now takes the
best backdrop for the hero and the second best for the tile. It also moves
image load off servers we do not own — every tile used to be a
`/photo/:/transcode` someone else's box generated on demand.

The shape that matters is not the TMDB call, it is that nothing waits for it.
`Art.tile` and `Art.hero` answer synchronously, from cache or from the Plex
fallback, and `Art.warm` notifies when the lookup lands so that one tile and
the backdrop are reassigned in place. A rail that awaited a network answer
would stall browsing, which is the one thing this app exists to fix. Misses are
cached as well as hits, or an obscure film costs a request every time its row
is walked past. With no key, `Tmdb.enabled()` is false, `Art.warm` returns at
once and every surface falls back to what `main` drew before — the same
behaviour by construction, not by a branch.

Episodes never ask TMDB at all. Their Plex `thumb` *is* the still, which also
closed a backlog item on the way past.

Two things were found rather than planned. `Rail.drawRow` keyed pool reuse on
the row *index*, and `Browse.runSearch` replaces the rows in place with
`rowIdx` still 0 — so the results page drew the right header over the previous
row's tiles. Any pooled renderer keyed on position has that bug waiting in it;
it is now keyed on the row object as well. And `test/load.js` runs the app in a
`vm` sandbox, so cross-realm checks fail: `instanceof Array` is false for an
array made in the test's realm, and `deepStrictEqual` rejects sandbox objects
on prototype identity alone.

The same task settled where the API key lives. The TV has no environment and no
build step, so `.env` cannot reach it — whatever `js/config.js` says on disk is
what the panel gets. `tools/package.sh` now writes the key into the *staged*
copy from `TMDB_KEY` or a gitignored `.env`, and refuses to package if the
substitution does not match. The repo stays clean, which is the point: it is
public.

Not done, deliberately: portrait posters in the rail, and TMDB logo art
replacing the hero's text title. Both are layout changes, not artwork sources.

---

## 2026-08-15 — Agents work through a spec-first loop, not a conversation

Several agents run in one evening each rediscovered the codebase, re-solved
deployment, and chased failures that were environmental rather than real. The
cost was not the number of agents; it was that each one started from nothing.

So: work goes through `.claude/crew/`. The orchestrator is the main session
rather than an agent, because a subagent cannot talk to the user. A spec naming
files and call sites is written and approved before any worker starts — that is
where the token spend is won, since a briefed worker does not explore. The
commit convention, the scope check and the environment ceiling became scripts,
because a rule in prose is paid for by every agent that reads it and a rule in
a script is free forever.

Two human gates: the spec, and anything only the panel can prove.

Supersedes nothing — this is the first process decision recorded.

## 2026-08-15 — Conventional commits, and no attribution footers

Commit history to this point is prose-imperative with long explanatory bodies
(`Give the player the rest of the film`, plus six paragraphs). Going forward:
`type(scope): summary`, four-line body cap, and no `Co-Authored-By` or
generated-by lines.

The reasoning that used to fill commit bodies belongs in the graph, where it
can be superseded and traversed, rather than in a message that can never be
revised. History is not rewritten.

Enforced by `.claude/crew/bin/commit-msg.js` via `core.hooksPath`, so it costs
no agent tokens and cannot be talked past.

## 2026-08-16 — A green baseline is a load-bearing thing

`npm run verify` on a fresh clone was red, and not because anything was broken:
`dev/fixtures/` is gitignored, so there is no video, and the mock 404s the route
that serves one. The failure was real output from a working system.

The cost was never the minute it takes to explain. It is that a red baseline
teaches everyone — human or agent — to explain failures away, and the next real
regression gets explained away with the same shrug. It had already happened
once: the 404 was read as a gap in the mock's transcode handling, which it is
not.

`verify` now generates the fixture if it is missing, and the console-error step
excuses that 404 **only while no fixture exists**, saying how many it ignored.
The earlier fix (537e26a) excused the path unconditionally, which also hid a
genuine transcode failure when a fixture was present — the exact thing the step
is there to catch. This supersedes it.

`npm run smoke` deliberately does *not* generate the fixture. If it did, the
no-fixture branch of that filter would never run again and could rot unnoticed.

Two smaller rules fell out of it, both recorded in the graph: a script joining
an `&&` chain inherits the chain's exit semantics, and the orchestrator's spec
edits must be committed before the task worktree is cut, or the worker reads a
stale spec.

## 2026-08-16 — Choosing an audio track, and what a direct play actually gives you

Choosing a different audio track did nothing. The OSD renamed it and the first
track kept playing.

On a direct play the server hands over the original file whole, every track
still in it, and the panel plays whichever it likes. `audioStreamID` on the
decision call is advice to the decision engine and changes not one byte of that
file — so restarting playback with a different id re-fetched the same bytes.
The code even said so in a comment and then did the thing the comment ruled out.

Two things work, and the panel decides which. It exposes `audioTracks` and we
select on it: instant, no restart, nothing asked of the server. Or it does not,
and direct play has to be given up (`directPlay=0`) so the server muxes — a real
session, and on a 4K file the guard refuses it by the ordinary rule, because
`Media.allows` does not know *why* a stream isn't direct. A forced mux, a
quality cap and the server's own choice all refuse 4K identically. No special
case was added for audio, which is the point.

Desktop Chrome exposes no `audioTracks` at all, so which path the B8 takes is
unknown until it runs there. The task is merged and **pending-tv**: the code is
reviewed and the suite is green, but the behaviour this change exists for has
never been observed.


## 024/025 — a design file can contradict the report that motivated it

*2026-09-09.* Two tasks fixing faults reported from the panel, run in parallel
now that 020 had split the stylesheet and 019 the smoke suite.

The ordering was the real fault. Both lists had been recorded in
`docs/backlog.md` and left there while refactors and new features went ahead. A
backlog entry is not a task and nothing dispatches from one, so a thing the user
had already said was wrong sat still while new work shipped past it. Faults the
user has reported outrank anything new.

**Screen 6c draws the film page's round buttons at 70px — smaller than the app's
88.** The spec, derived from the design file, told the worker to grow them to
"the design's size"; obeying it would have made everything-but-Play smaller,
which is the opposite of the complaint that produced the task ("the buttons are
too big for play and everything else is too small"). Only Play changed, from a
280px slab to a pill sized by its own text. Where the design and the report
disagree, the report is the one with a person behind it.

The same shape appeared in the player: **nothing there was ever two sizes.**
Every `.osd-btn` was the shared 88px, so "the play button and navigate next
buttons are different sizes" can only have been the *glyphs* — the play triangle
sat inset in its box where the double triangles did not. Reading the complaint as
being about the boxes would have produced a real change that fixed nothing.

Two files were owned by neither task by design — `css/base.css` and
`index.html` — with both specs told to stop and report rather than reach for
them. Both did. The consequences (`--c-play` dead once Play became a pill, and
the harness's three ▲-pressing control helpers dead once the player area
shadowed them) were cleared here, at the merge, which is where a shared file
belongs. That is the fix for the deadlock 019 and 020 hit, where two tasks each
needed one line in a file neither could write.
