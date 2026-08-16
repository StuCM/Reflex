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

- Episode stills. The show page is a wall of text; episodes carry a landscape
  `thumb` we never draw.
- Cast and crew on the show page, as the film page has.
- "Play next unwatched" at the top of a show, so a series you are part way
  through is one press, not two and a scroll.
- Watched state is drawn from `viewCount` and `viewOffset` but never updated
  after playback, so it is stale until the section is reloaded.
- Mark watched / unwatched by hand.
- Related items (`includeRelated=1`) and collections.

### 4. The rail

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

