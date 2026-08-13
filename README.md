# Reflex

A browse-fast Plex client for an LG OLED B8 (webOS 4.0). No bundler, no
dependencies — plain files, Chromium 53 target. See `CLAUDE.md` for the
constraints that shape every decision here.

## What works now

- plex.tv PIN link, token kept in localStorage
- direct server discovery (races every non-relay connection, first to answer wins)
- movie sections, paged and cached in IndexedDB — the rail paints from cache
  before any network call
- windowed rail: 14 tiles in the DOM regardless of library size
- masthead shows resolution / codec / container and **the audio track we would
  pick**, before you press OK
- OK runs the `hasMDE=1` decision call and plays only on `directplay`. A 4K item
  that will not direct play is refused with the server's reason.

Not yet: shows, and filters beyond the kids certificate cut. Direct play only —
there is no transcode playback path, by design.

## Run it on the laptop

```sh
npm run dev            # http://localhost:8080
npm run dev -- --films 30000 --latency 140    # the real library's size and distance
npm run verify         # Chromium-53 check, unit tests, headless smoke test
```

`npm run dev` serves the app exactly as it ships and stands in for both plex.tv
and a media server, so there is no sign-in and no traffic to anyone's real
server — the generated library is deliberately full of awkward files (TrueHD
only, 4K VC-1) so every branch of the playback guard is reachable. Press `?` in
the browser for the key mapping; `index.html` is rewritten in memory on the way
out, never on disk.

`npm run dev -- --proxy` forwards plex.tv to the real thing instead, if you want
to sign in properly and browse the real library from a desktop browser. Your
token passes through the local process.

To exercise playback, drop any browser-playable video at
`dev/fixtures/sample.mp4`; every item then plays it. Without one, playback takes
its error path, which is worth seeing once too.

## Put it on the TV

```sh
npm i -g @webosose/ares-cli
```

On the TV: install **Developer Mode** from the Content Store, sign in with your
LG developer account, toggle Dev Mode ON (it reboots), then toggle the Key
Server ON. The app shows the TV's IP and a 6-character passphrase.

ares-cli ships a placeholder device called `tv` pointing at `root@…:22` — that
is the webOS OSE profile, not a retail set. A retail TV in Dev Mode is
`prisoner@<ip>:9922`, so modify the entry rather than adding a second one:

```sh
ares-setup-device --modify tv -i "host=<TV_IP>" -i "port=9922" -i "username=prisoner"
ares-novacom --device tv --getkey      # prompts for the passphrase
ares-package . -e dev -e test -e tools -e node_modules
ares-install --device tv com.stu.plexlite_0.0.1_all.ipk
ares-launch  --device tv com.stu.plexlite
ares-inspect --device tv --app com.stu.plexlite   # DevTools, use Chromium ~53
```

The TV must be awake and on the same subnet — a B8 in standby drops its network
interface unless Quick Start+ is on, and nothing will answer on 9922.

Developer Mode expires after 1000 hours and takes sideloaded apps with it.

First launch shows a code — enter it at plex.tv/link.

## Keys

| Key | Browse | Playing |
|---|---|---|
| ← → | move in rail | seek ∓30s |
| ↑ ↓ | change library section | — |
| OK | play | play / pause |
| Back | exit app | stop |

## probe.py

Finds which declared client capability flips a file from transcode to direct
play. Uses `hasMDE=1`, so it returns the verdict without opening a session —
safe to run repeatedly against a server we don't own.

```sh
python3 probe.py --search "Dune"      # find a rating key
python3 probe.py 12345                # print streams, then the profile matrix
python3 probe.py 12345 --audio 98765  # force one audio stream on every row
```

When a row direct plays, copy its profile into `PROFILE` in `js/plex.js`.

## If nothing loads on the TV

Open `ares-inspect` and look at the Network tab first. The app runs from a
`file://` origin; webOS relaxes web security for packaged apps, so cross-origin
XHR to plex.tv and to the server should work. If requests fail with status 0,
that's the thing to confirm before blaming the Plex API.

The bottom line of the screen is a debug readout — server name, section item
counts, and the last decision verdict. If DevTools won't attach at all, run
`npm run beacon` on the laptop and point `beacon` in `js/config.js` at it: the
same line then prints in your terminal. Clear it again afterwards, it costs a
request per line.

## Curated rows

The discovery rows need a free TMDB v3 API key in `tmdbKey` in `js/config.js`.
Without one they say so and everything else works unchanged.

## Tests

```sh
npm test          # pure rules: audio selection, the UHD guard, certificates,
                  # and the virtual row's arithmetic
npm run check     # anything in js/ or css/ that Chromium 53 cannot run
npm run smoke     # the whole app in headless Chromium, against the mock
```

The unit tests cover the rules that keep an accidental transcode off someone
else's dashboard, and the certificate parsing that decides what a child is shown.
`npm run smoke` needs Playwright (`npm i -g playwright`); without it, it says so
and stops rather than failing.
