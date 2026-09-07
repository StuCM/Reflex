---
id: 011
slug: play-next
status: approved
branch: crew/011-play-next
model: sonnet
env: laptop
files:
  - js/shows.js
  - js/player.js
  - js/app.js
  - js/sidebar.js
  - js/browse.js
  - index.html
  - css/app.css
  - dev/smoke.js
  - test/shows.test.js
---

# Up next, when an episode ends

## Goal
When an episode finishes, the next one is offered on screen: its name, where it
sits in the series, and OK to play it. By default it **waits for a keypress**.
A setting in the sidebar turns on a countdown and chooses its length. Crossing
into a new season always waits, whatever that setting says.

## Why now
`docs/backlog.md` §1: "Next episode: play the following one when this one ends,
with a countdown that can be cancelled. The main reason a show is easier to
watch in the official app." Task 010 made an episode open its series rather than
dead-ending, so the route onward exists — this removes the last manual step.

The defaults are the user's, and both are the cautious reading. Stopping by
default matters because these are **someone else's servers**: an unattended
chain that rolls all night is load on hardware we do not own, by someone who
fell asleep. And a season boundary is exactly where an unattended chain should
not roll on, so it never counts down there even when the setting is on.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching any of the nine declared files. No worktrees are in
flight; 010 merged as `49ad203` and its branch is gone.

Read these as they now are, all landed since 009 and none of them to be redone:

- `js/app.js` — `openItem` now splits three ways, with `openShow(entry, at)` and
  `openEpisode(item)` beside `openDetail`. `openEpisode` toasts, resolves via
  `Shows.entryFor`, and falls back to the detail page on failure. `playChecked`
  already takes a `back` handler, which for an episode is `toShow`.
- `js/shows.js` — has `entryFor(episode)`, which resolves an episode up to its
  merged show and caches per show. Build `nextAfter` on top of it.
- `js/showpage.js` — `open(entry, options)` takes `options.at = {season,
  episode}`. Not claimed by this task; listed so you know the route exists.
- `css/app.css` — `#viewport` is `top: 500px; height: 580px`, and the dense
  header is 320px with its text absolutely positioned to sit on the same lines
  as the first screen. Do not move either; add to them.
- `dev/smoke.js` is at 43 steps.
- `.claude/crew/bin/scope-check.js` now exempts the task file and `BOARD.md`,
  so the gate passes after you write your status, and it bases on the merge
  base — no base argument needed.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `docs/backlog.md`, `CLAUDE.md` and the session that
produced this task. Workers must not go digging for more.

- **Everything that reaches Player goes through `Guard.check` first**
  (CLAUDE.md, `js/guard.js`). Playing the next episode is not an exception and
  must not shortcut it: the next episode may be a 4K TrueHD remux the server
  will refuse, and finding that out by starting a session is exactly the
  failure the guard exists to prevent. `js/player.js` must therefore **ask** for
  the next episode through a callback, the way `onSwitch` already asks for a
  different track, and `js/app.js` does the guarding and calls `playChecked`.
- **The sidebar already has a cycling setting.** `Prefer <server>` is an entry
  whose label shows the current value and whose activation cycles it
  (`js/sidebar.js` `modes()`, `Browse.activate`'s `kind: 'prefer'`,
  `Servers.cyclePreferred`). The autoplay setting is the same shape — copy that
  pattern rather than inventing a settings screen.
- **`js/shows.js` owns seasons and episodes merged across servers** and gained
  `entryFor(episode)` in task 010, which resolves an episode up to its merged
  show and caches per show. `Shows.seasons(entry)` and `Shows.episodes(season)`
  are the two levels. One level at a time — never `/allLeaves` on a library we
  do not own.
- **`js/app.js` already knows where stopping returns to.** `playChecked(item,
  verdict, isExtra, resumeAt, back, subLang)` takes a `back` handler, which for
  an episode is `toShow`. Playing the next episode reuses that whole path; do
  not write a second way into `Player.play`.
- **A film has no next.** This is episodes only. Extras and trailers
  (`isExtra`) never offer one either.
- **Chromium 53 and a 2018 SoC.** Animate only `transform` and `opacity`. The
  panel must not animate a shadow, filter or blur.
- **A green baseline is load-bearing** (docs/decisions.md, 2026-08-16).
  `dev/smoke.js` fails on any request that is not to `localhost:<PORT>`, and the
  player steps skip without `dev/fixtures/sample.mp4` — `npm run verify`
  generates it.

## Constraints that bite here
- **No `async`/`await`, no object spread, no `Object.entries`, no CSS Grid.**
  `npm run check` scans for these.
- **The countdown must not fire after the user has left.** If the panel is
  dismissed, or playback is stopped, or the app moves on, the timer is cleared.
  A timer that plays an episode onto a screen nobody is looking at is worse
  than no feature.
- **Never crawl a server we do not own.** Finding the next episode is one
  season's children at most, and only when an episode actually ends.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/shows.js` — what comes next.** Two functions, the arithmetic split out
   so it can be tested without a network:
   - `nextInList(episodes, current)` — **pure**. The entry after the one whose
     `ratingKey` matches `current`, or `null` at the end of the list or when
     `current` is not in it. Never throws on a null or empty list.
   - `nextAfter(episode)` → `Promise<{ episode, newSeason: bool } | null>`:
     resolve the show with the existing `entryFor`, get its seasons, find the
     one whose `index` matches `episode.parentIndex`, load its episodes and try
     `nextInList`. If that is null, take the **next season by `index`** and its
     first episode, with `newSeason: true`. If there is no next season, resolve
     `null` — the series is over and nothing is offered.

2. **`js/player.js` — the setting.** A tiny persisted preference, guarded the
   way `js/servers.js` guards localStorage:
   - `Player.autoplaySeconds()` → `0` (wait for a keypress) or a number of
     seconds. Default `0`.
   - `Player.cycleAutoplay()` → steps `0 → 5 → 10 → 15 → 30 → 0` and persists,
     returning the new value.
   - Key `reflex.autoplay` in `localStorage`, read once and cached in the
     module. A browser that refuses storage falls back to `0`, which is the
     safe direction.

3. **`index.html` and `css/app.css` — the panel.** A `#upnext` block, hidden by
   default, drawn over the stopped video in the same visual language as
   `#osd-skip`: the next episode's still, the show name, `S1 E5 · Title`, and a
   line saying what OK does. Positioned so it does not sit under the subtitle
   area. No blur, no shadow transition.

4. **`js/player.js` — the offer.** When playback of an **episode** ends
   naturally (the element's `ended` event, not a stop and not a switch):
   - Ask for the next episode through a new `onNext` option, which resolves to
     `{ episode, newSeason }` or null. Null means behave exactly as today.
   - Draw the panel. If `autoplaySeconds()` is greater than zero **and**
     `newSeason` is false, count down from it, updating the line once a second,
     and fire on zero. Otherwise show no timer at all — the line just says OK
     plays it.
   - OK plays it immediately, whether or not a timer is running. BACK dismisses
     the panel and exits as a normal stop does.
   - Clear the timer on: OK, BACK, any stop, and when the panel is hidden for
     any other reason. Test that path rather than assuming it.
   - Report `stopped` for the finished episode before the next one starts, as a
     normal stop does — a session left open on someone else's server is the
     rudest thing this app can do.

5. **`js/app.js` — guard it, then play it.** Pass `onNext` into `Player.play`
   for episodes only (never when `isExtra`). It calls `Shows.nextAfter(item)`,
   and when the panel asks to play, runs `Guard.check` on the next episode
   exactly as `onSwitch` does:
   - Refused → a toast saying why, the panel closes, and the app returns to the
     series page. Do not start a session to discover a refusal.
   - Allowed → `playChecked(next, verdict, false, 0, back)`, starting at zero
     rather than inheriting any resume position.

6. **`js/sidebar.js` and `js/browse.js` — the setting in the menu.** One more
   entry beside `Devices` and `Panel`, labelled from the current value —
   `Autoplay next: off`, `Autoplay next: 10s` — with `kind: 'autoplay'`.
   `Browse.activate` handles it by calling `Player.cycleAutoplay()`, toasting
   the new value and re-rendering, exactly as `kind: 'prefer'` does. It must not
   close the menu on every press if that makes the setting awkward to reach —
   match whatever `prefer` does today, and say in the task file which it is.

7. **`test/shows.test.js` (new)** — cover `nextInList`: the middle of a list;
   the last entry giving null; an episode not in the list giving null; an empty
   or null list giving null; and that it matches on `ratingKey` rather than
   array position, since the same episode arrives from different servers with
   different keys — assert the behaviour that actually holds, and say in the
   task file which it is if the spec has this wrong.

8. **`dev/smoke.js`** — with the fixture present:
   - An episode played to its end shows the panel naming the next episode, and
     with the setting at its default **no countdown runs and nothing plays on
     its own**.
   - OK on the panel plays the next episode, and it goes through the guard —
     a refused next episode toasts instead of playing.
   - With the setting turned on, the countdown appears and reaching zero starts
     the next episode; BACK before zero cancels it and nothing starts.
   - The last episode of a season offers the next season's first episode with
     **no timer**, even with the setting on.
   - The last episode of the last season offers nothing and behaves as today.
   - The setting appears in the sidebar and cycles.

## Out of scope
- **Detecting the end credits** to offer the next episode early. `ended` is the
  trigger here; a marker-based offer is its own task.
- **"Still watching?" after several episodes.** Worth having if autoplay is
  ever made the default; it is not the default, so not now.
- **Rebuilding the series or detail pages** to the new design language —
  backlog, and it would collide with this.
- **Marking watched / scrobbling**, which is a separate backlog item and not
  made worse or better here.
- **`js/rail.js`, `js/masthead.js`, `js/art.js`, `js/merge.js`.** Nothing about
  browsing changes.
- Autoplay for films, extras or trailers.

## Definition of done
- [ ] An episode ending offers the next one by name, with where it sits in the
      series.
- [ ] By default nothing plays on its own: the panel waits for OK.
- [ ] The sidebar carries an autoplay setting that cycles off → 5 → 10 → 15 →
      30 seconds and survives a reload.
- [ ] With a countdown set, it runs, is visible, plays on reaching zero, and is
      cancelled by BACK — and by any stop.
- [ ] The first episode of a **new season** is offered but never counted down,
      whatever the setting says.
- [ ] The last episode of the last season offers nothing.
- [ ] The next episode goes through `Guard.check`: a refusal toasts and does
      not start a session.
- [ ] The finished episode is reported `stopped` before the next one starts.
- [ ] A film, a trailer and an extra never offer a next episode.
- [ ] `nextInList` is pure and covered by `test/shows.test.js`.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

## Graph writes proposed
