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
const FILMS = 300;
const UHD = 60;

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

/* Pick real titles out of the same generated library the server will serve, so
   the playback assertions land on known media profiles rather than on whatever
   happens to be first. */
function findTitles() {
  const lib = buildLibrary({ films: FILMS, uhd: UHD });
  const all = [];
  Object.keys(lib.items).forEach(function (k) { lib.items[k].forEach(function (m) { all.push(m); }); });
  /* Search is a substring match, so a title is only usable here if no other
     title contains it — otherwise "one result" is not a safe assertion. */
  function unique(profile) {
    const hit = all.filter(function (m) {
      if (m._profile !== profile) return false;
      return all.filter(function (o) { return o.title.indexOf(m.title) >= 0; }).length === 1;
    })[0];
    if (!hit) throw new Error('no unambiguous title with profile ' + profile);
    return hit;
  }
  return {
    truehdOnly: unique('hevc-truehd'),   // must be refused before any request
    transcodes: unique('vc1-avi'),       // server says transcode, we refuse
    directPlays: unique('h264-eac3')     // plays
  };
}

const results = [];
function ok(name) { results.push([true, name]); console.log('  ok    ' + name); }
function fail(name, err) {
  results.push([false, name]);
  console.log('  FAIL  ' + name + '\n        ' + (err && err.message ? err.message : err));
}

function run() {
  const titles = findTitles();
  const server = start({ port: PORT, films: FILMS, uhd: UHD, latency: 0,
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
  page.on('console', function (m) {
    /* Without a dev/fixtures/sample.* the stream 404s on purpose. */
    const where = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && where.indexOf('library/parts') < 0) {
      errors.push('console: ' + m.text() + ' ' + where);
    }
  });
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
  function press(key, times) {
    let p = Promise.resolve();
    for (let i = 0; i < (times || 1); i++) {
      p = p.then(function () { return page.keyboard.press(key); })
           .then(function () { return page.waitForTimeout(60); });
    }
    return p;
  }
  function waitFor(fn, what, ms) {
    return page.waitForFunction(fn, null, { timeout: ms || 10000, polling: 100 })
      .then(function () { return true; }, function () { throw new Error('timed out waiting for ' + what); });
  }
  function step(name, fn) {
    return Promise.resolve().then(fn).then(function () { ok(name); }, function (e) { fail(name, e); });
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
          browse: !document.getElementById('browse').classList.contains('hidden'),
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

  /* Search for an exact title and land on the only result. */
  function openTitle(title) {
    return backToLibrary()
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
      .then(function () { return page.keyboard.press('Enter'); });
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
            if (chips.indexOf('TV Shows') >= 0) throw new Error('show section should be filtered out');
            if (chips.indexOf('Films') < 0) throw new Error('no Films chip');
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
            return waitFor('/\\(' + FILMS + '\\)/.test(document.querySelector("#rows").textContent)',
                           'the All row count');
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
        return press('ArrowUp', 8)                      // up to the chips
          .then(function () {
            return waitFor('document.querySelector("#sections .chip.on") !== null', 'chip focus');
          })
          .then(function () {
            /* Walk right to the kids chip rather than assuming its index. */
            return page.evaluate(function () {
              const chips = document.querySelectorAll('#sections .chip');
              for (let i = 0; i < chips.length; i++) {
                if (chips[i].classList.contains('on')) return i;
              }
              return -1;
            });
          })
          .then(function (from) {
            return page.evaluate(function () {
              const chips = document.querySelectorAll('#sections .chip');
              for (let i = 0; i < chips.length; i++) {
                if (chips[i].textContent.trim() === 'kids') return i;
              }
              return -1;
            }).then(function (to) {
              if (to < 0) throw new Error('no kids chip');
              return press(to > from ? 'ArrowRight' : 'ArrowLeft', Math.abs(to - from));
            });
          })
          .then(function () { return page.keyboard.press('Enter'); })
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
          .then(function () { return press('ArrowUp', 6); })
          .then(function () {
            return page.evaluate(function () {
              const chips = document.querySelectorAll('#sections .chip');
              let on = -1, want = -1;
              for (let i = 0; i < chips.length; i++) {
                if (chips[i].classList.contains('on')) on = i;
                if (chips[i].textContent.trim() === 'devices') want = i;
              }
              return [on, want];
            });
          })
          .then(function (idx) {
            if (idx[1] < 0) throw new Error('no devices chip');
            return press(idx[1] > idx[0] ? 'ArrowRight' : 'ArrowLeft', Math.abs(idx[1] - idx[0]));
          })
          .then(function () { return page.keyboard.press('Enter'); })
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
      return step('refuses a TrueHD-only file without asking the server', function () {
        return openTitle(titles.truehdOnly.title)
          .then(function () {
            return waitFor(shown('No passable audio', titles.truehdOnly.title),
                           'the no-passable-audio refusal, naming ' + titles.truehdOnly.title);
          })
          .then(debugLine)
          .then(function (line) {
            if (/decision:/.test(line)) {
              throw new Error('a decision call was made for a file we already knew was unplayable');
            }
          })
          .then(function () { return shot('refuse-truehd'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('refuses what the server says it would transcode', function () {
        return openTitle(titles.transcodes.title)
          .then(function () {
            return waitFor(shown('transcode', titles.transcodes.title),
                           'the transcode refusal, naming ' + titles.transcodes.title);
          })
          .then(debugLine)
          .then(function (line) {
            if (line.indexOf('decision: transcode') < 0) {
              throw new Error('expected a transcode verdict, debug says: ' + line);
            }
          })
          .then(function () { return shot('refuse-transcode'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('plays a file that direct plays', function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            return waitFor('/decision: directplay/.test(document.querySelector("#debug").textContent)',
                           'a directplay verdict');
          })
          .then(function () {
            /* With no dev/fixtures/sample.* the panel error path is the correct
               outcome; with one, the video element takes over. Either proves the
               guard let it through. */
            return page.waitForTimeout(400);
          })
          .then(function () { return shot('play'); });
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
