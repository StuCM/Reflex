# Project brief — Reflex

`CLAUDE.md` is the authority. This is the short list of places where a diff can
look right and be wrong.

## Hard constraints

- **Chromium 53, permanently.** No `async`/`await`, no object spread or rest,
  no `Object.entries`, no optional chaining or `??`, no CSS Grid, no
  `position: sticky`, no flexbox `gap`. `const`, `let`, arrow functions,
  template literals, destructuring, `Map` and `Set` are all available and
  preferred — this is ES2015 apart from the list above, and writing ES5 here is
  a misreading, not caution.
- **Animate only `transform` and `opacity`.** A shadow, filter or blur
  transition forces layout and paint on a 2018 SoC.
- **`Array.prototype.sort` is not stable.** Above ten elements, equal items
  reorder arbitrarily. Where the original order matters, sort indices and
  tie-break on position — `bySeason` in `src/api/youtube.ts` is the pattern.
- **`replaceChildren` is Chrome 86 and `append` is Chrome 54.** Both read as
  ordinary DOM and TypeScript's `DOM` lib types them as available. Use `fill`
  and `put` from `src/view/dom.ts`.
- **Never send `X-Plex-Platform: webOS`.** The decision endpoint answers
  `400 Bad Request` for it. The app says `Chrome` / `53.0`, which is honest.
- **`innerHTML` and inline style writes are banned** and eslint enforces it.
  Build nodes; toggle a class; a per-frame number goes in a CSS variable.

## Where a plausible diff does real damage

- **The direct play profile.** Widening `PROFILE` or `Media.canDecode` to make
  something work is the most damaging change available here: claiming a codec
  the panel cannot decode gives a black screen. Only evidence from the panel
  justifies it, and a laptop browser is not evidence — `src/core/panel.ts` asks
  the panel with `canPlayType` and acts only on `"probably"`.
- **The 4K rule.** The servers are someone else's and refuse to transcode 4K,
  killing the session after it starts. So 4K must direct play or be refused,
  and `hasMDE=1` settles it before a session opens. A bitrate cap on a 4K file
  is a transcode request and must be refused by the ordinary rule, not
  special-cased. Below 4K a transcode is allowed — insisting on direct play is
  what made every TrueHD remux unplayable.
- **Audio over plain ARC.** TrueHD and DTS-HD MA can never pass, ever. A
  commentary track can never be selected — it is an ordinary AC3 or AAC track
  by codec and channel count, so nothing excludes it by accident, and on a
  TrueHD remux it is the only passable track left. If the diff touches
  `Media.pickAudio`, `Media.bestAudio` or `Media.isCommentary`, check the tests
  cover both tiers.
- **Two servers, one entry per film.** Identity is `Media.identities`; every
  copy is kept on the entry as `_sources`; every request is made against a
  named server and items are stamped with `_server`. Nothing may assume a
  current server.
- **`src/data/guard.ts`** is the most important logic in the app. Everything
  that reaches the player goes through it.
- **An audio switch that stays a direct play is silent** — the server hands
  over the whole file and the panel plays the first track. Either the panel
  exposes `audioTracks`, or direct play is given up and the guard may refuse it.

## What this environment cannot prove

Decode, container support, HLS, smoothness and audio over ARC. A desktop
browser decodes far less than the panel: Firefox has no AC3/E-AC3 and no HEVC,
Chrome has no Matroska, so a silent film or a decode error on the laptop is the
browser and looks exactly like the bugs that matter.

A task about any of those is `pending-tv` at best, and a loop that marks it
`done` is lying. `npx crew preflight tv` says so too.

Browsing, the guard, the audio choice, the merge and the row arithmetic are all
fair to test on the laptop.

## Baseline

`npm run verify` is green once `npm run fixture` has been run — `dev/fixtures/`
is gitignored, so every fresh worktree starts without a video. `crew gate` runs
the fixture step first, because without it five player steps skip and the "no
console errors" step fails on a 404 for the converted stream. That is the
missing fixture, not the code, and chasing it is a wasted round.

The smoke count climbs as tasks add steps, so the baseline is whatever `main`
scores, not a number written down here. Treat a *drop* as a regression.

Iterate with `npm run smoke -- <area>`; declare `dev/smoke/<area>.js` in a
spec, not `dev/smoke.js`. Declare the screen's own stylesheet — `css/detail.css`
— not `css/`; `css/base.css` holds the shared tokens and changing those changes
every screen, which is worth saying out loud in the spec.
