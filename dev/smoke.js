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

  return {
    truehdOnly: only('hevc-truehd'),     // must be refused before any request
    transcodes: only('vc1-avi'),         // server says transcode, we refuse
    directPlays: only('h264-eac3'),      // plays
    shared: shared                       // on both servers, only one copy playable
  };
}

/* The two paths the mock serves the video from, both of which 404 when there is
   no fixture. See the console handler in drive(). */
const NO_FIXTURE_404 = /library\/parts|transcode\/universal\/start/;

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
  page.on('console', function (m) {
    const text = m.text();
    if (text.indexOf('REFLEX ') === 0) { trace.push(text.slice(7)); return; }
    /* Without a dev/fixtures/sample.* every route that serves the video 404s on
       purpose — the original file at /library/parts/, and the converted stream
       at /video/:/transcode/universal/start. Both are the same missing fixture,
       so both have to be excused, or a fresh clone fails this step with a 404
       that reads like a broken transcode path. */
    const where = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !NO_FIXTURE_404.test(where)) {
      errors.push('console: ' + text + ' ' + where);
    }
  });
  function tracedThat(re) { return trace.some(function (l) { return re.test(l); }); }
  /* Nothing may leave this machine in mock mode. The whole point of the mock is
     that developing the app never touches the server we do not own. */
  page.on('request', function (r) {
    const u = r.url();
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
  function chipTexts() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#sections .chip'),
        function (c) { return c.textContent.trim(); });
    });
  }
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

     Same idea as pressChip: find the row by what it says rather than by an
     index, walk the selection to it and press OK. The menu is what audio,
     subtitles and quality are chosen from without leaving playback. */

  /* The label, plus the note beside it — the note is where a row says what
     choosing it will cost, so a check that cannot see it is not checking. */
  function menuLabels() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#menu .menu-row'),
        function (r) {
          const note = r.querySelector('.menu-note-inline');
          return (r.classList.contains('on') ? '* ' : '') +
                 r.querySelector('.menu-label').textContent.trim() +
                 (note ? '  [' + note.textContent.trim() + ']' : '');
        });
    });
  }

  function menuTabs() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#menu .menu-tab'),
        function (t) { return t.textContent.trim() + (t.classList.contains('on') ? '*' : ''); });
    });
  }

  function menuChoose(re) {
    return page.evaluate(function (src) {
      const rows = document.querySelectorAll('#menu .menu-row');
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

  /* The menu opens on Audio; the tabs are reached with left and right, which is
     all the remote is guaranteed to have. */
  function openMenu(tabIndex) {
    return press('ArrowUp')
      .then(function () {
        return waitFor('!document.getElementById("menu").classList.contains("hidden")',
                       'the player menu');
      })
      .then(function () { return press('ArrowRight', tabIndex || 0); });
  }

  /* Walk the chip focus to a named chip and press OK on it, rather than
     assuming an index — the chip row grows as the app does. */
  function pressChip(label) {
    return press('ArrowUp', 8)
      .then(function () {
        return waitFor('document.querySelector("#sections .chip.on") !== null', 'chip focus');
      })
      .then(function () {
        return page.evaluate(function (want) {
          const chips = document.querySelectorAll('#sections .chip');
          let on = -1, to = -1;
          for (let i = 0; i < chips.length; i++) {
            if (chips[i].classList.contains('on')) on = i;
            if (chips[i].textContent.trim() === want) to = i;
          }
          return [on, to];
        }, label);
      })
      .then(function (idx) {
        if (idx[1] < 0) throw new Error('no "' + label + '" chip');
        return press(idx[1] > idx[0] ? 'ArrowRight' : 'ArrowLeft', Math.abs(idx[1] - idx[0]));
      })
      .then(function () { return page.keyboard.press('Enter'); });
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
          results: document.querySelector('#sections').textContent.indexOf('back to library') >= 0
        };
      }).then(function (st) {
        if (st.browse && !st.results) return true;
        if (n <= 0) throw new Error('could not get back to the library rows');
        return press('Backspace').then(function () { return attempt(n - 1); });
      });
    }
    return attempt(5);
  }

  /* Search for an exact title, focus the only result, and open its page. OK on
     the rail no longer plays — it opens the detail page, and playing is a
     decision made there against a named copy. */
  function openTitle(title) {
    return backToLibrary()
      .then(function () { return pressChip('Films'); })
      .then(function () { return press('F1'); })
      .then(function () { return page.waitForSelector('#search-input', { state: 'visible' }); })
      .then(function () { return page.fill('#search-input', title); })
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () {
        /* Wait for *this* title, not merely a non-empty masthead — the previous
           film's title is still on screen and would satisfy a looser check. */
        return waitFor('document.querySelector("#mh-title").textContent.trim() === ' +
                       JSON.stringify(title), 'the search result for ' + title);
      })
      .then(function () {
        /* And the audio badge has to have resolved before OK means anything —
           that is the whole promise of the masthead. */
        return waitFor('/AUDIO |NO PASSABLE/.test(document.querySelector("#mh-badges").textContent)',
                       'the audio badge');
      })
      .then(function () { return page.keyboard.press('Enter'); })
      .then(function () {
        return waitFor('!document.getElementById("detail").classList.contains("hidden") &&' +
                       ' document.getElementById("dt-title").textContent.trim() === ' +
                       JSON.stringify(title), 'the detail page for ' + title);
      })
      /* Every copy is checked as the page opens; nothing can be chosen
         meaningfully until at least the selected one has a verdict. */
      .then(function () {
        return waitFor('(function(){var s=document.querySelector(".dt-source.on");' +
                       'return s && !/checking/.test(s.textContent);})()',
                       'a verdict on the selected copy', 15000);
      });
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
          .then(function () { return page.textContent('#sections'); })
          .then(function (chips) {
            if (chips.indexOf('Films') < 0) throw new Error('no Films chip');
            if (chips.indexOf('TV Shows') < 0) throw new Error('no TV Shows chip');
          });
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
      return step('masthead follows the focused tile', function () {
        let first;
        return page.textContent('#mh-title')
          .then(function (t) { first = t; return press('ArrowRight', 3); })
          .then(function () { return page.textContent('#mh-title'); })
          .then(function (t) {
            if (t === first) throw new Error('title did not change after three rights');
          })
          .then(function () {
            return waitFor('/AUDIO |NO PASSABLE/.test(document.querySelector("#mh-badges").textContent)',
                           'the audio badge to resolve');
          })
          .then(function () { return shot('browse'); });
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
      return step('kids rows exclude everything above the cutoff', function () {
        return pressChip('kids')
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
          .then(function () { return pressChip('TV Shows'); })
          .then(function () {
            /* The All shows row is below the visible pool, so wait on the chip
               and on the rows having been rebuilt. */
            return waitFor('(function(){var c=document.querySelectorAll("#sections .chip");' +
                           'for (var i=0;i<c.length;i++) {' +
                           ' if (c[i].textContent.trim()==="TV Shows" &&' +
                           '     c[i].classList.contains("cur")) return true; }' +
                           'return false;})()', 'the shows section', 20000);
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
      return step('an episode opens the same copy chooser a film does', function () {
        return page.evaluate(function () {
          /* Make sure we are back on the episode list before pressing right. */
          return !!document.querySelector('.sh-episode');
        }).then(function () { return press('ArrowDown'); })
          .then(function () { return page.keyboard.press('ArrowRight'); })
          .then(function () {
            return waitFor('!document.getElementById("detail").classList.contains("hidden") &&' +
                           ' document.querySelectorAll(".dt-source").length > 0',
                           'the copy chooser for an episode', 20000);
          })
          .then(function () {
            return page.textContent('#dt-meta');
          })
          .then(function (meta) {
            /* An episode has to say which show and which number it is. */
            if (!/S\d+E\d+/.test(meta)) {
              throw new Error('no season/episode in the detail meta: ' + meta);
            }
          })
          .then(function () { return shot('episode-copies'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('discovery says what it needs rather than failing quietly', function () {
        /* No TMDB key in the harness, so this is the path a first run takes.
           It has to name the setting, not just refuse. */
        return backToLibrary()
          .then(function () { return pressChip('discover'); })
          .then(function () {
            return waitFor('!document.getElementById("message").classList.contains("hidden") &&' +
                           ' /TMDB/.test(document.getElementById("message-title").textContent) &&' +
                           ' /config\\.js/.test(document.getElementById("message-body").textContent)',
                           'the TMDB key message');
          })
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
            return waitFor('(function(){var c=document.querySelectorAll("#sections .chip");' +
                           'return c.length === 3 && c[1].textContent === "1 film";})()',
                           'the results header');
          })
          .then(function () { return chipTexts(); })
          .then(function (chips) {
            if (chips[0] !== titles.directPlays.title) {
              throw new Error('header names "' + chips[0] + '"');
            }
            if (chips[2] !== 'back to library') throw new Error('no way back: ' + chips.join(' / '));
          })
          .then(function () { return shot('search'); })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      return step('the device screen lists who has been watching', function () {
        return backToLibrary()
          .then(function () { return pressChip('devices'); })
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
            return waitFor('/transcode/.test(document.querySelector(".dt-source.on").textContent)',
                           'a transcode verdict on the selected copy', 15000);
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
          .then(chipTexts)
          .then(function () {
            /* One search result, not two — that is the whole point. */
            return page.evaluate(function () {
              const m = document.querySelector('#sections').textContent.match(/(\d+) films?/);
              return m ? Number(m[1]) : -1;
            });
          })
          .then(function (n) {
            if (n !== 1) throw new Error('the same film appeared ' + n + ' times');
          })
          .then(function () {
            /* Scoped to the copies: extras render the same row shape, in their
               own list, and counting those as copies makes this never settle. */
            return waitFor('(function(){var s=document.querySelectorAll("#dt-sources .dt-source");' +
                           'if (s.length !== 2) return false;' +
                           'return !/checking/.test(s[0].textContent) &&' +
                           ' !/checking/.test(s[1].textContent);})()',
                           'both copies checked', 15000);
          })
          .then(function () {
            return page.evaluate(function () {
              /* Copies only: extras render as .dt-source too, in their own list. */
              return Array.prototype.map.call(
                document.querySelectorAll('#dt-sources .dt-source'),
                function (s) {
                  return { on: s.classList.contains('on'),
                           text: s.textContent.replace(/\s+/g, ' ') };
                });
            });
          })
          .then(function (src) {
            /* The two copies must not read the same, and exactly one of them
               must be playable — that is the case this whole feature exists
               for: a 4K TrueHD remux on one server, a passable copy on the
               other. */
            const playable = src.filter(function (s) { return /direct play/.test(s.text); });
            const refused = src.filter(function (s) { return /4K, would transcode/.test(s.text); });
            if (playable.length !== 1 || refused.length !== 1) {
              throw new Error('expected one playable and one refused copy, got:\n        ' +
                              src.map(function (s) { return s.text; }).join('\n        '));
            }
            if (!/preferred/.test(src[0].text)) {
              throw new Error('the preferred server should be listed first');
            }
            if (!src[0].on) throw new Error('the preferred copy should be selected');
          })
          .then(function () { return shot('detail-shared'); });
      });
    })

    .then(function () {
      return step('switching copy changes what OK does', function () {
        /* Select the copy that cannot play and confirm the app refuses it,
           rather than quietly falling back to the one that can. */
        return press('ArrowDown')
          .then(function () {
            return page.evaluate(function () {
              const on = document.querySelector('.dt-source.on');
              return on ? on.textContent.replace(/\s+/g, ' ') : '';
            });
          })
          .then(function (text) {
            /* Read the verdict the page is showing rather than assuming which
               way this copy went — "4K, would transcode" is a refusal and
               "audio transcode" is not, and both contain the same word. Guard
               says yes to exactly these three and no to everything else, so
               listing the yeses is the formulation that cannot go stale. */
            const refusing = !/direct play|audio transcode|server transcodes/.test(text);
            return page.keyboard.press('Enter').then(function () {
              return waitFor('(function(){var m=document.getElementById("message");' +
                             'var v=document.getElementById("video");' +
                             'return ' + (refusing ? '!m.classList.contains("hidden")'
                                                   : '!v.classList.contains("hidden")') + ';})()',
                             refusing ? 'a refusal for the unplayable copy'
                                      : 'playback of the playable copy', 15000);
            });
          })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('extras are listed and are guarded like anything else', function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            return waitFor('(function(){var e=document.querySelectorAll("#dt-extras .dt-source");' +
                           'if (!e.length) return false;' +
                           'return !/checking/.test(e[0].textContent);})()',
                           'an extra with a verdict', 15000);
          })
          .then(function () {
            return page.evaluate(function () {
              return Array.prototype.map.call(
                document.querySelectorAll('#dt-extras .dt-source'),
                function (e) { return e.textContent.replace(/\s+/g, ' '); });
            });
          })
          .then(function (rows) {
            if (!/Trailer/i.test(rows.join(' '))) {
              throw new Error('no trailer listed: ' + rows.join(' | '));
            }
            /* A clip is an ordinary part on the same server, so it goes through
               the same guard — it must carry a verdict, not be assumed safe. */
            if (!/direct play|transcode|no passable/.test(rows[0])) {
              throw new Error('extra has no verdict: ' + rows[0]);
            }
          })
          .then(function () {
            /* Down past every copy of the film to reach the first extra. */
            return page.evaluate(function () {
              return document.querySelectorAll('#dt-sources .dt-source').length;
            });
          })
          .then(function (copies) { return press('ArrowDown', copies); })
          .then(function () {
            return waitFor('(function(){var on=document.querySelector(".dt-source.on");' +
                           'return on && on.parentNode.id === "dt-extras";})()',
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
      return step('the menu offers audio, subtitles, quality and chapters', function () {
        return openMenu(0)
          .then(menuTabs)
          .then(function (tabs) {
            if (tabs.join(',') !== 'Audio*,Subtitles,Quality,Chapters') {
              throw new Error('tabs are: ' + tabs.join(', '));
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
          .then(function () { return press('ArrowRight'); })          // subtitles
          .then(menuLabels)
          .then(function (labels) {
            if (!/Off/.test(labels[0])) throw new Error('subtitle rows: ' + labels.join(' | '));
            /* An image track is listed and refused by name — the only way to
               show it is to have the server burn it in, which is a transcode. */
            const image = labels.filter(function (l) { return /image/.test(l); });
            if (!image.length) throw new Error('the PGS track is not named as an image track');
          })
          .then(function () { return press('ArrowRight'); })          // quality
          .then(menuLabels)
          .then(function (labels) {
            if (!/Original/.test(labels[0])) throw new Error('quality rows: ' + labels.join(' | '));
            if (labels.length < 2) throw new Error('no bitrate caps offered');
          })
          .then(function () { return press('ArrowRight'); })          // chapters
          .then(menuLabels)
          .then(function (labels) {
            if (labels.length < 9) throw new Error('chapter rows: ' + labels.join(' | '));
          })
          .then(function () { return shot('player-menu'); })
          .then(function () { return press('Backspace'); })           // close the menu
          .then(function () {
            return waitFor('document.getElementById("menu").classList.contains("hidden")',
                           'the menu to close');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('subtitles are fetched as text and drawn over the video', function () {
        return openMenu(1)
          .then(function () { return menuChoose(/French/); })
          .then(function () {
            return waitFor('/français/.test(document.getElementById("subtitle").textContent)',
                           'the French subtitle track to be drawn over the video', 15000);
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
            return openMenu(0)
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
                return waitFor('/French/.test(document.getElementById("osd-tracks").textContent)',
                               'the OSD to name the new track', 10000);
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
        return openMenu(0)
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
        return waitFor('document.getElementById("osd-time").textContent.indexOf("0:00 /") !== 0',
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

    .then(function () {
      return step('no console errors and nothing left this machine', function () {
        if (errors.length) throw new Error(errors.slice(0, 4).join('\n        '));
        if (offSite.length) {
          throw new Error('requests escaped the mock: ' + offSite.slice(0, 3).join(', '));
        }
      });
    });
}

run();
