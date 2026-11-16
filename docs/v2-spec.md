# Reflex: design and behaviour spec

A lean TV client for one person's Plex server, running on an LG OLED B8 (2018) under webOS 4 (Chrome 53), rooted. Plain DOM and vanilla JS, no framework. Repo: StuCM/Reflex. Only the owner (Stu) uses it. The designs are in `designs/*.dc.html`, built as 1920x1080 boards. They have never been run on the TV. Treat every number here as a starting point to be tuned on the device with `motion-lab.html`.

How to read the design files: each `.dc.html` is a template for the Claude Design artifact runtime (`<sc-for>`, `<sc-if>`, `{{bindings}}`, a `renderVals()` function that returns fake data). The markup and inline styles are plain HTML and CSS, so the layout numbers can be copied directly. The runtime itself is not included, so the files will not render on their own. Pages marked "state" take a `state` prop, and thin wrapper files (e.g. `SeriesCast.dc.html`) just pin a state. Fonts: Space Grotesk 500/700 for titles and labels, Inter 400/600 for body. All poster art, service logos, people and titles in the designs are invented placeholders.

## 1. Constraints that shape everything

- Chrome 53: no CSS grid (use flex-wrap or absolute positioning), no flex `gap` (use margins), no `backdrop-filter`, no `calc()` inside transition durations, no async/await. Write ES5 or lightly ES6.
- Animate only `transform` and `opacity`. Never animate width, height, top or left. Avoid large `filter: blur`.
- Fake glass: translucent gradient + 1px light border + inset top highlight. Used on menu tiles and modals only.
- Virtualise long lists. The Plex library is about 94,000 movies, so never render more than a screenful plus a small buffer.
- Remote only (Magic Remote pointer also exists, so hover and click should work, but the remote is the primary input).
- The system on-screen keyboard cannot be restyled or opened by script. It appears when an `<input>` has focus, covers the bottom third, and has a voice button. Voice gives the app only transcribed text. A custom keyboard would lose the voice button, so the decision is to keep the system keyboard and keep every search field at the top of the screen. (Source: LG webOS TV virtual keyboard docs and developer forum.)
- Plex server is not controlled by the user. Read-only use of its API.

## 2. Design language

- Background: dark near-black `#0B0912` with three oversized radial glows: wine `rgba(154,47,69,0.82)` upper right (ellipse 1000x760 at 80% 16%), navy `rgba(47,91,168,0.62)` lower left (900x640 at 8% 96%), a faint wine `rgba(154,47,69,0.3)` lower right. Gradient motion is a one-off transform shift of the oversized glow layers on page change only (see section 7), never continuous.
- Accent colour is per profile (section 6). Default Together `#F4C8B6` peach, Stu `#AEBBF0` periwinkle, Naoise `#8FD9C4` mint. Swatches offered: Peach F4C8B6, Periwinkle AEBBF0, Mint 8FD9C4, Sage B9D69A, Rose F0A6C0, Lilac CDB0F0, Sky 8CCBF0, Coral F5A28A. Accent is used for small-caps labels, the "Ends HH:MM" outline tag, progress fills, active-tab underline, profile avatar ring. Some boards still show the old peach; they should all read the active profile's accent.
- Optional "Tint the background" setting (default off) adds a hint of the accent to the glow.
- Glass (menu tiles, modals): `linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04)), rgba(24,16,46,0.96)` for modals (0.7 alpha for tiles), 1px `rgba(255,255,255,0.26)` border, `inset 0 1px 0 rgba(255,255,255,0.4)`, big soft drop shadow. Modal overlay `rgba(8,5,18,0.78)`.
- Focus: 3px white ring `rgba(255,255,255,0.95)` plus soft shadow. On pills it is a ring; on posters it is a ring and the poster grows slightly. Which focus style is best (scale, sliding ring, or both) is to be decided from the motion lab.
- Posters are portrait 2:3, no boxes or trays behind them. Sizes: 176x264 normal, 210x315 focused (rows), 206x309 (grids, 40px gaps), 560x315 for 16:9 trailer thumbs. Plenty of empty space. Page margin 96px.
- Type: titles Space Grotesk 700 uppercase, letter-spacing about -1px at 92-96px for heroes; labels 22px 600 uppercase with 3px tracking; body 26-30px; nothing below 18px.
- Remote colour buttons: OK = primary action, Yellow = add to list, Red = mark watched, Blue = recap (series) or trailer (movie). Shown as a legend row of coloured dots on detail pages; shown as small chips on list pages. Which cue style is final for Home was never decided (three options exist: Combo = chips, ComboLegend = colour-key legend, ComboBadge = poster badge).
- "Not on server" items (from TMDB but not in Plex) are shown at about 45-50% opacity with a small tag.
- Service marks (Prism, Tidal, Ember are placeholders) show next to a focused title so you know where it streams. Watch-provider data needs JustWatch attribution.

## 3. Navigation model

- App opens on Home, resting on the Continue Watching row.
- Top menu is five glass tiles: Home, Movies, TV, Collections, Discover. A small chevron above the tiles hints that Up opens them. Up from the first row reveals the tiles (content pushes down about 130px, about 300ms). Left/Right changes page. Down closes the menu and returns to rows.
- Down moves through rows. A page always rests on one focused row and shows a peek of the next row at the bottom.
- Back unwinds one level: modal, then menu, then page history.
- Profile switch: Channel Up/Down on the remote cycles profile (keycodes believed to be 427/428, UNVERIFIED; the B8 may not deliver them to web apps).
- Search and Discover are one page (Discover). Search bar on top, always.

## 4. Remote key map (webOS)

Arrows 37-40, OK 13, Back 461 (also Esc/Backspace on desktop), Red 403, Green 404, Yellow 405, Blue 406, Ch Up/Down 427/428 (unverified), numbers 48-57.

## 5. Pages

Each entry: file, what it shows, behaviour.

**Home** (`Combo.dc.html`, props theme/layout/cue; `ComboMenu` = Up pressed, `ComboModal` = Add to list modal). Continue Watching first, then rows. Not yet updated for the later spacing decisions or the five-item top row's final look, and rows should end with a "See all" tile. Add-to-list modal lists the user's lists.

**Movies / TV** (`Movies.dc.html` props focus trending|top10, kind movie|tv; wrappers `MoviesHot`, `TvTrending`, `TvNext`). Decision history: first version was cramped, so it was rebuilt. Trending (plain, mixed across the user's services) is the first row. The ranked Top 10 (big outlined numerals, 300 weight, 260px, 4px stroke) is one or two movements down, not first. A peek of the next row sits at the bottom. Hero at the top shows eyebrow, 96px title, service logo, meta, OK/Add chips, synopsis, all driven by the focused poster. "Because you watched" row for movies; "Your next episodes" for TV. Open decision: whether Top 10 stays second or moves third.

**Discover** (`Discover.dc.html`, props state look|results|filter|search|people; wrappers `DiscoverResults`, `DiscoverFilter`, `DiscoverSearch`, `DiscoverPeople`). One page that merges browsing and search. Search bar on top (system keyboard). Resting `look` state: row of 16:9 new trailers (cinema and streaming, date captions, play button, duration chip) and an "In cinemas now" peek. A typed name or title gives plain results: type tabs All / Movies / TV / People with counts, "+ Filter", then a 7-wide poster grid, no single "best match" on top (people are searched least, so they are never first; they have their own tab). A sentence ("slow tense thrillers from the 2010s, nothing too gory") is sent to Ceist, which is assumed to return structured filters (NOT CONFIRMED), shown as removable "Ceist read this as" chips plus "+ Filter". `filter` state is an "Add a filter" glass modal with rows Genre, Decade, Rating, Service, Language, Runtime and a live match count. The People tab is a 7-wide grid of portraits with role. OK on a person swaps to that person's titles, newest first.

**Collections** (`Collections.dc.html` prop tab yours|curated; `CollectionsCurated`). Lists and Collections were merged. Inner tabs: Yours (watchlist, manual lists, smart lists) and Curated (genres, franchises, editorial; genres and curated are the same thing). 5 cover tiles per row (320x380, a fan of three posters, name, sub-line, tag Smart/Genre/Franchise/Curated, franchise progress "Seen 2 of 5", and a "New list" tile). Lists and the watchlist live on TMDB.

**List page** (`List.dc.html`). One template for any list. Eyebrow (e.g. Smart list), title, rules summary, sort and edit cues, 7-wide grid, "Not on server" items faded. Smart list rule editor is not designed.

**Profiles** (`Profile.dc.html` prop state page|switch; `ProfileSwitch`; `ProfileColour.dc.html`). See section 6. Profile page shows "Your shows" row plus "Picked for Stu" peek. "Who's watching?" modal: Together / Stu / Naoise, returns to Together after 4 hours idle. Avatar chip sits beside the clock. Profile colour page: profile list left, 8 swatches right, live preview card.

**Series** (`Series.dc.html` props state resume|season|cast|actor|recap, seasons few|many; wrappers `SeriesSeason`, `SeriesMany`, `SeriesCast`, `SeriesRecap`, `SeriesActor`). Opens ready to resume; the header shows the focused episode. Season row is text (numbers when there are many seasons, e.g. 14). Episode cards (440x248 focused) with tick, progress, status tag, titles hidden for unwatched episodes (setting, default on, avoids spoilers). Cast row (150px circles) peeks below. OK on an actor swaps the row to that actor's titles, newest first, with year labels, a TV tag, and "Not on server" faded; header reads "Name · Newest first" and "1 of 38". Suggested cap about 40 most recent credits (not decided). Blue button opens the Recap modal: choose a season, then the app launches YouTube with a search for "<title> season N recap <preferred channel>". Preferred channels are set in Settings (e.g. Man of Recaps). YouTube embeds are unlikely to work on Chrome 53; launching the YouTube app is the plan, but passing a search term is UNCONFIRMED and needs a device test. TMDB has no recap video type.

**Movie page** (`MovieDetail.dc.html` state buttons|cast|franchise|server; wrappers `MovieFranchise`, `MovieServer`). Hero like the series page: "Resume · 48 min left", title, service logo, meta, "Ends HH:MM" tag, synopsis. Legend: OK Resume, Yellow Add to list, Red Mark watched, Blue Trailer. Button row above the cast: one large Resume button (small time shown on it), then small icon-only buttons spaced 32px apart: Play from start, Server picker, Audio. Below: Cast (actor swap as in Series), "Part of <franchise>" row with seen ticks ("Seen 2 of 5", release order, "You are here", Not on server and Coming soon tags), then Trailers and extras. Server picker is a glass modal listing the same film on each of the user's servers (name, resolution/codec/bitrate/size, Direct play or Remote tag, check on the selected one). It assumes titles can be matched across servers by Plex/TMDB id; UNVERIFIED for mismatched libraries. Trailer: launch the YouTube app by video id (from TMDB videos); untested.

**Player** (`Player.dc.html` state controls|intro|tracks|next; wrappers `PlayerIntro`, `PlayerTracks`, `PlayerNext`). Simplified: title and episode line top-left, clock and "Ends HH:MM" top-right, seek bar with chapter ticks and scrubber, elapsed and remaining time, seek preview thumbnail above the scrubber. Centred under the bar: previous episode, play/pause (largest), next episode. Previous/next skip to episodes, they do not seek. Left/Right always seek. A small chevron at the bottom means Down opens the menu. No hint rows. Down opens one glass menu with three columns, Audio, Subtitles, Quality, all visible, with only the focused column expanded and the others collapsed to cards showing the current choice. Quality options: Original (direct play), High 1080p 8 Mbps, Medium 720p 4 Mbps, Low 480p 2 Mbps; the header line reports the current stream. There is no episode list in the player. Skip intro: a glass pill bottom-right while inside the intro window, OK seeks to the end of the intro. Next episode: card bottom-right near the end with a still, episode title, countdown, OK Play now, Back Stay. Intro and credits timings come from Plex markers (stored as server metadata, not in the video file); markers exist only if the server has intro/credits detection (Plex Pass feature) and have been generated; movies mostly lack them. UNVERIFIED for this server. Open question: whether Up should focus the transport buttons (the board shows a focus ring on Play).

**Settings** (`Settings.dc.html`). Two columns: General (Pick a profile on startup: Off by default; Default profile; Profile colours; Back up my data to this TV; Last backup; Hide titles of unwatched episodes) and Recap channels (ordered list, "+ Add channel"). Needs fleshing out: servers, default quality per server, subtitle and language preferences, autoplay next, auto-skip intro, restore from backup, about/debug.

## 6. Profiles and data

- Default mode is Together. Stu and Naoise are a deliberate mode for shows that belong to one person. Switching is a remote button plus a "Who's watching?" modal. A profile filters feeds, history and recommendations so one person's viewing does not flood the shared feed, and each profile has its own accent colour.
- Setting: choose the profile on startup (off by default, may be needed later).
- Storage: local IndexedDB on the TV. Tables: plays (with profile tag), title_tags, smart_lists, hidden. Watchlist and manual lists stay on TMDB.
- Backup: export to a file on the TV after changes (debounced, rolling copies), so it stays current. This needs a background service on the rooted TV and is UNVERIFIED.

## 7. Motion and performance (the app's feel is the main priority)

Previous builds felt jittery or late. Principles:
- The focus indicator moves first. Everything else (hero text, backdrop, details) updates about 150ms after focus settles. Debounce details, prefetch neighbours.
- Translate whole rows. One focus ring that slides, or one transform scale, not per-element layout changes.
- Skip animation entirely on key repeat (held arrow). Jump straight to the final state.
- Placeholder first: gradient or tiny blurred poster, never an empty hole.
- Starting timings (to be tuned): focus about 130ms, row scroll about 260ms, menu about 300ms, hero crossfade about 200ms, all with `cubic-bezier(.2,.7,.2,1)`.
- Background: three smaller glow blobs that physically travel, not grow. On page change each blob moves a long way (hundreds of px) in a different direction for parallax, about 800ms. Optionally they also drift a little as focus scrolls along a row (motion lab option 3, third setting). Transform only, no continuous idle animation. Rows crossfade about 130ms on page change.
- `will-change: transform` on containers only; do not blanket-apply it to hundreds of posters (memory).
- Use `motion-lab.html` on the TV. Number keys toggle each technique and a HUD shows fps, worst frame, jank count and key-to-frame latency. Decide the winning settings from measured numbers, then bake them into the app.

## 8. Integrations and assumptions

- Plex: library, playback, markers (intro/credits), preview thumbnails (seek), multiple servers, direct play versus transcode info. Not verified against this server.
- TMDB: trending, discover, recommendations, person credits, videos (YouTube keys for trailers), watch providers (JustWatch attribution), lists.
- YouTube: launch the app from webOS; deep link by video id is the reliable path, search-term launch is unconfirmed.
- Ceist: the user's own natural-language search tool; assumed to turn a sentence into structured filters. Interface not confirmed.

## 9. Not designed yet

First run and Plex sign-in, server management, loading/empty/error states (server unreachable, playback failed), buffering state, subtitle styling, resume prompts, Home update, add-to-list for multiple lists, smart list creation and rule editor, list rename/delete, mark-watched confirmation and undo, person page (the inline actor swap exists), new-episode notifications, screensaver/idle, pointer (Magic Remote) hover states, a final decision on the remote-button cue style.

## 10. Unverified items to test first on the device

1. Channel Up/Down key codes reach the web app.
2. Launching YouTube with a search term or video id from webOS.
3. Plex intro/credits markers on this server.
4. Background service to write the backup file.
5. Cross-server title matching for the server picker.
6. Ceist's actual interface.
7. Whether 1920x1080 or 1280x720 is the real app resolution (the motion lab scales to the window either way).

## 11. Files

- `designs/`: current `.dc.html` boards (Home = `Combo*`), plus `canvas.json` (board positions and titles, in the order they were designed).
- `motion-lab.html`: single-file motion test page for the B8.
- Superseded early explorations (Main, Backdrop, MenuLists, Tiles*, Home*, Grad*, ComboBadge/ComboLegend/ComboNavy variants) are not required and can be ignored.

## Kids (top-level page, 4th item: Home, Movies, TV, Kids, Collections, Discover)
Designs: Kids (Watch tab), KidsLists (Collections tab), KidsLock, KidsSettings, KidsLook.
- Own look: warmer, brighter background than the rest of the app (default "Sunny"; also Dusk, Mint, Berry), faint star/circle shapes, yellow accent #FFD66B, rounded font Fredoka for greeting, tabs, section labels and tile names. Fredoka must be bundled with the app (woff2), not fetched.
- Greeting at the top: "Hello <names>!" with names and wording set in Settings > Kids > Greeting and look. Kids' real names are entered by the user, never hard-coded.
- Two tabs under the greeting (Left/Right between them, Down enters content): Watch = Keep watching (16:9 cards with progress) + rows built from TMDB queries (e.g. New this week = discover sorted by release date with certification limit; add more rows later). Collections = grid of tiles, one per curated TMDB list, each opening the standard List template.
- Curation comes from TMDB (lists and discover queries), not Plex metadata. A tile/row is shown only if some titles exist on the server.
- Settings > Kids: ages to show (0-5, 6-9, 10-12, 13+), highest rating (UK certificates, read from TMDB), search inside Kids, which lists appear as tiles (on/off, order, add by list ID), PIN to leave Kids (typed with remote number buttons; Back stays in Kids), Greeting and look.
- UNVERIFIED: TMDB list items carry no certification so the rating limit needs a cached per-title lookup; ages vs rating overlap and may merge; Kids profile vs page undecided; new-content rows depend on release dates matching what the server holds.
