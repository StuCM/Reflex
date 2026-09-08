/* Drives the real app in a real browser against the mock server.
   Runs on Node only — modern syntax is fine here.

     npm run smoke              headless
     npm run smoke -- --head    watch it happen
     npm run smoke -- --shot    write dev/screenshots/*.png

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

const PORT = 8123;
const FILMS = 400;

const args = process.argv.slice(2);
const HEADED = args.indexOf('--head') >= 0;
const SHOTS = args.indexOf('--shot') >= 0;

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
  const server = start({ port: PORT, films: FILMS, latency: 0,
                         pinPolls: 1, proxy: false, quiet: true });
  let browser;

  return chromium.launch({ headless: !HEADED }).then(function (b) {
    browser = b;
    return b.newContext({ viewport: { width: 1920, height: 1080 } });
  }).then(function (ctx) {
    return ctx.newPage().then(function (page) { return drive(page, titles); });
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

function drive(page, titles) {
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
    if (u.indexOf('http://localhost:' + PORT) !== 0 &&
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
                   'the confirmation ' + what)
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
     is on the deck. */
  function pressButton(which) {
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
      return press(to > at ? 'ArrowRight' : 'ArrowLeft', Math.abs(to - at))
        .then(function () { return page.keyboard.press('Enter'); })
        .then(function () { return page.waitForTimeout(80); });
    });
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

  return page.goto('http://localhost:' + PORT + '/')

    .then(function () {
      return step('shows the plex.tv link code', function () {
        return page.waitForSelector('#link:not(.hidden)', { timeout: 8000 })
          .then(function () { return page.textContent('#link-code'); })
          .then(function (code) {
            if (code.trim() !== 'MOCK') throw new Error('link code was "' + code + '"');
          })
          .then(function () { return shot('link'); });
      });
    })

    .then(function () {
      return step('links, discovers a server and paints a rail', function () {
        /* Tiles exist from boot — the pool is built empty — so wait for one
           that has actually been filled with something. */
        return waitFor('(function(){var t=document.querySelectorAll("#rows .tile:not(.hidden)");' +
                       'var n=0,i;for(i=0;i<t.length;i++) if(t[i].textContent.trim()) n++;' +
                       'return n > 5;})()', 'filled tiles', 20000)
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            const text = rows.join(' | ');
            if (text.indexOf('Movies') < 0) throw new Error('no Movies section: ' + text);
            if (text.indexOf('TV Shows') < 0) throw new Error('no TV Shows section: ' + text);
          })
          .then(function () { return press('ArrowLeft'); });      // close it again
      });
    })

    .then(function () {
      return step('posters load', function () {
        return waitFor('(function(){var i=document.querySelectorAll("#rows img");' +
                       'for(var n=0;n<i.length;n++) if(i[n].naturalWidth>0) return true;' +
                       'return false;})()', 'a loaded poster');
      });
    })

    .then(function () {
      return step('artwork is looked up once per title, and only for what is on screen', function () {
        let first;
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () {
            if (!artLookups.length) throw new Error('no artwork was looked up at all');
            /* Four rows of twelve tiles is the whole pool; anything near the
               library's size would mean the deferred rows were fetched too. */
            if (artLookups.length > 60) {
              throw new Error(artLookups.length + ' lookups for one screen of tiles');
            }
          })
          /* Walk the row to its end once, so every tile in it has been drawn,
             then walk it again: the second pass must cost nothing. */
          .then(function () { return press('ArrowRight', 8); })
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () { first = artLookups.length; })
          .then(function () { return press('ArrowLeft', 8); })
          .then(function () { return page.waitForTimeout(600); })
          .then(function () { return press('ArrowRight', 8); })
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () {
            if (artLookups.length !== first) {
              throw new Error('walking the row again cost ' + (artLookups.length - first) +
                              ' more lookups');
            }
          });
      });
    })

    .then(function () {
      return step('a moving rail fetches only what has the focus, and fills in when it stops', function () {
        /* Sweeping used to cost a poster and a lookup per tile passed, every one
           of them for a tile already gone by. What each tile holds is compared
           against what Art says it should hold: fresh is its own picture, stale
           is the one the pool element was showing before, blank is the bug. */
        const SWEEP = 10;
        function tileArt() {
          return page.evaluate(function () {
            var out = { focused: 'none', fresh: 0, stale: 0, blank: [] };
            var tiles = document.querySelectorAll('#rows .row.on .tile');
            for (var i = 0; i < tiles.length; i++) {
              var t = tiles[i];
              if (t.classList.contains('hidden') || !t._item) continue;
              var box = t.getBoundingClientRect();
              if (box.right <= 0 || box.left >= 1920) continue;   // wound off the side
              var got = t.querySelector('img').getAttribute('src') || '';
              var state = !got ? 'blank' : (got === Art.tile(t._item, 209, 314) ? 'fresh' : 'stale');
              if (t.classList.contains('on')) out.focused = state;
              if (state === 'blank') out.blank.push(t.querySelector('.tile-title').textContent.trim());
              else out[state]++;
            }
            return out;
          });
        }

        let before;
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })
          .then(function () { return page.waitForTimeout(1500); })
          /* Two rows down in one movement, onto a row that was below the fold:
             none of its tiles has ever had a picture of its own. */
          .then(function () { return press('ArrowDown', 2); })
          .then(tileArt)
          .then(function (st) {
            if (st.focused !== 'fresh') {
              throw new Error('the focused tile is ' + st.focused + ', not its own poster');
            }
            if (st.stale < 5) {
              throw new Error('only ' + st.stale + ' of ' + (st.stale + st.fresh) +
                              ' tiles waited — the rail is still fetching while it moves');
            }
            if (st.blank.length) throw new Error(st.blank.length + ' tiles blanked mid-move');
          })
          .then(function () { return page.waitForTimeout(1500); })
          .then(tileArt)
          .then(function (st) {
            if (st.blank.length) {
              throw new Error('after resting, no poster on: ' + st.blank.join(', '));
            }
          })
          /* Well inside the row and settled, so from here every press winds
             exactly one new tile into the strip. */
          .then(function () { return press('ArrowRight', 4); })
          .then(function () { return page.waitForTimeout(1500); })
          .then(function () { before = tilePosters.length; })
          .then(function () { return press('ArrowRight', SWEEP); })
          .then(function () {
            /* One request per tile passed is what the old code cost; anything
               near that means the sweep is still fetching what it goes by. */
            const during = tilePosters.length - before;
            if (during * 2 >= SWEEP) {
              throw new Error(during + ' poster requests while sweeping past ' + SWEEP + ' tiles');
            }
          })
          .then(function () { return page.waitForTimeout(1500); })
          .then(tileArt)
          .then(function (st) {
            if (st.blank.length) {
              throw new Error('after the sweep settled, no poster on: ' + st.blank.join(', '));
            }
          });
      });
    })

    .then(function () {
      return step('the tile is a poster and the hero behind it is a backdrop', function () {
        /* The whole point of the feature: the tile asks for a different kind of
           picture from the hero, so the two can never be the same image. Same
           title, both from TMDB, one portrait and one wide. */
        return searchFor(titles.manyShots.title)
          .then(function () { return page.waitForTimeout(900); })
          .then(pictures)
          .then(function (st) {
            if (!st.tile.shot) throw new Error('the tile is not a TMDB picture: ' + st.tile.url);
            if (!st.hero.shot) throw new Error('the hero is not a TMDB picture: ' + st.hero.url);
            if (st.tile.shot.title !== st.hero.shot.title) {
              throw new Error('the hero is title ' + st.hero.shot.title +
                              ' while the tile is ' + st.tile.shot.title);
            }
            if (st.tile.shot.kind !== 'poster') {
              throw new Error('the tile drew a ' + st.tile.shot.kind + ': ' + st.tile.url);
            }
            if (st.hero.shot.kind !== 'backdrop') {
              throw new Error('the hero drew a ' + st.hero.shot.kind + ': ' + st.hero.url);
            }
            if (!st.tile.painted) throw new Error('the tile drew nothing');
          })
          .then(function () { return shot('artwork'); })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      return step('a title with no TMDB poster falls back to a Plex one', function () {
        /* TMDB has a backdrop for this title and no poster at all, so the tile
           must fall back to Plex rather than go blank or borrow the hero's — a
           16:9 picture in the 2:3 box is the smear the whole shape exists to
           stop. */
        return searchFor(titles.oneShot.title)
          .then(function () { return page.waitForTimeout(900); })
          .then(pictures)
          .then(function (st) {
            if (!st.hero.shot) throw new Error('the hero is not a TMDB picture: ' + st.hero.url);
            if (st.tile.shot) {
              throw new Error('the tile took TMDB art there was none of: ' + st.tile.url);
            }
            if (st.tile.url.indexOf('/photo/:/transcode') < 0) {
              throw new Error('the tile did not fall back to Plex: ' + st.tile.url);
            }
            /* Plex's own poster, never its wide `art`: the box is 2:3. */
            if (st.tile.url.indexOf('%2Fthumb%2F') < 0) {
              throw new Error('the tile fell back to something other than a poster: ' +
                              st.tile.url);
            }
            if (!st.tile.painted) throw new Error('the tile drew nothing');
          })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      return step('masthead follows the focused tile', function () {
        let first;
        return page.textContent('#mh-title')
          .then(function (t) { first = t; return press('ArrowRight', 3); })
          .then(function () { return page.textContent('#mh-title'); })
          .then(function (t) {
            if (t === first) throw new Error('title did not change after three rights');
          })
          .then(function () { return shot('browse'); });
      });
    })

    .then(function () {
      return step('the header carries the description and the cast, on both screens', function () {
        /* The one TMDB request that fetched the backdrops carries the overview
           and the billing too, so the header can say what the film is without
           a Plex metadata fetch per tile. The mock's overview names itself, and
           its actors are named after the title, so neither can be confused with
           the Plex summary that stands in until TMDB answers. */
        let head;
        return searchFor(titles.manyShots.title)
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () {
            return page.evaluate(function () {
              return { desc: document.getElementById('mh-desc').textContent.trim(),
                       cast: document.getElementById('mh-cast').textContent.trim() };
            });
          })
          .then(function (st) {
            if (!/^TMDB overview/.test(st.desc)) {
              throw new Error('the header description is not TMDB\'s: "' + st.desc + '"');
            }
            if (!/^Actor /.test(st.cast)) {
              throw new Error('the key actors did not come from TMDB: "' + st.cast + '"');
            }
            head = st;
          })
          /* And OK opens a page that says the same things, not a second
             description of the same film. */
          .then(function () { return openTitle(titles.manyShots.title); })
          .then(function () {
            return page.evaluate(function () {
              return { desc: document.getElementById('dt-summary').textContent.trim(),
                       cast: document.getElementById('dt-names').textContent.trim() };
            });
          })
          .then(function (st) {
            if (st.desc !== head.desc) {
              throw new Error('the detail page describes it differently: "' + st.desc + '"');
            }
            if (st.cast !== head.cast) {
              throw new Error('the detail page bills it differently: "' + st.cast + '"');
            }
          })
          .then(function () { return shot('header'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('a film says what it is, in chips and a kicker with no gaps', function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            /* The kicker's genre and director only exist once metadata lands. */
            return waitFor('document.getElementById("dt-kicker").textContent.indexOf("·") > 0',
                           'the kicker to fill in', 15000);
          })
          .then(detailFace)
          .then(function (st) {
            const parts = kickerParts(st.kicker);
            if (parts[0] !== 'movie') {
              throw new Error('the kicker does not lead with what it is: "' + st.kicker + '"');
            }
            if (parts.length !== 3) {
              throw new Error('expected type, genre and director: "' + st.kicker + '"');
            }
            /* Certificate, year, run time and the quality of the copy that
               would play — each present only if we have it. */
            const chips = st.chips.join(' | ');
            if (!st.chips.some(function (c) { return /^\d{4}$/.test(c); })) {
              throw new Error('no year among the chips: ' + chips);
            }
            if (!st.chips.some(function (c) { return /^(\d+h )?\d+m$/.test(c); })) {
              throw new Error('no runtime among the chips: ' + chips);
            }
            if (!st.chips.some(function (c) { return /^(4K|\d+p|SD)( HDR)?$/.test(c); })) {
              throw new Error('no quality among the chips: ' + chips);
            }
            if (st.chips.some(function (c) { return !c; })) {
              throw new Error('an empty chip: ' + chips);
            }
          })
          .then(function () { return shot('detail-face'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('every score is labelled with the source it came from', function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            return waitFor('document.querySelectorAll("#dt-ratings .dt-rating").length > 0',
                           'the ratings row', 15000);
          })
          .then(detailFace)
          .then(function (st) {
            /* Plex gives critics and audience; TMDB gives its own. We have no
               IMDb, so nothing may claim to be one. */
            st.ratings.forEach(function (r) {
              if (!/^\d+% Critics$|^\d+% Audience$|^[\d.]+ TMDB$/.test(r)) {
                throw new Error('a score with no honest label: "' + r + '"');
              }
            });
            if (st.glyphs !== st.ratings.length) {
              throw new Error(st.glyphs + ' glyphs for ' + st.ratings.length + ' scores');
            }
            if (/IMDb/i.test(st.page)) {
              throw new Error('a score labelled IMDb, which we never fetched');
            }
          })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('a cast member with no photograph shows initials', function () {
        /* Every mock actor has a picture, so the fallback is only reached by
           taking the pictures away — Plex.photoUrl is what castHtml asks. */
        return page.evaluate(function () {
          Plex._photoUrl = Plex.photoUrl;
          Plex.photoUrl = function () { return ''; };
        })
          .then(function () { return openTitle(titles.directPlays.title); })
          .then(function () {
            return waitFor('document.querySelectorAll("#dt-cast .dt-actor").length > 0',
                           'the cast row', 15000);
          })
          .then(function () {
            return page.evaluate(function () {
              return {
                blanks: Array.prototype.map.call(
                  document.querySelectorAll('#dt-cast .dt-actor-blank'),
                  function (b) { return b.textContent.trim(); }),
                names: Array.prototype.map.call(
                  document.querySelectorAll('#dt-cast .dt-actor-name'),
                  function (n) { return n.textContent.trim(); }),
                broken: document.querySelectorAll('#dt-cast img').length
              };
            });
          })
          .then(function (st) {
            if (st.broken) throw new Error('an img with no picture behind it');
            if (st.blanks.length !== st.names.length) {
              throw new Error(st.blanks.length + ' discs for ' + st.names.length + ' actors');
            }
            st.blanks.forEach(function (letters, i) {
              const want = st.names[i].split(/\s+/).slice(0, 2)
                .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
              if (letters !== want) {
                throw new Error('"' + st.names[i] + '" is shown as "' + letters + '"');
              }
            });
          })
          .then(backToLibrary)
          .then(function () {
            return page.evaluate(function () { Plex.photoUrl = Plex._photoUrl; });
          });
      });
    })

    .then(function () {
      return step('the All row knows its size without crawling it', function () {
        return press('ArrowDown', 5)
          .then(function () {
            return waitFor('/All films\\s+\\(\\d+\\)/.test(document.querySelector("#rows").textContent)',
                           'the All row count');
          })
          .then(function () {
            return page.evaluate(function () {
              const m = document.querySelector('#rows').textContent.match(/All films\s+\((\d+)\)/);
              return m ? Number(m[1]) : 0;
            });
          })
          .then(function (count) {
            /* Every film is on at least one server and many are on both, so the
               estimate starts at the sum of the two and settles down towards the
               true count as the walk finds duplicates. It must never claim fewer
               than the library holds. */
            if (count < FILMS) throw new Error('claims only ' + count + ' films of ' + FILMS);
            if (count > FILMS * 2) throw new Error('claims ' + count + ', more than both servers hold');
          });
      });
    })

    .then(function () {
      return step('paging fills tiles deep into the library', function () {
        return press('ArrowRight', 40)
          .then(function () { return page.waitForTimeout(600); })
          .then(function () {
            return waitFor('(function(){var t=document.querySelector("#rows .row.on .tile.on");' +
                           'return t && t.textContent.trim().length > 0;})()',
                           'the focused tile to fill after paging');
          })
          .then(debugLine)
          .then(function (line) {
            if (line.indexOf('JS ERROR') >= 0) throw new Error(line);
          });
      });
    })

    .then(function () {
      return step('the All row spans every movie library, deduplicated', function () {
        /* Main splits its films across two libraries and Backup has a third, so
           the count proves both halves of the fold: more than any one library
           holds, and fewer than all three added up. The walk above has already
           found duplicates, which is what brings it down off the sum. */
        return page.evaluate(function () {
          const m = document.querySelector('#rows').textContent.match(/All films\s+\((\d+)\)/);
          return m ? Number(m[1]) : 0;
        }).then(function (count) {
          if (count <= titles.movies.biggest) {
            throw new Error('All films claims ' + count + ', no more than the biggest library (' +
                            titles.movies.biggest + '): the libraries were not merged');
          }
          if (count >= titles.movies.sum) {
            throw new Error('All films claims ' + count + ' of ' + titles.movies.sum +
                            ' copies: nothing was deduplicated');
          }
        });
      });
    })

    .then(function () {
      return step('a film in two of one server\'s libraries keeps both copies', function () {
        /* Main holds 4K remuxes of films it also has at 1080, in a library of
           their own. Folded into one Movies section they are one entry — but
           two copies, and only one of them plays. Reached by walking the All
           row rather than by searching: search folds per server, which is
           right for a hub and would hide the second copy here. */
        function findTwin(left) {
          return page.evaluate(function () {
            const tile = document.querySelector('#rows .row.on .tile.on');
            const item = tile && tile._item;
            if (!item) return null;
            const copies = Merge.sources(item);
            const here = copies.filter(function (c) { return c._server === item._server; });
            return { title: item.title, copies: copies.length, sameServer: here.length };
          }).then(function (st) {
            if (st && st.sameServer > 1) return st;
            if (left <= 0) throw new Error('no film with two copies on one server in the All row');
            return press('ArrowRight').then(function () { return findTwin(left - 1); });
          });
        }
        let entry;
        return findTwin(60)
          .then(function (st) { entry = st; return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('(function(){var c=document.querySelector("#dt-actions .dt-act-cap");' +
                           'return c && !/checking/.test(c.textContent);})()',
                           'a verdict for ' + entry.title, 20000);
          })
          .then(function () { return openChooser('source'); })
          .then(function () {
            /* Every copy has to be checked before the notes mean anything. */
            return waitFor('(function(){var r=document.querySelectorAll(' +
                           '"#dt-menu:not(.hidden) .menu-row");' +
                           'if (!r.length) return false;' +
                           'for (var i=0;i<r.length;i++) if (/checking/.test(r[i].textContent)) return false;' +
                           'return true;})()', 'every copy of ' + entry.title + ' checked', 20000);
          })
          .then(sourceRows)
          .then(function (src) {
            /* The chooser lists exactly what the merge holds — a copy dropped in
               the fold would show up as one row fewer. */
            if (src.length !== entry.copies) {
              throw new Error(src.length + ' copies listed for ' + entry.title +
                              ' but the merge holds ' + entry.copies);
            }
            const names = {};
            src.forEach(function (s) { names[s.server] = (names[s.server] || 0) + 1; });
            const twice = Object.keys(names).filter(function (n) { return names[n] > 1; });
            if (!twice.length) throw new Error('no server listed twice: ' +
                                               src.map(function (s) { return s.server; }).join(' | '));
            const media = src.filter(function (s) { return s.server === twice[0]; })
                             .map(function (s) { return s.version; });
            if (media[0] === media[1]) {
              throw new Error('the same server\'s two copies read alike: ' + media[0]);
            }
            /* And they differ where it counts: one plays, one is refused. */
            const text = src.map(function (s) { return s.verdict; }).join(' | ');
            if (!/direct play/.test(text) || !/4K/.test(text)) {
              throw new Error('expected a playable copy and a refused 4K one: ' + text);
            }
          })
          .then(function () { return press('Backspace'); })
          .then(function () { return shot('detail-two-libraries'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('kids rows exclude everything above the cutoff', function () {
        return sidebarPick('Kids')
          .then(function () {
            return waitFor('/Kids/.test(document.querySelector("#rows").textContent)',
                           'a kids row', 15000);
          })
          .then(function () { return shot('kids'); });
      });
    })

    .then(function () {
      return step('back leaves kids for the library', function () {
        return press('Backspace')
          .then(function () {
            return waitFor('!/Kids/.test(document.querySelector("#rows").textContent)',
                           'the library rows back');
          });
      });
    })

    .then(function () {
      return step('a show section drills into series and episodes', function () {
        return backToLibrary()
          .then(function () { return sidebarPick('TV Shows'); })
          .then(function () {
            /* The All shows row is below the visible pool, so wait on the hero
               naming the section and on the rows having been rebuilt. */
            return waitFor('!document.getElementById("sidebar").classList.contains("open")',
                           'the shows section', 20000);
          })
          .then(function () { return page.waitForTimeout(800); })
          .then(function () { return press('ArrowDown'); })   // off Continue watching
          .then(function () {
            /* Shows are not films: no runtime, no audio verdict, a series count
               instead. */
            return waitFor('/\\d+ series/.test(document.querySelector("#mh-meta").textContent)',
                           'a show in the masthead', 15000);
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('!document.getElementById("show").classList.contains("hidden") &&' +
                           ' document.querySelectorAll("#sh-seasons .chip").length > 0 &&' +
                           ' document.querySelectorAll(".sh-episode").length > 1',
                           'the show page with series and episodes', 20000);
          })
          .then(function () {
            return page.evaluate(function () {
              return {
                title: document.getElementById('sh-title').textContent,
                seasons: document.querySelectorAll('#sh-seasons .chip').length,
                episodes: Array.prototype.map.call(document.querySelectorAll('.sh-episode'),
                  function (e) { return e.textContent.replace(/\s+/g, ' '); })
              };
            });
          })
          .then(function (st) {
            if (!st.title) throw new Error('the show page has no title');
            /* Episode rows must carry their number and a runtime, or the list is
               just a wall of titles. */
            if (!/^\s*1/.test(st.episodes[0])) {
              throw new Error('first episode row does not start with its number: ' + st.episodes[0]);
            }
            if (!/\d+ min/.test(st.episodes[0])) {
              throw new Error('no runtime on the episode row: ' + st.episodes[0]);
            }
          })
          .then(function () { return shot('show'); })
          .then(function () {
            /* The focused episode is checked in place, so OK means something. */
            return waitFor('(function(){var e=document.querySelector(".sh-episode.on");' +
                           'return e && /direct play|transcode|no passable/.test(e.textContent);})()',
                           'a verdict on the focused episode', 20000);
          });
      });
    })

    .then(function () {
      return step('every episode row carries its still, present or not', function () {
        /* The still moved here off the rail tile. It is a picture per visible
           row on a page you drilled into, not one per tile in a 30,000 item
           walk, which is why it is affordable here and was not there. */
        return page.evaluate(function () {
          var rows = Array.prototype.slice.call(document.querySelectorAll('.sh-episode'));
          function shape() {
            return rows.map(function (r) {
              var s = r.querySelector('.sh-ep-still');
              return {
                height: r.offsetHeight,
                box: s ? Math.round(s.offsetWidth) + 'x' + Math.round(s.offsetHeight) : null,
                art: s ? getComputedStyle(s).backgroundImage : 'none'
              };
            });
          }
          var before = shape();
          /* An episode with no thumb differs from one with it only in the
             picture, so taking the picture away is that episode. */
          var blanked = rows[0] && rows[0].querySelector('.sh-ep-still');
          if (blanked) blanked.style.backgroundImage = 'none';
          var after = shape();
          if (blanked) blanked.style.backgroundImage = '';
          return { before: before, after: after };
        }).then(function (st) {
          if (st.before.length < 2) throw new Error('too few episode rows to judge');
          st.before.forEach(function (r, i) {
            if (r.box !== '160x90') {
              throw new Error('episode ' + i + ' has a ' + r.box + ' still box');
            }
            if (r.art === 'none') throw new Error('episode ' + i + ' drew no still');
            if (r.height !== st.before[0].height) {
              throw new Error('episode ' + i + ' is ' + r.height + 'px, not ' +
                              st.before[0].height);
            }
          });
          if (st.after[0].art !== 'none') throw new Error('the still would not blank');
          if (st.after[0].height !== st.before[0].height) {
            throw new Error('an episode with no still is ' + st.after[0].height +
                            'px, not ' + st.before[0].height);
          }
        });
      });
    })

    .then(function () {
      return step('a series with more than one season can be switched', function () {
        return page.evaluate(function () {
          return document.querySelectorAll('#sh-seasons .chip').length;
        }).then(function (n) {
          if (n < 2) return;              // this show has one series; nothing to switch
          return press('ArrowUp', 12)     // up out of the episode list, to the series chips
            .then(function () {
              return waitFor('document.querySelector("#sh-seasons .chip.on") !== null',
                             'series focus');
            })
            .then(function () { return press('ArrowRight'); })
            .then(function () {
              return waitFor('document.querySelectorAll(".sh-episode").length > 0',
                             'the next series to load', 15000);
            });
        });
      });
    })

    .then(function () {
      return step('an episode\'s copy chooser is reached through the series page', function () {
        return page.evaluate(function () {
          /* Make sure we are back on the episode list before pressing right. */
          return !!document.querySelector('.sh-episode');
        }).then(function () { return press('ArrowDown'); })
          .then(function () { return page.keyboard.press('ArrowRight'); })
          .then(function () {
            return waitFor('!document.getElementById("detail").classList.contains("hidden") &&' +
                           ' document.querySelectorAll("#dt-actions .dt-act").length > 0',
                           'the action row for an episode', 20000);
          })
          .then(detailFace)
          .then(function (st) {
            /* An episode has to say which show and which number it is: the show
               is the kicker, the number is a chip. */
            const parts = kickerParts(st.kicker);
            if (!parts.length) throw new Error('an episode with no kicker at all');
            if (!st.chips.some(function (c) { return /^S\d+E\d+$/.test(c); })) {
              throw new Error('no season/episode among the chips: ' + st.chips.join(' | '));
            }
            /* The mock's episodes carry no scores and TMDB is never asked about
               one, so this is the "nothing to show" case: an empty row, not an
               unlabelled glyph or a stray separator. */
            if (st.ratings.length || st.glyphs) {
              throw new Error('an episode with scores from nowhere: ' + st.ratings.join(' | '));
            }
          })
          .then(function () { return shot('episode-copies'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('no recaps strip at all without a YouTube key', function () {
        /* Youtube.enabled() is the whole gate, and the key is read once at load,
           so switching the gate off is how a keyless build is seen from here.
           The harness always sets a key; a shipped app usually will not. */
        return openShowPage(titles.recapShow)
          .then(function () {
            return page.evaluate(function () {
              Youtube._enabled = Youtube.enabled;
              Youtube.enabled = function () { return false; };
            });
          })
          .then(function () { return reopenShowPage(titles.recapShow); })
          .then(intoRecaps)
          .then(function (st) {
            if (st.html) throw new Error('a recaps strip with no key: ' + st.html);
            if (!st.episode) throw new Error('down past the last episode left the list');
            if (ytCalls.length) throw new Error('asked YouTube anyway: ' + ytCalls.join(', '));
          })
          .then(function () {
            return page.evaluate(function () { Youtube.enabled = Youtube._enabled; });
          });
      });
    })

    .then(function () {
      return step('down from the last episode reaches Find recaps, having asked nothing',
        function () {
          return reopenShowPage(titles.recapShow)
            .then(intoRecaps)
            .then(function (st) {
              if (!st.open) throw new Error('the recaps strip did not open');
              if (!st.lifted) throw new Error('the episode list did not move out of the way');
              if (st.focused !== 'Find recaps') {
                throw new Error('the action reads "' + st.focused + '"');
              }
              /* The whole point: a search costs 100 units of the day's 10,000,
                 so browsing to the strip must cost nothing at all. */
              if (ytCalls.length) {
                throw new Error('YouTube was asked before OK: ' + ytCalls.join(', '));
              }
            })
            .then(function () { return shot('recaps-action'); });
        });
    })

    .then(function () {
      return step('OK searches once and draws the season recaps in order', function () {
        return page.keyboard.press('Enter')
          .then(function () {
            return waitFor('document.querySelectorAll("#sh-recaps .sh-recap-thumb").length > 0',
                           'the recaps rail', 15000);
          })
          .then(recapStrip)
          .then(function (st) {
            const names = st.cards.map(function (c) { return c.title; });
            if (names.length !== 4) throw new Error('4 recaps expected, got: ' + names.join(' | '));
            /* Season order, with the one that names no season last. */
            if (!/Season 1/.test(names[0]) || !/Season 2/.test(names[1]) ||
                !/ S3 /.test(names[2] + ' ') || !/^Everything/.test(names[3])) {
              throw new Error('out of season order: ' + names.join(' | '));
            }
            /* The channel's other content came back with them and must not be
               on screen — that is what pickForShow is for. */
            if (names.join(' | ').indexOf('Zzyzx') >= 0) {
              throw new Error('a different show is in the rail: ' + names.join(' | '));
            }
            st.cards.forEach(function (c, i) {
              if (c.art === 'none') throw new Error('recap ' + i + ' drew no thumbnail');
              if (!/^\d+:\d\d$/.test(c.length)) {
                throw new Error('recap ' + i + ' has no length: "' + c.length + '"');
              }
            });
            if (ytSearches.length !== 1) {
              throw new Error(ytSearches.length + ' searches for one press');
            }
          })
          .then(function () { return shot('recaps'); });
      });
    })

    .then(function () {
      return step('the same show a second time is answered from the cache', function () {
        const before = ytSearches.length;
        return reopenShowPage(titles.recapShow)
          .then(intoRecaps)
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('document.querySelectorAll("#sh-recaps .sh-recap-thumb").length > 0',
                           'the recaps rail from cache', 15000);
          })
          .then(function () { return page.waitForTimeout(300); })
          .then(function () {
            if (ytSearches.length !== before) {
              throw new Error('searched again: ' + ytSearches.slice(before).join(', '));
            }
          });
      });
    })

    .then(function () {
      return step('OK on a recap plays it in an overlay, and BACK closes it', function () {
        const reported = timelines.length;
        return page.keyboard.press('Enter')
          .then(function () {
            return waitFor('!document.getElementById("recap").classList.contains("hidden")',
                           'the recap overlay', 10000);
          })
          .then(function () {
            return page.evaluate(function () {
              return {
                src: document.getElementById('recap-frame').getAttribute('src'),
                video: !document.getElementById('video').classList.contains('hidden')
              };
            });
          })
          .then(function (st) {
            if (!/\/__ytembed\/.+-s1\?autoplay=1$/.test(st.src)) {
              throw new Error('the overlay is showing "' + st.src + '"');
            }
            /* A recap is not library content: nothing about it may reach the
               player, the guard or a Plex session. */
            if (st.video) throw new Error('a recap started the video element');
            if (timelines.length !== reported) {
              throw new Error('a recap reported to Plex: ' + timelines.slice(-1)[0]);
            }
          })
          .then(function () { return shot('recap-playing'); })
          .then(function () { return press('Backspace'); })
          .then(function () {
            return waitFor('document.getElementById("recap").classList.contains("hidden")',
                           'the overlay to close');
          })
          .then(recapStrip)
          .then(function (st) {
            if (!st.focused) throw new Error('the rail lost its focus behind the overlay');
          });
      });
    })

    .then(function () {
      return step('an embed that never loads offers the YouTube app instead of hanging',
        function () {
          /* The third card is the one the mock never answers for. Chromium 53 is
             nine years old and YouTube drops old browsers over time, so this is
             an outcome to expect rather than a fault to debug. */
          return press('ArrowRight', 2)
            .then(function () { return page.keyboard.press('Enter'); })
            .then(function () {
              return waitFor('!document.getElementById("message").classList.contains("hidden")',
                             'the offer of the YouTube app', 20000);
            })
            .then(function () {
              return page.evaluate(function () {
                return {
                  title: document.getElementById('message-title').textContent,
                  body: document.getElementById('message-body').textContent,
                  overlay: !document.getElementById('recap').classList.contains('hidden')
                };
              });
            })
            .then(function (st) {
              if (st.overlay) throw new Error('the overlay is still up over the offer');
              if (!/YouTube app/.test(st.body)) {
                throw new Error('the offer does not mention the app: ' + st.title + ' / ' + st.body);
              }
            })
            .then(function () { return press('Backspace'); })
            .then(function () {
              return waitFor('!document.getElementById("show").classList.contains("hidden")',
                             'the show page behind the offer');
            });
        });
    })

    .then(function () {
      return step('a show the channel has nothing for says so', function () {
        return openShowPage(titles.noRecapShow)
          .then(intoRecaps)
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('/No recaps found/.test(' +
                           'document.getElementById("sh-recaps").textContent)',
                           'the empty answer', 15000);
          })
          .then(backToLibrary)
          /* Searching for these shows left the rail in Movies; the steps after
             this one expect what the show steps left — the shows section, one
             row down from Continue watching. */
          .then(function () { return sidebarPick('TV Shows'); })
          .then(function () { return page.waitForTimeout(600); })
          .then(function () { return press('ArrowDown'); });
      });
    })

    .then(function () {
      return step('the sidebar lists the modes and jumps to a category', function () {
        let cats;
        return backToLibrary()
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            const text = rows.join(' | ');
            ['Discovery', 'Kids', 'Search'].forEach(function (want) {
              if (rows.indexOf(want) < 0) throw new Error('no ' + want + ' row: ' + text);
            });
            /* Continue watching carries the mark too when the rail is resting
               on it, so only the sections are counted here. */
            const current = rows.filter(function (r) {
              return r.indexOf('* ') === 0 && r.indexOf('Continue watching') < 0;
            });
            if (current.length !== 1) throw new Error('sections showing as current: ' + text);
            cats = rows.filter(function (r) { return r.indexOf('- ') === 0; })
                       .map(function (r) { return r.slice(2); });
            if (cats.indexOf('Continue watching') >= 0) {
              throw new Error('Continue watching is listed under a section as well: ' + text);
            }
          })
          .then(function () { return shot('sidebar'); })
          /* Picking a category is how the sidebar replaces scrolling to a row,
             so it has to actually land the rail on it. */
          .then(function () { return sidebarPick(cats[0]); })
          .then(function () {
            return waitFor('document.getElementById("mh-row").textContent.trim() === ' +
                           JSON.stringify(cats[0]), 'the rail to land on ' + cats[0]);
          });
      });
    })

    .then(function () {
      return step('the sidebar lists Continue watching, Movies and TV Shows, once each', function () {
        return backToLibrary()
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            const text = rows.join(' | ');
            const top = rows.filter(function (r) { return r.indexOf('- ') < 0; })
                            .map(function (r) { return r.replace('* ', ''); });
            ['Continue watching', 'Movies', 'TV Shows', 'Discovery', 'Kids', 'Search']
              .forEach(function (want) {
                if (top.indexOf(want) < 0) throw new Error('no ' + want + ' entry: ' + text);
              });
            /* The libraries themselves are gone: the mock's are Films, 4K Films
               and TV Shows, and only the last of those is also a section name. */
            ['Films', '4K Films'].forEach(function (lib) {
              if (top.indexOf(lib) >= 0) throw new Error('the library ' + lib +
                                                         ' is still listed: ' + text);
            });
            const watching = rows.filter(function (r) {
              return r.replace(/^\* /, '').replace(/^- /, '') === 'Continue watching';
            });
            if (watching.length !== 1) {
              throw new Error(watching.length + ' Continue watching entries: ' + text);
            }
          })
          .then(function () { return press('ArrowLeft'); });      // close it again
      });
    })

    .then(function () {
      return step('Continue watching can be cut to films or to episodes', function () {
        function types(what) {
          return focusedRowTypes().then(function (st) {
            if (!st) throw new Error('no focused row after ' + what);
            if (st.title !== 'Continue watching') {
              throw new Error('after ' + what + ' the rail is on "' + st.title + '"');
            }
            if (!st.types.length) throw new Error('nothing left in the row after ' + what);
            return st.types;
          });
        }
        return backToLibrary()
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return types('Continue watching'); })
          .then(function (all) {
            /* onDeck is films and episodes together — if it were not, the cuts
               below would prove nothing. */
            if (all.indexOf('movie') < 0 || all.indexOf('episode') < 0) {
              throw new Error('Continue watching is not mixed: ' + all.join(', '));
            }
          })
          /* Opening the sidebar from that row must land on it with its cuts
             showing, rather than a level up on the section — which is also
             current, and used to win. */
          .then(openSidebar)
          .then(function () {
            return page.evaluate(function () {
              const on = document.querySelector('#sidebar .sb-row.on');
              return {
                on: on ? on.textContent.trim() : '',
                subs: Array.prototype.map.call(
                  document.querySelectorAll('#sidebar .sb-row.sub'),
                  function (r) { return r.textContent.trim(); })
              };
            });
          })
          .then(function (st) {
            if (st.on !== 'Continue watching') {
              throw new Error('the sidebar opened on "' + st.on + '", not the row we were on');
            }
            if (st.subs.indexOf('Movies') < 0 || st.subs.indexOf('TV Shows') < 0) {
              throw new Error('Continue watching did not open its cuts: ' + st.subs.join(' | '));
            }
          })
          .then(function () { return press('ArrowLeft'); })
          .then(function () { return watchingPick('TV Shows'); })
          .then(function () { return types('the TV Shows cut'); })
          .then(function (only) {
            const stray = only.filter(function (t) { return t !== 'episode'; });
            if (stray.length) throw new Error('the TV Shows cut kept ' + stray.join(', '));
          })
          .then(function () { return watchingPick('Movies'); })
          .then(function () { return types('the Movies cut'); })
          .then(function (only) {
            const stray = only.filter(function (t) { return t !== 'movie'; });
            if (stray.length) throw new Error('the Movies cut kept ' + stray.join(', '));
          })
          /* And the cut lifts again, which is also how the rest of the run gets
             its mixed row back. */
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return types('the cut being lifted'); })
          .then(function (all) {
            if (all.indexOf('episode') < 0) throw new Error('the episodes did not come back');
          })
          .then(function () { return shot('continue-watching'); });
      });
    })

    .then(function () {
      return step('an episode tile is its show\'s poster, for no extra request', function () {
        /* Plex puts the show's poster on the episode as grandparentThumb, so
           the tile is a poster like every other without a lookup of any kind.
           Two episodes of one show therefore draw the same picture. */
        return backToLibrary()
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return watchingPick('TV Shows'); })
          .then(function () { return page.waitForTimeout(900); })
          .then(function () {
            return page.evaluate(function () {
              var tiles = document.querySelectorAll('#rows .row.on .tile:not(.hidden)');
              return Array.prototype.map.call(tiles, function (t) {
                var it = t._item || {};
                return {
                  type: it.type || '',
                  show: it.grandparentRatingKey || '',
                  src: (t._img && t._img.src) || '',
                  showThumb: encodeURIComponent(it.grandparentThumb || 'none'),
                  ownThumb: encodeURIComponent(it.thumb || 'none')
                };
              });
            });
          })
          .then(function (tiles) {
            var eps = tiles.filter(function (t) { return t.type === 'episode'; });
            if (!eps.length) throw new Error('no episodes in the TV Shows cut');
            var byShow = {};
            eps.forEach(function (t) {
              if (t.src.indexOf(t.showThumb) < 0) {
                throw new Error('an episode tile is not its show\'s poster: ' + t.src);
              }
              if (t.src.indexOf(t.ownThumb) >= 0) {
                throw new Error('an episode tile is still its own still: ' + t.src);
              }
              if (byShow[t.show] && byShow[t.show] !== t.src) {
                throw new Error('two episodes of one show drew different tiles');
              }
              byShow[t.show] = t.src;
            });
          })
          /* And put the row back the way the rest of the run expects it. */
          .then(function () { return sidebarPick('Continue watching'); });
      });
    })

    .then(function () {
      return step('OK on an episode opens its series, at that episode', function () {
        /* An episode is never a dead end: the point of landing on the series
           page is that the next episode is one keypress away, which the copy
           chooser for a single episode never gave you. */
        let ep;
        return backToLibrary()
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return watchingPick('TV Shows'); })
          .then(function () {
            return page.evaluate(function () {
              const t = document.querySelector('#rows .row.on .tile.on');
              const it = (t && t._item) || {};
              return { type: it.type || '', show: it.grandparentTitle || '',
                       season: it.parentIndex, episode: it.index };
            });
          })
          .then(function (st) {
            if (st.type !== 'episode') throw new Error('the focused tile is a ' + st.type);
            ep = st;
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('!document.getElementById("show").classList.contains("hidden") &&' +
                           ' document.querySelector(".sh-episode.on") !== null',
                           'the series page for the episode', 20000);
          })
          .then(function () {
            return page.evaluate(function () {
              const chip = document.querySelector('#sh-seasons .chip.cur');
              const on = document.querySelector('.sh-episode.on');
              return {
                title: document.getElementById('sh-title').textContent.trim(),
                season: chip ? chip.textContent.trim() : '',
                episode: on.querySelector('.sh-ep-num').textContent.trim(),
                detail: !document.getElementById('detail').classList.contains('hidden')
              };
            });
          })
          .then(function (st) {
            if (st.detail) throw new Error('the episode opened its own page, not the series');
            if (st.title !== ep.show) {
              throw new Error('opened "' + st.title + '", not "' + ep.show + '"');
            }
            /* The season chip is named by the server ("Season 3"); what has to
               match is the number the episode says it belongs to. */
            if (!new RegExp('(^|\\D)' + ep.season + '$').test(st.season)) {
              throw new Error('opened on "' + st.season + '", not season ' + ep.season);
            }
            if (st.episode !== String(ep.episode)) {
              throw new Error('highlighted episode ' + st.episode + ', not ' + ep.episode);
            }
          })
          .then(function () { return shot('episode-to-series'); })
          /* And onward: the next episode is right there, with its own copies. */
          .then(function () { return press('ArrowDown'); })
          .then(function () { return page.keyboard.press('ArrowRight'); })
          .then(function () {
            return waitFor('!document.getElementById("detail").classList.contains("hidden") &&' +
                           ' document.querySelectorAll("#dt-actions .dt-act").length > 0',
                           'the action row for the next episode', 20000);
          })
          .then(detailFace)
          .then(function (st) {
            const chips = st.chips.join(' | ');
            const m = chips.match(/S(\d+)E(\d+)/);
            if (!m) throw new Error('no season/episode among the chips: ' + chips);
            if (Number(m[2]) === ep.episode) {
              throw new Error('moving down stayed on episode ' + ep.episode);
            }
          })
          .then(backToLibrary)
          .then(function () {
            /* The same show a second time is free: the guid lookups that found
               it on every server are what OK must not pay for twice. */
            const asks = [];
            function watch(r) { if (/\/library\/all\?.*guid=/.test(r.url())) asks.push(r.url()); }
            page.on('request', watch);
            return page.keyboard.press('Enter')
              .then(function () {
                return waitFor('!document.getElementById("show").classList.contains("hidden") &&' +
                               ' document.querySelector(".sh-episode.on") !== null',
                               'the series page a second time', 20000);
              })
              .then(function () { return page.waitForTimeout(400); })
              .then(function () {
                page.off('request', watch);
                if (asks.length) {
                  throw new Error('the series was resolved again: ' + asks.join(', '));
                }
              }, function (e) { page.off('request', watch); throw e; });
          })
          .then(backToLibrary)
          /* Put the mixed row back for the rest of the run. */
          .then(function () { return sidebarPick('Continue watching'); });
      });
    })

    .then(function () {
      return step('the last sidebar entry can be reached and is on screen', function () {
        /* There is no pointer on this device, so anything past the fold is
           simply unreachable unless the list winds itself.

           The generated library is small enough that the real sidebar happens
           to fit, which is exactly why this drives Sidebar.open directly with a
           section that does not — the fault is about long lists, and asserting
           it against a short one proves nothing. */
        return backToLibrary()
          .then(openSidebar)
          .then(function () {
            return page.evaluate(function () {
              var many = [], i;
              for (i = 0; i < 30; i++) many.push('Category ' + (i + 1));
              Sidebar.open([{ title: 'Films', categories: many, current: true }],
                           function () {}, 'library');
              return document.querySelectorAll('#sidebar .sb-row').length;
            });
          })
          .then(function (n) {
            if (n < 30) throw new Error('only ' + n + ' sidebar rows built');
            return press('ArrowDown', n);        // more than enough to hit the end
          })
          .then(function () { return page.waitForTimeout(300); })
          .then(function () {
            return page.evaluate(function () {
              var rows = document.querySelectorAll('#sidebar .sb-row');
              var last = rows[rows.length - 1];
              var panel = document.getElementById('sidebar').getBoundingClientRect();
              var r = last.getBoundingClientRect();
              return { focused: last.classList.contains('on'), label: last.textContent.trim(),
                       top: Math.round(r.top), bottom: Math.round(r.bottom),
                       panelBottom: Math.round(panel.bottom) };
            });
          })
          .then(function (st) {
            if (!st.focused) throw new Error('the last entry never took focus');
            if (st.top < 0 || st.bottom > st.panelBottom) {
              throw new Error('"' + st.label + '" is focused but off screen at ' +
                              st.top + '–' + st.bottom + ' of ' + st.panelBottom);
            }
          })
          .then(function () { return press('ArrowLeft'); });        // close it again
      });
    })

    .then(function () {
      return step('the Mantis palette is what the stylesheet is serving', function () {
        /* Cheap, and it catches a half-applied swap: the accent is the one
           colour every focused thing on every screen is drawn in. */
        return page.evaluate(function () {
          var css = getComputedStyle(document.documentElement);
          var layer = getComputedStyle(document.querySelector('#hero-art .hero-layer'));
          var strip = getComputedStyle(document.querySelector('#rows .strip'));
          return { ac: css.getPropertyValue('--ac').trim(),
                   bg: css.getPropertyValue('--bg').trim(),
                   move: css.getPropertyValue('--t-move').trim(),
                   fade: css.getPropertyValue('--t-fade').trim(),
                   heroFor: layer.transitionDuration,
                   stripFor: strip.transitionDuration };
        }).then(function (st) {
          if (st.ac !== '#a79ce3') throw new Error('--ac is ' + st.ac + ', not the violet');
          if (st.bg !== '#161826') throw new Error('--bg is ' + st.bg + ', not the Mantis ground');
          if (st.move !== '340ms') throw new Error('--t-move is ' + st.move);
          if (st.fade !== '620ms') throw new Error('--t-fade is ' + st.fade);
          /* The backdrop crossfades gently; the UI's own motion must not be
             slowed with it. */
          if (st.heroFor !== '0.62s') throw new Error('a hero layer fades over ' + st.heroFor);
          if (st.stripFor !== '0.34s') throw new Error('a strip slides over ' + st.stripFor);
        });
      });
    })

    .then(function () {
      return step('the hero art follows focus, and comes back', function () {
        /* Resting on a title, moving on, and coming back used to leave the
           previous backdrop on screen: the art was painted from Meta's
           callback, and Meta skips an item whose payload it already holds.

           The hero and the focused tile are deliberately different pictures now
           — the two steps above are what check that — so what is checked here is
           that the backdrop belongs to whatever is under focus: it moves when
           focus moves, and comes back unchanged when focus comes back. */
        function state() {
          return page.evaluate(function () {
            var lit = document.querySelector('#hero-art .hero-layer.on');
            return { hero: lit ? lit.style.backgroundImage : '',
                     layers: document.querySelectorAll('#hero-art .hero-layer').length,
                     title: document.getElementById('mh-title').textContent.trim() };
          });
        }
        function settle() { return page.waitForTimeout(900); }
        var atA;
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })      // to the first row
          .then(settle)
          .then(function () { return press('ArrowRight'); })       // rest on A
          .then(settle)
          .then(state)
          .then(function (st) {
            /* Two layers, one lit: a crossfade needs both, and a stack of them
               would mean every backdrop stayed in memory. */
            if (st.layers !== 2) {
              throw new Error(st.layers + ' hero layers, not 2');
            }
            if (!st.hero) throw new Error('no backdrop on "' + st.title + '"');
            atA = st;
          })
          .then(function () { return press('ArrowRight'); })       // rest on B
          .then(settle)
          .then(state)
          .then(function (st) {
            if (st.hero === atA.hero) {
              throw new Error('the backdrop did not move from "' + atA.title +
                              '" to "' + st.title + '"');
            }
          })
          .then(function () { return press('ArrowLeft'); })        // back to A, now cached
          .then(settle)
          .then(state)
          .then(function (st) {
            if (st.hero !== atA.hero) {
              throw new Error('back on "' + st.title + '" the backdrop is not the one it had');
            }
          })
          /* And it must survive a fast sweep, where every item but the last is
             passed over before its request could have finished. */
          .then(function () { return press('ArrowRight', 12); })
          .then(settle)
          .then(state)
          .then(function (swept) {
            if (swept.hero === atA.hero) {
              throw new Error('after a fast sweep the backdrop is still the one from "' +
                              atA.title + '"');
            }
            /* Stepping off and back on has to land on the same picture, which is
               what says the backdrop belongs to the item and not to the sweep. */
            return press('ArrowLeft')
              .then(settle)
              .then(function () { return press('ArrowRight'); })
              .then(settle)
              .then(state)
              .then(function (st) {
                if (st.hero !== swept.hero) {
                  throw new Error('"' + st.title + '" has a different backdrop the second time');
                }
              });
          });
      });
    })

    .then(function () {
      return step('stepping down keeps the film on screen, over one row and a peek', function () {
        /* The tall hero leaves room for one row. If it does not collapse when
           the focus moves off row 0, the row you just moved to is drawn below
           the fold and moving down looks like nothing happening — and if it
           collapses to a bare band, browsing throws the picture away, which is
           the other half of what this step is for. */
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })
          .then(function () { return page.waitForTimeout(500); })
          .then(function () {
            return page.evaluate(function () {
              return document.getElementById('browse').classList.contains('dense');
            });
          })
          .then(function (dense) {
            if (dense) throw new Error('the hero is a band while the first row is focused');
          })
          .then(function () { return press('ArrowDown'); })
          .then(function () { return page.waitForTimeout(600); })
          .then(function () {
            return page.evaluate(function () {
              var row = document.querySelector('#rows .row.on');
              var tile = row && row.querySelector('.tile.on');
              var vp = document.getElementById('viewport').getBoundingClientRect();
              var t = tile && tile.getBoundingClientRect();
              /* Every row the pool has drawn, in the order they sit, with how
                 much of each one the viewport actually shows. */
              var rows = Array.prototype.map.call(
                document.querySelectorAll('#rows .row:not(.hidden)'), function (r) {
                  var b = r.getBoundingClientRect();
                  return { height: Math.round(b.height),
                           top: Math.round(b.top),
                           shown: Math.round(Math.min(b.bottom, vp.bottom) -
                                             Math.max(b.top, vp.top)) };
                }).sort(function (a, b) { return a.top - b.top; });
              /* Tiles whose whole width is on screen — the row is drawn wider
                 than the panel and clipped, so "seven across" is a count of
                 the ones you can actually see. */
              var across = Array.prototype.filter.call(
                row ? row.querySelectorAll('.tile:not(.hidden)') : [], function (el) {
                  var b = el.getBoundingClientRect();
                  return b.left >= -1 && b.right <= 1921;
                }).length;
              return {
                dense: document.getElementById('browse').classList.contains('dense'),
                label: row ? row.querySelector('.row-label').textContent.trim() : '',
                art: tile ? { w: Math.round(tile.querySelector('.tile-inner').offsetWidth),
                              h: Math.round(tile.querySelector('.tile-inner').offsetHeight) }
                          : null,
                across: across,
                top: t ? Math.round(t.top) : null, bottom: t ? Math.round(t.bottom) : null,
                vpTop: Math.round(vp.top), vpBottom: Math.round(vp.bottom),
                rows: rows,
                heroOpacity: Number(getComputedStyle(document.getElementById('hero-art')).opacity),
                desc: document.getElementById('mh-desc').textContent.trim(),
                cast: document.getElementById('mh-cast').textContent.trim()
              };
            });
          })
          .then(function (st) {
            if (!st.dense) throw new Error('the hero did not collapse off the first row');
            if (st.top === null) throw new Error('no focused tile on row 1');
            /* Portrait, 2:3, seven across. The row arithmetic hangs off these,
               so a change here is a change to how much of the rail you see. */
            if (!st.art || st.art.w !== 209 || st.art.h !== 314) {
              throw new Error('the tile art is ' + JSON.stringify(st.art) + ', not 209×314');
            }
            if (st.across !== 7) {
              throw new Error(st.across + ' tiles fit across, not 7');
            }
            if (st.top < st.vpTop - 1 || st.bottom > st.vpBottom + 1) {
              throw new Error('"' + st.label + '" is focused but drawn at ' + st.top + '–' +
                              st.bottom + ', outside the viewport ' + st.vpTop + '–' + st.vpBottom);
            }
            /* The header still carries the film: the picture behind it, what it
               is about, and who is in it. */
            if (!(st.heroOpacity > 0)) {
              throw new Error('the backdrop was thrown away off the first row');
            }
            if (!st.desc) throw new Error('the description vanished off the first row');
            if (!st.cast) throw new Error('the key actors vanished off the first row');
            /* One whole row under the header and the next peeking, which is the
               only thing saying there is more below. A 2:3 poster is taller than
               the landscape tile this replaced, so one row is the trade that was
               made for it, not a regression. */
            var whole = st.rows.filter(function (r) { return r.shown >= r.height - 1; });
            var peek = st.rows.filter(function (r) {
              return r.shown > 0 && r.shown < r.height - 1;
            });
            if (whole.length < 1) {
              throw new Error('no whole row fits under the header');
            }
            if (!peek.length) {
              throw new Error('no row peeks below the fold, so nothing says there is more');
            }
          })
          .then(function () { return shot('dense'); })
          /* And at the *end* of the list, where the window stops scrolling and
             the last row sits wherever the clamp leaves it. This is where the
             row height and the viewport height have to agree: get it wrong and
             the final row's title is below the clip, invisible. Every section
             has an All row at the bottom, so there is always one to land on. */
          .then(function () { return press('ArrowDown', 12); })
          .then(function () { return page.waitForTimeout(700); })
          .then(function () {
            return page.evaluate(function () {
              var row = document.querySelector('#rows .row.on');
              var tile = row && row.querySelector('.tile.on');
              var title = tile && tile.querySelector('.tile-title');
              var vp = document.getElementById('viewport').getBoundingClientRect();
              var n = title && title.getBoundingClientRect();
              return {
                label: row ? row.querySelector('.row-label').textContent.trim() : '',
                titleBottom: n ? Math.round(n.bottom) : null,
                vpBottom: Math.round(vp.bottom)
              };
            });
          })
          .then(function (st) {
            if (st.titleBottom === null) throw new Error('no focused tile on the last row');
            if (st.titleBottom > st.vpBottom + 1) {
              throw new Error('the last row is clipped: "' + st.label + '" title ends at ' +
                              st.titleBottom + ', past the viewport at ' + st.vpBottom);
            }
          });
      });
    })

    .then(function () {
      return step('discovery turns a curated list into rows of what we hold', function () {
        /* The mock answers TMDB's list endpoints with ids the fake servers
           really have, so this walks the whole path: a small external list, a
           guid lookup per title, and a row of the ones that came back. */
        return backToLibrary()
          .then(function () { return sidebarPick('Discovery'); })
          .then(function () {
            return waitFor('(function(){var r=document.querySelectorAll("#rows .row:not(.hidden)");' +
                           'for(var i=0;i<r.length;i++){' +
                           'if(/Trending this week/.test(r[i].textContent) &&' +
                           ' r[i].querySelectorAll(".tile:not(.hidden)").length) return true;}' +
                           'return false;})()', 'a trending row with something in it', 20000);
          })
          .then(function () { return shot('discovery'); })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      return step('search finds a title and shows a result count', function () {
        return backToLibrary()
          .then(function () { return press('F1'); })
          .then(function () { return page.waitForSelector('#search-input', { state: 'visible' }); })
          .then(function () { return page.fill('#search-input', titles.directPlays.title); })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            /* The results page has no chip row any more: the first row's own
               title is the header, and it still has to say what was asked, how
               many came back, and the way out. */
            return waitFor('document.getElementById("browse").classList.contains("results")',
                           'the results page');
          })
          .then(function () { return page.textContent('#mh-row'); })
          .then(function (header) {
            const safe = titles.directPlays.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const want = new RegExp('^' + safe +
                                    '\\s+·\\s+1 film\\s+·\\s+BACK to library$');
            if (!want.test(header.trim())) throw new Error('the header reads "' + header + '"');
          })
          .then(function () { return shot('search'); })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      return step('the device screen lists who has been watching', function () {
        return backToLibrary()
          .then(function () { return sidebarPick('Devices'); })
          .then(function () {
            return waitFor('/Living room/.test(document.querySelector("#device-list").textContent)',
                           'the device list', 15000);
          })
          .then(function () { return shot('devices'); })
          .then(function () { return press('Backspace'); })   // saves and returns
          .then(function () {
            return waitFor('document.getElementById("devices").classList.contains("hidden")',
                           'the device screen to close');
          });
      });
    })

    .then(function () {
      /* A 4K remux whose only tracks are TrueHD and DTS-HD MA. Neither can cross
         plain ARC, so the film's own track is offered to the server for
         re-encoding — and re-encoding anything on a 4K file is the one thing
         the admin's kill-stream fires on, so it is refused. The decision call
         is how we learn that, and it opens no session (hasMDE=1), which is
         why asking is the design rather than a cost. */
      return step('refuses a 4K remux whose only audio would be re-encoded', function () {
        return openTitle(titles.truehdOnly.title)
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor(shown('4K transcode refused', titles.truehdOnly.title),
                           'the 4K refusal, naming ' + titles.truehdOnly.title);
          })
          .then(function () {
            if (!tracedThat(/decision: transcode/)) {
              throw new Error('the verdict was reached without asking the server');
            }
          })

          .then(function () { return shot('refuse-truehd'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('plays sub-4K content the server has to convert', function () {
        /* Below 4K a transcode is ordinary server work, and refusing it is what
           made every awkward file unplayable. */
        return openTitle(titles.transcodes.title)
          .then(function () {
            return waitFor('/transcode/.test(' +
                           'document.querySelector("#dt-actions .dt-act-cap").textContent)',
                           'a transcode verdict on Play\'s caption', 15000);
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            if (!tracedThat(/decision: transcode/)) {
              throw new Error('expected a transcode verdict in: ' + trace.slice(-3).join(' | '));
            }
          })
          .then(function () {
            if (!hasFixture()) return page.waitForTimeout(500);
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && !v.error;})()',
                           'the converted stream to start', 15000);
          })
          .then(function () {
            if (!tracedThat(/server converting/)) {
              throw new Error('played the original file rather than the converted stream');
            }
          })
          .then(function () { return shot('transcode-play'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('a film on both servers is one entry with two copies', function () {
        return openTitle(titles.shared.title)
          .then(function () {
            /* One search result, not two — that is the whole point. The count
               is in the results header the search left in the hero. */
            return page.evaluate(function () {
              const m = document.getElementById('mh-row').textContent.match(/(\d+) films?/);
              return m ? Number(m[1]) : -1;
            });
          })
          .then(function (n) {
            if (n !== 1) throw new Error('the same film appeared ' + n + ' times');
          })
          .then(function () { return openChooser('source'); })
          .then(function () {
            return waitFor('(function(){var r=document.querySelectorAll(' +
                           '"#dt-menu:not(.hidden) .menu-row");' +
                           'if (r.length !== 2) return false;' +
                           'return !/checking/.test(r[0].textContent) &&' +
                           ' !/checking/.test(r[1].textContent);})()',
                           'both copies checked', 15000);
          })
          .then(sourceRows)
          .then(function (src) {
            /* The two copies must not read the same, and exactly one of them
               must be playable — that is the case this whole feature exists
               for: a 4K TrueHD remux on one server, a passable copy on the
               other. */
            const plays = src.filter(function (s) { return /direct play/.test(s.verdict); });
            const refused = src.filter(function (s) { return /4K, would transcode/.test(s.verdict); });
            if (plays.length !== 1 || refused.length !== 1) {
              throw new Error('expected one playable and one refused copy, got:\n        ' +
                              src.map(function (s) { return s.server + ' ' + s.version + ' — ' +
                                                            s.verdict; }).join('\n        '));
            }
            if (!src[0].preferred) throw new Error('the preferred server should be listed first');
            if (!src[0].on) throw new Error('the preferred copy should be selected');
          })
          .then(function () { return shot('detail-shared'); });
      });
    })

    .then(function () {
      return step('a copy the guard refuses toasts and leaves the last one chosen', function () {
        /* The chooser is still up from the step before. Pick the copy that
           cannot play: the page must say why in a line and go on offering the
           one that can, rather than accepting a choice it will refuse at Play. */
        let was;
        return sourceRows()
          .then(function (src) {
            was = src.filter(function (s) { return s.on; })[0];
            const bad = src.filter(function (s) { return !playable(s.verdict); })[0];
            if (!bad) throw new Error('no refused copy to choose');
            /* By the whole label: two copies of the same film routinely differ
               only in bitrate, so half of one matches the other as well. */
            const label = bad.version + ' \u00b7 ' + bad.server;
            return menuChoose(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
          })
          .then(function () {
            return waitFor('(function(){var t=document.getElementById("toast");' +
                           'return !t.classList.contains("hidden") &&' +
                           ' /Kept as it was/.test(t.textContent);})()',
                           'the refusal toast', 15000);
          })
          .then(function () { return openChooser('source'); })
          .then(sourceRows)
          .then(function (src) {
            const on = src.filter(function (s) { return s.on; })[0];
            if (!on || on.version !== was.version || on.server !== was.server) {
              throw new Error('the refused copy was selected anyway: ' +
                              (on ? on.server + ' ' + on.version : 'nothing'));
            }
          })
          .then(function () { return press('Backspace'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('extras are cards with a length, and are guarded like anything else',
        function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            return waitFor('(function(){var e=document.querySelectorAll("#dt-extras .dt-extra");' +
                           'if (!e.length) return false;' +
                           'return !/checking/.test(e[0].textContent);})()',
                           'an extra with a verdict', 15000);
          })
          .then(function () {
            return page.evaluate(function () {
              return Array.prototype.map.call(
                document.querySelectorAll('#dt-extras .dt-extra'),
                function (e) {
                  const len = e.querySelector('.dt-extra-len');
                  return { text: e.textContent.replace(/\s+/g, ' '),
                           len: len ? len.textContent.trim() : '' };
                });
            });
          })
          .then(function (cards) {
            const all = cards.map(function (c) { return c.text; }).join(' | ');
            if (!/Trailer/i.test(all)) throw new Error('no trailer listed: ' + all);
            /* A clip is an ordinary part on the same server, so it goes through
               the same guard — it must carry a verdict, not be assumed safe. */
            if (!/direct play|transcode|no passable/.test(cards[0].text)) {
              throw new Error('extra has no verdict: ' + cards[0].text);
            }
            if (!/^\d+ min$/.test(cards[0].len)) {
              throw new Error('no length on the card: "' + cards[0].len + '"');
            }
          })
          /* Down off the action row is the extras strip. */
          .then(function () { return press('ArrowDown'); })
          .then(function () {
            return waitFor('!!document.querySelector("#dt-extras .dt-extra.on")',
                           'focus to reach the extras');
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            if (!hasFixture()) return page.waitForTimeout(500);
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && v.currentTime >= 0;})()',
                           'the extra to start', 15000);
          })
          .then(function () { return shot('extras'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('the film page opens on Play, with a button per choice', function () {
        return openTitle(titles.directPlays.title)
          .then(actionRow)
          .then(function (row) {
            /* Play, Trailer, Quality, Source, Audio, Subtitles — and Play has
               the focus, so OK is still one press. */
            if (row.length !== 6) {
              throw new Error('the action row is: ' +
                              row.map(function (a) { return a.button || a.caption; }).join(' | '));
            }
            if (!row[0].primary || !row[0].on || row[0].button !== 'Play') {
              throw new Error('Play is not the focused primary: ' + JSON.stringify(row[0]));
            }
            /* Every caption names what is chosen now, and none of them is
               still saying "checking". */
            const blank = row.filter(function (a) {
              return !a.caption || /checking/.test(a.caption);
            });
            if (blank.length) {
              throw new Error('a button with nothing chosen: ' +
                              row.map(function (a) { return a.caption; }).join(' | '));
            }
            /* Play says what it will do and what the server will make of it. */
            if (!/from start|resume at/.test(row[0].caption) ||
                !/direct play/.test(row[0].caption)) {
              throw new Error('Play\'s caption is: ' + row[0].caption);
            }
          })
          .then(function () { return shot('detail-actions'); });
      });
    })

    .then(function () {
      return step('an audio track says what it costs, and the caption follows it', function () {
        return openChooser('audio')
          .then(menuLabels)
          .then(function (labels) {
            /* The h264-eac3 profile: E-AC3 5.1, AC3 5.1 and a French AAC
               stereo, all three named by language. */
            if (labels.length !== 3) throw new Error('audio rows: ' + labels.join(' | '));
            /* What a row says has to be what OK does. Desktop Chrome exposes no
               audioTracks, so every track but the one already chosen costs
               direct play — and the one already chosen must not be warned
               about, because choosing it costs nothing at all. */
            const on = labels.filter(function (l) { return /^\* /.test(l); });
            if (on.length !== 1) throw new Error('audio rows: ' + labels.join(' | '));
            if (/\[/.test(on[0])) {
              throw new Error('the track already chosen is warned about: ' + on[0]);
            }
            const others = labels.filter(function (l) { return !/^\* /.test(l); });
            const quiet = others.filter(function (l) { return !/costs direct play/.test(l); });
            if (quiet.length) {
              throw new Error('a row that does not say it costs direct play: ' +
                              labels.join(' | '));
            }
          })
          .then(function () { return menuChoose(/French/); })
          .then(function () {
            return waitFor('/AAC/.test(document.querySelectorAll(' +
                           '"#dt-actions .dt-act-cap")[4].textContent)',
                           'the audio button to name the chosen track', 15000);
          })
          .then(actionRow)
          .then(function (row) {
            /* Choosing a track the panel cannot select gives up direct play, so
               Play must now say so rather than still promising one. */
            if (/direct play/.test(row[0].caption)) {
              throw new Error('the audio choice cost nothing: ' + row[0].caption);
            }
          })
          .then(function () { return shot('detail-audio'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a subtitle language chosen on the film page is what plays', function () {
        return openTitle(titles.directPlays.title)
          .then(function () { return openChooser('subtitles'); })
          .then(menuLabels)
          .then(function (labels) {
            if (!/Off/.test(labels[0])) throw new Error('subtitle rows: ' + labels.join(' | '));
          })
          .then(function () { return menuChoose(/French/); })
          .then(function () {
            return waitFor('/French/.test(document.querySelectorAll(' +
                           '"#dt-actions .dt-act-cap")[5].textContent)',
                           'the subtitles button to name French', 15000);
          })
          /* And Play starts on it: the language crosses into the player, which
             fetches that track and draws it over the video. */
          .then(function () { return pressButton('play'); })
          .then(function () {
            return waitFor('/fran\u00e7ais/.test(document.getElementById("subtitle").textContent)',
                           'the chosen subtitle track drawn over the video', 15000);
          })
          .then(function () { return shot('detail-subtitles'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('plays a file that direct plays', function () {
        return openTitle(titles.directPlays.title)
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () { return page.waitForTimeout(600); })
          .then(function () {
            if (!tracedThat(/decision: directplay/)) {
              throw new Error('no directplay verdict in: ' + trace.slice(-3).join(' | '));
            }
          })
          .then(function () {
            /* With a fixture, the video element has to actually get going —
               "the guard let it through" is not the same as "it played". Without
               one, the error path is the correct outcome and all we can check is
               that the guard did not refuse it. */
            if (!hasFixture()) return page.waitForTimeout(400);
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && !v.paused &&' +
                           ' v.currentTime > 0.2 && !v.error;})()',
                           'the video to start advancing', 15000);
          })
          .then(function () { return shot('play'); });
      });
    })

    /* Everything the player can do while a film runs. All of it needs something
       actually playing, so it is skipped without a fixture — npm run fixture. */

    .then(function () {
      if (!hasFixture()) return;
      return step('four captioned buttons, each opening its own panel', function () {
        return press('ArrowUp')                                    // into the row
          .then(controlRow)
          .then(function (row) {
            const named = row.ids.filter(Boolean).join(',');
            if (named !== 'osd-ctl-audio,osd-ctl-subs,osd-ctl-quality,osd-ctl-chapters') {
              throw new Error('the control row is: ' + row.ids.join(', '));
            }
            /* A caption names what is chosen now, so none of the four may be
               blank — that is the whole reason the tabs went. */
            const blank = row.caps.slice(row.caps.length - 4)
              .filter(function (c) { return c === ''; });
            if (blank.length) throw new Error('captions: ' + row.caps.join(' | '));
          })
          .then(function () { return openMenu('audio'); })
          .then(controlRow)
          .then(function (row) {
            /* The violet ring means "this is the panel that is open". */
            if (row.open !== 'osd-ctl-audio') {
              throw new Error('the open button is not ringed: ' + row.open);
            }
          })
          .then(menuLabels)
          .then(function (labels) {
            /* This film is the h264-eac3 profile: E-AC3 5.1, AC3 5.1 and a
               French AAC stereo. All three have to be offered, named by
               language rather than by stream id. */
            if (labels.length !== 3 || !/English/.test(labels[0]) ||
                !/French/.test(labels[2])) {
              throw new Error('audio rows: ' + labels.join(' | '));
            }
          })
          .then(function () { return openMenu('subs'); })
          .then(menuLabels)
          .then(function (labels) {
            if (!/Off/.test(labels[0])) throw new Error('subtitle rows: ' + labels.join(' | '));
            /* An image track is listed and refused by name — the only way to
               show it is to have the server burn it in, which is a transcode. */
            const image = labels.filter(function (l) { return /image/.test(l); });
            if (!image.length) throw new Error('the PGS track is not named as an image track');
          })
          .then(function () { return openMenu('quality'); })
          .then(menuLabels)
          .then(function (labels) {
            if (!/Original/.test(labels[0])) throw new Error('quality rows: ' + labels.join(' | '));
            if (labels.length < 2) throw new Error('no bitrate caps offered');
            /* There is no adaptive ladder behind any of these: Original is the
               file as it stands and a cap is a fixed ceiling. A row claiming to
               follow the connection would be a lie the user cannot check. */
            if (/auto|follows the connection/i.test(labels.join(' '))) {
              throw new Error('a quality row claims to follow the connection: ' +
                              labels.join(' | '));
            }
            /* And each one says what it costs before OK is pressed. */
            if (!/\[direct play\]/.test(labels[0]) ||
                !/\[transcode · /.test(labels[1])) {
              throw new Error('quality rows do not say what they cost: ' + labels.join(' | '));
            }
          })
          .then(function () { return shot('player-menu'); })
          .then(function () { return press('Backspace'); })           // close the panel
          .then(function () {
            return waitFor('document.getElementById("menu").classList.contains("hidden")',
                           'the panel to close');
          });
      });
    })

    /* Chapters is a rail of cards rather than a list: where a chapter has a
       still it is on the card, and where it has not the card is the same size
       with nothing broken in it. */

    .then(function () {
      if (!hasFixture()) return;
      return step('chapters open as a rail, and OK on a card seeks there', function () {
        var was;
        return openChapters()
          .then(function () {
            return page.evaluate(function () {
              return Array.prototype.map.call(
                document.querySelectorAll('#osd-chapters .osd-chap'),
                function (c) {
                  const shot = c.querySelector('.osd-chap-shot');
                  return { h: shot.offsetHeight, w: shot.offsetWidth,
                           art: shot.style.backgroundImage !== '',
                           imgs: c.querySelectorAll('img').length,
                           time: c.querySelector('.osd-chap-time').textContent.trim(),
                           title: c.querySelector('.osd-chap-title').textContent.trim(),
                           on: c.classList.contains('on') };
                });
            });
          })
          .then(function (cards) {
            if (cards.length < 8) throw new Error('only ' + cards.length + ' chapter cards');
            const sizes = cards.filter(function (c) { return c.h !== cards[0].h || c.w !== cards[0].w; });
            if (sizes.length) throw new Error('the cards are not all one size');
            /* No <img> anywhere: a card with no thumbnail must not leave a
               broken one behind, and a background is how that is guaranteed. */
            if (cards.filter(function (c) { return c.imgs; }).length) {
              throw new Error('a chapter card uses an img, which breaks without a thumb');
            }
            if (!cards.filter(function (c) { return c.art; }).length) {
              throw new Error('no chapter card drew the thumbnail the mock supplies');
            }
            if (!cards.filter(function (c) { return !c.art; }).length) {
              throw new Error('no chapter without a thumbnail to check');
            }
            if (!cards[0].time || !cards[0].title) throw new Error('a card is missing its text');
            if (cards.filter(function (c) { return c.on; }).length !== 1) {
              throw new Error('the chapter holding the playhead is not the ringed one');
            }
            return shot('player-chapters');
          })
          .then(function () {
            return page.evaluate(function () { return document.getElementById('video').currentTime; });
          })
          /* Two along, then OK: the seek is aimed at that chapter's start. */
          .then(function (t) { was = t; return press('ArrowRight', 2); })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('/SEEKING/.test(document.getElementById("osd-time").textContent)',
                           'the OSD to show the chapter jump aiming');
          })
          .then(function () {
            return waitFor('document.getElementById("osd-chapters").classList.contains("hidden")',
                           'the rail to close once a chapter is taken');
          })
          .then(function () {
            if (!(was >= 0)) throw new Error('playback had no position to seek from');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('subtitles are fetched as text and drawn over the video', function () {
        return openMenu('subs')
          .then(function () { return menuChoose(/French/); })
          .then(function () {
            return waitFor('/français/.test(document.getElementById("subtitle").textContent)',
                           'the French subtitle track to be drawn over the video', 15000);
          })
          /* And clear of the controls: a line of dialogue behind a button is
             the one thing this screen must not do. */
          .then(function () {
            return page.evaluate(function () {
              const sub = document.getElementById('subtitle').getBoundingClientRect();
              const osd = document.getElementById('osd').getBoundingClientRect();
              return [sub.bottom, osd.top,
                      document.getElementById('subtitle').classList.contains('lifted')];
            });
          })
          .then(function (at) {
            if (!at[2]) throw new Error('the subtitle was not lifted while the OSD was up');
            if (at[0] > at[1]) {
              throw new Error('the subtitle runs into the controls: bottom ' + at[0] +
                              ' against an OSD starting at ' + at[1]);
            }
          })
          .then(function () { return shot('subtitles'); });
      });
    })

    /* Audio track selection, which is the one thing in the player that cannot
       be done by asking nicely.

       On a direct play the server hands over the original file with every
       track still in it, and the panel plays whichever it likes. Passing
       audioStreamID to the decision call changes nothing about those bytes, so
       a "switch" that stays a direct play is silent and total nonsense — the
       OSD renames the track and you go on hearing the first one.

       There are two ways out and the panel decides which. Both are tested. */

    .then(function () {
      if (!hasFixture()) return;
      return step('a track the panel owns is switched without asking the server', function () {
        /* Desktop Chrome exposes no audioTracks, so stand one in: this is the
           seam the TV may or may not have, and the logic behind it — mapping a
           Plex stream to a pipeline track and selecting it — has to be right
           either way. */
        return page.evaluate(function () {
          var v = document.getElementById('video');
          var list = [];
          /* Three, to match the three audio streams on this file, in order. */
          for (var i = 0; i < 3; i++) list.push({ id: 'p' + i, enabled: i === 0 });
          list.length = 3;
          Object.defineProperty(v, 'audioTracks', { configurable: true, value: list });
        })
          .then(function () {
            const before = trace.length;
            return openMenu('audio')
              .then(menuLabels)
              .then(function (labels) {
                /* No row may warn about a restart now — the panel owns them. */
                if (/restarts/.test(labels.join(' '))) {
                  throw new Error('offered a restart for a track the panel can select: ' +
                                  labels.join(' | '));
                }
              })
              .then(function () { return menuChoose(/French · AAC/); })
              .then(function () {
                return waitFor('/French/.test(document.querySelector(' +
                               '"#osd-ctl-audio .osd-cap").textContent)',
                               'the audio button to name the new track', 10000);
              })
              .then(function () {
                return page.evaluate(function () {
                  var l = document.getElementById('video').audioTracks;
                  return [l[0].enabled, l[1].enabled, l[2].enabled];
                });
              })
              .then(function (enabled) {
                if (!enabled[2] || enabled[0] || enabled[1]) {
                  throw new Error('the panel track was not selected: ' + JSON.stringify(enabled));
                }
                const after = trace.slice(before);
                if (after.filter(function (l) { return /decision:/.test(l); }).length) {
                  throw new Error('asked the server for a track the panel could select itself');
                }
                if (after.filter(function (l) { return /playing /.test(l); }).length) {
                  throw new Error('restarted playback for a switch that costs nothing');
                }
              })
              /* And playback never stopped, which is the whole point of it. */
              .then(function () {
                return waitFor('(function(){var v=document.getElementById("video");' +
                               'return !v.paused && !v.error;})()',
                               'playback to carry straight on');
              });
          })
          .then(function () {
            return page.evaluate(function () {
              delete document.getElementById('video').audioTracks;
            });
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a track the panel cannot select stops asking for the file', function () {
        /* The fallback, and the actual bug: with no audioTracks to select from,
           a switch must stop being a direct play. Re-fetching the same file
           with a different audioStreamID changes nothing you can hear.

           This is deliberately the last thing that runs, because it ends
           playback in the harness and cannot not: the app correctly reaches for
           start.m3u8, and Chrome refuses every .m3u8 there has ever been. What
           is asserted is everything up to the bytes — the verdict changed, and
           the converted URL is what was played. */
        const before = trace.length;
        return openMenu('audio')
          .then(menuLabels)
          .then(function (labels) {
            /* With no panel list, the menu has to warn that this one restarts. */
            if (!/restarts/.test(labels.join(' '))) {
              throw new Error('no restart warning without a panel track list: ' +
                              labels.join(' | '));
            }
          })
          /* Not the AAC one — the step before this switched to it on the panel,
             and choosing what is already playing is correctly a no-op. */
          .then(function () { return menuChoose(/· AC3 5\.1/); })
          /* The decision, the restart and the media error all land inside a
             second; there is no end state to wait for, because the end state
             here is a failure the harness cannot avoid. */
          .then(function () { return page.waitForTimeout(1500); })
          .then(function () {
            const after = trace.slice(before);
            /* The switch's OWN verdict — the first one after the press. Later
               lines are the film page re-checking every copy once the harness
               fails to play the stream, and those are direct plays for
               unrelated parts. */
            const verdict = after.filter(function (l) { return /decision:/.test(l); })[0];
            if (!verdict) throw new Error('no second decision call for the new track');
            /* directplay here would mean the same file, every track still in
               it, and the panel going on choosing — which is exactly the bug,
               and this is what it looked like in the trace. */
            if (!/decision: directstream/.test(verdict)) {
              throw new Error('the chosen track did not stop the direct play: ' + verdict);
            }
            /* And what it played has to be the converted stream, not the file. */
            if (!after.filter(function (l) { return /server converting/.test(l); }).length) {
              throw new Error('played the original file again rather than the muxed stream: ' +
                              after.slice(-3).join(' | '));
            }
          })
          /* Put the film back on so the steps after this one have something to
             work with: out of the failure message, back to the page, play. */
          .then(function () { return press('Backspace'); })
          .then(function () {
            return waitFor('!document.getElementById("detail").classList.contains("hidden")',
                           'the film page after the harness could not play the stream');
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && !v.paused &&' +
                           ' v.currentTime > 0 && !v.error;})()',
                           'playback to start again', 15000);
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('skip intro appears inside the marker and takes you past it', function () {
        /* Back to the start first — by now the film is well past the intro, and
           the offer is only made while you are inside one. */
        return press('ArrowLeft')
          .then(function () {
            return waitFor('!document.getElementById("osd-skip").classList.contains("hidden")',
                           'the skip-intro offer', 20000);
          })
          .then(function () { return page.textContent('#osd-skip'); })
          .then(function (text) {
            if (!/Skip intro/.test(text)) throw new Error('the offer says: ' + text);
          })
          .then(function () { return shot('skip-intro'); })
          /* OK means "take it" while the offer is up — the one moment that
             button is not pause, and the moment you are reaching for it. */
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('document.getElementById("video").currentTime >= 11.5',
                           'playback to land past the end of the intro', 10000);
          })
          .then(function () {
            return waitFor('document.getElementById("osd-skip").classList.contains("hidden")',
                           'the offer to go away once taken');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the trackbar shows chapters, and a digit jumps', function () {
        return page.evaluate(function () {
          return [document.querySelectorAll('#osd-ticks .osd-tick').length,
                  document.querySelectorAll('#osd-ticks .osd-band').length];
        }).then(function (n) {
          if (n[0] < 7) throw new Error('only ' + n[0] + ' chapter ticks on the bar');
          if (n[1] < 2) throw new Error('the intro and credits are not marked on the bar');
        })
        /* The elapsed and the total sit either side of the bar, not under it. */
        .then(function () {
          return page.evaluate(function () {
            function box(id) { return document.getElementById(id).getBoundingClientRect(); }
            return [box('osd-time').right, box('osd-bar').left, box('osd-bar').right,
                    box('osd-total').left,
                    document.getElementById('osd-total').textContent.trim()];
          });
        })
        .then(function (at) {
          if (!(at[0] <= at[1] && at[2] <= at[3])) {
            throw new Error('the times are not either side of the bar: ' + at.join(', '));
          }
          if (!/^\d+:\d\d/.test(at[4])) throw new Error('no total run time: ' + at[4]);
        })
        /* 0 is the safe digit to prove the jump with: the fixture is thirty
           seconds and the film says two hours, so anything else aims past the
           end of what the harness can serve. */
        .then(function () { return page.keyboard.press('0'); })
        .then(function () {
          return waitFor('/SEEKING/.test(document.getElementById("osd-time").textContent)',
                         'the OSD to show where the jump is aiming');
        })
        .then(function () { return shot('trackbar'); });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the OSD follows playback, and Back stops it', function () {
        var at;
        return waitFor('document.getElementById("osd-time").textContent.trim().indexOf("0:00") !== 0',
                       'the OSD clock to move off zero', 15000)
          .then(function () { return page.evaluate(function () { return document.getElementById('video').currentTime; }); })
          .then(function (t) {
            at = t;
            return press('Backspace');            // stop
          })
          .then(function () {
            /* Back from playback returns to the page it was started from, so
               you can pick the other copy without searching again. */
            return waitFor('document.getElementById("video").classList.contains("hidden") &&' +
                           ' !document.getElementById("detail").classList.contains("hidden")',
                           'playback to stop and the detail page to come back');
          })
          .then(function () {
            if (!(at > 0)) throw new Error('playback never advanced');
          });
      });
    })

    /* ---- what comes next ----

       The whole point of the feature is that it does NOT roll on by itself
       unless it was asked to, so half of these steps are about nothing
       happening. */

    .then(function () {
      if (!hasFixture()) return;
      return step('an episode ending offers the next one, and waits', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, 1); })
          .then(playToEnd)
          .then(waitForOffer)
          .then(function (st) {
            if (st.title.indexOf('S1 E2') !== 0) {
              throw new Error('the offer does not name S1 E2: ' + st.title);
            }
            if (st.show.indexOf(titles.run.title) < 0) {
              throw new Error('the offer does not name the series: ' + st.show);
            }
            if (/Playing in/.test(st.hint)) {
              throw new Error('a countdown ran with the setting off: ' + st.hint);
            }
          })
          .then(function () { return shot('up-next'); })
          /* And then nothing. The offer is still there and no episode has
             started itself, which is the default this feature ships with. */
          .then(function () { return page.waitForTimeout(3000); })
          .then(upNext)
          .then(function (st) {
            if (!st.showing) throw new Error('the offer went away on its own');
            if (!/S1 E2/.test(st.title)) throw new Error('the offer changed to ' + st.title);
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('OK on the offer plays the next one, the last one closed first', function () {
        const mark = timelines.length;
        return page.keyboard.press('Enter')
          .then(function () {
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !v.classList.contains("hidden") && v.currentTime > 0.2 && !v.error;})()',
                           'the next episode to start', 25000);
          })
          .then(function () {
            /* A session left open on someone else's server is the rudest thing
               this app can do, so the finished episode is reported stopped
               before the next one asks for anything. */
            const after = timelines.slice(mark);
            const stopped = after.findIndex(function (u) { return /state=stopped/.test(u); });
            const playing = after.findIndex(function (u) { return /state=playing/.test(u); });
            if (stopped < 0) throw new Error('the finished episode was never reported stopped');
            if (playing >= 0 && playing < stopped) {
              throw new Error('the next episode started before the last one was closed');
            }
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a next episode the guard refuses toasts instead of playing', function () {
        const mark = timelines.length;
        return playToEnd()
          .then(waitForOffer)
          .then(function (st) {
            if (st.title.indexOf('S1 E3') !== 0) {
              throw new Error('the offer does not name S1 E3: ' + st.title);
            }
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('(function(){var t=document.getElementById("toast");' +
                           'return !t.classList.contains("hidden") && /Not playing/.test(t.textContent) &&' +
                           ' document.getElementById("video").classList.contains("hidden") &&' +
                           ' !document.getElementById("show").classList.contains("hidden");})()',
                           'the refusal, back on the series page', 25000);
          })
          .then(function () {
            /* Refused before anything opened: the decision call carries
               hasMDE=1 and nothing was ever reported playing. */
            const started = timelines.slice(mark).filter(function (u) {
              return /state=playing/.test(u);
            });
            if (started.length) throw new Error('a session was opened for a refused episode');
          });
      });
    })

    .then(function () {
      return step('the sidebar carries the autoplay setting and cycles it', function () {
        return backToLibrary()
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            if (rows.indexOf('Autoplay next: off') < 0) {
              throw new Error('no autoplay setting in the sidebar: ' + rows.join(' | '));
            }
          })
          .then(function () { return sidebarPick('Autoplay next: off'); })
          .then(function () {
            return waitFor('/Autoplay next: 5s/.test(document.getElementById("toast").textContent)',
                           'the setting to say what it moved to');
          })
          .then(function () {
            /* Persisted, so it is still 5s after the app is next launched. */
            return page.evaluate(function () { return localStorage.getItem('reflex.autoplay'); });
          })
          .then(function (stored) {
            if (stored !== '5') throw new Error('the setting stored "' + stored + '"');
          })
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            if (rows.indexOf('Autoplay next: 5s') < 0) {
              throw new Error('the sidebar still says: ' + rows.join(' | '));
            }
          })
          .then(function () { return press('ArrowLeft'); });        // close the sidebar
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the countdown runs, and BACK before zero cancels it', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, 1); })
          .then(playToEnd)
          .then(function () {
            return waitFor('/Playing in/.test(document.getElementById("un-hint").textContent)',
                           'the countdown', 25000);
          })
          .then(function () { return press('Backspace'); })
          .then(function () {
            return waitFor('document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' document.getElementById("video").classList.contains("hidden")',
                           'the offer and playback to go away');
          })
          /* Longer than the countdown it was cancelling. Nothing may start
             behind a screen nobody is looking at any more. */
          .then(function () { return page.waitForTimeout(6000); })
          .then(function () {
            return page.evaluate(function () {
              return document.getElementById('video').classList.contains('hidden');
            });
          })
          .then(function (gone) {
            if (!gone) throw new Error('a cancelled countdown started an episode anyway');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the countdown reaching zero plays the next episode', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, 1); })
          .then(playToEnd)
          .then(function () {
            return waitFor('/Playing in/.test(document.getElementById("un-hint").textContent)',
                           'the countdown', 25000);
          })
          .then(function () { return shot('up-next-countdown'); })
          /* Not a key from here on: the point is that it plays itself. */
          .then(function () {
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !v.classList.contains("hidden") && v.currentTime > 0.2 && !v.error;})()',
                           'the next episode to start itself', 25000);
          })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a new series is offered but never counted down', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, titles.run.lastOfFirst); })
          .then(playToEnd)
          .then(waitForOffer)
          .then(function (st) {
            if (st.title.indexOf('S2 E1') !== 0) {
              throw new Error('the offer does not name S2 E1: ' + st.title);
            }
            if (/Playing in/.test(st.hint)) {
              throw new Error('a series boundary counted down: ' + st.hint);
            }
          })
          .then(function () { return page.waitForTimeout(6000); })
          .then(upNext)
          .then(function (st) {
            if (!st.showing) throw new Error('the offer fired at a series boundary');
          })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the last episode of the last series offers nothing', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(titles.run.seasons, titles.run.lastOfLast); })
          .then(playToEnd)
          .then(function () {
            return waitFor('document.getElementById("video").classList.contains("hidden") &&' +
                           ' document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !document.getElementById("show").classList.contains("hidden")',
                           'playback to end with nothing offered', 25000);
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a film that ends offers nothing', function () {
        return backToLibrary()
          .then(function () { return openTitle(titles.directPlays.title); })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(playToEnd)
          .then(function () {
            return waitFor('document.getElementById("video").classList.contains("hidden") &&' +
                           ' document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !document.getElementById("detail").classList.contains("hidden")',
                           'the film to end and the page to come back', 25000);
          });
      });
    })

    /* ---- getting things out of Continue watching ----

       Green turns the row into a multi-select, and nothing goes without a
       confirmation naming which of two different things is about to happen: the
       item hidden, watch state untouched, or marked watched, which is not the
       same and is not reversible. The mock's Backup server has no
       removeFromContinueWatching, so both paths are walked here rather than
       described. These steps come last because they shorten the row. */

    .then(function () {
      return step('green picks things off Continue watching, and BACK changes nothing',
        function () {
          let was;
          return backToLibrary()
            .then(function () { return sidebarPick('Continue watching'); })
            .then(deckRow)
            .then(function (row) {
              was = row;
              if (row.label !== 'Continue watching') {
                throw new Error('the rail is on "' + row.label + '"');
              }
              if (row.entries.length < 3) {
                throw new Error('only ' + row.entries.length + ' part-watched entries');
              }
              if (row.hint) throw new Error('the select-mode hint is up before green');
            })
            .then(function () { return press('F3'); })                    // green
            .then(deckRow)
            .then(function (row) {
              if (row.label !== 'Select to remove — 0 picked') {
                throw new Error('green left the row labelled "' + row.label + '"');
              }
              if (!row.hint) throw new Error('the select-mode hint never appeared');
            })
            .then(function () { return page.keyboard.press('Enter'); })   // pick this one
            .then(function () { return press('ArrowRight'); })
            .then(function () { return page.keyboard.press('Enter'); })   // and the next
            .then(deckRow)
            .then(function (row) {
              if (row.label !== 'Select to remove — 2 picked') {
                throw new Error('two picks read as "' + row.label + '"');
              }
              if (row.picked !== 2) throw new Error(row.picked + ' tiles are marked, not 2');
            })
            /* OK again unpicks, and up and down are ignored so the mode cannot
               be left by wandering out of it. */
            .then(function () { return page.keyboard.press('Enter'); })
            .then(function () { return press('ArrowDown'); })
            .then(deckRow)
            .then(function (row) {
              if (row.label !== 'Select to remove — 1 picked') {
                throw new Error('after unpicking and a down press: "' + row.label + '"');
              }
            })
            .then(function () { return shot('deck-picking'); })
            .then(function () { return press('Backspace'); })
            .then(deckRow)
            .then(function (row) {
              if (row.label !== 'Continue watching') {
                throw new Error('BACK left the row labelled "' + row.label + '"');
              }
              if (row.picked || row.hint) throw new Error('BACK left the mode half up');
              if (row.entries.length !== was.entries.length) {
                throw new Error('BACK removed ' +
                                (was.entries.length - row.entries.length) + ' entries');
              }
            });
        });
    })

    .then(function () {
      return step('the sidebar reaches select mode too, for a remote with no green key',
        function () {
          return backToLibrary()
            .then(function () { return sidebarPick('Continue watching'); })
            /* Off the row entirely, so picking the entry has to land the focus
               back on it rather than arm a mode nobody can see. */
            .then(function () { return press('ArrowDown'); })
            .then(openSidebar)
            .then(sidebarRows)
            .then(function (rows) {
              const listed = rows.map(function (r) { return r.replace(/^[*-] /g, '').trim(); });
              if (listed.indexOf('Clear from Continue watching') < 0) {
                throw new Error('no clear entry in the sidebar: ' + rows.join(' | '));
              }
            })
            .then(function () { return press('ArrowLeft'); })              // close it again
            .then(function () { return sidebarPick('Clear from Continue watching'); })
            .then(deckRow)
            .then(function (row) {
              if (row.label !== 'Select to remove — 0 picked') {
                throw new Error('the sidebar left the row labelled "' + row.label + '"');
              }
              if (!row.hint) throw new Error('the select-mode hint never appeared');
            })
            .then(function () { return press('Backspace'); })
            /* And it is not offered where there is no Continue watching row to
               clear — Kids builds its own rows. */
            .then(function () { return sidebarPick('Kids'); })
            .then(function () { return page.waitForTimeout(400); })
            .then(openSidebar)
            .then(sidebarRows)
            .then(function (rows) {
              if (rows.join(' | ').indexOf('Clear from Continue watching') >= 0) {
                throw new Error('the clear entry is offered in Kids: ' + rows.join(' | '));
              }
              if (rows.join(' | ').indexOf('Devices') < 0) {
                throw new Error('the sidebar is not even listing its modes: ' + rows.join(' | '));
              }
            })
            .then(function () { return press('ArrowLeft'); })
            .then(backToLibrary);
        });
    })

    .then(function () {
      return step('a title\'s own page offers the same removal, and only on the deck',
        function () {
          let film;
          return backToLibrary()
            .then(function () { return sidebarPick('Continue watching'); })
            .then(function () {
              return focusDeck(function (e) { return e.type === 'movie' && onMain(e); });
            })
            .then(function (entry) { film = entry; return page.keyboard.press('Enter'); })
            .then(function () {
              return waitFor('!document.getElementById("detail").classList.contains("hidden")',
                             'the page for ' + film.title);
            })
            .then(actionRow)
            .then(function (row) {
              const acts = row.map(function (a) { return a.act; });
              if (acts.indexOf('remove') < 0) {
                throw new Error('no remove button on a deck title: ' + acts.join(', '));
              }
              const btn = row[acts.indexOf('remove')];
              if (!/Continue watching/.test(btn.caption)) {
                throw new Error('the remove button says "' + btn.caption + '"');
              }
            })
            .then(function () { return pressButton('remove'); })
            .then(function () { return waitForConfirm('from the film page'); })
            .then(function (box) {
              if (box.title !== 'Remove 1 from Continue watching') {
                throw new Error('the confirmation says "' + box.title + '"');
              }
            })
            .then(takeConfirm)
            /* Back on the rail, with the row already redrawn without it. */
            .then(function () {
              return waitFor('document.getElementById("detail").classList.contains("hidden")',
                             'the page to close onto the rail');
            })
            .then(deckRow)
            .then(function (row) {
              const still = row.entries.filter(function (e) { return e.title === film.title; });
              if (still.length) throw new Error(film.title + ' is still in the row');
            })
            /* And a title that is not part-watched is not offered it at all. */
            .then(function () { return openTitle(titles.directPlays.title); })
            .then(actionRow)
            .then(function (row) {
              const acts = row.map(function (a) { return a.act; });
              if (acts.join(',') !== 'play,trailer,quality,source,audio,subtitles') {
                throw new Error('a film that is not on the deck offers: ' + acts.join(', '));
              }
            });
        });
    })

    .then(function () {
      return step('a picked entry is hidden, and stays gone after a reload', function () {
        let film;
        const before = deckWrites.length;
        /* Through a real reload first, so the rows cache is freshly written and
           the check below is about this removal rather than an earlier one. */
        return reloadDeck()
          .then(function () {
            return focusDeck(function (e) { return e.type === 'movie' && onMain(e); });
          })
          .then(function (entry) { film = entry; return cachedRows('Movies'); })
          /* Read before as well as after: a check that the cache is empty
             afterwards proves nothing if the key was never the right one. */
          .then(function (cached) {
            if (!cached || !cached.rows) {
              throw new Error('nothing cached under rows:Movies to begin with');
            }
          })
          .then(function () { return press('F3'); })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () { return press('F3'); })
          .then(function () { return waitForConfirm('for one picked film'); })
          .then(function (box) {
            if (box.title !== 'Remove 1 from Continue watching') {
              throw new Error('the confirmation says "' + box.title + '"');
            }
            if (box.note !== 'They stay part-watched.') {
              throw new Error('the note says "' + box.note + '"');
            }
            /* Cancel is what it lands on: the action is a key away and never
               the default. */
            if (box.rows.join(' | ') !== 'Remove them | > Cancel') {
              throw new Error('the confirmation rows are: ' + box.rows.join(' | '));
            }
          })
          .then(takeConfirm)
          .then(function () {
            const wrote = deckWrites.slice(before);
            const hid = wrote.filter(function (u) {
              return /__plex\/actions\/removeFromContinueWatching/.test(u);
            });
            if (hid.length !== 1) {
              throw new Error('the hide went: ' + (wrote.join(', ') || 'nowhere'));
            }
            /* Hiding leaves watch state alone, so nothing may have been
               scrobbled on the way. */
            const marked = wrote.filter(function (u) { return /scrobble/.test(u); });
            if (marked.length) throw new Error('it scrobbled as well: ' + marked.join(', '));
          })
          .then(deckRow)
          .then(function (row) {
            if (row.entries.filter(function (e) { return e.title === film.title; }).length) {
              throw new Error(film.title + ' is still in the row');
            }
          })
          /* The cached rows carry Continue watching too, in every section, so
             they have to go or a reload paints it straight back. */
          .then(function () { return Promise.all([cachedRows('Movies'), cachedRows('TV Shows')]); })
          .then(function (cached) {
            const kept = cached.filter(Boolean);
            if (kept.length) {
              throw new Error(kept.length + ' section(s) still have cached rows after a removal');
            }
          })
          .then(reloadDeck)
          .then(function (row) {
            if (row.entries.filter(function (e) { return e.title === film.title; }).length) {
              throw new Error(film.title + ' came back after a reload');
            }
          });
      });
    })

    .then(function () {
      return step('a server that cannot hide says so, and cancelling keeps the entry',
        function () {
          let entry;
          const before = deckWrites.length;
          return backToLibrary()
            .then(function () { return sidebarPick('Continue watching'); })
            /* An episode, because marking one watched is the destructive case:
               it is the show that has to be scrobbled, and the confirmation
               says so before it happens. */
            .then(function () {
              return focusDeck(function (e) { return e.type === 'episode' && onBackup(e); });
            })
            .then(function (e) { entry = e; return press('F3'); })
            .then(function () { return page.keyboard.press('Enter'); })
            .then(function () { return press('F3'); })
            .then(function () { return waitForConfirm('for the Backup copy'); })
            .then(takeConfirm)
            /* Backup has no removeFromContinueWatching, so the app asks again —
               and says plainly that this one is not the same thing. */
            .then(function () { return waitForConfirm('offering to mark it watched'); })
            .then(function (box) {
              if (box.title !== 'Mark 1 watched') {
                throw new Error('the second confirmation says "' + box.title + '"');
              }
              if (!/cannot hide them/.test(box.note) ||
                  !/marks every episode/.test(box.note)) {
                throw new Error('the note does not say what marking watched costs: ' + box.note);
              }
              if (box.rows.join(' | ') !== 'Mark them watched | > Cancel') {
                throw new Error('the rows are: ' + box.rows.join(' | '));
              }
            })
            /* Cancel is selected, so OK cancels — and nothing is marked. */
            .then(function () { return page.keyboard.press('Enter'); })
            .then(function () { return page.waitForTimeout(200); })
            .then(function () {
              const marked = deckWrites.slice(before).filter(function (u) {
                return /scrobble/.test(u);
              });
              if (marked.length) throw new Error('cancelling scrobbled anyway: ' + marked.join(', '));
            })
            .then(function () { return press('Backspace'); })            // out of the mode
            .then(reloadDeck)
            .then(function (row) {
              if (!row.entries.filter(function (e) { return e.title === entry.title; }).length) {
                throw new Error(entry.title + ' left the row after a cancelled removal');
              }
            });
        });
    })

    .then(function () {
      return step('marking a part-watched series watched scrobbles the show, not the episode',
        function () {
          let entry;
          const before = deckWrites.length;
          return backToLibrary()
            .then(function () { return sidebarPick('Continue watching'); })
            .then(function () {
              return focusDeck(function (e) { return e.type === 'episode' && onBackup(e); });
            })
            .then(function (e) {
              entry = e;
              if (!e.showKey) throw new Error(e.title + ' carries no show to scrobble');
              return press('F3');
            })
            .then(function () { return page.keyboard.press('Enter'); })
            .then(function () { return press('F3'); })
            .then(function () { return waitForConfirm('to hide the episode'); })
            .then(takeConfirm)
            .then(function () { return waitForConfirm('to mark the series watched'); })
            .then(takeConfirm)
            .then(function () { return page.waitForTimeout(300); })
            .then(function () {
              const wrote = deckWrites.slice(before).filter(function (u) {
                return u.indexOf('/:/scrobble') >= 0;
              });
              /* The episode's own key would only advance the deck to the next
                 episode and leave the series exactly where it was — which is
                 the thing the user says they are stuck in. */
              const onShow = wrote.filter(function (u) {
                return u.indexOf('key=' + entry.showKey + '&') >= 0;
              });
              if (!onShow.length) {
                throw new Error('nothing was scrobbled against show ' + entry.showKey +
                                ': ' + (wrote.join(', ') || 'no scrobble at all'));
              }
              const onEpisode = wrote.filter(function (u) {
                return u.indexOf('key=' + entry.key + '&') >= 0;
              });
              if (onEpisode.length) {
                throw new Error('the episode was scrobbled instead of its show: ' +
                                onEpisode.join(', '));
              }
            })
            .then(reloadDeck)
            .then(function (row) {
              if (row.entries.filter(function (e) { return e.title === entry.title; }).length) {
                throw new Error(entry.title + ' is still part-watched after the show was marked');
              }
            });
        });
    })

    .then(function () {
      return step('an entry on both servers is cleared on each as that one allows', function () {
        let entry;
        const before = deckWrites.length;
        return backToLibrary()
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return focusDeck(onBoth); })
          .then(function (e) { entry = e; return press('F3'); })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () { return press('F3'); })
          .then(function () { return waitForConfirm('for the shared film'); })
          .then(takeConfirm)
          /* Main hides it; Backup cannot, so the whole entry falls to the
             second question rather than half-vanishing. */
          .then(function () { return waitForConfirm('after Backup refused to hide it'); })
          .then(takeConfirm)
          .then(function () { return page.waitForTimeout(300); })
          .then(function () {
            const wrote = deckWrites.slice(before);
            function went(path) {
              return wrote.some(function (u) { return u.indexOf(path) >= 0; });
            }
            if (!went('/__plex/actions/removeFromContinueWatching')) {
              throw new Error('Main was never asked to hide it: ' + wrote.join(', '));
            }
            if (!went('/__plex2/:/scrobble')) {
              throw new Error('Backup was never marked watched: ' + wrote.join(', '));
            }
            /* Main had already hidden its copy, so it must not then be
               scrobbled: the fallback is for the copy that was refused, not for
               every copy of the entry. Hiding leaves watch state alone and that
               is the whole point of preferring it. */
            if (went('/__plex/:/scrobble')) {
              throw new Error('Main was scrobbled after it had already hidden it: ' +
                              wrote.join(', '));
            }
          })
          .then(reloadDeck)
          .then(function (row) {
            if (row.entries.filter(function (e) { return e.title === entry.title; }).length) {
              throw new Error(entry.title + ' survived on one of the two servers');
            }
          });
      });
    })

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
