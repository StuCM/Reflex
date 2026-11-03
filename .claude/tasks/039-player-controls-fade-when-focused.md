---
id: 039
slug: player-controls-fade-when-focused
status: draft
branch: crew/039-player-controls-fade-when-focused
model: sonnet
env: laptop
rounds: 0
files:
  - src/screen/player.ts
  - dev/smoke/player.js
---

# Player controls fade even when something is focused

## Goal
With the trackbar or the control row focused, the controls fade after a
longer idle, and focus returns to none, so the arrows seek again. An open
panel or menu closes after a longer idle still. Today any focus keeps the OSD
up until BACK.

## Why now
Reported 2026-11-03: "if you have something selected or focused in the player
controls they never fade."

## Existing work
`npx crew collisions` could not run, because the crew CLI is not installed.
Checked by hand: no branch touches `src/screen/player.ts` other than `main`.
None.

## Graph context
`npx crew graph` was unavailable. Written from the code and `CLAUDE.md`.

- `showOsd()` (`src/screen/player.ts:271`) arms a 4000ms timer. When it fires,
  it re-arms itself instead of fading while
  `pending !== null || menu.isOpen() || openPanel || focus !== 'none'`. Nothing
  ever clears `focus` on its own, so a focused row never fades.
- **Why focus must be cleared, not just hidden.** `CLAUDE.md` says the control
  row is a mode: while it is focused, the arrows walk the row instead of
  nudging ±30s. Fading with focus kept would leave ◀ ▶ moving an invisible
  focus. So the fade and `setFocus('none')` happen together.
- `setFocus(to)` (~line 312) is the only way to change focus. Use it.
  `menu.close()`, plus `openPanel = null` and `chaptersElement` hidden, is how
  `play()` and `stop()` close panels (~lines 1245, 1341). Find or extract one
  close function rather than duplicating those three lines.
- Aiming a seek (`pending !== null`) keeps the OSD up until the seek lands.
  That stays exactly as it is.

## Constraints that bite here
- Animate only `opacity`/`transform`. The fade is already the `faded` class,
  so do not add a transition.
- `max-lines` for `player.ts` is pinned at 1548 in `.oxlintrc.json`, and that
  file is outside `files:`. Pay for any added lines in this file, by
  extracting the close helper, rather than raising the limit. If that proves
  impossible, stop and report.

## Approach
1. Name the timings as constants beside the existing 4000:
   `OSD_IDLE = 4000`, `FOCUS_IDLE = 8000`, `PANEL_IDLE = 15000`.
2. Track `lastKeyAt`, set on every key the player handles.
3. In the timer: if a seek is pending, re-arm as today. If a panel or menu is
   open and `now - lastKeyAt < PANEL_IDLE`, re-arm; otherwise close it. If
   focus is not `'none'` and `now - lastKeyAt < FOCUS_IDLE`, re-arm; otherwise
   `setFocus('none')`, repaint the row, and fade. In all other cases, fade as
   today.
4. **Smoke step in `dev/smoke/player.js`**, after "up takes the trackbar, down
   the row…":
   - *Focused controls fade, and the arrows seek again.* Press ▼ to focus the
     row, wait past `FOCUS_IDLE`, then assert that `#osd` has `faded` **and**
     that pressing ▶ moves `currentTime` forward by about 30s (positive
     content, not just the absence of focus).
   - Second assertion: open a panel, wait past `PANEL_IDLE`, and assert that it
     closed and the OSD faded.

   Use Playwright's `page.clock` to fast-forward if the installed version has
   it. Otherwise wait in real time. Skip without a fixture, as the other
   player steps do. Run against `main` first: it must fail there.

## Out of scope
- The 4s fade when nothing is focused, the seek-aiming behaviour, and the
  colour keys.
- Any visual change to the OSD, the row or the panels.
- Splitting `player.ts`.

## Definition of done
- [ ] With the row or the trackbar focused and no key pressed for 8s, the OSD
      fades and focus is `'none'`. A following ▶ nudges +30s.
- [ ] With a panel or menu open and no key pressed for 15s, it closes and the
      OSD fades.
- [ ] Any key resets those clocks. A user still choosing in a panel never has
      it closed under them.
- [ ] Aiming a seek still keeps the OSD up until it lands.
- [ ] The new smoke step passes, and was observed failing against `main`.
- [ ] The gate passes (`npx crew gate .claude/tasks/039-player-controls-fade-when-focused.md`).
- [ ] No file outside `files:` is touched. `max-lines` is not raised.
- [ ] Commits follow the convention.

## Review rounds

## Graph writes proposed
