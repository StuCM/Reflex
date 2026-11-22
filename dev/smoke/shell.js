'use strict';
/* the v2 background and the tuning panel */
module.exports = function (h) {
  const { press, waitFor, step, page, tilePosters, backdrops } = h;

  const hudText = () => page.evaluate('document.getElementById("hud").textContent');
  const glowX = () => page.evaluate('document.getElementById("g1").style.getPropertyValue("--gx")');
  const stripMs = () =>
    page.evaluate('getComputedStyle(document.querySelector("#rows .strip")).transitionDuration');
  const noise = () => page.evaluate('document.documentElement.style.getPropertyValue("--noise")');
  const assertEqual = (got, want, what) => {
    if (got !== want) throw new Error(what + ': got ' + JSON.stringify(got) + ', wanted ' + want);
  };

  return h
    .ready()

    .then(function () {
      return step('the background has three glows and a noise layer', function () {
        return page
          .evaluate(
            '({ glows: document.querySelectorAll("#bg .glow").length,' +
              ' noise: getComputedStyle(document.getElementById("bg"), "::after").backgroundImage,' +
              ' shown: getComputedStyle(document.getElementById("bg")).display })',
          )
          .then(function (bg) {
            assertEqual(bg.glows, 3, 'glows');
            assertEqual(/noise\.png/.test(bg.noise), true, 'noise layer ' + bg.noise);
            assertEqual(bg.shown, 'block', 'background display');
          });
      });
    })

    .then(function () {
      return step('Space Grotesk 700 is loaded', function () {
        return page
          .evaluate(
            'document.fonts.load("700 20px \\"Space Grotesk\\"").then(function (faces) {' +
              ' return faces.length > 0 && document.fonts.check("700 20px \\"Space Grotesk\\""); })',
          )
          .then(function (loaded) {
            assertEqual(loaded, true, 'document.fonts.check');
          });
      });
    })

    .then(function () {
      return step('with the panel hidden, number keys change nothing', function () {
        return noise()
          .then(function (before) {
            return press('7').then(function () {
              return noise().then(function (after) {
                assertEqual(after, before, '--noise');
                assertEqual(before, '0.03', 'default --noise');
              });
            });
          })
          .then(function () {
            return page.evaluate('document.getElementById("hud").classList.contains("hidden")');
          })
          .then(function (hidden) {
            assertEqual(hidden, true, 'panel hidden');
          });
      });
    })

    .then(function () {
      return step('Blue shows the panel with live numbers', function () {
        return press('F6')
          .then(function () {
            return waitFor(
              '/fps [1-9]/.test(document.getElementById("hud").textContent)',
              'a non-zero fps',
              5000,
            );
          })
          .then(hudText)
          .then(function (text) {
            assertEqual(/1 hero 150/.test(text), true, 'hero default 150 ms in in ' + text);
          });
      });
    })

    .then(function () {
      return step('key 5 changes the real transition duration of a strip', function () {
        return stripMs()
          .then(function (ms) {
            assertEqual(ms, '0.36s', 'slow strip');
            return press('5');
          })
          .then(stripMs)
          .then(function (ms) {
            assertEqual(ms, '0.2s', 'fast strip');
            return press('5', 2);
          })
          .then(stripMs)
          .then(function (ms) {
            assertEqual(ms, '0.36s', 'slow again');
          });
      });
    })

    .then(function () {
      const offsets = () =>
        page.evaluate(
          '["g1","g2","g3"].map(function (id) { var st = document.getElementById(id).style;' +
            ' return st.getPropertyValue("--gx") + "," + st.getPropertyValue("--gy"); }).join(" ")',
        );
      return step('one page moves each glow by its own offset', async function () {
        await press('ArrowUp');
        await press('ArrowRight');
        assertEqual(
          await offsets(),
          '-260px,70px 220px,-90px -160px,110px',
          'offsets after one page',
        );
        await press('ArrowLeft');
        assertEqual(await offsets(), '0px,0px 0px,0px 0px,0px', 'offsets back on Home');
        await press('Escape');
        await page.waitForTimeout(500);
      });
    })

    .then(function () {
      const menuLabels = 'document.querySelectorAll("#rows .tile:not(.hidden)").length > 0';
      const visit = async (steps) => {
        const before = tilePosters.length;
        await press('ArrowUp');
        await press('ArrowRight', steps);
        await waitFor(menuLabels, 'tiles on the new page', 10000);
        await page.waitForTimeout(1500);
        await press('ArrowDown');
        await page.waitForTimeout(500);
        return tilePosters.slice(before).filter((u) => u.indexOf('/__tmdbimg/') >= 0);
      };
      return step('key 9 switches the poster size of tiles drawn after it', async function () {
        assertEqual(/9 poster w185/.test(await hudText()), true, 'readout ' + (await hudText()));
        await press('9');
        assertEqual(/9 poster w342/.test(await hudText()), true, 'readout ' + (await hudText()));
        const large = await visit(2);
        assertEqual(large.length > 0, true, 'posters asked for at w342');
        assertEqual(
          large.every((u) => u.indexOf('/w342/') >= 0),
          true,
          'every new poster is w342: ' + large[0],
        );
        await press('9');
        assertEqual(/9 poster w185/.test(await hudText()), true, 'readout ' + (await hudText()));
        const small = await visit(1);
        assertEqual(small.length > 0, true, 'TMDB posters asked for at w185');
        assertEqual(
          small.every((u) => u.indexOf('/w185/') >= 0),
          true,
          'every new poster is w185: ' + small[0],
        );
        await press('ArrowUp');
        await press('ArrowLeft', 3);
        await press('Escape');
        await page.waitForTimeout(600);
      });
    })

    .then(function () {
      const g1x = () =>
        page.evaluate(
          'new DOMMatrix(getComputedStyle(document.getElementById("g1")).transform).m41',
        );
      return step('with drift on, moving along a row moves the first glow', async function () {
        await press('3');
        assertEqual(
          await page.evaluate('document.body.classList.contains("drift")'),
          true,
          'drift class',
        );
        await page.waitForTimeout(1200);
        const before = await g1x();
        await press('ArrowRight');
        await page.waitForTimeout(1200);
        assertEqual(before - (await g1x()), 22, 'g1 x moved by 22px for one tile');
        await press('ArrowLeft');
        await press('3', 2);
        assertEqual(
          await page.evaluate('document.body.classList.contains("drift")'),
          false,
          'drift class cleared',
        );
      });
    })

    .then(function () {
      const settling = 'document.getElementById("rows").classList.contains("no-anim")';
      return step('a held arrow skips animation and a single press does not', function () {
        return press('ArrowRight')
          .then(function () {
            return page.waitForTimeout(250);
          })
          .then(function () {
            return page.evaluate(settling);
          })
          .then(function (single) {
            assertEqual(single, false, 'no-anim after a single press');
            return page.keyboard.down('ArrowLeft');
          })
          .then(function () {
            return page.keyboard.down('ArrowLeft');
          })
          .then(function () {
            return page.evaluate(settling);
          })
          .then(function (held) {
            assertEqual(held, true, 'no-anim while held');
            return page.keyboard.up('ArrowLeft');
          })
          .then(function () {
            return waitFor(settling + ' === false', 'the animation to come back', 2000);
          });
      });
    })

    .then(function () {
      const hasHero = () =>
        page.evaluate('document.getElementById("bg").classList.contains("hero-on")');
      return step(
        'hero shows glows away; key 1 off brings them back with no backdrop',
        async function () {
          await press('ArrowRight');
          await waitFor(
            'document.getElementById("bg").classList.contains("hero-on")',
            'the hero to show',
            5000,
          );
          await waitFor(
            'getComputedStyle(document.getElementById("g1")).opacity === "0"',
            'the glows to hide',
            5000,
          );
          await press('1', 3);
          assertEqual(/1 hero off/.test(await hudText()), true, 'readout ' + (await hudText()));
          await press('ArrowRight');
          await waitFor(
            'getComputedStyle(document.getElementById("g1")).opacity === "1"',
            'the glows to return',
            5000,
          );
          assertEqual(await hasHero(), false, 'hero-on with the hero off');
          const before = backdrops.length;
          await press('ArrowRight', 2);
          await page.waitForTimeout(1000);
          assertEqual(backdrops.length, before, 'backdrops asked for with the hero off');
          await press('1', 2);
          assertEqual(/1 hero 150/.test(await hudText()), true, 'readout ' + (await hudText()));
          await press('ArrowRight');
          await waitFor(
            'document.getElementById("bg").classList.contains("hero-on")',
            'the hero to come back',
            5000,
          );
          assertEqual(backdrops.length > before, true, 'backdrop asked for again with the hero on');
        },
      );
    })

    .then(function () {
      return step('a setting survives a reload', function () {
        return press('7')
          .then(function () {
            return page.reload();
          })
          .then(h.ready)
          .then(noise)
          .then(function (n) {
            assertEqual(n, '0.05', '--noise after reload');
            return press('F6');
          })
          .then(function () {
            return press('7', 3);
          })
          .then(noise)
          .then(function (n) {
            assertEqual(n, '0.03', '--noise restored');
            return press('F6');
          });
      });
    })

    .then(function () {
      const menuOpen = () =>
        page.evaluate('document.getElementById("browse").classList.contains("menu")');
      const LABELS =
        'Array.prototype.map.call(document.querySelectorAll("#rows .row-label"), function (t) {' +
        ' return t.textContent.trim(); }).join("|")';
      return step(
        'Up opens the top menu; arrows change page and Down closes it',
        async function () {
          await press('ArrowUp');
          assertEqual(await menuOpen(), true, 'menu open after Up from row 0');
          const tiles = await page.evaluate(
            'Array.prototype.map.call(document.querySelectorAll("#menubar .mb-tile"), function (t) {' +
              ' return t.textContent; }).join("|")',
          );
          assertEqual(tiles, 'Home|Movies|TV|Kids|Collections|Discover|More', 'menu tiles');
          const movies = await page.evaluate(LABELS);
          assertEqual(movies.length > 0, true, 'Movies row labels are drawn');

          await press('ArrowRight', 2);
          await waitFor(
            '(' + LABELS + ') !== ' + JSON.stringify(movies),
            'the TV rows to replace the Movies rows',
            10000,
          );
          assertEqual(await glowX(), '-520px', 'g1 --gx on the third page');

          await press('ArrowDown');
          await page.waitForTimeout(500);
          assertEqual(await menuOpen(), false, 'menu closed after Down');
          assertEqual(
            await page.evaluate('document.getElementById("browse").classList.contains("dense")'),
            false,
            'focus is back on row 0',
          );
        },
      );
    })

    .then(function () {
      const menuOpen = () =>
        page.evaluate('document.getElementById("browse").classList.contains("menu")');
      const sidebarText = () =>
        page.evaluate(
          'Array.prototype.map.call(document.querySelectorAll("#sidebar .sb-row"), function (r) {' +
            ' return (r.classList.contains("cur") ? "* " : "") + r.textContent.trim(); }).join("|")',
        );
      return step('Kids loads from the menu, and More opens the sidebar', async function () {
        await press('ArrowUp');
        await press('ArrowRight');
        await press('Escape');
        assertEqual(await menuOpen(), false, 'Back closes the menu');
        await waitFor(
          'document.querySelectorAll("#rows .tile:not(.hidden)").length > 0',
          'Kids tiles',
          15000,
        );
        assertEqual(await glowX(), '-780px', 'g1 --gx on the Kids page');
        await h.openSidebar();
        const rows = await sidebarText();
        assertEqual(/(^|\|)\* Kids(\||$)/.test(rows), true, 'Kids is current in ' + rows);
        await h.sidebarPick('Movies');
        await waitFor(
          'document.querySelectorAll("#rows .tile:not(.hidden)").length > 0',
          'Movies back from the sidebar',
          10000,
        );
        await h.openSidebar();
        const after = await sidebarText();
        assertEqual(
          /\* Movies/.test(after) && !/\* Kids/.test(after),
          true,
          'Movies is current in ' + after,
        );
        await press('ArrowLeft');
      });
    })

    .then(function () {
      const OBSERVE =
        'window.__w = { root: 0, bg: 0 };' +
        'var watch = function (el, key) { new MutationObserver(function (m) { window.__w[key] += m.length; })' +
        '.observe(el, { attributes: true, attributeFilter: ["style"] }); };' +
        'watch(document.documentElement, "root"); watch(document.getElementById("bg"), "bg");';
      const writes = () => page.evaluate('window.__w');
      const cls = (id) => 'document.getElementById("' + id + '").classList.contains("no-anim")';
      const drifting = () => page.evaluate('document.body.classList.contains("drift")');
      const driftTo = async (want) => {
        if ((await drifting()) !== want) await press('3');
        if ((await drifting()) !== want) await press('3');
      };
      return step('a pan writes no style on the root; drift writes go to #bg', async function () {
        await press('F6');
        await driftTo(true);
        await page.evaluate(OBSERVE);
        await press('ArrowRight', 10);
        await page.waitForTimeout(300);
        let w = await writes();
        assertEqual(w.root, 0, 'root style writes during a pan');
        assertEqual(w.bg > 0, true, 'bg style writes with drift on (control)');

        await driftTo(false);
        await page.evaluate(OBSERVE);
        await press('ArrowLeft', 10);
        await page.waitForTimeout(300);
        w = await writes();
        assertEqual(w.bg, 0, 'bg style writes with drift off');
        await press('F6');

        await page.keyboard.down('ArrowRight');
        await page.keyboard.down('ArrowRight');
        assertEqual(await page.evaluate(cls('rows')), true, 'no-anim on #rows while held');
        assertEqual(await page.evaluate(cls('browse')), false, 'no-anim never on #browse');
        await page.keyboard.up('ArrowRight');
        await waitFor(cls('rows') + ' === false', 'no-anim to clear', 2000);
      });
    })

    .then(function () {
      const rects = () =>
        page.evaluate(
          '(function () { var t = document.querySelector("#rows .tile.on");' +
            ' var p = t.querySelector(".tile-inner").getBoundingClientRect();' +
            ' var l = t.querySelector(".tile-title").getBoundingClientRect();' +
            ' var r = document.getElementById("ring");' +
            ' var rr = r.getBoundingClientRect(), tt = t.getBoundingClientRect();' +
            ' return { poster: p.bottom, label: l.top, ringOpacity: getComputedStyle(r).opacity,' +
            ' ringLeft: rr.left, tileLeft: tt.left }; })()',
        );
      const focusClass = () =>
        page.evaluate('document.getElementById("rows").className.replace(/\\s+/g, " ")');
      return step('key 8 cycles the focus style; the label clears the poster', async function () {
        await press('F6');
        await page.waitForTimeout(500);
        let r = await rects();
        assertEqual(r.label >= r.poster, true, 'label below poster in scale mode');
        assertEqual(r.ringOpacity, '0', 'ring hidden in scale mode');

        await press('8');
        await page.waitForTimeout(500);
        assertEqual(/f-ring/.test(await focusClass()), true, 'f-ring after one press');
        r = await rects();
        assertEqual(r.ringOpacity, '1', 'ring shown in ring mode');
        assertEqual(Math.abs(r.ringLeft - r.tileLeft) < 6, true, 'ring over the focused tile');
        await press('ArrowRight');
        await page.waitForTimeout(500);
        r = await rects();
        assertEqual(Math.abs(r.ringLeft - r.tileLeft) < 6, true, 'ring follows the focus');
        assertEqual(r.label >= r.poster, true, 'label below poster in ring mode');

        await press('8');
        await page.waitForTimeout(500);
        assertEqual(/f-both/.test(await focusClass()), true, 'f-both after two presses');
        r = await rects();
        assertEqual(r.label >= r.poster, true, 'label below poster in both mode');
        await press('8');
        assertEqual(/f-ring|f-both/.test(await focusClass()), false, 'back to scale');
        await press('F6');
      });
    })

    .then(function () {
      return step(
        'a press writes position only where it changed; the hero fades once per change',
        async function () {
          await page.waitForTimeout(800);
          await page.evaluate(
            'window.__writes = 0; window.__fades = 0;' +
              ' var set = CSSStyleDeclaration.prototype.setProperty;' +
              ' CSSStyleDeclaration.prototype.setProperty = function (name) {' +
              '   if (name === "--tx" || name === "--ty") window.__writes++;' +
              '   return set.apply(this, arguments); };' +
              ' new MutationObserver(function (m) { window.__fades += m.length; })' +
              '.observe(document.getElementById("masthead"), { attributes: true, attributeFilter: ["class"] });',
          );
          const writes = () => page.evaluate('window.__writes');
          const fades = () => page.evaluate('window.__fades');

          await press('ArrowRight');
          await page.waitForTimeout(400);
          const one = await writes();
          assertEqual(one > 0, true, 'a press writes some position (control), got ' + one);
          assertEqual(one <= 8, true, 'one press wrote ' + one + ' positions, wanted at most 8');

          const before = await writes();
          await press('ArrowRight', 10);
          await page.waitForTimeout(400);
          const perPress = ((await writes()) - before) / 10;
          assertEqual(perPress <= 8, true, 'held arrow wrote ' + perPress + ' positions per press');

          await press('ArrowLeft', 60);
          await page.waitForTimeout(600);
          await page.evaluate('window.__fades = 0');
          await press('ArrowRight');
          await page.waitForTimeout(300);
          assertEqual(await fades(), 2, 'a new title restarts the fade once (remove + add)');

          await press('ArrowLeft', 60);
          await page.waitForTimeout(600);
          await page.evaluate('window.__fades = 0');
          await press('ArrowLeft', 5);
          await page.waitForTimeout(300);
          assertEqual(await fades(), 0, 'five presses on the same title restart no fade');
        },
      );
    })

    .then(function () {
      return step(
        'a profile saved before off existed keeps its hero delay and poster default',
        async function () {
          await page.evaluate(
            'localStorage.setItem("reflex.tuning", JSON.stringify({ hero: 2, poster: 0, noise: 2 }))',
          );
          await page.reload();
          await h.ready();
          await press('F6');
          const text = await hudText();
          assertEqual(/1 hero 280/.test(text), true, 'legacy hero 2 (280) in ' + text);
          assertEqual(
            /9 poster w185/.test(text),
            true,
            'legacy poster 0 is not a choice in ' + text,
          );
          assertEqual(/7 noise 0.05/.test(text), true, 'legacy noise kept in ' + text);
          await page.evaluate('localStorage.removeItem("reflex.tuning")');
          await press('F6');
        },
      );
    })

    .then(function () {
      const calls = (query) =>
        page.evaluate(function (q) {
          return fetch('/__plextv/hub-calls?' + q).then((r) => r.json());
        }, query);
      const LABELS =
        'Array.prototype.map.call(document.querySelectorAll("#rows .row:not(.hidden) .row-label"), function (t) {' +
        ' return t.textContent.trim(); }).join("|")';
      const KEY = (code) =>
        'document.dispatchEvent(new KeyboardEvent("keydown", { keyCode: ' + code + ' }));';
      /* Left or Right on the menu, then Enter: the page loads in the same task. */
      const GO = (code) =>
        '(function(){' +
        KEY(code) +
        KEY(13) +
        'return { labels: ' +
        LABELS +
        ', tiles: document.querySelectorAll("#rows .tile:not(.hidden):not(.placeholder)").length,' +
        ' title: document.getElementById("mh-title").textContent };})()';
      const HUBS = /\/hubs\/(sections\/\w+|promoted)/;
      const settle = async (what) => {
        await waitFor('(' + LABELS + ').split("|").length > 2', what, 15000);
        await page.waitForTimeout(1500);
      };

      return step(
        'a page seen two minutes ago returns at once with no request; a stale one refreshes only what changed',
        async function () {
          await calls('reset=1');
          await page.reload();
          await h.ready();
          await settle('Movies rows');
          const first = (await calls('')).length;
          assertEqual(first > 0, true, 'the first visit asks the servers (' + first + ')');

          await press('ArrowUp');
          await press('ArrowRight', 2);
          await waitFor(
            '(' + LABELS + ') !== ' + JSON.stringify(await page.evaluate(LABELS)),
            'TV',
            10000,
          );
          await settle('TV rows');
          const tv = await page.evaluate(LABELS);
          await press('ArrowLeft');
          await settle('Movies back');
          await press('ArrowRight');
          await settle('TV again');
          await calls('reset=1');

          const back = await page.evaluate(GO(37));
          assertEqual(
            back.labels !== tv && back.labels.split('|').length > 2,
            true,
            'rows in the first frame: ' + back.labels,
          );
          assertEqual(back.tiles > 0, true, 'posters drawn in the first frame');
          assertEqual(/Loading/.test(back.title), false, 'no Loading in the first frame');
          await page.waitForTimeout(1500);
          assertEqual(
            (await calls('')).length,
            0,
            'a page returned to within two minutes asks nothing',
          );
        },
      )
        .then(function () {
          return step(
            'past the window the old rows show at once and only a changed row redraws',
            async function () {
              await page.evaluate(h.AGE_PAGES);
              let drop = false;
              await page.route(HUBS, async (route) => {
                const response = await route.fetch();
                const body = await response.json();
                if (drop) {
                  ((body.MediaContainer || {}).Hub || []).forEach((hub) => {
                    if (hub.title === 'Top Rated') hub.Metadata = hub.Metadata.slice(1);
                  });
                }
                await route.fulfill({ response, json: body });
              });
              await page.evaluate(
                'window.__writes = {};' +
                  'new MutationObserver(function (list) { list.forEach(function (m) {' +
                  ' if (m.type === "attributes" && m.oldValue === m.target.getAttribute(m.attributeName)) return;' +
                  ' var row = (m.target.closest ? m.target : m.target.parentNode).closest(".row"); if (!row) return;' +
                  ' var label = row.querySelector(".row-label").textContent.trim();' +
                  ' window.__writes[label] = (window.__writes[label] || 0) + 1; }); })' +
                  '.observe(document.getElementById("rows"), { attributes: true, attributeOldValue: true, childList: true, characterData: true, subtree: true });',
              );
              await calls('reset=1');
              await page.evaluate('fetch("/__plextv/slow-hubs?ms=1500")');
              drop = true;
              await press('ArrowUp');
              const old = await page.evaluate(GO(39));
              assertEqual(
                old.labels.split('|').length > 2 && old.tiles > 0,
                true,
                'the old rows at once: ' + old.labels,
              );
              await page.waitForTimeout(600);
              await page.evaluate('window.__writes = {}');
              await page.waitForTimeout(3000);
              await page.evaluate('fetch("/__plextv/slow-hubs?ms=0")');
              assertEqual(
                (await calls('')).length > 0,
                true,
                'a stale page asks the servers again',
              );
              const writes = await page.evaluate('window.__writes');
              assertEqual(
                (writes['Top Rated'] || 0) > 0,
                true,
                'the changed row redraws: ' + JSON.stringify(writes),
              );
              const quiet = Object.keys(writes).filter(
                (label) =>
                  label !== 'Top Rated' &&
                  label !== 'Continue watching' &&
                  label.indexOf('All') !== 0,
              );
              assertEqual(quiet.length, 0, 'unchanged rows redraw: ' + JSON.stringify(writes));
              await page.unroute(HUBS);
              await page.evaluate('Date.now = window.__realNow; window.__skew = 0');
            },
          );
        })
        .then(function () {
          return step(
            'a cold page draws placeholder tiles with its name, then its rows',
            async function () {
              await page.evaluate(function () {
                return new Promise(function (done) {
                  const request = indexedDB.deleteDatabase('reflex');
                  request.onsuccess = request.onerror = request.onblocked = done;
                });
              });
              await page.evaluate('fetch("/__plextv/slow-hubs?ms=2500")');
              await page.reload();
              await waitFor(
                'document.querySelectorAll("#rows .tile.placeholder:not(.hidden)").length > 0',
                'placeholder tiles',
                10000,
              );
              const title = await page.evaluate('document.getElementById("mh-title").textContent');
              assertEqual(
                title.length > 0 && !/Loading/.test(title),
                true,
                'the page name in the hero: ' + title,
              );
              await waitFor(
                'document.querySelectorAll("#rows .tile:not(.hidden):not(.placeholder)").length > 0 && (' +
                  LABELS +
                  ').split("|").length > 2',
                'rows after the placeholders',
                15000,
              );
              assertEqual(
                await page.evaluate(
                  'document.querySelectorAll("#rows .tile.placeholder:not(.hidden)").length',
                ),
                0,
                'placeholders gone',
              );
              await page.evaluate('fetch("/__plextv/slow-hubs?ms=0")');
            },
          );
        });
    });
};
