'use strict';
/* the v2 background and the tuning panel */
module.exports = function (h) {
  const { press, waitFor, step, page } = h;

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
                assertEqual(before, '0.05', 'default --noise');
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
            assertEqual(/1 hero 420/.test(text), true, 'toggle readout in ' + text);
          });
      });
    })

    .then(function () {
      return step('key 9 shifts the glows and cycles back', function () {
        return press('9')
          .then(glowX)
          .then(function (x) {
            assertEqual(x, '-260px', 'g1 --gx after one page');
            return press('9', 3);
          })
          .then(glowX)
          .then(function (x) {
            assertEqual(x, '0px', 'g1 --gx after four');
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
        await press('9');
        assertEqual(
          await offsets(),
          '-260px,70px 220px,-90px -160px,110px',
          'offsets after one page',
        );
        await press('9', 3);
        assertEqual(await offsets(), '0px,0px 0px,0px 0px,0px', 'offsets after four');
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
      return step('a setting survives a reload', function () {
        return press('7')
          .then(function () {
            return page.reload();
          })
          .then(h.ready)
          .then(noise)
          .then(function (n) {
            assertEqual(n, '0.08', '--noise after reload');
            return press('F6');
          })
          .then(function () {
            return press('7', 3);
          })
          .then(noise)
          .then(function (n) {
            assertEqual(n, '0.05', '--noise restored');
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
    });
};
