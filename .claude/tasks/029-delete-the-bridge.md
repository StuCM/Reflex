---
id: 029
slug: delete-the-bridge
status: approved
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

## Graph writes proposed
- Decision: the youtube channel id is memoised in memory, not cached in
  IndexedDB, because a persistent cache there required `api/` to import `data/`
  and invert the layering. Cost is one lookup per session.
