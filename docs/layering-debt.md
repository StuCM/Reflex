# Layering debt

`src/` is layered — `core/` is the floor, `rules/` is pure, `api/` makes
requests, `data/` holds, `view/` draws, `screen/` owns state — and since 030 an
import that goes the wrong way up fails `npm run lint:names` by name. The rules
shipped as a **ratchet**, not an invariant: nothing new gets in, and the
fifteen crossings that were already there are named exceptions in the `DEBT`
table at the top of `eslint.config.mjs`.

This file is that table as prose. It is the register the follow-up tasks get
written from; the config is the enforced copy, and the two are the same
fifteen.

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

### `view/` → `api/` (2)

- `src/view/masthead.ts` — `library.tmdbId`
- `src/view/rail.ts` — `library.tmdbId`

Reading an id off a Plex item is not a request, so this is an import of the
wrong module rather than a request from `view/`; `tmdbId` reads like `rules/`.

### `view/` → `data/` (3)

- `src/view/masthead.ts` — `data/art`
- `src/view/rail.ts` — `data/art`
- `src/view/sidebar.ts` — `data/servers`

### `view/` → `screen/` (2)

- `src/view/sidebar.ts` — `player.autoplayLabel`
- `src/view/sidebar.ts` — `showpage.themeLabel`

Both are label functions living in the screen that happens to use them. They
are the shape `rules/labels.ts` already holds.

### `core/` → `api/` (1)

- `src/core/ui.ts` — `http.request`, for the debug beacon

`core/` is the floor, so this is the inversion that most wants a callback rather
than an import.

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
