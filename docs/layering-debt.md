# Layering debt

`src/` is layered — `core/` is the floor, `rules/` is pure, `api/` makes
requests, `data/` holds, `view/` draws, `screen/` owns state — and since 030 an
import that goes the wrong way up fails `npm run lint:names` by name. The rules
shipped as a **ratchet**, not an invariant: nothing new gets in, and the
crossings that were already there are named exceptions in the `DEBT` table at
the top of `eslint.config.mjs`.

This file is that table as prose. It is the register the follow-up tasks get
written from; the config is the enforced copy, and the two are the same
**eleven**.

## What the layering actually permits

Settled 2026-09-13, after the first cut of this file assumed a stricter rule
than the project wants:

- **`view/` may read `data/`.** A drawing file reading what is already held is
  free, and the drawing code is the part that knows which tile is on screen.
  Three crossings stopped being debt.
- **`view/` may not reach `api/`.** Opening a request from the drawing layer is
  how calls nobody asked for get made. Still debt — though see below, because
  neither of the two actually opens one.
- **`core/` may reach `api/`.** The debug beacon needs a request. One crossing
  stopped being debt. `import/no-cycle` still guards the pair.

### The one that this permission lets in

`art.tile`, `art.hero` and `art.factsFor` are synchronous cache reads, which is
what "may read `data/`" was meant to allow. **`art.warm` is not** — it queues a
TMDB lookup and pumps the queue (`src/data/art.ts:111`), and `view/rail.ts:183`
and `view/masthead.ts:32` call it. So a fetch can still start from `view/`, and
the layer rule no longer objects.

That is deliberate rather than overlooked: tasks 015 and 021 put `warm` there
precisely because the rail is what knows which tile has focus, and the smoke step
*a moving rail fetches only what has the focus, and fills in when it stops* is
what holds the line. **The lint cannot see the difference between a cache read
and a queued fetch — that step can.** If `warm` ever moves, it moves to
`screen/`, and the step is what proves it still only warms the focus.

## Go first

**`src/rules/rows.ts` → `src/data/merge` (`merge.items`, `merge.stream`).**
The only one that contradicts a documented invariant: CLAUDE.md calls `rules/`
pure — "no DOM, no request, no cache, which is what makes it the half worth unit
testing" — and a row model that reaches the cache makes that sentence false. The
retired text scan missed it because it looked for `indexedDB` rather than for
the import.

## The rest, by pair

### `api/` → `data/` (5)

Every one is `import * as servers from '../../data/servers'`. `api/` needs to
know which server it is talking to, and `data/servers.ts` is where that lives —
so this is one crossing repeated, and one move fixes all five.

- `src/api/plex/auth.ts` — `servers.forget`
- `src/api/plex/client.ts` — `servers.load`
- `src/api/plex/discovery.ts` — `servers.all`, `servers.set`, `servers.forget`
- `src/api/plex/images.ts` — `servers.of`
- `src/api/plex/library.ts` — `servers.stamp`

### `view/` → `api/` (2) — move `tmdbId`, do not forgive it

- `src/view/masthead.ts` — `library.tmdbId`
- `src/view/rail.ts` — `library.tmdbId`

`tmdbId` (`src/api/plex/library.ts:248`) finds a `tmdb://` guid or regexes the
legacy `themoviedb://` form out of a string. It opens nothing. So `view/` is not
reaching the network here despite the rule saying so — it is importing a pure
function that is in the wrong layer. **Moving `tmdbId` to `rules/` removes both
entries rather than forgiving them**, which makes this the cheapest item on the
list and a better first task than it looks.

### `view/` → `screen/` (2)

- `src/view/sidebar.ts` — `player.autoplayLabel`
- `src/view/sidebar.ts` — `showpage.themeLabel`

Both are label functions living in the screen that happens to use them. They
are the shape `rules/labels.ts` already holds.

### `data/` → `view/` (1)

- `src/data/devices.ts` — `dom.fill`, `dom.put`

`data/devices.ts` draws its own picker. Either the drawing moves to `view/` or
the file does.

## The ceiling of the exception list

An exception is per file **and target layer**, not per import: `rules/rows.ts`
is forgiven `data/`, so a second `data/` import in that file would land
silently. A crossing to any other layer, from any file, still fails — proven by
adding one and watching it go red. Narrowing an exception to the exact specifier
is the next turn of the ratchet, and is only worth doing while the list is still
shrinking.
