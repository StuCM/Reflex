---
id: 029
slug: delete-the-bridge
status: blocked
branch: crew/029-delete-the-bridge
model: sonnet
env: laptop
files:
  - src/api/youtube.ts
  - src/data/cached.ts
  - src/legacy.ts
  - src/main.ts
  - types/legacy.d.ts
---

# The last four globals go, and the bridge with them

## Goal
`src/legacy.ts` and `types/legacy.d.ts` no longer exist. Nothing in `src/`
reaches for a global; every dependency is an import the compiler can see.

## Why now
Step 7, and one of the three things the feature freeze now waits on. The
migration finished at 0.3.1 — this is the last of it.

## Graph context
`types/legacy.d.ts` declares four globals: `Panel`, `Config`, `UI` and `Cached`.
Three are already dead — nothing in `src/` uses them. **`Cached` has exactly one
consumer**, `src/api/youtube.ts:40` and `:46`, inside `channelId()`:

```ts
export function channelId(): Promise<string> {
  return Cached.ytChannel.get(HANDLE).then((cached) => {
    if (cached) return cached;
    return get('/channels', …).then((body) => { … Cached.ytChannel.put(HANDLE, id); return id; });
  });
}
```

`ytChannel` is declared at `src/data/cached.ts:64` and has no other consumer
anywhere in `src/`, `dev/` or `test/`.

**The decision this task carries, already taken — do not re-open it.** The
obvious fix is to import `data/cached` into `api/youtube.ts`. That inverts the
layering: `api/` makes requests, `data/` decides what is held, and an
`api/` → `data/` import makes the lower layer depend on the higher one. Task 030
turns the layer rules into import lint, which would then have to carve out an
exception for it on day one.

So the persistent cache goes instead. `channelId()` keeps a module-level
in-memory promise, which resolves the handle **once per session** and only when
recaps are actually opened. The cost is one extra search call per app launch, in
the one flow that already makes several; the gain is that `api/` stops reaching
across the layering and `Cached` loses its last consumer.

## Constraints that bite here
- Chromium 53 via the bundler. Keep the file's Promise idiom.
- `src/api/youtube.ts` must stay inert without a key — `enabled()` reads
  `settings.youtubeKey` at call time and the smoke suite depends on that.
- `channelId()` throws `no channel for <handle>` when the lookup finds nothing.
  That contract is relied on; a memo must not cache a rejection forever.

## Approach
1. In `src/api/youtube.ts`, replace the `Cached.ytChannel` round trip with a
   module-level `let channel: Promise<string> | null = null`. `channelId()`
   returns it when set, otherwise assigns the request promise and returns it.
   **Clear it on rejection** (`channel = null` in a `.then(null, …)`), or a
   single failed lookup poisons the session.
2. Delete `ytChannel` from `src/data/cached.ts`.
3. Delete `types/legacy.d.ts` and `src/legacy.ts`.
4. In `src/main.ts`, drop `import './legacy';`. The file becomes the single
   `import './app';` — say so in its header comment, which currently explains
   why the bridge is still there.
5. In `CLAUDE.md`, the Layout section says step 7 is outstanding and the freeze
   note lists "delete the bridge". Update both to what is true afterwards.

## Out of scope
- `tools/check-layers.js` and import lint — that is task 030, and the two are
  **file-disjoint but not order-free**: 030's rules would flag the very import
  this task removes, so 029 lands first.
- Splitting the screen files — task 031.
- Any other use of `src/data/cached.ts`; only `ytChannel` goes.
- The recaps feature itself, and task 026's embed fallback.

## Definition of done
- [ ] `grep -rn "legacy" src/ types/` returns nothing
- [ ] `src/main.ts` imports one module
- [ ] Opening recaps twice in one session makes **one** `/channels` request, and
      a step asserts that count with a non-zero control on the same collector
- [ ] A failed channel lookup does not prevent a later one succeeding
- [ ] `npm run verify` passes
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Docs the orchestrator applies at close
<!-- Not in files: — two tasks editing CLAUDE.md collide at merge and defeat
     running them apart. State what it must say; the orchestrator writes it. -->

- The Layout section's note that `src/legacy.ts` survives, and the freeze note's
  "delete the bridge", both come out: nothing in `src/` reaches for a global.
- The Types section says `types/legacy.d.ts` "is ambient by necessity and dies
  with the bridge". It has died; drop the sentence.

## Review rounds

None. Blocked before review.

## What changed

- `src/api/youtube.ts` — `channelId()` memoises a module-level
  `Promise<string>` instead of round-tripping `Cached.ytChannel`, and clears it
  on rejection so one failed lookup does not poison the session.
- `src/data/cached.ts` — `ytChannel` deleted; it had no other consumer.
- `src/legacy.ts` — deleted.
- `types/legacy.d.ts` — deleted.
- `src/main.ts` — one `import './app';`, header rewritten.

Committed as `b9eeca1 refactor(api): memoise the youtube channel id in memory`,
branched from `main` at `7f99a76`. Scope check passes: 5 files declared,
5 changed.

## Why this is blocked

**The spec's Graph context is wrong about who consumes the bridge.** It says
three of the four globals are dead because nothing in `src/` uses them. True of
`src/` — but `src/legacy.ts` publishes twenty-nine globals on `window`, and the
**smoke suite reads five of them page-side**, inside `page.evaluate` and inside
a page-side `keydown` listener. Deleting the bridge deletes those globals and
the suite cannot see the app at all.

Measured on this branch: `npm run verify` gets through check, lint, format,
typecheck and the unit tests, then `npm run smoke` scores **82/94**, down from
94/94 on `main`. Twelve steps fail, all with `ReferenceError`:

| smoke file | global | steps that fail |
|---|---|---|
| `dev/smoke/browse.js:62` | `Art.tile` | `a moving rail fetches only what has the focus…`, `a tile carries no picture but its own while the row sweeps`, `a row walked twice keeps its pictures while it moves`, and `no console errors and nothing left this machine` |
| `dev/smoke/browse.js:784` | `Merge.sources` | `a film in two of one server's libraries keeps both copies` |
| `dev/smoke/show.js:66` | `ShowPage.current` | the five theme-music steps: `a series with a theme plays it, quietly and looping`, `BACK off the show page stops the theme`, `a series without a theme is silent`, `starting an episode stops the theme dead`, `theme music can be turned off, and off survives a reload` |
| `dev/smoke/recaps.js:36,37,51` | `Config.youtubeKey`, `Youtube._key` | `no recaps strip at all without a YouTube key` — which is also the step proving `enabled()` reads the key at call time, a constraint this task's own spec names |
| `dev/smoke/sections.js:431` | `Sidebar.open` | `the last sidebar entry can be reached and is on screen`, and `stepping down keeps the film on screen, over one row and a peek` cascades behind it |

None of these five files is in `files:`, and the handover was explicit that
nothing outside it may be touched because 026 and 028 are live in parallel
worktrees — 026 owns `dev/smoke/recaps.js` and 028 the browse/rail area. So the
fix is out of scope by construction, and the decision it needs is not mine to
invent.

**What the spec has to settle before this can land:**

1. How the smoke suite reaches app internals once no module is on `window`.
   Either the suite stops reaching for them (rewrite five assertions against
   rendered DOM instead of app functions), or a deliberate, dev-only export
   survives the bridge — a `window.__reflex` set behind `import.meta.env.DEV`,
   say, which is a different thing from the migration bridge but is still a
   global and still needs `types/`, so it wants stating out loud, not guessing.
2. Ordering. If the answer is "rewrite the smoke steps", this task must run
   **after** 026 and 028 land, with `dev/smoke/browse.js`, `show.js`,
   `sections.js` and `recaps.js` added to `files:`.

## Other things the spec got wrong

- **DoD 1 cannot pass as written.** `grep -rn "legacy" src/ types/` still
  matches seven lines about Plex's *legacy agent guid form* in
  `src/api/plex/library.ts`, `src/rules/identity.ts` and `types/plex.d.ts` —
  nothing to do with the bridge. The check wants to be
  `ls src/legacy.ts types/legacy.d.ts` or a grep for `legacy.ts`.
- **DoD 3 is unbuildable inside `files:`.** "a step asserts that count with a
  non-zero control on the same collector" is a change to `dev/smoke/recaps.js`,
  which is not declared. The collectors already exist (`ytCalls`, `ytSearches`
  in `dev/smoke.js`), so it is a small step — but it belongs to whichever task
  owns that file.
- **`eslint.config.mjs:114-120`** carries a `files: ['src/legacy.ts']` override
  turning off `naming-convention` for the bridge. Harmless once the file is
  gone (eslint ignores a glob that matches nothing) but now dead. Not in
  `files:`; flagging it for whoever closes this out.
- `.oxlintrc.json:82` mentions legacy modules in a comment on the
  `import/no-unassigned-import` override. That override is still needed —
  `src/main.ts` is still a side-effect import — so only the comment is stale.

## Graph writes proposed

- **Pattern:** *the smoke suite is a consumer of the migration bridge, not just
  `js/`.* `src/legacy.ts` reads as dead the moment `grep` over `src/` comes back
  empty, and it is not: five `dev/smoke/*.js` files reach for `Art`, `Merge`,
  `ShowPage`, `Sidebar`, `Config` and `Youtube` from inside `page.evaluate`,
  where no import can reach and no type checker can see them. Before deleting
  anything that publishes on `window`, grep `dev/` and `test/` as well as
  `src/`. Cost here: one full task round.
- **Decision (implemented, and still good):** the youtube channel id is
  memoised in memory rather than cached in IndexedDB, because a persistent
  cache required `api/` to import `data/` and invert the layering that task 030
  is about to enforce. Cost is one lookup per session, in a flow that already
  spends 100 quota units on the search beside it. The memo clears itself on
  rejection so a failed lookup does not poison the session.
