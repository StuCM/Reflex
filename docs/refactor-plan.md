# The refactor: Vite, TypeScript, and rules that enforce themselves

Decided 2026-09-10, in conversation. This is the spec for section 0 of
`docs/backlog.md`. Features are frozen until it is done.

The layering landed at 0.0.2 — `js/` became six directories with the
boundaries checked by `tools/check-es5.js`. That check is a regex scan its own
header calls "not proof", and the naming conventions were enforced by nothing
at all. This replaces both with real tools.

**The governing rule: if a convention matters, a machine enforces it.** Nothing
here relies on an agent, or a human, remembering. Where a tool cannot enforce
something, that is written down as a known gap rather than left implied.

---

## The stack

`vite@8` ships **Rolldown**, `@oxc-project/runtime` and **Lightning CSS** as
direct dependencies — no esbuild, no Rollup. So the Rust toolchain is the
default, not an opt-in.

| tool | version | what it does here |
|---|---|---|
| `vite` | 8.2 | dev + build. Rolldown bundles, Oxc transforms, Lightning CSS handles `css/` |
| `vitest` | 5.0 | unit tests; replaces `node:test` and deletes `test/load.js` |
| `oxlint` | 1.82 | the fast linter — everything except two rules it does not have |
| `oxfmt` | 0.67 | formatting, `printWidth: 100`, `singleQuote: true` |
| `eslint` + `typescript-eslint` + `eslint-plugin-unicorn` | latest | **only** the two naming rules oxlint lacks |
| `stylelint` + `stylelint-no-unsupported-browser-features` | latest | the CSS bans, from browserslist |
| `typescript` | 5.x | `strict: true` from the first file |

### Build settings that are not optional

```ts
// vite.config.ts
export default defineConfig({
  base: './',                    // the TV loads from file://, not from a server
  build: {
    target: 'chrome53',
    cssTarget: 'chrome53',
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
```

`format: 'iife'` and `inlineDynamicImports` are load-bearing: Chromium 53 has
no `<script type="module">` (Chrome 61), so the output must be one classic
script. Any code-splitting silently produces a bundle the TV cannot load.

`base: './'` likewise — the app runs from
`file:///media/developer/apps/usr/palm/applications/com.stu.plexlite/`, and
Vite's default absolute `/assets/…` paths resolve to the filesystem root.

---

## Layout

`js/` becomes `src/`, which is what Vite expects and what `index.html` will
reference. The six layers survive unchanged, because they are what the import
rules are written against.

```
src/
  core/      config  panel  ui
  api/       http  plex  tmdb  youtube
  data/      store  cached  servers  merge  meta  art  shows  discovery  devices  guard
  rules/     audio  subtitles  quality  timeline  identity  labels  ratings
  view/      glyphs  menu  rail  masthead  sidebar
  screen/    browse  detail  showpage  player
  main.ts    (was js/app.js)
types/       plex.d.ts  and friends
```

### File naming

**kebab-case**, enforced by `unicorn/filename-case`. One concept per file. No
barrels — a barrel hides which layer a call really reaches into, and there is
no tree-shaking argument for one when the output is a single IIFE.

### Imports

Namespace imports, so the call site still says what kind of rule it is:

```ts
import * as audio from '../rules/audio';
import * as quality from '../rules/quality';

const track = audio.pickAudio(part);
if (!quality.allows(version, isDirect)) return refuse();
```

This is the one change that touches every file. `rules/media.js` — 504 lines,
31 exports, seven concerns — splits by what imports it:

| file | exports |
|---|---|
| `rules/audio.ts` | `pickAudio` `bestAudio` `audioTracks` `audioLabel` `audioMenuLabel` `audioSummary` `passesArc` `isCommentary` `streamById` |
| `rules/subtitles.ts` | `subtitleTracks` `subLabel` `pickSubtitle` `isTextSub` `langName` |
| `rules/quality.ts` | `isUHD` `canDecode` `allows` `qualities` `versionLabel` `bitrateLabel` |
| `rules/timeline.ts` | `chapters` `markerAt` `markerLabel` |
| `rules/identity.ts` | `identity` `identities` |
| `rules/labels.ts` | `railTitle` `railSub` `episodeLabel` |
| `rules/ratings.ts` | `ageLimit` `isKidsRating` `KIDS_MAX_AGE` |

None over ~120 lines. The gain is honest imports: `view/rail.ts` takes
`labels` and nothing else, rather than reaching into a 504-line surface.

**CLAUDE.md's rules sections must be rewritten to match.** It currently writes
rules as sentences — "`Media.allows` is the whole rule", "`Media.canDecode`
refuses anything outside H.264/HEVC" — and those names are about to change.
That is a documentation cost, not a design one, but it is not optional: a
constraints document naming functions that do not exist is worse than none.

---

## Style

### Functions

Variant B: **`async`/`await`, one function, guard clauses first.** A bundler
downlevels `async` for Chromium 53, which is the whole reason it is now
available — the ban in CLAUDE.md was a consequence of having no compiler, not
something the panel imposes.

```ts
export async function check(
  item: PlexItem,
  versionIndex = 0,
  forceAudioId?: string,
  options: DecideOptions = {},
): Promise<Verdict> {
  const metadata = await meta.load(item);
  if (!metadata) {
    return { ok: false, state: 'nometa', text: 'No metadata for this copy.' };
  }
  // …
}
```

`max-lines-per-function` is set to **60**, not the default 50, because variant
B leaves `check()` at about 45 and the rule should agree with the chosen style
rather than fight it.

### Formatting

`oxfmt`, `printWidth: 100`, `singleQuote: true`. Verified: single quotes are
honoured.

**This gives up hand-alignment, deliberately.** A formatter reprints; it does
not splice. Every aligned object literal explodes to one property per line:

```
return { ok: false, state: 'nopart', metadata, version,     →    return {
         text: 'This version has no playable part.' };               ok: false,
                                                                     state: 'nopart',
                                                                     …
```

That reverses the strategy the September codemods ran on, which spliced source
precisely so alignment and comment layout survived. The trade is bought
knowingly: layout stops being reviewable material at all.

A formatter does not touch what a comment *says*, only where it sits. What it
says is the next section, and it changes.

### Comments

Audited 2026-09-10: **22% of the tree is comments**, blocks run to 20 lines,
and `js/core/config.js` is 42%. CLAUDE.md's rule already said not to do this.
Nothing enforced it, so it happened anyway — including in the three files
added that same day, which came in at or above the tree average.

The rule, sharpened, is in CLAUDE.md and in `~/.claude/CLAUDE.md` as a global:
**would a competent reader delete or simplify this, and be wrong?** Types carry
what a parameter is. `docs/decisions.md` and the memory graph carry why. What
survives is the narrow class that stops a mistake — `panelIndexOf` comparing
two list lengths before trusting the panel's track order, which reads as a
redundant guard and is not.

Eleven lines to one, from `data/cache.js`, the worst offender written that day:

```ts
/* Every key the cache holds, and how long a hit lasts. */

/** Cached until replaced. `drop` writes null — Store has no delete. */
/** Cached for maxAge, hit or miss. */
/** A hit is kept; a miss is retried after maxAge. */
```

The `drop` note survives on merit: someone would "fix" it to a real delete.

**Enforcement, and its limit.** Comment *quality* is not lintable, and a length
cap produces truncated comments rather than better ones. Two things are
mechanical:

- `jsdoc/no-types` — bans `@param {PlexPart}` once the types are real. Missing
  from oxlint, so it joins the two naming rules in the ESLint half.
- **A density ratchet**, the same mechanism as `max-lines`: today's percentage
  per file is the ceiling, CI fails if a file gets more comment-heavy, and any
  merge may lower a number. Roughly 30 lines in `tools/`, and worth writing
  because nothing off the shelf does it.

Baseline to beat, worst first:

| file | today |
|---|---|
| `core/config.js` | 42.6% |
| `rules/rows.js` | 38.5% |
| `data/guard.js` | 35.3% |
| `view/masthead.js` | 30.2% |
| `data/cache.js` | 29.7% |
| whole tree | **22.0%** across 7,047 lines |

The ratchet only stops it getting worse. Bringing it down happens file by file
during the migration, when each one is being rewritten anyway.

### Naming

No abbreviations. `unicorn/prevent-abbreviations` with a project replacement
map, plus `id-length` as a floor:

| was | becomes |
|---|---|
| `st` | `stream` |
| `md` | `metadata` |
| `sec` | `section` |
| `ep` | `episode` |
| `gen` | `generation` |
| `v` | `videoElement` |
| `el` | `element` |
| `fn` | `callback` |
| `idx` | `index` |
| `msg` | `message` |
| `r` `m` `t` `n` `h` `w` `c` `s` `x` | say what they are |

`i` and `j` stay legal **in `for` headers only**. `id`, `url`, `src`, `at`,
`to` are words, not abbreviations, and stay.

Note that many of the 110 `i` declarations exist only because the code avoids
`for...of` — see the open question below.

---

## Enforcement: what runs, and where

**Pre-commit** (via the existing `core.hooksPath = .claude/crew/githooks`),
staged files only, milliseconds:

- `oxfmt --check`
- `oxlint`
- the existing `commit-msg` convention hook, unchanged

**CI — GitHub Actions, on every push and PR.** There is currently *no CI at
all*, which is the largest single gap: the cloud session's PR #1 had zero
checks on it.

- `tsc --noEmit`
- `oxlint`
- `eslint` (the two naming rules)
- `stylelint`
- `vitest run`
- `npx playwright test` — the 92-step smoke suite
- `vite build` — proves the Chromium 53 target still compiles

### What each check replaces

| today | becomes | why it is better |
|---|---|---|
| `check-es5.js` JS syntax rules | `build.target: 'chrome53'` | a compiler, not a regex |
| — nothing — | `eslint-plugin-compat` via browserslist | catches `Object.entries`, `padStart`, `.finally` — runtime APIs a bundler does **not** polyfill |
| `check-es5.js` layer rules | `import/no-cycle` + import restrictions | resolves real imports |
| `check-es5.js` manifest check | the import graph | a file not imported is not in the bundle |
| `check-es5.js` CSS rules | `stylelint` + browserslist | parses declarations |
| nothing | `max-lines`, `max-depth`, `complexity` | size stops being a judgement call |
| nothing | `unicorn/prevent-abbreviations` | the thing that prompted all this |

`tools/check-es5.js` is deleted once every row above is green.

### The verified oxlint config

```json
{
  "plugins": ["unicorn", "typescript", "import"],
  "categories": { "correctness": "error", "suspicious": "error", "perf": "error" },
  "rules": {
    "id-length": ["error", { "min": 3, "exceptions": ["i", "j", "id", "at", "to"] }],
    "max-lines": ["error", { "max": 1250 }],
    "max-lines-per-function": ["error", { "max": 60 }],
    "max-depth": ["error", 4],
    "complexity": ["error", 15],
    "unicorn/filename-case": ["error", { "case": "kebabCase" }],
    "import/no-cycle": "error"
  }
}
```

Confirmed against a fixture: `st` is flagged, `i` in a `for` header is not.

**Limits ratchet.** `max-lines` starts at 1250 — today's `player.js` — and
comes down as files split. Nothing is blocked on day one; every merge may lower
a number. The screen-file splits are not a precondition for the conversion.

### Two rules oxlint does not have

Probed against oxlint 1.82:

```
present  max-lines · max-lines-per-function · max-depth · complexity
present  id-length · unicorn/filename-case · import/no-cycle
MISSING  unicorn/prevent-abbreviations
MISSING  typescript/naming-convention
```

Both missing rules are the naming ones — the exact thing this refactor was
asked for. So ESLint runs alongside, configured to those two rules and nothing
else, in CI only. Two linters is not good, and it is temporary: the ESLint half
deletes itself the day oxlint ships `prevent-abbreviations`.

---

## Migration order

Globals to ESM cannot be half-done — but it can be staged behind a bridge.
`src/legacy.ts` imports each converted module and assigns it to `window`, so
unconverted files keep finding their globals. It is deleted last.

1. **Setup.** Vite, Vitest, oxlint, oxfmt, tsconfig, configs, CI. No source
   changes. Green: existing suites still pass through Vite's dev middleware.
2. **`rules/`** — pure, already unit-tested, no DOM and no network. The split
   above happens here. Vitest replaces the `vm.runInContext` loader.
3. **`api/`** — four files, one of which (`http.ts`) is new this month.
4. **`data/`** — ten files. `import.meta.env` replaces the `sed`-based key
   bake in `tools/package.sh`, which **fixes the §0b bug** rather than patching
   it: a bundled build currently ships with TMDB and YouTube keys empty.
5. **`view/`** — five files, DOM-heavy, needs the element typing from the
   September spike (`types/rail.d.ts` is the pattern).
6. **`screen/`** — four files, the largest. Splitting them is a separate task,
   not a precondition.
7. **Delete the bridge**, delete `tools/check-es5.js`, rewrite CLAUDE.md's
   rules sections against the new names.

Green smoke at every step. Nothing sits unreviewable — the lesson of PR #1,
which was thirteen commits against a remote six weeks stale.

### The dev server keeps its job

`dev/server.js` + `mock-plex.js` + `library.js` are 1,680 lines of fake
plex.tv, fake Plex, fake TMDB and YouTube, generating a 30,000-film library on
demand. Vite does not replace any of it. It runs *inside* it:

```js
const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
// the mock keeps every /library, /photo, /video and plex.tv route;
// everything else falls through to vite.middlewares
```

One process, one port, `npm run dev` unchanged. The "nothing leaves the
machine" smoke assertion stays where it is.

`dev/shim.js` — which injects config into `index.html` in memory — is likely
subsumed by `import.meta.env` and should be deleted if so.

---

## CSS

Lightning CSS is already a Vite dependency, so this is configuration rather
than adoption. Measured at `chrome 53`:

| written | Lightning CSS emits | verdict |
|---|---|---|
| nesting `& .tile` | `.rail .tile` | **now usable** |
| `:is(.b, .c)` | `:-webkit-any()` fallback, then `:is()` | **now usable** |
| `display: grid`, `gap` | unchanged | **still banned** |
| `position: sticky` | unchanged | **still banned** |
| `clamp(1rem, 2vw, 3rem)` | `max(1rem, min(2vw, 3rem))` | **still banned — trap** |

That last row is the one to watch. Lightning CSS "lowers" `clamp()` into
`min()`/`max()`, which arrived in **Chrome 79** — so the output is exactly as
unsupported as the input, while looking handled. Anyone who drops the clamp ban
trusting the tool ships silently broken CSS. The stylelint config must carry
that reason as a comment, not just the rule.

---

## Open, and deliberately not decided

**Does `for...of` actually cost anything on this panel?** CLAUDE.md bans it —
"it goes through the iterator protocol, and in the rail-drawing and merge paths
on a 2018 SoC that is a real cost for a cosmetic gain" — but no number was ever
taken, and Oxc will not downlevel it at `chrome53` because Chrome 38 supports
it. It is now the main thing standing between the code and readable loops, and
it is why there are 110 declarations of `i`.

Settle it with one profiling run on the B8 over the rail and merge paths, using
the CDP recipe now in CLAUDE.md's testing section. If the cost is real the ban
stays **with a number attached**; if it is not, the loops become `for...of` and
most of the abbreviations disappear on their own.

Do this during step 2, before `rules/` is rewritten — it changes how much of
the rewrite is worth doing by hand.
