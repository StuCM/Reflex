# The Mantis design source

Exported from Claude Design and committed here **because workers run in git
worktrees, which contain only tracked files** — an untracked drop would be
invisible to them.

- `Mantis Screens.dc.html` — the canvas. Six screens: `6a`/`6b` home with the
  big and dense hero, `6c` the movie page, `7a`/`7b`/`7c` the player, a setting
  opened from the row, and chapters.
- `Palette Frame.dc.html`, `_ds/styles.css` — the design system's own tokens.
- `support.js`, `image-slot.js` — the canvas runtime, so the file can be opened
  in a browser locally. It also pulls Phosphor icons from unpkg, which will not
  load offline; the icons are decorative here.

## Read it at face value: it is authored at 1920×1080

`.frame { width: 1920px; height: 1080px; transform: scale(.5) }` — the canvas
merely *displays* the screens at half size. Every pixel value in the file is
already in the app's coordinate system. Do not scale anything.

## Two palettes live in this export, and they disagree

- The **screens** define their own: `--ac:#a3bfa8` (sage), `--ac2:#b9a98c`
  (sand), `--bg:#131719`.
- The **design system** under `_ds/` is violet on a blue-black:
  `--color-accent:#9184d9`, `--color-bg:#161826`.
- `Reflex Discovery.dc.html` (not copied — superseded) held `--ac:#cfe06a` on
  `--bg:#0c0f16`, which is the app's original ink-and-citron.

The app currently ships **violet and amber**, sampled from screenshots of an
earlier revision of these screens. The screens as exported say sage and sand.
Which is current is the user's call — see `docs/decisions.md`.

Nothing here is packaged: `tools/package.sh` stages only `appinfo.json`,
`index.html`, the icons, `css/` and `js/`.
