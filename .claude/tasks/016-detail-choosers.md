---
id: 016
slug: detail-choosers
status: done
branch: crew/016-detail-choosers
model: sonnet
env: laptop
files:
  - js/menu.js
  - js/player.js
  - js/detail.js
  - js/app.js
  - index.html
  - css/app.css
  - dev/smoke.js
---

# Choose the copy, the audio and the subtitles before pressing Play

## Goal
The film page's action row becomes the design's: a primary **Play**, then round
buttons that open real menus — the source (server × version), the video
quality, the audio track, the subtitles — plus Trailer. Each shows what is
currently chosen on its label, and each choice is checked by the guard before it
sticks. The vertical list of copies goes away; the buttons replace it.

## Why now
The user chose real choosers over restyling the copy list. Everything they need
already exists as pure, tested functions — `Media.audioTracks`,
`Media.subtitleTracks`, `Media.qualities`, `Media.versionLabel` — and the player
already renders exactly this kind of menu. This task is mostly wiring, provided
the menu is shared rather than written twice.

## Existing work
`node .claude/crew/bin/preflight.js collisions` printed nothing — no branch
carries commits touching any of the seven declared files. No worktrees are in
flight; 015 merged as `537bb00`, main verified at 64/64.

Read these as they now are:

- `js/rail.js` holds `paint(tile)`, a `_wait` flag and a 160ms settle timer from
  015, plus `place(el, x, animate)` from `8625a76`. Not this task's file; listed
  so the settle is not mistaken for something to copy into the menu.
- `js/detail.js` — 014 rebuilt the header (kicker, chips, ratings) and fixed
  `close()` to move the generation counter on. The copy list this task removes is
  `#dt-sources` and its label, below that header.
- `css/app.css` has `--t-fade: 620ms` used only on the hero layers; the menu
  should use `--t-quick` or `--t-move`, not the backdrop's fade.
- `dev/smoke.js` is at 64 steps.

## Graph context
`claude-memory-graph` is not on PATH in this checkout, so this section is from
`docs/decisions.md`, `CLAUDE.md` and the session that produced this task.
Workers must not go digging for more.

- **The player already has this menu.** `js/player.js` renders `.menu-tab` and
  `.menu-row` into `#menu-tabs` / `#menu-inner`, winds the list with a
  transform, and walks it with up/down/left/right/OK. That rendering and
  walking is what gets shared. What each tab *contains*, and what choosing a
  row *does*, is playback-specific and stays in `js/player.js`.
- **Everything that reaches Player goes through `Guard.check`** (CLAUDE.md).
  A choice made on the detail page is no different: it must be checked before
  it is accepted, and a refusal must say why and leave the previous choice
  standing. `js/app.js`'s `playChecked` already takes a verdict; the page must
  hand it one that matches what the buttons say.
- **Direct play blocks audio choice, and this is the subtle one.** On a direct
  play the server hands over the file whole and the panel plays whichever track
  it likes; `audioStreamID` changes nothing. `js/panel.js` reports whether the
  pipeline exposes `audioTracks`. So an audio choice on this page either (a) is
  something the panel can honour, or (b) requires giving up direct play, which
  on a 4K file the guard will refuse. The menu must say which before OK is
  pressed — the player's menu already does this and the wording is there to
  copy.
- **`Detail.addOtherVersions`** already finds every copy on every server by
  guid, across sections, so the source menu's contents are already assembled —
  it is the same `copies` array the list renders today.
- **`Detail.close()` moves the generation counter on** (014), so metadata
  landing after BACK cannot redraw. Any new async work here must respect the
  same guard.
- **Chromium 53.** No CSS Grid, no `position: sticky`, no `async`/`await`, no
  object spread, no `Object.entries`. Animate only `transform` and `opacity`.
  `Array.prototype.sort` is not stable — sort indices if order matters.
- **Palette and timings are tokens**: `--ac` violet, `--ac2` amber,
  `--t-quick`, `--t-move`, `--t-fade`, `--ease`.

## Constraints that bite here
- **The player's behaviour must not change at all.** Every existing player
  smoke step — the audio switch that restarts, the one the panel owns, the
  subtitle language, the quality cap, chapters — must pass **unchanged**. If a
  step needs editing to keep passing, the extraction has changed behaviour and
  is wrong.
- **No dead buttons.** "My list" has nowhere to store anything: leave it out.
- **A refusal must not lose the user's place.** A choice the guard refuses
  toasts and leaves the previous selection; it never closes the page or clears
  the row.
- **Comments**: one concise line on an exported function.
- **Commits**: `type(scope): summary`, lowercase, imperative, ≤72 chars, no
  full stop, no attribution footers. The hook enforces it.

## Approach

1. **`js/menu.js` (new) — the shell, and only the shell.** A module that draws
   tabs and rows into elements it is given and walks them with the d-pad:
   - `Menu.open({ host, tabs, onChoose, onClose })`, where `tabs` is
     `[{ label, rows: [{ label, note, on, value }] }]`.
   - `Menu.key(code)` returns true for everything while open — an overlay that
     let keys through would move a selection nobody can see.
   - It renders, it winds the list to keep the selection visible, it reports the
     chosen `value`. It knows nothing about playback, copies or tracks.
   - Load it in `index.html` before `js/player.js` and `js/detail.js`.

2. **`js/player.js` — use it, change nothing else.** Replace the rendering and
   key-walking with `Menu`, keeping every tab's contents and every choice's
   consequence exactly where they are. The OSD, the skip prompt, seeking,
   `onSwitch` and the note about what a switch will cost are untouched. This
   step is a refactor: the diff should remove more than it adds.

3. **`index.html` and `css/app.css` — the action row.** `#dt-actions` holding a
   primary Play pill with a caption under it (`from start`, or `resume at
   1:12`), then round buttons each with a caption naming the current choice.
   Reuse the existing `.menu-*` classes for the popup so both screens look the
   same; the popup anchors near the button that opened it.

4. **`js/detail.js` — the buttons.** In order: **Play**, **Trailer**,
   **Quality**, **Source**, **Audio**, **Subtitles**.
   - Trailer is present only when the item has an extra; it plays the first one
     as today, and never inherits a resume position.
   - Quality is `Media.qualities` for the selected copy — versions and bitrate
     caps, exactly as the player's menu builds them.
   - Source is the `copies` array the list renders today, labelled
     `<version> · <server>`, each carrying its guard verdict as its note.
   - Audio is `Media.audioTracks` for the selected copy, with the same
     "instant / needs the server to mux" note the player's menu shows.
   - Subtitles is `Media.subtitleTracks` plus an explicit *off*.
   - Choosing re-runs `Guard.check` for the resulting combination. Accepted →
     the button's caption updates and the chosen state is what Play will use.
     Refused → toast `Kept as it was — <reason>` and leave it, the same wording
     the player already uses for a refused switch.

5. **`js/detail.js` — remove the list.** `#dt-sources` and its label go; the
   Source button is now how a copy is chosen. Anything that referenced the list
   — key handling, the `dt-hint` text — follows.

6. **`js/app.js`** — `Detail.open`'s `onPlay` now receives the verdict the page
   has already checked, along with the chosen audio and subtitle language, and
   passes them into `playChecked` so the player starts on what the buttons said.
   Do not add a second route into `Player.play`.

7. **`dev/smoke.js`** — the copy chooser steps become button-and-menu steps:
   - Opening a film shows Play and the round buttons, each captioned with the
     current choice.
   - The Source menu lists every copy the merge found, including two from one
     server, each with its verdict.
   - Choosing a refused copy toasts and leaves the previous one selected.
   - Choosing an audio track updates the caption, and Play starts on it.
   - **Every existing player menu step passes unchanged.**

## Out of scope
- **"My list"** — no storage, no button.
- **The player's OSD redesign** — the round controls, the quality panel and the
  chapters rail from the design. Separate task; this one only moves the player's
  menu onto the shared shell without changing how it looks or behaves.
- **The show page**, the browse screen, the up-next panel.
- **`js/guard.js`, `js/media.js`, `js/plex.js`.** The rules are right; this
  calls them from one more place.
- **Changing what `Detail.addOtherVersions` fetches.**

## Definition of done
- [ ] The film page shows Play and round buttons for Trailer, Quality, Source,
      Audio and Subtitles, each captioned with what is currently chosen.
- [ ] Each opens a menu; choosing re-runs the guard; a refusal toasts and leaves
      the previous choice standing.
- [ ] Play starts on exactly what the buttons say, including the audio track and
      the subtitle language.
- [ ] The vertical copy list is gone, and every copy is still reachable —
      including two copies held by one server.
- [ ] An audio choice says, before OK, whether the panel can honour it or
      whether it costs direct play.
- [ ] The player's menu is the same module and behaves identically: every
      existing player smoke step passes **unchanged**.
- [ ] `npm run verify` passes.
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Review rounds

### Round one — CHANGES

1. `js/detail.js` `audioRows` computed the cost note from `panelOwnsAudio()`
   alone, so the track already in use — the one the guard picked, which costs
   nothing to keep — was captioned as if choosing it would cost a mux. The note
   and the `forceStream` handed to `Guard.check` came from two different tests.
2. `js/menu.js` built all four of the player's tabs at open, where the old
   `menuKey` rebuilt on every left/right. Only `chapterRow`'s `on` depends on
   live state, but that is enough: the chapter marked as current froze at
   whichever one was playing when the menu opened.

Both fixed in `4a92ea5`.

1. One predicate, `needsMux(st)`, now feeds both the note and `forceStream`, so
   what a row says before OK is what OK does; the row already chosen carries no
   note at all, as the player's does not. The wording is this page's rather than
   the player's — nothing is playing here, so "restarts" would be wrong: it says
   `costs direct play — the server would mux it` or `keeps direct play`. The
   smoke step asserts that shape rather than merely that a note exists.
2. `Menu` takes each tab's `rows` as a builder and calls it in `build()`, on
   open and on every tab change. Only the tab being shown is built, which is
   what the player did before.

### Round two — PASS

Both fixes verified against the rendered DOM rather than the source: the smoke
step reads the `on` row's note back off the page, and the chapter marker is
recomputed per visit. Gate re-run independently: check clean, 9/9, 67/67, in
scope.

## What changed, per file

- `js/menu.js` (new) — the shared shell: tabs, rows, the winding transform, the
  d-pad, and an overlay that swallows every key. Rows carry a `value`; what that
  means belongs to the caller.
- `js/player.js` — its menu is now `Menu`. The row builders are handed over
  uncalled and return arrays; `menuOn`, `tab`, `sel`, `rows`, `paintMenu`,
  `menuKey` and `closeMenu` are gone, and `Menu.isOpen()` answers what `menuOn`
  did. 170 lines changed, most of them removed.
- `js/detail.js` — the copy list becomes an action row: Play, Trailer (only with
  an extra), Quality, Source, Audio, Subtitles, each captioned with the current
  choice. Each chooser re-runs `Guard.check` for the combination; a refusal
  toasts `Kept as it was — …` and the page does not move. Subtitles never reach
  the guard, because they change nothing the server does — but an image track is
  refused in the same shape.
- `js/app.js` — `Detail`'s `onPlay` gained a fourth argument, the chosen
  subtitle language, which goes straight into `playChecked`'s existing
  `subLang`. No second route into `Player.play`.
- `index.html` — `#dt-actions` and `#dt-menu`; `#dt-sources` and its label gone;
  `#menu` is now an empty host; `js/menu.js` in the script list before both
  screens that use it.
- `css/app.css` — the action row and the popup; `.dt-source*` removed; the
  menu's inner elements are classes rather than ids, so two hosts can carry
  them. `#dt-menu .menu-list` is the one override: the player's menu holds its
  height so the tabs never move, this one hangs off a button and shrinks.
- `dev/smoke.js` — the copy-list steps became button-and-chooser steps, plus
  three new ones: the action row itself, an audio row's cost note and the
  caption following it, and a subtitle language chosen on the page and drawn
  over the video during playback. 64 → 67.

## Where the spec was thin

- **Quality "versions and bitrate caps".** On this page a version is already a
  separate row in Source (a source is server × version), so version rows in
  Quality would have been the same choice twice. Quality is `Media.qualities`
  for the selected copy and nothing else.
- **`tabs` as `[{ label, rows: [...] }]`.** Rows are a builder function instead.
  An array built at open is stale by the time you arrow to it, which is what
  froze the player's current-chapter marker — see round one.
- **The extras strip.** The spec removes only `#dt-sources`, so the strip stays
  and is reached with ▼ off the action row. Trailer plays the first extra; the
  strip is how you reach the rest.

## Graph writes proposed

- **Pattern — one predicate behind a menu's note and its consequence.** A menu
  row that says what choosing it will cost, and a handler that decides what it
  actually costs, must be the same test called twice. Written as two tests they
  agree on the day they are written and drift the first time either is touched;
  the row then lies about the one thing it exists to say. `Detail.needsMux` is
  the shape: the note is a function of it, and so is the `forceStream` handed to
  `Guard.check`.
- **Pattern — a shared menu takes row builders, not rows.** `Menu.open` is given
  each tab's `rows` uncalled and builds the tab when it is shown. Building all
  tabs at open looks equivalent and is not: any row whose `on` depends on live
  state — the chapter being played, in this case — freezes at whatever it was
  when the menu opened. It is also less work, since only the tab you reach is
  ever built.
- **Decision — a choice on the film page goes through `Guard.check` again, not
  through the verdict already on the row.** Every copy is checked as the page
  opens, so the baseline verdict is there and reusing it would save a call. It
  is not reused, because a choice is a *combination* — copy, bitrate cap, audio
  track — and only the copy's own verdict is on the row. `hasMDE=1` opens no
  session, so the extra call costs a query and nothing else, and the alternative
  is a page that says direct play about a combination it never asked about.
- **Decision — subtitles do not reach the guard, on either screen.** They are
  fetched as text and drawn over the video, so they change nothing about the
  stream the server serves. The one exception is an image track, which could
  only be shown by burning it in; the film page refuses one with the same
  wording a refused copy gets, rather than accepting it and going silently
  blank at playback.
