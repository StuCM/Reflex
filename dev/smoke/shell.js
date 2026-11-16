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
            assertEqual(/1 hero 280/.test(text), true, 'toggle readout in ' + text);
          });
      });
    })

    .then(function () {
      return step('key 9 shifts the glows and cycles back', function () {
        return press('9')
          .then(glowX)
          .then(function (x) {
            assertEqual(x, '-90px', 'g1 --gx after one page');
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
      const settling = 'document.getElementById("browse").classList.contains("no-anim")';
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
    });
};
