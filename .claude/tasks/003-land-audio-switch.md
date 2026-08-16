---
id: 003
slug: land-audio-switch
status: draft
env: laptop
branch: claude/player-features
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

- [ ] the branch is merged into `main`, or rejected with written reasons in
      this file
- [ ] `npm run verify` is 26/26 on the merged result
- [ ] the 4K rule is explicitly confirmed to hold on the no-`audioTracks` path
- [ ] `537e26a`'s unconditional 404 filter did **not** come back — `main` keeps
      001's `hasFixture()`-gated version
- [ ] `.claude/worktrees/player` and `/tmp/verify-audio` are removed once the
      branch has landed

## Review rounds

<!-- Reviewer appends one block per round. Max 2, then escalate to the user. -->

## Graph writes proposed

<!-- Worker and reviewer append; only the orchestrator commits them. -->
