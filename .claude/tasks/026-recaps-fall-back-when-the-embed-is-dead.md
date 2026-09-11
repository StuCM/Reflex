---
id: 026
slug: recaps-fall-back-when-the-embed-is-dead
status: done
branch: crew/026-recaps-fall-back-when-the-embed-is-dead
model: sonnet
env: laptop
files:
  - src/app.ts
  - dev/smoke/recaps.js
---

# A recap that cannot play says so, instead of showing black

## Goal
Pressing OK on a season recap either plays it or, within a couple of seconds,
offers the YouTube app. It never leaves a black screen.

## Why now
Verified on the panel 2026-09-10, which is what task 012 was waiting for. It
fails, and the fallback the code was written to give never runs.

## Graph context
Measured over CDP against the real panel, with a real recap
(`RK38g5pR3b8`, "Severance RECAP: Season 1" — the search half is fine: 25 raw
items, 2 picked, correct string ids):

- `https://www.youtube.com/embed/<id>?autoplay=1` returns **200**
- YouTube's player CSS and `base.js` load, also 200
- **no `googlevideo` request is ever made** — the media is never fetched
- `iframe.onload` **fires**

So Chromium 53 is too old for YouTube's current embed player: the shell loads,
the player never starts. `src/app.ts:117` `openRecap` arms an 8s timer and
`recapFrame.onload` clears it — on the only failure mode that actually happens,
the timer is cancelled and `recapFailed` never runs.

`recapFailed` and its message screen already work, and `recapOffer` +
`webOS.service.request` already launch the YouTube app. Only the detection is
wrong.

## Constraints that bite here
- Chromium 53. No `async`/`await` in source style terms is no longer true (the
  bundler lowers it) but keep the file's existing Promise idiom.
- A cross-origin iframe cannot be inspected, so "did it play" cannot be read
  from the DOM. Do not try.
- Never leave the app on a screen with no way out: BACK must always work.

## Approach
1. In `src/app.ts`, stop treating `onload` as success. Delete the
   `recapFrame.onload` handler that clears `recapTimer`.
2. Keep one timer, shortened to **4000ms**, armed in `openRecap`. When it
   fires, call `recapFailed('cannot play YouTube')`. The message screen already
   offers the YouTube app on OK and the recaps on BACK.
3. The user may be watching a recap that *is* playing when the timer fires, so
   the offer must not steal the screen from a working video. There is no way to
   know from inside. Therefore: **do not auto-dismiss**. Show the offer only if
   the user has not pressed anything since `openRecap` — track a flag set by the
   existing key router and cleared in `openRecap`.
4. Leave `closeRecap` as it is; it already blanks the src.

## Out of scope
- Making the embed work. It does not work on this panel and that is not ours.
- The YouTube search, `parse`, `pickForShow`, or the recaps rail — all verified
  working on the panel.
- Launching the YouTube app: `recapOffer` already does it.
- Any change to `src/api/youtube.ts`.

## Definition of done
- [ ] With the embed dead, OK on a recap shows the "opens it in the YouTube app"
      offer within 5 seconds, never a persistent black screen
- [ ] BACK from the offer returns to the recaps rail
- [ ] A smoke step drives OK on a recap with the embed stubbed to load-but-never-
      play, and fails if the offer does not appear
- [ ] The existing step "an embed that never loads offers the YouTube app
      instead of hanging" still passes
- [ ] `npm run verify` passes
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

1. **PASS** (crew-reviewer). Verified 94/94 on HEAD, traced the flag for a race
   at open time (there is none: the OK that opens the overlay is handled by
   `showpage.key` while `recapVideo` is still null), and confirmed the new step
   drives the loading card rather than the stalling one. Recorded the one
   deviation below as correct but literal.

## What changed

- `src/app.ts` — `recapFrame.onload` no longer cancels the fallback timer (the
  handler is gone); the timer is 4000ms and calls
  `recapFailed('cannot play YouTube')`; a new `recapTouched`, cleared in
  `openRecap` and set by the key router's recap branch, stands the offer down
  if the viewer has pressed anything.
- `dev/smoke/recaps.js` — a step between the two existing recap steps drives OK
  on the card the mock *does* answer, presses nothing, and asserts the offer
  arrives (title `cannot play YouTube`, body naming the app, overlay down) in
  under 8s. Run against `main` it fails, which is the point.

## What the spec got wrong

- Nothing material. One deviation: "Leave `closeRecap` as it is" — its
  `recapFrame.onload = null` became dead once step 1 deleted the only
  assignment, so it went with it. No behaviour change; the reviewer agreed.
- The spec's step 3 reasoning ("the offer must not steal the screen from a
  working video") does not quite hold up — a viewer watching a recap that
  really plays presses nothing either, so the flag protects only the case where
  they *have* touched a key. It is still the best available signal from outside
  a cross-origin frame, and it costs nothing, so it was implemented as written.
- `dev/mock-youtube.js:21` still says "the app's 8-second fallback". Stale by
  one number, and outside `files:`, so it was left alone.

## Graph writes proposed
- Pattern: `iframe.onload` is not proof a third-party embed plays — it fires on
  the shell. Detect with a timer that success cancels, not a load event.
- Pattern: when a failure is invisible from inside (cross-origin), the honest
  detector is a deadline plus a signal that the viewer is fine — here a
  keypress. Nothing can be read back; only the absence of a complaint.
- Decision: the recap fallback deadline is 4s, and `onload` cancels nothing.
  YouTube's embed shell loads happily on Chromium 53 and its player never
  starts, so the only load event available is a lie.
