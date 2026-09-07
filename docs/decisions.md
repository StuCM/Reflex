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
