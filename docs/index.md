---
title: Reflex
description: A browse-fast Plex client for a 2018 LG OLED B8, and the record of how it is built.
---

# Reflex

A Plex client for an **LG OLED B8 (2018, webOS 4.0)**. The stock Plex app
streams fine on this TV but browsing the library is slow and awkward. This app
exists to fix browsing, and handles playback itself — bouncing back to the
official app to play something would defeat the purpose.

The constraint that shapes everything: **webOS 4.0 ships Chromium 53,
permanently.** LG does not update Chromium within a major webOS version.

## What is here

- **[Decisions](/decisions)** — what was chosen and why, in the order it was
  chosen. A record, so entries are superseded rather than rewritten.
- **[Backlog](/backlog)** — what is next, ordered outward from the video: if
  playback is wrong, nothing further out matters.
- **[The refactor](/refactor-plan)** — the Vite and TypeScript migration.
  Finished 2026-09-13; kept as the record of what was decided.
- **[Layering debt](/layering-debt)** — the imports that cross `src/`'s layers
  the wrong way, frozen by a ratchet so nothing new joins them.

## What is not here

`CLAUDE.md` is the working brief for anyone — human or agent — changing the
code, and it stays in the repository root where the tools that read it expect
it. This site is the reasoning around the code, not the instructions for
editing it.
