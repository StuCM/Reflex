/* Drives the real app in a real browser against the mock server.
   Runs on Node only — modern syntax is fine here.

     npm run smoke              every area, headless
     npm run smoke -- player    one area, which is what iterating wants
     npm run smoke -- --head    watch it happen
     npm run smoke -- --shot    write dev/screenshots/*.png

   The steps live in dev/smoke/<area>.js, one file per area; this file is the
   harness they are given and the runner that walks them in order. The mock
   takes whatever port the OS hands out, so two suites can run at once.

   Needs Playwright. It is not a dependency of this project (there are none),
   so if it isn't installed the run says so and stops without failing:

     npm i -g playwright && npx playwright install chromium

   What it is for: the app has no unit-testable UI layer — it is one document,
   remote keys, and a rail. This walks the paths that matter (link, browse,
   paging, kids, search, devices, and all three playback verdicts) and fails on
   any console error, so a refactor that breaks browsing gets caught on the
   laptop instead of on the TV. */
'use strict';

const path = require('path');
const fs = require('fs');
const { start } = require('./server');
const buildLibrary = require('./library').build;
const mockTmdb = require('./mock-tmdb');
const mockYoutube = require('./mock-youtube');
const oneBackdrop = mockTmdb.oneBackdrop;
const noCredits = mockTmdb.noCredits;

const FILMS = 400;

/* The order they run in, which is also the order they ran in as one file:
   several areas depend on the app being left where the one before it left it. */
const AREAS = ['link', 'browse', 'show', 'recaps', 'sections', 'discovery',
               'search', 'devices', 'detail', 'player', 'deck'];

const args = process.argv.slice(2);
const HEADED = args.indexOf('--head') >= 0;
const SHOTS = args.indexOf('--shot') >= 0;

const named = args.filter(function (a) { return a.charAt(0) !== '-'; });
const unknown = named.filter(function (a) { return AREAS.indexOf(a) < 0; });
if (unknown.length) {
  console.log('\n  no such area: ' + unknown.join(', '));
  console.log('  areas: ' + AREAS.join(' ') + '\n');
  process.exit(1);
}
/* Named or not, they run in AREAS order — the suite is the same suite however
   it was asked for. */
const RUNNING = named.length
  ? AREAS.filter(function (a) { return named.indexOf(a) >= 0; })
  : AREAS;

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  try {
    chromium = require(path.join(
      require('child_process').execSync('npm root -g').toString().trim(),
      'playwright')).chromium;
  } catch (e2) {
    console.log('\n  SKIPPED: Playwright is not installed.');
    console.log('  npm i -g playwright && npx playwright install chromium\n');
    process.exit(0);
  }
}

/* Pick real titles out of the same generated library the servers will serve, so
   the playback assertions land on known media profiles rather than on whatever
   happens to be first. */
function findTitles() {
  const lib = buildLibrary({ films: FILMS });
  const main = lib.servers[0], backup = lib.servers[1];

  const copies = {};      // film index -> [copy, ...]
  lib.servers.forEach(function (srv) {
    srv.items['1'].forEach(function (m) {
      (copies[m._film] = copies[m._film] || []).push(m);
    });
  });

  /* Search is a substring match, so a title is only usable here if no other
     title contains it — otherwise "one result" is not a safe assertion. */
  function unambiguous(m) {
    const inFilms = lib.films.filter(function (f) { return f.title.indexOf(m.title) >= 0; }).length;
    /* Search returns shows as well now, and shows are named from the same
       vocabulary — a title is only safe here if nothing else contains it. */
    const inShows = lib.shows.filter(function (sh) { return sh.title.indexOf(m.title) >= 0; }).length;
    return inFilms === 1 && inShows === 0;
  }

  /* A film only one server has, so its verdict is the only one on offer. */
  function only(profile) {
    const hit = main.items['1'].concat(backup.items['1']).filter(function (m) {
      return m._profile === profile && copies[m._film].length === 1 && unambiguous(m);
    })[0];
    if (!hit) throw new Error('no unambiguous single-server title with profile ' + profile);
    return hit;
  }

  /* A film both servers have, in different shapes: one copy direct plays and
     the other cannot. This is the case the whole feature exists for. */
  const shared = main.items['1'].filter(function (m) {
    if (copies[m._film].length !== 2 || !unambiguous(m)) return false;
    const profiles = copies[m._film].map(function (c) { return c._profile; });
    return profiles.indexOf('hevc-truehd') >= 0 &&
           (profiles.indexOf('hevc-eac3') >= 0 || profiles.indexOf('h264-eac3') >= 0);
  })[0];
  if (!shared) throw new Error('no shared film with one playable and one unplayable copy');

  /* Two films the TMDB mock treats differently: one with posters and backdrops
     both, so the tile and the hero are a poster and a backdrop, and one sparse
     enough to have no poster at all, where the tile falls back to what Plex
     has. Both must have credits, or the header's cast line has nothing to say. */
  function withBackdrops(want) {
    const hit = main.items['1'].concat(backup.items['1']).filter(function (m) {
      return oneBackdrop(m._film) === want && !noCredits(m._film) && unambiguous(m);
    })[0];
    if (!hit) throw new Error('no unambiguous film with ' + (want ? 'one' : 'several') +
                              ' TMDB backdrops');
    return hit;
  }

  /* A show to watch a run of. One server holds it, so every verdict on the page
     is the only one on offer; its episodes direct play, except the third, which
     the library deliberately encodes differently and the guard has to refuse;
     and it has a second series to cross into. */
  function runOfEpisodes() {
    const holders = {};
    lib.servers.forEach(function (srv) {
      srv.items['3'].forEach(function (m) {
        (holders[m._show] = holders[m._show] || []).push(srv);
      });
    });

    function usable(m) {
      if (holders[m._show].length !== 1) return false;
      if (m._profile !== 'h264-eac3' || (m.childCount || 0) < 2) return false;
      /* Shows are searched for by title like films are, so one that another
         title contains is not safe to assert a single result on. */
      const named = lib.shows.filter(function (sh) { return sh.title.indexOf(m.title) >= 0; });
      if (named.length !== 1) return false;
      if (lib.films.filter(function (f) { return f.title.indexOf(m.title) >= 0; }).length) return false;
      const third = episodesOf(m, 1).filter(function (e) { return e.index === 3; })[0];
      return !!third && (third._profile === 'hevc-truehd' || third._profile === 'vc1-avi');
    }

    function episodesOf(m, season) {
      return holders[m._show][0].episodesByShow[m.ratingKey].filter(function (e) {
        return e.parentIndex === season;
      });
    }

    const hit = main.items['3'].concat(backup.items['3']).filter(usable)[0];
    if (!hit) throw new Error('no single-server show that direct plays with an awkward third episode');
    return {
      title: hit.title,
      seasons: hit.childCount,
      lastOfFirst: episodesOf(hit, 1).length,
      lastOfLast: episodesOf(hit, hit.childCount).length
    };
  }

  /* A show the recaps mock answers for, and one it does not — both reached by
     search like everything else here, so both titles have to be unambiguous. */
  function showWithRecaps(want) {
    const hit = lib.shows.filter(function (sh) {
      if (mockYoutube.hasRecaps(sh.title) !== want) return false;
      const named = lib.shows.filter(function (o) { return o.title.indexOf(sh.title) >= 0; });
      if (named.length !== 1) return false;
      return !lib.films.filter(function (f) { return f.title.indexOf(sh.title) >= 0; }).length;
    })[0];
    if (!hit) throw new Error('no unambiguous show ' + (want ? 'with' : 'without') + ' recaps');
    return hit.title;
  }

  /* Every movie library on both servers is one Movies section now, so its All
     row must land between the biggest single library and the sum of them all. */
  const movieCounts = [];
  lib.servers.forEach(function (srv) {
    srv.sections.forEach(function (s) {
      if (s.type === 'movie') movieCounts.push(srv.items[s.key].length);
    });
  });

  return {
    movies: {
      biggest: Math.max.apply(null, movieCounts),
      sum: movieCounts.reduce(function (a, b) { return a + b; }, 0)
    },
    truehdOnly: only('hevc-truehd'),     // must be refused before any request
    transcodes: only('vc1-avi'),         // server says transcode, we refuse
    directPlays: only('h264-eac3'),      // plays
    shared: shared,                      // on both servers, only one copy playable
    manyShots: withBackdrops(false),     // posters and backdrops both
    oneShot: withBackdrops(true),        // no posters, so the tile falls back
    run: runOfEpisodes(),                // a series to play one episode after another
    recapShow: showWithRecaps(true),     // the channel has this one's seasons
    noRecapShow: showWithRecaps(false)   // and nothing at all for this one
  };
}

/* Playback can only really be tested if there is something to play. */
function hasFixture() {
  return ['sample.mp4', 'sample.webm', 'sample.mkv'].some(function (n) {
    return fs.existsSync(path.join(__dirname, 'fixtures', n));
  });
}

const results = [];
function ok(name) { results.push([true, name]); console.log('  ok    ' + name); }
function fail(name, err) {
  results.push([false, name]);
  console.log('  FAIL  ' + name + '\n        ' + (err && err.message ? err.message : err));
}

function run() {
  const titles = findTitles();
  /* Port 0: the OS picks one that is free, which is what lets a second suite
     run beside this one. The mock prints the port it was asked for, so its
     banner says 0 and the real one is said here. */
  const server = start({ port: 0, films: FILMS, latency: 0,
                         pinPolls: 1, proxy: false, quiet: true });
  let browser, port;

  return new Promise(function (resolve) {
    server.on('listening', function () { resolve(server.address().port); });
  }).then(function (p) {
    port = p;
    console.log('  smoke on http://localhost:' + port +
                '   areas: ' + RUNNING.join(' ') + '\n');
    return chromium.launch({ headless: !HEADED });
  }).then(function (b) {
    browser = b;
    return b.newContext({ viewport: { width: 1920, height: 1080 } });
  }).then(function (ctx) {
    return ctx.newPage().then(function (page) { return drive(page, titles, port); });
  }).then(function () {
    return browser.close();
  }, function (e) {
    fail('run', e);
    return browser && browser.close();
  }).then(function () {
    server.close();
    const bad = results.filter(function (r) { return !r[0]; }).length;
    console.log('\n  ' + (results.length - bad) + '/' + results.length + ' passed\n');
    process.exit(bad ? 1 : 0);
  });
}

function drive(page, titles, port) {
  const errors = [];
  const offSite = [];

  /* "no supported source" is the video element failing on a stream the mock
     cannot provide — the correct outcome when dev/fixtures/sample.* is absent. */
  page.on('pageerror', function (e) {
    if (e.message.indexOf('no supported source') < 0) errors.push('pageerror: ' + e.message);
  });
  /* Every UI.debug line is echoed to the console, so collecting them gives the
     app's own account of what it did — more reliable than sampling #debug,
     which only ever holds the latest line. */
  const trace = [];
  /* Without a dev/fixtures/sample.* there is nothing to convert, so the HLS
     stream 404s on purpose. Expected only while the fixture is missing, and only
     for that path — every other 404 still fails the step. */
  const noFixture = !hasFixture();
  let expected404 = 0;
  page.on('console', function (m) {
    const text = m.text();
    if (text.indexOf('REFLEX ') === 0) { trace.push(text.slice(7)); return; }
    const where = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && where.indexOf('library/parts') < 0) {
      if (noFixture && where.indexOf('/video/:/transcode/universal/start') >= 0) {
        expected404++;
        return;
      }
      /* One recap embed never answers on purpose, so that the app's fallback
         has something to fall back from; closing the overlay aborts it. */
      if (where.indexOf('/__ytembed/') >= 0) return;
      /* Backup answers removeFromContinueWatching with a 404 on purpose — that
         is the whole reason the app has a fallback. Only Backup's: a 404 from
         Main would be a real failure. */
      if (where.indexOf('/__plex2/actions/removeFromContinueWatching') >= 0) return;
      errors.push('console: ' + text + ' ' + where);
    }
  });
  function tracedThat(re) { return trace.some(function (l) { return re.test(l); }); }
  /* Nothing may leave this machine in mock mode. The whole point of the mock is
     that developing the app never touches the server we do not own. */
  /* One lookup per title on screen and never a second: the whole point of the
     cache, and the difference between this and crawling the library. */
  const artLookups = [];
  /* Tile posters only, by the size the rail asks for: the hero's backdrop is a
     w1280 or a 1920-wide Plex crop and is not what a sweep must stop fetching. */
  const tilePosters = [];
  /* Progress reports, in the order they were sent — which is how a step can
     tell that the finished episode was closed out before the next one opened
     anything on the server. */
  const timelines = [];
  /* What was asked of YouTube, and when. A search is 100 units of a day's
     10,000, so "none until the button is pressed, one per press" is the feature
     rather than a detail of it. */
  const ytCalls = [];
  const ytSearches = [];
  /* Every write that takes something off the deck, so a step can say which
     server was actually told rather than only that the row got shorter. */
  const deckWrites = [];
  page.on('request', function (r) {
    const u = r.url();
    if (/removeFromContinueWatching|\/:\/scrobble/.test(u)) deckWrites.push(u);
    if (/\/__yt\/(channels|search|videos)\?/.test(u)) ytCalls.push(u);
    if (u.indexOf('/__yt/search?') >= 0) ytSearches.push(u);
    if (/\/__tmdb\/movie\/\d+\?/.test(u)) artLookups.push(u);
    if (u.indexOf('/__tmdbimg/w342/') >= 0 ||
        (u.indexOf('/photo/:/transcode') >= 0 && u.indexOf('width=209') >= 0)) tilePosters.push(u);
    if (u.indexOf('/:/timeline?') >= 0) timelines.push(u);
    /* 10.255.255.1 is the dead connection the mock advertises on purpose, so
       that discovery's race has something to lose to. */
    if (u.indexOf('http://localhost:' + port) !== 0 &&
        u.indexOf('data:') !== 0 &&
        u.indexOf('10.255.255.1') < 0) offSite.push(u);
  });

  const shotDir = path.join(__dirname, 'screenshots');
  if (SHOTS && !fs.existsSync(shotDir)) fs.mkdirSync(shotDir);
  let shotN = 0;
  function shot(name) {
    if (!SHOTS) return Promise.resolve();
    return page.screenshot({ path: path.join(shotDir, (++shotN) + '-' + name + '.png') });
  }

  function debugLine() { return page.textContent('#debug'); }
  function visible(sel) { return page.isVisible(sel); }
  /* times === 0 means do not press at all — "walk zero steps to the tab you are
     already on" is a real thing to ask for, and `times || 1` turned it into one
     press, which is a whole tab out. */
  function press(key, times) {
    let p = Promise.resolve();
    for (let i = 0; i < (times === undefined ? 1 : times); i++) {
      p = p.then(function () { return page.keyboard.press(key); })
           .then(function () { return page.waitForTimeout(60); });
    }
    return p;
  }
  function waitFor(fn, what, ms) {
    return page.waitForFunction(fn, null, { timeout: ms || 10000, polling: 100 })
      .then(function () { return true; }, function () { throw new Error('timed out waiting for ' + what); });
  }
  /* On failure, print the app's own last words alongside the assertion. A
     timeout says only what did not happen; the trace says what did. */
  function step(name, fn) {
    return Promise.resolve().then(fn).then(function () { ok(name); }, function (e) {
      fail(name, e);
      trace.slice(-5).forEach(function (l) { console.log('        · ' + l); });
    });
  }

  /* ---- the in-player menu ----

     Same idea as sidebarPick: find the row by what it says rather than by an
     index, walk the selection to it and press OK. The menu is what audio,
     subtitles and quality are chosen from without leaving playback. */

  /* The player and the film page draw the same menu into different hosts, and
     only one of them is ever up — so every reader here asks for whichever is
     not hidden rather than naming a screen. */
  const MENU_ROWS = '#menu:not(.hidden) .menu-row, #dt-menu:not(.hidden) .menu-row';
  const MENU_TABS = '#menu:not(.hidden) .menu-tab, #dt-menu:not(.hidden) .menu-tab';

  /* The label, plus the note beside it — the note is where a row says what
     choosing it will cost, so a check that cannot see it is not checking. */
  function menuLabels() {
    return page.evaluate(function (sel) {
      return Array.prototype.map.call(document.querySelectorAll(sel),
        function (r) {
          const note = r.querySelector('.menu-note-inline');
          return (r.classList.contains('on') ? '* ' : '') +
                 r.querySelector('.menu-label').textContent.trim() +
                 (note ? '  [' + note.textContent.trim() + ']' : '');
        });
    }, MENU_ROWS);
  }

  function menuTabs() {
    return page.evaluate(function (sel) {
      return Array.prototype.map.call(document.querySelectorAll(sel),
        function (t) { return t.textContent.trim() + (t.classList.contains('on') ? '*' : ''); });
    }, MENU_TABS);
  }

  function menuChoose(re) {
    return page.evaluate(function (src) {
      const rows = document.querySelectorAll(
        '#menu:not(.hidden) .menu-row, #dt-menu:not(.hidden) .menu-row');
      const want = new RegExp(src);
      let sel = 0, to = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].classList.contains('sel')) sel = i;
        if (to < 0 && want.test(rows[i].textContent)) to = i;
      }
      return [sel, to];
    }, re.source).then(function (idx) {
      if (idx[1] < 0) {
        return menuLabels().then(function (labels) {
          throw new Error('no menu row matching ' + re + ' in: ' + labels.join(' | '));
        });
      }
      return press(idx[1] > idx[0] ? 'ArrowDown' : 'ArrowUp', Math.abs(idx[1] - idx[0]))
        .then(function () { return page.keyboard.press('Enter'); })
        .then(function () { return page.waitForTimeout(80); });
    });
  }

  /* ---- the player's control row ----

     Four round buttons on the right, each captioned with what is chosen now.
     Up takes the focus into the row, left and right walk it, up again opens the
     panel belonging to the button underneath. */

  /* Every control in order: its id (empty on the three transport buttons), its
     caption, which one has the focus and which one's panel is open. */
  function controlRow() {
    return page.evaluate(function () {
      const ids = [], caps = [];
      let foc = -1, open = null;
      Array.prototype.forEach.call(
        document.querySelectorAll('#osd-controls .osd-ctl'),
        function (c, i) {
          ids.push(c.id);
          caps.push(c.querySelector('.osd-cap').textContent.trim());
          if (c.classList.contains('foc')) foc = i;
          if (c.classList.contains('on')) open = c.id;
        });
      return { ids: ids, caps: caps, foc: foc, open: open };
    });
  }

  /* Walk the focus onto a named button from wherever the row happens to be, so
     a step never has to know what the one before it left focused. */
  function focusControl(id) {
    return controlRow()
      /* A panel that is up owns the d-pad, so it has to go before the row can
         be walked at all. */
      .then(function (row) { return row.open ? press('Backspace').then(controlRow) : row; })
      .then(function (row) { return row.foc >= 0 ? row : press('ArrowUp').then(controlRow); })
      .then(function (row) {
        const want = row.ids.indexOf('osd-ctl-' + id);
        if (want < 0) throw new Error('no control called ' + id + ': ' + row.ids.join(', '));
        const by = want - row.foc;
        return press(by > 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(by));
      });
  }

  function openMenu(id) {
    return focusControl(id)
      .then(function () { return press('ArrowUp'); })
      .then(function () {
        return waitFor('!document.getElementById("menu").classList.contains("hidden")',
                       'the ' + id + ' panel');
      });
  }

  /* Chapters is the one that is a rail rather than a list. */
  function openChapters() {
    return focusControl('chapters')
      .then(function () { return press('ArrowUp'); })
      .then(function () {
        return waitFor('!document.getElementById("osd-chapters").classList.contains("hidden")',
                       'the chapter rail');
      });
  }

  /* ---- the sidebar ----

     What the chip row used to be. Left off the front of a row opens it, so
     "however far into a row we are, get the sections on screen" is a loop of
     lefts rather than a count of them. */

  function sidebarIsOpen() {
    return page.evaluate(function () {
      return document.getElementById('sidebar').classList.contains('open');
    });
  }

  function openSidebar() {
    function attempt(n) {
      return sidebarIsOpen().then(function (isOpen) {
        if (isOpen) return true;
        if (n <= 0) throw new Error('the sidebar would not open');
        return press('ArrowLeft').then(function () { return attempt(n - 1); });
      });
    }
    return attempt(60);
  }

  /* One string per row: '* ' marks the section showing, '- ' marks a category
     nested under one. */
  function sidebarRows() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#sidebar .sb-row'),
        function (r) {
          return (r.classList.contains('cur') ? '* ' : '') +
                 (r.classList.contains('sub') ? '- ' : '') + r.textContent.trim();
        });
    });
  }

  /* Move the sidebar focus onto a named row, rather than assuming an index —
     the list grows as the app does. Movies and TV Shows name both a section and
     a cut of Continue watching, so a top-level entry wins unless the nested one
     was asked for; a category, which only ever exists nested, is found either
     way. */
  function sidebarWalkTo(label, sub) {
    return page.evaluate(function (want) {
      const rows = document.querySelectorAll('#sidebar .sb-row');
      let on = 0, top = -1, nested = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].classList.contains('on')) on = i;
        if (rows[i].textContent.trim() !== want.label) continue;
        if (rows[i].classList.contains('sub')) { if (nested < 0) nested = i; }
        else if (top < 0) top = i;
      }
      return [on, want.sub ? nested : (top >= 0 ? top : nested)];
    }, { label: label, sub: !!sub }).then(function (idx) {
      if (idx[1] < 0) {
        return sidebarRows().then(function (rows) {
          throw new Error('no "' + label + '" in the sidebar: ' + rows.join(' | '));
        });
      }
      return press(idx[1] > idx[0] ? 'ArrowDown' : 'ArrowUp', Math.abs(idx[1] - idx[0]));
    });
  }

  /* Walk to a named row and press OK on it. */
  function sidebarPick(label) {
    return openSidebar()
      .then(function () { return sidebarWalkTo(label); })
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () { return page.waitForTimeout(80); })
      /* OK on a section whose categories are known opens them in place; it
         takes a second press to actually switch to it. */
      .then(sidebarIsOpen)
      .then(function (still) {
        if (!still) return;
        return page.keyboard.press('Enter').then(function () { return page.waitForTimeout(80); });
      });
  }

  /* The cuts of Continue watching hang under it, so the parent has to be opened
     first — one press expands it, and sidebarPick's second press would pick it
     before its children were ever on screen. */
  function watchingPick(label) {
    return openSidebar()
      .then(sidebarRows)
      .then(function (rows) {
        /* Already open when the rail is resting on the row, and pressing OK on
           the parent then would pick it rather than open it. */
        const open = rows.indexOf('- ' + label) >= 0 || rows.indexOf('* - ' + label) >= 0;
        if (open) return;
        return sidebarWalkTo('Continue watching')
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () { return page.waitForTimeout(80); })
          .then(sidebarIsOpen)
          .then(function (still) {
            if (!still) throw new Error('OK on Continue watching picked it instead of opening it');
          });
      })
      .then(function () { return sidebarWalkTo(label, true); })
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () { return page.waitForTimeout(200); });
  }

  /* ---- the Continue watching row, as the clearing steps need it ----

     Every entry in it, not only the tiles drawn: the row is one entry per
     title, each carrying every copy of it, and clearing has to reach the server
     behind each copy. */

  function deckRow() {
    return page.evaluate(function () {
      const el = document.querySelector('#rows .row.on');
      const row = el && el._rowRef;
      if (!row || !row.items) return null;
      return {
        label: el.querySelector('.row-label').textContent.trim(),
        focus: row.focus,
        picked: Array.prototype.filter.call(el.querySelectorAll('.tile'), function (t) {
          return t.classList.contains('picked');
        }).length,
        hint: !document.getElementById('browse-hint').classList.contains('hidden'),
        entries: row.items.map(function (m) {
          return { title: m.grandparentTitle || m.title, type: m.type,
                   key: String(m.ratingKey),
                   showKey: m.grandparentRatingKey ? String(m.grandparentRatingKey) : '',
                   servers: [m._server].concat((m._sources || []).map(function (s) {
                     return s._server;
                   })) };
        })
      };
    }).then(function (row) {
      if (!row) throw new Error('the Continue watching row is not the focused one');
      return row;
    });
  }

  /* Move the focus onto the first entry `wanted` accepts, and hand it back. */
  function focusDeck(wanted) {
    return deckRow().then(function (row) {
      let to = -1;
      for (let i = 0; i < row.entries.length; i++) {
        if (to < 0 && wanted(row.entries[i])) to = i;
      }
      if (to < 0) {
        throw new Error('nothing in the row matched: ' + row.entries.map(function (e) {
          return e.title + ' [' + e.servers.join(' + ') + ']';
        }).join(' | '));
      }
      return press(to > row.focus ? 'ArrowRight' : 'ArrowLeft', Math.abs(to - row.focus))
        .then(function () { return row.entries[to]; });
    });
  }

  const onMain = function (e) { return e.servers.length === 1 && /main$/.test(e.servers[0]); };
  const onBackup = function (e) { return e.servers.length === 1 && /backup$/.test(e.servers[0]); };
  const onBoth = function (e) { return e.servers.length === 2; };

  /* The confirmation: what it says will happen, and which row it landed on. */
  function confirmBox() {
    return page.evaluate(function () {
      const box = document.getElementById('confirm');
      if (box.classList.contains('hidden')) return null;
      return {
        title: box.querySelector('.menu-tab').textContent.trim(),
        note: box.querySelector('.menu-note').textContent.trim(),
        rows: Array.prototype.map.call(box.querySelectorAll('.menu-row'), function (r) {
          return (r.classList.contains('sel') ? '> ' : '') +
                 r.querySelector('.menu-label').textContent.trim();
        })
      };
    });
  }

  function waitForConfirm(what) {
    return waitFor('!document.getElementById("confirm").classList.contains("hidden")',
                   'the confirmation ' + what, 15000)
      .then(confirmBox);
  }

  /* Take the action rather than the default: Cancel is what it lands on. */
  function takeConfirm() {
    return press('ArrowUp')
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () { return page.waitForTimeout(400); });
  }

  /* Whatever the browse screen has cached for a section's rows. Continue
     watching sits in every one of them, so a removal has to clear the lot or a
     reload paints the thing straight back. */
  function cachedRows(section) {
    return page.evaluate(function (key) {
      return new Promise(function (resolve) {
        const req = indexedDB.open('reflex', 1);
        req.onerror = function () { resolve('no database'); };
        req.onsuccess = function () {
          const get = req.result.transaction('kv', 'readonly').objectStore('kv').get(key);
          get.onsuccess = function () { resolve(get.result === undefined ? null : get.result); };
          get.onerror = function () { resolve('read failed'); };
        };
      });
    }, 'rows:' + section);
  }

  /* Land on Continue watching with the deck as the servers now have it. Out
     through the other section and back: picking the section you are already on
     repaints the rows it holds rather than asking the servers again, so a
     reload that stays on Movies would prove nothing about what they now say. */
  function reloadDeck() {
    return backToLibrary()
      .then(function () { return sidebarPick('TV Shows'); })
      .then(function () { return page.waitForTimeout(500); })
      .then(function () { return sidebarPick('Movies'); })
      .then(function () { return page.waitForTimeout(500); })
      .then(function () { return sidebarPick('Continue watching'); })
      .then(function () { return page.waitForTimeout(200); })
      .then(deckRow);
  }

  /* What the focused row is showing, by kind: the tiles carry their item. */
  function focusedRowTypes() {
    return page.evaluate(function () {
      const row = document.querySelector('#rows .row.on');
      if (!row) return null;
      return {
        title: row.querySelector('.row-label').textContent.trim(),
        types: Array.prototype.map.call(row.querySelectorAll('.tile:not(.hidden)'),
          function (t) { return (t._item && t._item.type) || '?'; })
      };
    });
  }

  /* The refusal screen has to be *showing*, and it has to be about the film we
     actually chose — naming the wrong one is a bug this caught once already. */
  function shown(titleFragment, film) {
    return '(function(){' +
      'var v = document.getElementById("message");' +
      'if (v.classList.contains("hidden")) return false;' +
      'return /' + titleFragment + '/.test(document.getElementById("message-title").textContent) &&' +
      ' document.getElementById("message-body").textContent.indexOf(' + JSON.stringify(film) + ') === 0;' +
      '})()';
  }

  /* Whatever the last step left on screen, get back to plain browsing. */
  function backToLibrary() {
    function attempt(n) {
      return page.evaluate(function () {
        return {
          browse: !document.getElementById('browse').classList.contains('hidden') &&
                  document.getElementById('detail').classList.contains('hidden') &&
                  document.getElementById('show').classList.contains('hidden'),
          results: document.getElementById('browse').classList.contains('results')
        };
      }).then(function (st) {
        if (st.browse && !st.results) return true;
        if (n <= 0) throw new Error('could not get back to the library rows');
        return press('Backspace').then(function () { return attempt(n - 1); });
      });
    }
    return attempt(5);
  }

  /* Search for an exact title and come to rest on the only result. */
  function searchFor(title) {
    return backToLibrary()
      .then(function () { return sidebarPick('Movies'); })
      .then(function () { return press('F1'); })
      .then(function () { return page.waitForSelector('#search-input', { state: 'visible' }); })
      .then(function () { return page.fill('#search-input', title); })
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () {
        /* Wait for *this* title, not merely a non-empty masthead — the previous
           film's title is still on screen and would satisfy a looser check. */
        return waitFor('document.querySelector("#mh-title").textContent.trim() === ' +
                       JSON.stringify(title), 'the search result for ' + title);
      });
  }

  /* What the focused tile and the backdrop are showing. A picture from the TMDB
     mock names its kind, its title and which of that title's it is; one from
     Plex does not, which is how the fallback is told apart. */
  function pictures() {
    return page.evaluate(function () {
      function shotOf(u) {
        var m = String(u).match(/(backdrop|poster)\/(\d+)\/(\d+)\.svg/);
        return m ? { kind: m[1], title: m[2], n: m[3] } : null;
      }
      var img = document.querySelector('#rows .row.on .tile.on img');
      var lit = document.querySelector('#hero-art .hero-layer.on');
      var hero = lit ? lit.style.backgroundImage : '';
      return {
        tile: { url: (img && img.src) || '', shot: shotOf(img && img.src),
                painted: !!(img && img.naturalWidth > 0) },
        hero: { url: hero, shot: shotOf(hero) }
      };
    });
  }

  /* OK on the rail no longer plays — it opens the detail page, and playing is a
     decision made there against a named copy. */
  function openTitle(title) {
    return searchFor(title)
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () {
        return waitFor('!document.getElementById("detail").classList.contains("hidden") &&' +
                       ' document.getElementById("dt-title").textContent.trim() === ' +
                       JSON.stringify(title), 'the detail page for ' + title);
      })
      /* Every copy is checked as the page opens; nothing can be chosen
         meaningfully until at least the selected one has a verdict, and Play's
         caption is where that verdict is said. */
      .then(function () {
        return waitFor('(function(){var c=document.querySelector("#dt-actions .dt-act-cap");' +
                       'return c && !/checking/.test(c.textContent);})()',
                       'a verdict on the selected copy', 15000);
      });
  }

  /* ---- the film page's action row ----

     Play, then a round button per choice, each captioned with what is chosen
     now. The captions are the assertion: they are what says, before OK, what
     Play would do. */

  function actionRow() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#dt-actions .dt-act'),
        function (a) {
          return { on: a.classList.contains('on'),
                   act: a.getAttribute('data-act'),
                   primary: a.classList.contains('primary'),
                   button: a.querySelector('.dt-act-btn').textContent.trim(),
                   caption: a.querySelector('.dt-act-cap').textContent.trim() };
        });
    });
  }

  /* Walk the row to a button and press OK. By name rather than by an index:
     Trailer is only there when the film has one, and Remove only when the thing
     is on the deck — and Trailer arrives with the extras, which is to say after
     the page is on screen. A row that grows a button mid-walk shifts every
     index past it, so the walk is checked and repeated rather than counted
     once: OK a place short opens the wrong panel, and the step that wanted the
     confirmation waits out its timeout for one that was never asked for. */
  function pressButton(which) {
    function walk(n) {
      return actionRow().then(function (row) {
        let at = 0, to = -1;
        for (let i = 0; i < row.length; i++) {
          if (row[i].on) at = i;
          if (row[i].act === which) to = i;
        }
        if (to < 0) {
          throw new Error('no ' + which + ' button: ' +
                          row.map(function (a) { return a.act; }).join(', '));
        }
        if (to === at) return;
        if (n <= 0) throw new Error('the ' + which + ' button would not take the focus');
        return press(to > at ? 'ArrowRight' : 'ArrowLeft', Math.abs(to - at))
          .then(function () { return walk(n - 1); });
      });
    }
    return walk(4)
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () { return page.waitForTimeout(80); });
  }

  function openChooser(which) {
    return pressButton(which).then(function () {
      return waitFor('!document.getElementById("dt-menu").classList.contains("hidden")',
                     'the ' + which + ' chooser');
    });
  }

  /* The source chooser's rows, split back into the version, the server it is on
     and the verdict the guard gave it. */
  function sourceRows() {
    return page.evaluate(function () {
      return Array.prototype.map.call(
        document.querySelectorAll('#dt-menu:not(.hidden) .menu-row'),
        function (r) {
          const note = r.querySelector('.menu-note-inline');
          const parts = r.querySelector('.menu-label').textContent.trim().split(' \u00b7 ');
          const preferred = parts[parts.length - 1] === 'preferred';
          if (preferred) parts.pop();
          return { on: r.classList.contains('on'),
                   preferred: preferred,
                   server: parts.pop(),
                   version: parts.join(' \u00b7 '),
                   verdict: note ? note.textContent.trim() : '' };
        });
    });
  }

  /* Guard says yes to exactly these three and no to everything else, so listing
     the yeses is the formulation that cannot go stale. */
  function playable(verdict) {
    return /direct play|direct stream|audio transcode|server transcodes/.test(verdict);
  }

  /* The kicker, the chips and the ratings, read off whatever page is open.
     Everything here is already fetched — what is tested is what the page says
     and how it is labelled. */
  function detailFace() {
    return page.evaluate(function () {
      function texts(sel) {
        return Array.prototype.map.call(document.querySelectorAll(sel), function (e) {
          return e.textContent.replace(/\s+/g, ' ').trim();
        });
      }
      return {
        kicker: document.getElementById('dt-kicker').textContent.trim(),
        chips: texts('#dt-chips .dt-chip'),
        ratings: texts('#dt-ratings .dt-rating'),
        glyphs: document.querySelectorAll('#dt-ratings .dt-rating svg').length,
        page: document.getElementById('detail').textContent
      };
    });
  }

  /* A part missing from the kicker takes its separator with it, so a blank
     between two dots is a bug rather than a shorter kicker. */
  function kickerParts(kicker) {
    if (!kicker) return [];
    const parts = kicker.split('·');
    parts.forEach(function (p) {
      if (!p.trim()) throw new Error('an empty part in the kicker: "' + kicker + '"');
    });
    return parts.map(function (p) { return p.trim(); });
  }

  /* ---- a run of episodes ----

     Search finds shows as well as films, so a show with an unambiguous title is
     reached exactly the way a film is; OK on it opens the series page. */

  function openShowPage(title) {
    return searchFor(title)
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () {
        return waitFor('!document.getElementById("show").classList.contains("hidden") &&' +
                       ' document.querySelectorAll(".sh-episode").length > 1',
                       'the series page for ' + title, 20000);
      });
  }

  /* Leave the show page and come straight back to it, which is how "the second
     visit costs nothing" is asked. Back from a show lands on the result that
     opened it, still focused. */
  function reopenShowPage(title) {
    return press('Backspace')
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () {
        return waitFor('!document.getElementById("show").classList.contains("hidden") &&' +
                       ' document.querySelectorAll(".sh-episode").length > 1',
                       'the series page for ' + title + ' again', 20000);
      });
  }

  /* Everything the recaps strip is saying: whether it is open, what it holds,
     and whether the episode list moved out of its way. */
  function recapStrip() {
    return page.evaluate(function () {
      const strip = document.getElementById('sh-recaps');
      const on = strip.querySelector('.sh-recap.on');
      return {
        open: strip.classList.contains('open'),
        lifted: document.getElementById('sh-episodes').classList.contains('lifted'),
        html: strip.innerHTML.trim(),
        focused: on ? on.textContent.trim() : '',
        episode: !!document.querySelector('.sh-episode.on'),
        cards: Array.prototype.map.call(strip.querySelectorAll('.sh-recap'), function (c) {
          const thumb = c.querySelector('.sh-recap-thumb');
          const len = c.querySelector('.sh-recap-len');
          const title = c.querySelector('.sh-recap-title');
          return {
            title: (title || c).textContent.trim(),
            art: thumb ? getComputedStyle(thumb).backgroundImage : 'none',
            length: len ? len.textContent.trim() : ''
          };
        })
      };
    });
  }

  /* Down out of the episode list, however far into it the page landed — no
     series here runs to twenty episodes. */
  function intoRecaps() {
    return press('ArrowDown', 20).then(recapStrip);
  }

  function focusedEpisode() {
    return page.evaluate(function () {
      const on = document.querySelector('.sh-episode.on');
      return on ? Number(on.querySelector('.sh-ep-num').textContent.trim()) : null;
    });
  }

  /* Walk the series chips and the episode list to a numbered episode and press
     OK. The numbers are read off the page rather than counted from an assumed
     start, because where the page lands is its own decision. */
  function playEpisode(seasonN, episodeN) {
    return press('ArrowUp', 30)                  // out of the episodes, onto the chips
      .then(function () {
        return waitFor('document.querySelector("#sh-seasons .chip.on") !== null',
                       'the series chips');
      })
      .then(function () {
        return page.evaluate(function (want) {
          const chips = document.querySelectorAll('#sh-seasons .chip');
          let on = 0, to = -1;
          for (let i = 0; i < chips.length; i++) {
            if (chips[i].classList.contains('on')) on = i;
            if (chips[i].textContent.trim() === 'Season ' + want) to = i;
          }
          return [on, to];
        }, seasonN);
      })
      .then(function (idx) {
        if (idx[1] < 0) throw new Error('no Season ' + seasonN + ' chip on the page');
        return press(idx[1] > idx[0] ? 'ArrowRight' : 'ArrowLeft', Math.abs(idx[1] - idx[0]));
      })
      .then(function () {
        return waitFor('document.querySelectorAll(".sh-episode").length > 1',
                       'the episodes of series ' + seasonN, 15000);
      })
      .then(function () { return press('ArrowDown'); })     // into the episode list
      .then(focusedEpisode)
      .then(function (at) {
        if (at === null) throw new Error('no focused episode row');
        if (at === episodeN) return;
        return press(episodeN > at ? 'ArrowDown' : 'ArrowUp', Math.abs(episodeN - at))
          .then(focusedEpisode)
          .then(function (now) {
            if (now !== episodeN) throw new Error('landed on episode ' + now + ', wanted ' + episodeN);
          });
      })
      .then(function () {
        /* OK on an episode with no verdict yet opens the copy chooser rather
           than playing, so wait for the check to land first. */
        return waitFor('(function(){var e=document.querySelector(".sh-episode.on");' +
                       'return e && e.querySelector(".sh-verdict") !== null;})()',
                       'a verdict on S' + seasonN + 'E' + episodeN, 20000);
      })
      .then(function () { return page.keyboard.press('Enter'); });
  }

  /* Run the file out rather than sitting through it: the offer is made on the
     element's own `ended`, which is the event we want to see fire. */
  function playToEnd() {
    return waitFor('(function(){var v=document.getElementById("video");' +
                   'return !v.classList.contains("hidden") && v.duration > 0 &&' +
                   ' v.currentTime > 0 && !v.error;})()',
                   'playback to get going', 25000)
      .then(function () {
        return page.evaluate(function () {
          const v = document.getElementById('video');
          v.currentTime = Math.max(0, v.duration - 0.15);
        });
      });
  }

  function upNext() {
    return page.evaluate(function () {
      return {
        showing: !document.getElementById('upnext').classList.contains('hidden'),
        show: document.getElementById('un-show').textContent.trim(),
        title: document.getElementById('un-title').textContent.trim(),
        hint: document.getElementById('un-hint').textContent.trim(),
        video: !document.getElementById('video').classList.contains('hidden')
      };
    });
  }

  function waitForOffer() {
    return waitFor('!document.getElementById("upnext").classList.contains("hidden")',
                   'the up-next offer', 25000).then(upNext);
  }

  /* Linked, with the rail painted and nothing else on top of it: where every
     area but link begins, so one can be run without the ones before it. */
  function ready() {
    return waitFor('(function(){var t=document.querySelectorAll("#rows .tile:not(.hidden)");' +
                   'var n=0,i;for(i=0;i<t.length;i++) if(t[i].textContent.trim()) n++;' +
                   'return n > 5;})()', 'filled tiles', 20000)
      .then(backToLibrary);
  }

  /* Everything an area file is given. The steps live in dev/smoke/*.js; the
     harness stays here, so there is one browser, one mock and one set of
     collectors however many areas are asked for. */
  const h = {
    page, titles, ready, FILMS, hasFixture,
    step, press, waitFor, shot, visible, debugLine, trace, tracedThat,
    artLookups, tilePosters, timelines, ytCalls, ytSearches, deckWrites,
    menuLabels, menuChoose, controlRow, openMenu, openChapters,
    openSidebar, sidebarRows, sidebarPick, watchingPick,
    deckRow, focusDeck, onMain, onBackup, onBoth,
    waitForConfirm, takeConfirm, cachedRows, reloadDeck, focusedRowTypes,
    shown, backToLibrary, searchFor, pictures, openTitle,
    actionRow, pressButton, openChooser, sourceRows, playable,
    detailFace, kickerParts, openShowPage, reopenShowPage,
    recapStrip, intoRecaps, playEpisode, playToEnd, upNext, waitForOffer
  };

  /* One area after another, never two at once: several of them depend on the
     app being left where the one before it left it. */
  return page.goto('http://localhost:' + port + '/')

    .then(function () {
      return RUNNING.reduce(function (p, area) {
        return p.then(function () { return require('./smoke/' + area)(h); });
      }, Promise.resolve());
    })

    /* Last, whatever ran: it is about the whole session rather than any one
       area. */
    .then(function () {
      return step('no console errors and nothing left this machine', function () {
        if (errors.length) throw new Error(errors.slice(0, 4).join('\n        '));
        if (offSite.length) {
          throw new Error('requests escaped the mock: ' + offSite.slice(0, 3).join(', '));
        }
      }).then(function () {
        if (expected404) {
          console.log('        ignored ' + expected404 + ' × 404 on the converted stream: ' +
                      'no dev/fixtures/sample.*, so there is nothing to convert');
        }
      });
    });
}

run();
