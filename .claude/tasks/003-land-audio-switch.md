---
id: 003
slug: land-audio-switch
status: pending-tv
env: laptop
branch: crew/003-land-audio-switch
files:
  - js/player.js
  - js/panel.js
  - js/guard.js
  - js/plex.js
  - js/app.js
  - dev/smoke.js
  - dev/mock-plex.js
  - CLAUDE.md
---

# Land the audio-switch fix stranded on claude/player-features

## Goal

`57407f1` "Actually switch the audio track" exists, is finished, and is on no
branch that leads anywhere. Get it reviewed and merged, or deliberately
rejected — not left where it is.

## Why now

It fixes a bug the app currently has in `main`: choosing an audio track renames
it in the OSD and keeps playing the first one. On a direct play the server hands
over the whole file and `audioStreamID` changes not a byte of it, so the restart
re-fetched identical bytes. The commit's own message says the old code "said so
in a comment and then did the thing the comment ruled out."

It was found by the collision check that does not exist yet (002) — the branch
was invisible while task 001 was specced against the same file.

## This is not a build task

**Do not reimplement any of it.** The work is written. This task is the review
and the merge that never happened. If the reviewer rejects part of it, say so
and stop; do not rewrite it into something new.

## Graph context

<!-- Inlined by the orchestrator. Do not re-query. -->

- Pattern **"crew's collision check cannot see unmerged branches"** — this
  branch is the case that produced that trap.
- Decision **"build the declared Plex client profile by asking the panel, not
  by hardcoding it"** — `js/panel.js` already reports whether the pipeline
  exposes `audioTracks`; this commit is the first thing to consume that.
- Decision **"direct play only, no transcode playback path"** — superseded in
  part already (below 4K a transcode is allowed). This commit leans on that:
  when the panel has no track list, it gives up direct play so the server muxes,
  and on 4K the guard refuses by the ordinary rule.

## Constraints that bite here

- `js/` is Chromium 53. The commit predates nothing here, but `npm run check`
  is still the arbiter.
- 4K must direct play or not play. The commit claims it honours this via
  `Guard.check` rather than a special case — **verify that claim specifically**,
  it is the project's one hard rule.
- `dev/smoke.js` is the file 001 just changed on `main`. `git merge-tree` says
  the merge is currently clean, but re-check before merging.

## Approach

1. `git merge-base main claude/player-features` and read the two commits on the
   branch (`537e26a`, `57407f1`) in full. `537e26a` is **already superseded** —
   `main` now has 001's conditional version of the same filter. Expect the merge
   to keep 001's.
2. Run the suite on the branch merged into `main`, in a detached worktree so
   nobody's checkout moves:
   `git worktree add --detach /tmp/003-check main && cd /tmp/003-check && git merge claude/player-features`
3. Spawn `crew-reviewer` against the merged diff, with one instruction beyond
   the usual: judge whether the 4K rule still holds when the panel has no
   `audioTracks` and direct play is given up.
4. Report: merge cleanly, merge with fixes, or reject with reasons.

## Out of scope

- Any new feature. Including anything the commit message says would be nice.
- Rewriting the commit. Its history and message stay as they are.
- The skip-intro fix it also carries — it rides along; do not extend it.

## Definition of done

- [x] the branch is merged into `main`, or rejected with written reasons in
      this file
- [x] `npm run verify` is green on the merged result — 28/28, not 26/26; the
      commit adds two smoke steps (see Outcome)
- [x] the 4K rule is explicitly confirmed to hold on the no-`audioTracks` path
- [x] `537e26a`'s unconditional 404 filter did **not** come back — `main` keeps
      001's `hasFixture()`-gated version
- [ ] `.claude/worktrees/player` and `/tmp/verify-audio` are removed once the
      branch has landed

## Outcome

**Merged, not rejected.** `57407f1` is landed on `crew/003-land-audio-switch` as
an ordinary merge commit — history and message untouched, nothing reimplemented.
The orchestrator lands it on `main`; a worker never merges there.

`537e26a` turned out to be **already in `main`** — it is the merge base, not a
commit on the branch. Only `57407f1` was outstanding, so the "expect the merge
to keep 001's version" step had nothing to resolve. The merge was clean.

What changed, per file (all of it is `57407f1`'s, unmodified):

- `js/plex.js` — `playbackParams`/`decide`/`transcodeUrl` take an `opts` object
  instead of a trailing `maxBitrate`; `directPlay` is now `0` for either a
  bitrate cap or `forceStream`.
- `js/guard.js` — `check` takes the same `opts`, carries `forceStream` onto the
  verdict, and names a copy-copy verdict `direct stream` rather than a
  transcode.
- `js/player.js` — the fix: select on the panel's own `audioTracks` when it has
  them, otherwise `forceStream` and restart; `applyChosenTrack` at
  `loadedmetadata` and again at `playing`; the OSD says *panel's choice* when it
  did not choose; menu rows say which switches restart. Also the skip-intro
  dismissal now lasts only as long as the marker it dismissed.
- `js/app.js` — passes `opts` through `onSwitch` and `transcodeUrl`.
- `js/panel.js` — untouched. It already reported `audioTracks`; this is the
  first consumer.
- `dev/mock-plex.js` — answers `directstream` (or `transcode` for TrueHD/DTS-HD
  MA) when the client sends `directPlay=0`.
- `dev/smoke.js` — two new steps, one renamed; failures now print the app's last
  five trace lines.
- `CLAUDE.md` — the player section explains why choosing a track costs
  something.

### The 4K rule on the no-`audioTracks` path — confirmed

Traced independently by me and by the reviewer, and it holds **by the ordinary
rule, with no special case**:

    chooseAudio → no panel track → switchTo({ forceStream: true })
    → Guard.check(..., { forceStream: true })
    → playbackParams: directPlay = (maxBitrate || forceStream) ? 0 : 1
    → the server cannot answer 'directplay' → guard's `direct` is false
    → Media.allows(media, false) === !isUHD(media) → a 4K file is refused
    → app.js sees !v2.ok, toasts why, and the film keeps playing

`Media.allows` does not know or care *why* a stream is not direct, so a forced
mux, a quality cap and the server's own choice all refuse 4K identically.
`test/audio.test.js:95-98` covers it. No path was found where `forceStream` is
dropped such that a 4K switch reports `directplay`.

### Why `pending-tv` and not `done`

The laptop proves the logic and nothing else. Desktop Chrome exposes no
`audioTracks` at all — the smoke test stubs a list in to exercise the mapping —
so **which of the two paths the B8 actually takes is unknown until it runs
there**, and that is the whole point of the change. The `panel` chip reports the
answer on the TV. The fallback path is untestable here for a second reason:
Chrome rejects any response at a `.m3u8` URL before reading a byte, so the smoke
test asserts everything up to the bytes and stops.

What to check on the panel: whether the `panel` chip says `audioTracks`, and
then that choosing a track in the menu changes what you hear — instantly if the
chip says yes, after a restart if it does not.

### Where the spec was wrong

- **`537e26a` is not on the branch.** It is the merge base and already in
  `main`. Approach step 1 assumed two commits to merge; there was one.
- **The baseline is 28/28, not 26/26.** The commit adds two smoke steps and
  renames a third, so 26 + 2 = 28. DoD item 2 is met at 28/28 green.
- **`scope-check` flags three files it should not.** It bases on `origin/main`,
  which is two commits behind local `main`; the three `.claude/tasks/*.md` hits
  are unpushed `main` commits, not this task's work. `git diff --stat main HEAD`
  is exactly the seven declared files. Task 002 may want this.
- **The worktree cleanup (DoD item 5) is left for the orchestrator.** The branch
  has not landed on `main` yet, which is the condition the DoD itself sets, and
  removing another session's worktree is not a worker's to do. Both
  `.claude/worktrees/player` and `/tmp/verify-audio` are still there.

## Review rounds

<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

### Round 1 — `crew-reviewer` — **PASS**

Read the spec, `57407f1` in full, the whole `git diff main HEAD`, and re-ran
`npm run verify` independently: 28/28.

- Verified the 4K chain hop by hop rather than trusting my summary, including
  the mock's new `directPlay=0` branch in both its lossless and non-lossless
  sub-cases. Found no path where `forceStream` is lost. Rule holds.
- `switchTo`'s carry-forward is right, and is not what fixes this case —
  `chooseAudio` sets `forceStream` explicitly. The carry-forward stops a *later*
  switch (a version change mid-forced-session) from reverting to `directPlay=1`.
- `panelIndexOf` refusing to map across mismatched list lengths is the correct
  conservative call; a positional guess would silently select the wrong track,
  which is the class of bug the commit exists to fix.
- No ES5/Chromium-53 violations in `js/`. The one `Object.defineProperty` is in
  `dev/smoke.js`, which is never packaged.
- `537e26a`'s unconditional filter did not come back — the region is
  byte-identical to 001's `hasFixture()`-gated version.
- Agrees a `guard.js` unit test is a follow-up task, not a change to this diff:
  `test/` is not in this spec's `files:`.

Non-blocking observation raised: the new `direct stream` label branch is
unreachable dead code.

**Worker's correction to that one point:** it is unreachable *against the mock*,
not on a real server. `playbackParams` always sends `directStream: 1`, so a real
Plex server answers `directstream` with both streams copied for any container it
must remux — an MKV that will not direct play, which is most of this library —
while `directPlay` is still `1`. `detail.js:195,210` and `showpage.js:100` call
`Guard.label` on every copy, so that is exactly where the new label will show
up. The mock only produces `directstream` under `directPlay=0`, which is why it
looks dead from the harness. No change needed; recording it so nobody deletes
the branch as dead later.

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->

**Decision — "audioStreamID cannot pick a track from a direct-played file"**
(already in project memory as `direct-play-blocks-audio-choice`; this is the
commit that acts on it). A direct play hands over the original file whole, every
track in it, and the panel plays whichever it likes. `audioStreamID` is advice
to the decision engine and changes not one byte. Exactly two things work:
select on the panel's `audioTracks`, or give up direct play so the server muxes.
Rationale: the previous code said so in a comment and then restarted playback
with a different id anyway, which re-fetched identical bytes. Supersedes nothing;
completes the note.

**Decision — "a forced mux is refused on 4K by `Media.allows`, not by a special
case"**. `forceStream` sets `directPlay=0`, so the decision is never
`directplay`, so `Media.allows(media, false)` is `!isUHD(media)`. The value of
this is that audio selection needed no new 4K logic at all — the one hard rule
was already expressed in one place. Any future "ask the server for a different
stream" feature inherits the refusal free, and should not add its own.

**Pattern — "a mock that only produces a verdict under one flag makes handling
of that verdict look like dead code"**. `dev/mock-plex.js` answers `directstream`
only when `directPlay=0`, but a real server answers it whenever the container
needs a remux with `directPlay=1` still set. A reviewer reading reachability
from the harness alone concluded a live branch was dead. Trap: the mock's
coverage is a floor on what is reachable, never the ceiling. Check the real
protocol before deleting a branch the harness cannot reach.

**Pattern — "`scope-check` bases on `origin/main`, so unpushed `main` commits
read as scope creep"**. Cost a few minutes here and will recur on every task
while `main` is ahead of its remote. Either push `main` before dispatching, or
have `scope-check` prefer local `main`. Relevant to task 002.

**Follow-up task worth specing** — `js/guard.js` still has no unit test, and it
is now the file that decides whether a forced mux is allowed. `test/` was out of
this spec's `files:`, so it was correctly not added here.
