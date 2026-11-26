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
      return step('the grid keeps a bounded pool and focus reaches item 300', async function () {
        const got = await page.evaluate(function () {
          const host = document.createElement('div');
          host.id = 'test-grid';
          document.body.appendChild(host);
          const items = [];
          for (let i = 0; i < 500; i++) items.push({ title: 'Film ' + i, absent: i === 300 });
          const g = window.Grid.grid(host, {
            columns: 7,
            tileW: 206,
            tileH: 309,
            gap: 40,
            rows: 2,
          });
          g.render(items, 0);
          const before = host.querySelectorAll('.gd-tile').length;
          g.render(items, 300);
          const on = host.querySelector('.gd-tile.on');
          const out = {
            before: before,
            after: host.querySelectorAll('.gd-tile').length,
            visible: host.querySelectorAll('.gd-tile:not(.hidden)').length,
            title: on && on.querySelector('.gd-title').textContent,
            absent: on && on.classList.contains('absent'),
            tag: on && getComputedStyle(on.querySelector('.gd-tag')).display,
          };
          host.parentNode.removeChild(host);
          return out;
        });
        assertEqual(got.before, 21, 'pool before');
        assertEqual(got.after, 21, 'pool after focusing 300');
        assertEqual(got.visible, 21, 'tiles carrying an item');
        assertEqual(got.title, 'Film 300', 'focused title');
        assertEqual(got.absent, true, 'absent class');
        assertEqual(got.tag, 'block', 'not-on-server tag shown');
      });
    })

    .then(function () {
      return step(
        'the legend lists its keys in order with their colour classes',
        async function () {
          const got = await page.evaluate(function () {
            const host = document.createElement('div');
            document.body.appendChild(host);
            window.Legend.legend(host, [
              { key: 'ok', label: 'Play' },
              { key: 'yellow', label: 'Add to list' },
              { key: 'red', label: 'Mark watched' },
              { key: 'blue', label: 'Trailer' },
            ]);
            const out = Array.prototype.map.call(
              host.querySelectorAll('.lg-item'),
              function (item) {
                return item.querySelector('.lg-dot').className + '=' + item.textContent;
              },
            );
            host.parentNode.removeChild(host);
            return out.join('|');
          });
          assertEqual(
            got,
            'lg-dot lg-ok=Play|lg-dot lg-yellow=Add to list|lg-dot lg-red=Mark watched|lg-dot lg-blue=Trailer',
            'legend',
          );
        },
      );
    })

    .then(function () {
      return step('tabs move the underline and report the index', async function () {
        const got = await page.evaluate(function () {
          const host = document.createElement('div');
          document.body.appendChild(host);
          const t = window.Tabs.tabs(host, ['Cast', 'Extras', 'More'], 0);
          const on = function () {
            return host.querySelector('.v2-tab.on').textContent;
          };
          const out = [on(), t.step(1), on(), t.step(1), t.step(1), t.step(-1), on()];
          host.parentNode.removeChild(host);
          return out.join('|');
        });
        assertEqual(got, 'Cast|1|Extras|2|2|1|Extras', 'tab walk');
      });
    })

    .then(function () {
      return step(
        'a menu wears the glass skin, shows the scrim and swallows keys',
        async function () {
          const got = await page.evaluate(function () {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const scrim = document.getElementById('glass-scrim');
            window.Menu.open({
              host: host,
              tabs: [
                {
                  label: 'A',
                  rows: function () {
                    return [{ label: 'one', value: 1 }];
                  },
                },
              ],
            });
            const open = {
              glass: host.classList.contains('glass'),
              image: getComputedStyle(host).backgroundImage,
              scrim: !scrim.classList.contains('hidden'),
              swallowed: window.Menu.key(65),
            };
            window.Menu.close();
            open.scrimAfter = scrim.classList.contains('hidden');
            host.parentNode.removeChild(host);
            return open;
          });
          assertEqual(got.glass, true, 'glass class');
          assertEqual(/gradient/.test(got.image), true, 'glass background ' + got.image);
          assertEqual(got.scrim, true, 'scrim shown');
          assertEqual(got.swallowed, true, 'key swallowed');
          assertEqual(got.scrimAfter, true, 'scrim hidden after close');
        },
      );
    })

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
      /* Combo.dc.html at rest: the tab bar and the clock, measured. */
      const RESTING = function () {
        const rect = (el) => el.getBoundingClientRect();
        const css = (el) => getComputedStyle(el);
        const tabs = Array.prototype.slice.call(document.querySelectorAll('#tab-list .tab'));
        const on = document.querySelector('#tab-list .tab.on');
        const off = document.querySelector('#tab-list .tab:not(.on)');
        const chevron = document.querySelector('#tabs svg');
        const clock = document.getElementById('clock');
        const now = new Date();
        const pad = (n) => (n < 10 ? '0' : '') + n;
        return {
          labels: tabs.map((t) => t.textContent).join('|'),
          on: on && on.textContent,
          ons: document.querySelectorAll('#tab-list .tab.on').length,
          tabsTop: rect(document.getElementById('tabs')).top,
          tabsOpacity: css(document.getElementById('tabs')).opacity,
          chevron: [
            rect(chevron).width,
            rect(chevron).height,
            rect(tabs[0]).top - rect(chevron).bottom,
          ],
          chevronStroke: [chevron.getAttribute('stroke'), chevron.getAttribute('stroke-width')],
          chevronPath: chevron.querySelector('path').getAttribute('d'),
          centre: Math.round((rect(tabs[0]).left + rect(tabs[tabs.length - 1]).right) / 2),
          gaps: tabs
            .slice(1)
            .map((t, i) => Math.round(rect(t).left - rect(tabs[i]).right))
            .join(','),
          font: [css(on).fontFamily, css(on).fontSize, css(on).fontWeight].join(' '),
          onColour: css(on).color,
          onLine: [
            css(on).borderBottomWidth,
            css(on).borderBottomStyle,
            css(on).borderBottomColor,
            css(on).paddingBottom,
          ].join(' '),
          offColour: css(off).color,
          offLine: css(off).borderBottomColor,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--ac').trim(),
          clock: clock.textContent,
          wall: [
            pad(now.getHours()) + ':' + pad(now.getMinutes()),
            pad(new Date(now.getTime() - 1000).getHours()) +
              ':' +
              pad(new Date(now.getTime() - 1000).getMinutes()),
          ],
          clockRight: 1920 - rect(clock).right,
          clockTop: rect(clock).top,
          clockFont: [css(clock).fontSize, css(clock).fontWeight, css(clock).color].join(' '),
          clockShown: css(clock).display,
        };
      };
      return step(
        'at rest the tab bar names the pages, underlines this one, and the clock tells the time',
        async function () {
          await h.topRow();
          await waitFor(
            'getComputedStyle(document.getElementById("tabs")).opacity === "1"',
            'the tab bar to settle',
            3000,
          );
          const got = await page.evaluate(RESTING);
          assertEqual(got.labels, 'Home|Movies|TV|Kids|Collections|Discover', 'tab labels');
          assertEqual(got.ons, 1, 'one tab underlined');
          assertEqual(got.tabsTop, 22, 'tab bar top');
          assertEqual(got.tabsOpacity, '1', 'tab bar shown at rest');
          assertEqual(
            got.chevron.join(','),
            '28,28,6',
            'chevron size and the 6px above the labels',
          );
          assertEqual(got.chevronStroke.join(' '), 'rgba(255,255,255,0.55) 2.2', 'chevron stroke');
          assertEqual(got.chevronPath, 'M6 15l6-6 6 6', 'chevron path');
          assertEqual(got.centre, 960, 'tab bar centred across 1920');
          assertEqual(got.gaps, '48,48,48,48,48', 'tab gaps');
          assertEqual(got.font, '"Space Grotesk", Inter, sans-serif 30px 600', 'tab font');
          assertEqual(got.onColour, 'rgb(255, 255, 255)', 'active tab colour');
          assertEqual(got.accent, '#F4C8B6', 'the accent the underline uses');
          assertEqual(got.onLine, '3px solid rgb(244, 200, 182) 8px', 'active underline');
          assertEqual(got.offColour, 'rgba(255, 255, 255, 0.42)', 'inactive tab colour');
          assertEqual(got.offLine, 'rgba(0, 0, 0, 0)', 'no underline on an inactive tab');
          assertEqual(
            got.wall.indexOf(got.clock) >= 0,
            true,
            'clock ' + got.clock + ' against ' + got.wall,
          );
          assertEqual(got.clockRight, 96, 'clock right edge');
          assertEqual(got.clockTop, 44, 'clock top');
          assertEqual(got.clockFont, '32px 600 rgba(255, 255, 255, 0.7)', 'clock type');
          assertEqual(got.clockShown, 'block', 'clock shown');

          /* A second page on a fake clock, two seconds short of ten. */
          const fake = await page.context().newPage();
          try {
            await fake.clock.install({ time: new Date(2026, 0, 1, 9, 59, 58) });
            await fake.goto(page.url());
            const read = () => fake.evaluate('document.getElementById("clock").textContent');
            assertEqual(await read(), '09:59', 'the fake clock at boot');
            await fake.clock.runFor(3000);
            assertEqual(await read(), '10:00', 'the clock on the minute, with no key pressed');
          } finally {
            await fake.close();
          }
        },
      );
    })

    .then(function () {
      /* ComboMenu.dc.html: the tiles, the hint and the dimmed row, measured. */
      const OPENED = function () {
        const rect = (el) => el.getBoundingClientRect();
        const css = (el) => getComputedStyle(el);
        const tiles = Array.prototype.slice.call(document.querySelectorAll('#menubar .mb-tile'));
        const face = (tile) => {
          const icon = tile.querySelector('svg');
          const label = tile.querySelector('.mb-label');
          const box = rect(tile);
          return {
            box: [box.width, box.height, box.top].join(','),
            radius: css(tile).borderTopLeftRadius,
            icon: [rect(icon).width, icon.getAttribute('stroke-width')].join(','),
            label: [css(label).fontSize, css(label).fontWeight, css(label).color].join(' '),
            between: Math.round(rect(label).top - rect(icon).bottom),
            border: [
              css(tile).borderTopWidth,
              css(tile).borderTopStyle,
              css(tile).borderTopColor,
            ].join(' '),
            fill: css(tile).backgroundColor + ' ' + css(tile).backgroundImage,
            shadow: css(tile).boxShadow,
          };
        };
        const on = tiles.find((t) => t.classList.contains('on'));
        const rest = tiles.find((t) => !t.classList.contains('on'));
        const hint = document.getElementById('menu-hint');
        const firstRow = document.querySelector('#rows .row');
        const restTile = firstRow.querySelector('.tile:not(.on)');
        let node = restTile;
        let dim = 1;
        while (node) {
          dim *= Number(css(node).opacity);
          node = node.parentElement;
        }
        return {
          labels: tiles.map((t) => t.textContent).join('|'),
          icons: tiles.filter((t) => t.querySelector('svg path')).length,
          ons: tiles.filter((t) => t.classList.contains('on')).length,
          on: face(on),
          rest: face(rest),
          left: rect(tiles[0]).left,
          gaps: tiles
            .slice(1)
            .map((t, i) => Math.round(rect(t).left - rect(tiles[i]).right))
            .join(','),
          centres: tiles.map((t) => Math.round(rect(t).top + rect(t).height / 2)).join(','),
          masthead: css(document.getElementById('masthead')).opacity,
          tabs: css(document.getElementById('tabs')).opacity,
          hint: document.getElementById('menu-hint-title').textContent,
          row: firstRow.querySelector('.row-label').textContent,
          hintTop: rect(hint).top,
          hintCentre: Math.round(
            (rect(hint.querySelector('svg')).left + rect(hint.querySelector('span')).right) / 2,
          ),
          hintType: [css(hint).fontSize, css(hint).fontWeight, css(hint).color].join(' '),
          hintChevron: [
            rect(hint.querySelector('svg')).width,
            hint.querySelector('path').getAttribute('d'),
            Math.round(
              rect(hint.querySelector('span')).left - rect(hint.querySelector('svg')).right,
            ),
          ].join(' '),
          rowTop: rect(restTile).top,
          posters: Array.prototype.slice
            .call(firstRow.querySelectorAll('.tile:not(.hidden) .tile-inner'))
            .map((inner) => rect(inner))
            .filter((box) => box.right > 0 && box.left < 1920)
            .map((box) => [box.left, box.top, box.width, box.height].join(','))
            .join(' '),
          trayHidden: [
            firstRow.querySelector('.row-label'),
            firstRow.querySelector('.tile-title'),
            firstRow.querySelector('.tile-sub'),
            document.getElementById('hero-art'),
            document.getElementById('hero-scrim-x'),
            document.getElementById('hero-scrim-y'),
          ]
            .map((el) => css(el).opacity)
            .join(','),
          dim: Math.round(dim * 100) / 100,
          menuMs: getComputedStyle(document.documentElement).getPropertyValue('--t-menu').trim(),
          motion: ['menubar', 'tabs', 'masthead', 'viewport', 'menu-hint']
            .map(
              (id) =>
                css(document.getElementById(id)).transitionProperty +
                '/' +
                css(document.getElementById(id)).transitionDuration,
            )
            .join(' '),
        };
      };
      const LABELS =
        'Array.prototype.map.call(document.querySelectorAll("#rows .row-label"), function (t) {' +
        ' return t.textContent.trim(); }).join("|")';
      const onTab = () => page.evaluate('document.querySelector("#tab-list .tab.on").textContent');
      return step(
        "Up opens the board's tiles over a dimmed first row; arrows change page and Down closes it",
        async function () {
          await press('ArrowUp');
          assertEqual(await h.menuIsOpen(), true, 'menu open after Up from row 0');
          await page.waitForTimeout(400);
          const got = await page.evaluate(OPENED);
          assertEqual(
            got.labels,
            'Home|Movies|TV|Collections|Discover|Kids|Search|Settings|Servers',
            'menu tiles',
          );
          assertEqual(got.icons, 9, 'tiles with an icon');
          assertEqual(got.ons, 1, 'one focused tile');
          assertEqual(got.on.box, '220,220,220', 'focused tile size and top');
          assertEqual(got.rest.box, '160,160,250', 'rest tile size, centred on the row');
          assertEqual(got.on.radius + ' ' + got.rest.radius, '38px 30px', 'tile corners');
          assertEqual(got.on.icon + ' ' + got.rest.icon, '76,1.7 52,1.7', 'icon size and stroke');
          assertEqual(got.on.label, '30px 600 rgb(255, 255, 255)', 'focused label');
          assertEqual(got.rest.label, '24px 600 rgb(255, 255, 255)', 'rest label');
          assertEqual(got.on.between + ',' + got.rest.between, '10,10', 'icon to label');
          assertEqual(got.left, 96, 'row starts at the edge');
          assertEqual(got.gaps, '28,28,28,28,28,28,28,28', 'tile gaps');
          assertEqual(
            /^(330,)*330$/.test(got.centres),
            true,
            'tiles centre-aligned: ' + got.centres,
          );
          assertEqual(got.rest.border, '1px solid rgba(255, 255, 255, 0.26)', 'rest border');
          assertEqual(got.on.border, '1px solid rgba(255, 255, 255, 0.26)', 'focused border');
          assertEqual(
            got.rest.fill,
            'rgba(22, 16, 44, 0.74) linear-gradient(rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.08))',
            'rest glass',
          );
          assertEqual(
            got.on.fill,
            'rgba(44, 34, 84, 0.9) linear-gradient(rgba(255, 255, 255, 0.36), rgba(255, 255, 255, 0.16))',
            'focused glass',
          );
          assertEqual(
            got.rest.shadow,
            'rgba(255, 255, 255, 0.3) 0px 1px 0px 0px inset, rgba(0, 0, 0, 0.3) 0px 12px 30px 0px',
            'rest shadow',
          );
          assertEqual(
            got.on.shadow,
            'rgba(255, 255, 255, 0.95) 0px 0px 0px 3px, rgba(255, 255, 255, 0.5) 0px 1px 0px 0px inset, rgba(0, 0, 0, 0.5) 0px 24px 60px 0px',
            'focused ring',
          );
          assertEqual(got.masthead, '0', 'masthead hidden');
          assertEqual(got.tabs, '0', 'tab bar hidden');
          assertEqual(got.hint, got.row, 'the hint names the first row');
          assertEqual(got.hint.length > 0, true, 'a hint at all');
          assertEqual(got.hintTop, 486, 'hint top');
          assertEqual(got.hintCentre, 960, 'hint centred');
          assertEqual(got.hintType, '26px 600 rgba(255, 255, 255, 0.55)', 'hint type');
          assertEqual(got.hintChevron, '26 M6 9l6 6 6-6 12', 'hint chevron and gap');
          assertEqual(got.rowTop, 775, 'the first row in the tray');
          const lefts = got.posters.split(' ').map((p) => p.split(',')[0]);
          assertEqual(lefts.length >= 9, true, 'posters across the tray: ' + got.posters);
          assertEqual(
            got.posters,
            lefts.map((_, i) => [96 + 202 * i, 775, 176, 264].join(',')).join(' '),
            'every tray poster 176x264 at top 775, left 96, stride 202',
          );
          assertEqual(got.trayHidden, '0,0,0,0,0,0', 'no row title, captions or backdrop');
          await waitFor(
            'getComputedStyle(document.getElementById("g1")).opacity === "1"',
            'the ground glows under the tray',
            3000,
          );
          assertEqual(got.dim, 0.4, 'the first row dimmed');
          assertEqual(got.menuMs, '300ms', '--t-menu');
          assertEqual(
            got.motion,
            'opacity/0.3s opacity/0.3s opacity/0.3s transform, opacity/0.3s, 0.3s opacity/0.3s',
            'menu motion: transform and opacity, 300ms',
          );
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
          assertEqual(await h.menuIsOpen(), false, 'menu closed after Down');
          assertEqual(await onTab(), 'TV', 'the tab bar underlines TV');
          assertEqual(
            await page.evaluate('getComputedStyle(document.getElementById("tabs")).opacity'),
            '1',
            'the tab bar back',
          );
          assertEqual(
            await page.evaluate('document.getElementById("browse").classList.contains("dense")'),
            false,
            'focus is back on row 0',
          );
        },
      );
    })

    .then(function () {
      const LABELS =
        'Array.prototype.map.call(document.querySelectorAll("#rows .row-label"), function (t) {' +
        ' return t.textContent.trim(); }).join("|")';
      /* Page-side, since a round trip is slower than the 150ms being measured. */
      const arm = () =>
        page.evaluate(
          '(function(){var t=window.__menuT={key:0,changed:0,base:' +
            LABELS +
            '};document.addEventListener("keydown",function(){t.key=performance.now();},true);' +
            'new MutationObserver(function(){if(!t.changed&&' +
            LABELS +
            '!==t.base)t.changed=performance.now();})' +
            '.observe(document.getElementById("rows"),{childList:true,subtree:true,characterData:true});})()',
        );
      const rearm = () => page.evaluate('window.__menuT.changed=0;window.__menuT.base=' + LABELS);
      const took = async () => {
        await waitFor('window.__menuT.changed > 0', 'the rows to change', 10000);
        return page.evaluate('window.__menuT.changed - window.__menuT.key');
      };
      return step(
        'the menu loads a new page 150ms after the last arrow and a seen one at once',
        async function () {
          await press('ArrowUp');
          await arm();
          await press('ArrowRight');
          const first = await took();
          assertEqual(
            first >= 140 && first < 290,
            true,
            'Collections loaded ' + first + 'ms after the arrow',
          );
          await rearm();
          await press('ArrowLeft');
          const seen = await took();
          assertEqual(seen < 100, true, 'a page seen before took ' + seen + 'ms');
          await press('Escape');
        },
      );
    })

    .then(function () {
      const sidebarText = () =>
        page.evaluate(
          'Array.prototype.map.call(document.querySelectorAll("#sidebar .sb-row"), function (r) {' +
            ' return (r.classList.contains("cur") ? "* " : "") + r.textContent.trim(); }).join("|")',
        );
      return step('Kids loads from the menu, and Servers opens the sidebar', async function () {
        await press('ArrowUp');
        await press('ArrowRight', 3);
        await press('Escape');
        assertEqual(await h.menuIsOpen(), false, 'Back closes the menu');
        await waitFor(
          'document.querySelectorAll("#rows .tile:not(.hidden)").length > 0',
          'Kids tiles',
          15000,
        );
        assertEqual(await glowX(), '-780px', 'g1 --gx on the Kids page');
        assertEqual(
          await page.evaluate('document.querySelector("#tab-list .tab.on").textContent'),
          'Kids',
          'the tab bar underlines Kids',
        );
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
        /* The way to Servers from a library passes Home, which shows at once. */
        assertEqual(
          /\* Continue watching/.test(after) && !/\* Kids/.test(after),
          true,
          'Kids is no longer current in ' + after,
        );
        await press('ArrowLeft');
      });
    })

    .then(function () {
      return step('Search opens search', async function () {
        await h.topRow();
        await press('ArrowUp');
        const walk = await page.evaluate(function () {
          const tiles = Array.prototype.slice.call(document.querySelectorAll('#menubar .mb-tile'));
          return tiles.findIndex((t) => t.classList.contains('on'));
        });
        await press('ArrowRight', 6 - walk);
        await press('Enter');
        assertEqual(
          await page.evaluate('document.querySelector(".view:not(.hidden)").id'),
          'search',
          'Search opens the search view',
        );
        await press('Escape');
      });
    })

    .then(function () {
      return step('Servers is the last tile, and ends inside the right edge', async function () {
        await h.topRow();
        await press('ArrowUp');
        const walk = await page.evaluate(function () {
          const tiles = Array.prototype.slice.call(document.querySelectorAll('#menubar .mb-tile'));
          return tiles.findIndex((t) => t.classList.contains('on'));
        });
        await page.evaluate(function () {
          const counts = (window.__mbWrites = { root: 0, strip: 0 });
          const watch = (el, key) =>
            new MutationObserver((m) => {
              counts[key] += m.length;
            }).observe(el, { attributes: true, attributeFilter: ['style'] });
          watch(document.documentElement, 'root');
          new MutationObserver((m) => {
            counts.strip += m.length;
          }).observe(document.getElementById('mb-strip'), {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true,
          });
        });
        await press('ArrowLeft', walk + 1);
        await page.waitForTimeout(400);
        const servers = await page.evaluate(function () {
          const on = document.querySelector('#menubar .mb-tile.on');
          return { label: on.textContent, right: on.getBoundingClientRect().right };
        });
        const writes = await page.evaluate('window.__mbWrites');
        assertEqual(servers.label, 'Servers', 'left past Home wraps to Servers');
        assertEqual(servers.right, 1820, 'Servers ends inside the right edge');
        assertEqual(writes.root, 0, 'root style writes while walking the tiles');
        assertEqual(writes.strip > 0, true, 'the focus moved from tile to tile (control)');
        await press('Escape');
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
                    if (hub.title === 'Recently Released') hub.Metadata = hub.Metadata.slice(1);
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
              const old = await page.evaluate(GO(37));
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
                (writes['Recently Released'] || 0) > 0,
                true,
                'the changed row redraws: ' + JSON.stringify(writes),
              );
              const quiet = Object.keys(writes).filter(
                (label) =>
                  label !== 'Recently Released' &&
                  label !== 'Continue watching' &&
                  label !== 'Your next episodes' &&
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
                  ').split("|").length > 3',
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
      const GO = (code) =>
        '(function(){' +
        KEY(code) +
        KEY(13) +
        'return { labels: ' +
        LABELS +
        ', tiles: document.querySelectorAll("#rows .tile:not(.hidden):not(.placeholder)").length };})()';
      const settle = async (what) => {
        await waitFor('(' + LABELS + ').split("|").length > 2', what, 15000);
        await page.waitForTimeout(1500);
      };
      const heldTitles = async (name) => {
        const held = await h.cachedRows(name);
        return held && held.rows ? held.rows.map((row) => row.title) : [];
      };
      /* Down to the last row, and the label it carries. */
      const lastLabel = async () => {
        await press('ArrowDown', 8);
        const labels = (await page.evaluate(LABELS)).split('|');
        await press('ArrowUp', 8);
        return labels[labels.length - 1];
      };

      return step(
        'Home mixes both libraries and has no All row; Movies and TV are TMDB rows',
        async function () {
          await calls('reset=1');
          await page.reload();
          await h.ready();
          await settle('Home rows');
          const homeLast = await lastLabel();
          await press('ArrowUp');
          await press('ArrowRight');
          await page.waitForTimeout(400);
          await press('Enter');
          await settle('Movies rows');
          const movies = await page.evaluate(LABELS);
          await press('ArrowUp');
          await press('ArrowRight');
          await page.waitForTimeout(400);
          await press('Enter');
          await settle('TV rows');
          const tv = await page.evaluate(LABELS);

          const home = await heldTitles('Home');
          assertEqual(home.indexOf('Recently Aired') >= 0, true, 'Home has a TV row: ' + home);
          assertEqual(home.indexOf('Recently Released') >= 0, true, 'Home has a film row: ' + home);
          assertEqual(
            movies.startsWith('Trending this week|Top 10 today|Because you watched '),
            true,
            'Movies rows: ' + movies,
          );
          assertEqual(
            tv.startsWith(
              'Trending this week|Top 10 today|Your next episodes|Because you watched ',
            ),
            true,
            'TV rows: ' + tv,
          );
          assertEqual(homeLast, home[home.length - 1], 'Home ends on its last hub');
        },
      )
        .then(function () {
          return step(
            'Movies, Home, Movies within two minutes makes no request, and the first visit did',
            async function () {
              await calls('reset=1');
              await page.reload();
              await h.ready();
              await settle('Home after a reload');
              const first = (await calls('')).length;
              assertEqual(first > 0, true, 'the first visit asks the servers (' + first + ')');
              await press('ArrowUp');
              await press('ArrowRight');
              await settle('Movies');
              await calls('reset=1');
              const home = await page.evaluate(GO(37));
              await press('ArrowUp');
              assertEqual(
                home.labels.split('|').length > 2 && home.tiles > 0,
                true,
                'Home in the first frame: ' + home.labels,
              );
              const movies = await page.evaluate(GO(39));
              assertEqual(
                movies.labels.split('|').length > 2 && movies.tiles > 0,
                true,
                'Movies in the first frame: ' + movies.labels,
              );
              await page.waitForTimeout(1500);
              assertEqual((await calls('')).length, 0, 'Movies, Home, Movies asked nothing');
            },
          );
        })
        .then(function () {
          return step(
            'Kids, Collections and Discover come back whole in the first frame',
            async function () {
              const hop = async (code) => {
                await press('ArrowUp');
                return page.evaluate(GO(code));
              };
              const loaded = async (ready, what) => {
                await waitFor(ready, what, 60000);
                await page.waitForTimeout(1500);
              };
              const tiles = 'document.querySelectorAll("#rows .tile:not(.hidden)").length > 0';
              /* From Movies: TV, Collections, Discover, Kids. */
              await hop(39);
              await hop(39);
              await loaded(tiles, 'the first collection');
              await hop(39);
              await loaded(tiles, 'the discovery rows');
              await hop(39);
              await loaded('/Popular kids films/.test(' + LABELS + ')', 'the kids rows');

              const discover = await hop(37);
              assertEqual(
                discover.labels.length > 0 && discover.tiles > 0,
                true,
                'Discover in the first frame: ' + discover.labels,
              );
              const collections = await hop(37);
              assertEqual(collections.tiles > 0, true, 'Collections in the first frame');
              await hop(39);
              const kids = await hop(39);
              assertEqual(
                /Popular kids films/.test(kids.labels) && kids.tiles > 0,
                true,
                'Kids in the first frame: ' + kids.labels,
              );
              await press('Escape');
            },
          );
        });
    })

    .then(function () {
      return step(
        'profiles: Together by default, a profile has its accent and its plays',
        async function () {
          const accent = () =>
            page.evaluate(
              'getComputedStyle(document.documentElement).getPropertyValue("--ac").trim()',
            );
          const profile = () => page.evaluate('window.Profiles.current().id');
          const deckCount = () =>
            page.evaluate(function () {
              const rows = document.querySelectorAll('#rows .row');
              for (let i = 0; i < rows.length; i++) {
                if (
                  rows[i].querySelector('.row-label').textContent.trim() === 'Continue watching'
                ) {
                  return rows[i]._rowRef.items.length;
                }
              }
              return 0;
            });
          /* A reload, so the deck is built fresh under whichever profile was saved. */
          const reloaded = async (want) => {
            await page.reload();
            await h.ready();
            await waitFor(
              '(function(){var r=document.querySelectorAll("#rows .row"),i;for(i=0;i<r.length;i++){' +
                'if(r[i].querySelector(".row-label").textContent.trim()==="Continue watching"&&' +
                'r[i]._rowRef.items.length' +
                (want ? '===' + want : '>1') +
                ')return true}return false})()',
            );
            return deckCount();
          };

          assertEqual(await profile(), 'together', 'the fresh profile');
          assertEqual(await accent(), '#F4C8B6', 'Together accent');
          const stores = await page.evaluate(function () {
            return new Promise(function (resolve) {
              const req = indexedDB.open('reflex');
              req.onsuccess = function () {
                resolve(Array.prototype.slice.call(req.result.objectStoreNames).sort().join());
              };
            });
          });
          assertEqual(stores, 'hidden,kv,plays,smart_lists,title_tags', 'the v2 tables');

          const everything = await reloaded(0);
          if (everything < 2) throw new Error('Together has ' + everything + ' on the deck');

          await page.evaluate('window.Profiles.set("stu")');
          assertEqual(await accent(), '#AEBBF0', 'Stu accent');
          await page.evaluate(function () {
            const rows = document.querySelectorAll('#rows .row');
            for (let i = 0; i < rows.length; i++) {
              if (rows[i].querySelector('.row-label').textContent.trim() === 'Continue watching') {
                window.Profiles.recordPlay(rows[i]._rowRef.items[0], 1000, 5000);
              }
            }
          });
          await page.waitForTimeout(300);
          assertEqual(await reloaded(1), 1, 'Stu deck count');
          assertEqual(await profile(), 'stu', 'Stu survives a reload');
          assertEqual(await accent(), '#AEBBF0', 'Stu accent after a reload');

          await page.evaluate('window.Profiles.set("together")');
          assertEqual(await accent(), '#F4C8B6', 'back to Together');
          await page.waitForTimeout(300);
          assertEqual(await reloaded(0), everything, 'Together deck count');
        },
      );
    });
};
