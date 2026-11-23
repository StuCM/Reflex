---
id: 072
slug: the-guard-warns-and-lets-you-play
status: approved
branch: crew/072-the-guard-warns-and-lets-you-play
model: opus
env: laptop
rounds: 0
work: v2-foundations
files:
  - src/data/guard.ts
  - src/app.ts
  - types/plex.d.ts
  - src/screen/detail.ts
  - src/screen/player.ts
  - src/screen/showpage.ts
  - CLAUDE.md
  - dev/smoke.js
  - dev/smoke/detail.js
  - dev/smoke/player.js
  - dev/mock-plex.js
---

# The guard warns about a 4K transcode and lets you play anyway

## Goal
Choosing a 4K copy that would not direct play — including one whose only
usable audio must be re-encoded — shows a clear warning of what it costs the
server owner, with **Play anyway** and **Back**, instead of refusing. A switch
mid-film that would cause such a transcode asks the same way and never stops
playback to do it.

## Why now
`docs/v2-decisions.md` (Stuart, 2026-11-16): "the guard needs to be loosened
though and just warn allowing the user to still play as this has bitten me a
few times". On 2026-11-23 he took the recommended answers: the override also
covers a TrueHD-only 4K file ("yes, with the same warning, naming the audio
cost"), and mid-play switches "ask with the same warning, but never stop
playback to do it".

## Existing work
None in flight. Base `feat/v2`. First of the v2 foundations (072-075), run
one at a time.

## Background
- `src/data/guard.ts:21` `check()` returns a `Verdict` (`types/plex.d.ts:385`);
  `refusal()` (l.151) turns a not-ok verdict into title/body text;
  `label()` (l.122) is the Play caption. `src/rules/quality.ts:51 allows` is
  the rule and stays unchanged (unit tested).
- `src/app.ts:101 playChecked` refuses on `!ok`; the player's audio /
  quality / version switches refuse with a toast (CLAUDE.md, player section).
- Smoke: `dev/smoke/detail.js:40` "refuses a 4K remux whose only audio would
  be re-encoded"; `dev/smoke/player.js:1043` "a next episode the guard refuses
  toasts instead of playing"; `dev/smoke.js:245-246` the `truehdOnly` and
  `transcodes` fixtures, and `:941` the refusal-screen helper.

## Graph context
- Constraint "The user does not own the Plex servers": the server's rule is
  no 4K transcode, enforced by a kill-stream after the session starts. The
  warning must say so plainly — the session may be killed.
- The decision call with `hasMDE=1` still runs before anything starts; only the
  final refusal becomes overridable.

## Approach
1. `guard.ts`: a not-ok verdict caused by **4K + not direct play** (video
   transcode, or audio re-encode on a 4K file) gets `overridable: true` and a
   state (e.g. `'uhd-transcode'`). Other refusals (no playable audio at all,
   undecodable codec, server error) stay hard refusals. `refusal()` for an
   overridable verdict returns warning text naming what will be transcoded
   (video, or the audio track by name) and that the owner's server may stop it.
2. `types/plex.d.ts`: `Verdict.overridable?: boolean`.
3. `app.ts playChecked`: for an overridable verdict show the warning with
   **Play anyway** (OK) and **Back**; Play anyway requests the transcode
   (`directPlay=0`, as a converted stream is fetched today below 4K) and plays.
   BACK returns to where Play was pressed.
4. `detail.ts`: Play's caption for an overridable verdict reads as a warning
   (e.g. "4K transcode — may be stopped"), not "won't play". **Choosing** a
   copy, audio track or quality whose verdict is overridable is accepted (today
   `detail.ts:375` refuses any `!checked.ok` with "Kept as it was"); the
   warning comes when Play is pressed. Rewrite `dev/smoke/detail.js:166`
   ("a copy the guard refuses toasts…") for the overridable case and keep it
   for a hard refusal.
4b. `showpage.ts:664` sends any `!verdict.ok` episode to the copies page: an
   overridable verdict instead goes through the same warning as the film page.
5. Mid-play switches live in `src/app.ts` (`onSwitch` ~l.302, `playNext`
   ~l.348) with the player's menu in `player.ts`: a switch (audio, quality,
   version, next episode) whose verdict
   is overridable shows the same choice **over the playing film** (the menu
   shell); Back keeps playing as is; Play anyway restarts with the switch.
   Hard refusals keep today's toast.
6. `CLAUDE.md`: rewrite the "Refuse 4K playback if the decision is anything
   but `directplay`" passage and the player passage about refused switches to
   warn-then-allow, in this change.
7. Smoke: rewrite `detail.js:40` — the TrueHD-only 4K remux now shows the
   warning naming the audio; Back makes no transcode request; Play anyway
   requests the transcode (count requests to the mock's universal transcode
   path: 0 then 1). `player.js:1043` — a next episode that would be a 4K
   transcode shows the warning over the playing film and playback continues
   behind it. A hard refusal (no audio at all) still refuses. Run the new
   steps against `feat/v2` and watch them fail.

## Out of scope
- Changing `allows`, the codec profile, or what counts as direct play.
- Any change below 4K (transcodes are already allowed there).

## Definition of done
- [ ] A 4K non-direct-play shows a warning with Play anyway / Back; Play anyway plays via transcode; Back requests nothing (smoke, failing on `feat/v2`).
- [ ] Mid-play switches that would transcode 4K ask over the playing film and never stop it (smoke).
- [ ] Hard refusals unchanged (smoke).
- [ ] `CLAUDE.md` describes warn-then-allow; `npm test` (quality rules) unchanged and green.
- [ ] the gate passes (`crew gate .claude/tasks/072-the-guard-warns-and-lets-you-play.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
