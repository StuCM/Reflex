'use strict';
/* the recaps strip under a series page */
module.exports = function (h) {
  const { timelines, ytCalls, ytSearches, shot, press, waitFor, step, sidebarPick,
    backToLibrary, openShowPage, reopenShowPage, recapStrip, intoRecaps, page,
    titles } = h;

  return h.ready()

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
                !/ S3 /.test(names[2] + ' ') || !names[3].startsWith('Everything')) {
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
    });
};
