# Backlog

Moved out of CLAUDE.md so it is not loaded into every agent's context.
The orchestrator reads this; workers do not need it.

Ordered so that the thing closest to the screen comes first: if playback is
wrong, nothing further out matters. Take one group at a time. Anything marked
**TV** cannot be answered on the laptop.

### 1. Playback itself

- **TV** Does an MKV direct play through the HTML5 video element on webOS 4 at
  all? The media pipeline handles MKV from USB; the element may still refuse
  the container. This is the single assumption everything rests on.
- **TV** Does the converted stream play? `Plex.transcodeUrl` hands the element
  an HLS playlist; webOS plays HLS natively, but that is untested here.
- **TV** Audio output to Auto, then `probe.py` on a file that currently
  transcodes: which declared capability flips it. The oldest open question.
- Mark watched. We report progress every 10s but never scrobble, so a film
  played to the end stays half-watched everywhere else.
- Report `stopped` when the app is backgrounded or the TV sleeps. A session
  left open on someone else's server is the rudest thing this app could do.
- Next episode: play the following one when this one ends, with a countdown
  that can be cancelled. The main reason a show is easier to watch in the
  official app.
- ~~Subtitles~~ — done, and `subtitles=none` stays on the decision call
  deliberately. Burning in is a transcode; the track is fetched as text from
  `/library/streams/<id>`, parsed by `js/subs.js` and drawn over the video, so
  it costs the server one GET and no session. **TV**: none of it has met the
  panel, and `js/panel.js` will say on the first deploy whether the pipeline
  exposes `textTracks` at all — if it does, handing it a track is worth
  comparing against drawing them ourselves.

### 2. The player on screen

- ~~A scrub bar~~ — done: position, duration, buffered, a knob, chapter ticks
  and bands for the intro and end credits.
- ~~Subtitle and audio track pickers in one place~~ — done: one menu on the
  arrows with Audio, Subtitles, Quality and Chapters, and the colour buttons
  as shortcuts into it. Quality is versions plus bitrate caps, and every cap
  goes back through the guard, so a 4K cap is refused as the transcode it is.
- The OSD titles an episode by its own name only — it should say the show and
  the number, as everywhere else does.
- Next/previous episode while playing.
- **TV** The quality menu has never met a real transcode: a cap restarts
  playback against `Plex.transcodeUrl`, and whether the panel seeks inside a
  Plex HLS playlist is unknown.

### 3. The pages that lead into playback

- **Clear things out of Continue watching.** The list grows and never shrinks.
  Wanted: a coloured button on the browse screen that turns the Continue
  watching row into a multi-select, and the same action on a title's own page.
  **The mechanism needs deciding before this is specced.** "Mark watched" is the
  obvious answer and is wrong for shows: a series you are two seasons into is
  removed by marking all thirty watched, which destroys the fact that you have
  seen two. Plex has `PUT /actions/removeFromContinueWatching?ratingKey=` on
  newer servers, which hides the item without touching watch state — exactly the
  intent — so the task should use that where the server has it and fall back to
  `PUT /:/scrobble` only where it does not.

  Resolved while waiting on 013: **do not sniff the server version for this.**
  Discovery already has `productVersion` from plex.tv's `/api/v2/resources`,
  but a version number lies — forks, Plex Pass differences, and a fallback has
  to exist regardless. Try `removeFromContinueWatching` and fall back to
  `scrobble` on a 404. Capability detection by trying beats version sniffing,
  and it needs no probe script and no write to a server we do not own just to
  find out what it supports.

- **TMDB categories as the default rows, server hubs in the menu.** Today the
  browse screen shows the server's own hubs (Recently Added, Recently Released,
  Top Rated) and TMDB's curated rows live in a separate Discovery *mode*. The
  user wants that inverted: their own TMDB categories — trending, what is on
  Netflix / Prime / Disney+, recommendations — as the rows shown by default,
  with the server's hubs still reachable but demoted into the sidebar. Also
  wants a say in which TMDB categories exist rather than the four hardcoded in
  `js/tmdb.js`. Touches `js/browse.js`, `js/discovery.js`, `js/sidebar.js`.

- **The film page's layout is wrong in five ways**, all seen on the panel:
  1. `#dt-body` and `#dt-extras` are `width: 1000px` on a 1920px screen — a
     leftover from when `#dt-art` occupied 1100px on the right. 008 and 014
     replaced that with a full-width header and nobody widened the body, so cast
     and extras have been squeezed into half the screen since.
  2. Spacing throughout is cramped.
  3. Extras should be a row you navigate **down** to with only its top showing —
     the same peek the rail uses and the user already approved there — rather
     than a strip inside the body.
  4. `.dt-act.primary` is 280×88 while every other button is 88×88: Play is too
     big and the rest too small.
  5. **No way to play from the start** when a film is part-watched. Play
     resumes; there is no second action.
  Best done against `design/Mantis Screens.dc.html` if the user can export it —
  screenshots carried the palette losslessly but carry no type scale and no
  spacing, which is exactly what is wrong here.

- **Rebuild the film and series pages to the design language the rail now
  uses** — portrait posters, the 264px header, ink & citron. The flow they have
  to serve is: search a title, land on its page, switch between servers and
  copies there. That flow already *works* — `Detail.addOtherVersions` asks every
  server `/library/all?guid=` on open, which is global across sections and so
  finds the 4K-library copy the row never knew about — but the page looks
  nothing like the rest of the app. Blocked behind 008 (which reshapes
  `js/detail.js`) and 009 (`js/showpage.js`, `css/app.css`).
- ~~Episode stills~~ — task 009. The show page is a wall of text; episodes
  carry a landscape `thumb` we never draw.
- Cast and crew on the show page, as the film page has.
- "Play next unwatched" at the top of a show, so a series you are part way
  through is one press, not two and a scroll.
- Watched state is drawn from `viewCount` and `viewOffset` but never updated
  after playback, so it is stale until the section is reloaded.
- Mark watched / unwatched by hand.
- Related items (`includeRelated=1`) and collections.

### 4. The rail

- **Two Continue watching rows, on a real server only.** `mergeHubs` in
  `js/browse.js` passes through every hub `/hubs/sections/<key>` returns, and a
  real Plex server serves one called `Continue Watching` — so the app shows its
  own onDeck row *and* the server's hub. `dev/mock-plex.js` serves only Recently
  Added, Recently Released, Top Rated and Directors, so no test has ever been
  able to see it. Fix: drop hubs that duplicate what we build ourselves
  (`continue watching`, `on deck`, case-insensitively) **and** make the mock
  serve one so the step can fail.
- **Tiles show the previous item's poster while scrolling.** 015 deliberately
  keeps a swept-past tile's existing picture rather than blanking it, on the
  reasoning that a held poster beats an empty box. On a recycled tile that means
  showing the *wrong* film for 160ms and then swapping, which reads as the image
  jumping. A neutral placeholder on recycle, or a crossfade on the swap, is
  what was actually wanted.
- **The scrolled header should be laid out like the first screen**, not in two
  columns. The description is hard to read where it is, and the lower rows'
  layout is off. Replicate the tall hero's arrangement, and **add the ratings
  row** the detail page has.

- **The motion is jarring.** With one row fitting under the header, every press
  of down scrolls a whole 466px row, and the tall-to-dense change moves the
  header, the rail and the backdrop at once. `#rows` already eases over 340ms
  and `.strip` over 180ms, so the fix is consistency and timing, not adding
  transitions.
- **The hero backdrop hard-swaps.** `Masthead.paintArt` assigns
  `background-image` outright, so the picture cuts rather than fades. Two
  stacked layers alternating `opacity` gives a crossfade for the price of a
  composited layer, which is inside what the SoC allows — unlike a filter or a
  blur.
- **The browse screen needs redesigning** to the Mantis look, once the palette
  lands. It works; it does not match.

- **Jump to a letter.** 30,000 films is not d-pad-able, and this is the
  biggest single gap left in browsing.
- Filters beyond the kids cut: year, unwatched, resolution, genre — all
  server side, as the certificate filter already is.
- Sort: title, recently added, year.
- A top-level "recently added across both servers" row, above the sections.
- Search could filter and remember; it currently does neither.

### 5. Boot, cache and the servers

- A server added to the account after the cache was written is never found —
  discovery only rediscovers when every cached server fails.
- IndexedDB never evicts. Page entries from a since-changed section linger
  for ever; a cursor sweep is the fix.
- The metadata cache drops all 500 entries when it fills, rather than the
  oldest.
- The debug line is always on screen. It should be a setting, not a constant.

### 6. Only if browsing is still slow after all that

- A caching backend on the existing Hetzner box (Docker Compose + Caddy) that
  pre-sizes posters and serves a pre-baked section index. Deliberately last:
  the point is to find out whether it is needed, and the numbers so far say
  the cost is round trips, not the panel.

### Housekeeping

- `js/browse.js` and `js/plex.js` are both past 550 lines and are the next
  split candidates — search, kids and the discovery rows would go cleanly.
- `js/guard.js` has no unit test. It is the most important logic in the app
  and is only covered end to end.

