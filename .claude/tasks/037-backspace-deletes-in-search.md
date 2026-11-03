---
id: 037
slug: backspace-deletes-in-search
status: draft
branch: crew/037-backspace-deletes-in-search
model: sonnet
env: laptop
rounds: 0
files:
  - src/screen/browse.ts
  - dev/smoke/search.js
---

# Delete on the TV keyboard deletes a letter instead of leaving search

## Goal
In the search view, the on-screen keyboard's delete key removes a character
from the query. Only the remote's BACK key (and Esc on a laptop) leaves search.
Today delete leaves search, and the character is not removed either.

## Why now
A bug the user hits every time they search on the panel (reported 2026-11-03).

## Existing work
`npx crew collisions` could not run, because the crew CLI is not installed in
the session that wrote this. Checked by hand: no branch other than `main` and
`ccr-e2dc43ae-pi2ghm` (docs only) touches these files. None.

## Graph context
`npx crew graph` was unavailable. Written from the code.

- `isBack()` in `src/core/ui.ts:42` accepts 461 (the TV's BACK), 27 (Esc) and
  **8 (Backspace)**. Backspace is there because a desktop browser has no BACK
  key. The webOS virtual keyboard's delete sends 8.
- `searchKey()` in `src/screen/browse.ts:1024` runs for the `search` view
  (`src/app.ts:351`) and closes search on any `isBack(code)`. `onKey` in
  `app.ts` then calls `preventDefault()`, which is why the character survives.
- The input's own `keydown` listener (`browse.ts:111`) handles only Enter.
  Leave it alone.

## Constraints that bite here
- Do not change `isBack()`. Every other screen relies on Backspace meaning
  back on the laptop.

## Approach
1. In `searchKey()`, return `false` for `KEY.BACKSPACE` before the `isBack`
   check, so the input receives the key and deletes. Esc and 461 still call
   `closeSearch()`.
2. Add a smoke step to `dev/smoke/search.js`: open search (`F1`), `page.fill`
   the input with `abc`, press `Backspace`, and assert that the input's value
   is `ab` **and** that `#search-input` is still visible. Then press `Escape`
   and assert that search closed. That second assertion is the control: the
   step proves a way out still exists.
3. Run the new step against `main` first. It must fail there on the value
   check.

## Out of scope
- Clearing the query with BACK, or any other change to how search behaves.
- The search results page, the on-screen keyboard layout, or `isBack()`.

## Definition of done
- [ ] In the search view, Backspace deletes one character and search stays
      open.
- [ ] Esc (laptop) and keycode 461 (TV) still close search.
- [ ] The new smoke step passes, and was observed failing against `main`
      (quote the failure line in the report).
- [ ] The gate passes (`npx crew gate .claude/tasks/037-backspace-deletes-in-search.md`).
- [ ] No file outside `files:` is touched.
- [ ] Commits follow the convention.

## Review rounds

## Graph writes proposed
