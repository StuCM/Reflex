'use strict';
/* a series page: seasons, episodes, their copies, its theme tune */
const buildLibrary = require('../library').build;
const hasTheme = require('../mock-plex').hasTheme;

module.exports = function (h) {
  const { shot, visible, press, waitFor, step, sidebarPick, backToLibrary,
    openShowPage, openSidebar, sidebarRows, playEpisode,
    detailFace, kickerParts, page, titles } = h;

  /* Two shows to open by name: one TheTVDB gave a theme tune to and one it did
     not, picked out of the same generated library the mock serves — the way
     dev/smoke.js picks its own titles. The themed one must also direct play, or
     OK on its first episode opens the copy chooser instead of playing. */
  const themed = pickShow(true), silent = pickShow(false);

  function pickShow(want) {
    const lib = buildLibrary({ films: h.FILMS });
    const holders = {};
    lib.servers.forEach(function (srv) {
      srv.items['3'].forEach(function (m) {
        (holders[m._show] = holders[m._show] || []).push(m);
      });
    });

    /* Search matches on a substring, so a title another one contains is not
       safe to open by name. */
    function unambiguous(title) {
      const inShows = lib.shows.filter(function (sh) { return sh.title.indexOf(title) >= 0; });
      const inFilms = lib.films.filter(function (f) { return f.title.indexOf(title) >= 0; });
      return inShows.length === 1 && inFilms.length === 0;
    }

    const hit = lib.shows.filter(function (sh) {
      const copies = holders[sh.i] || [];
      if (hasTheme(sh.i) !== want || !copies.length) return false;
      if (want && (copies.length !== 1 || copies[0]._profile !== 'h264-eac3')) return false;
      return unambiguous(sh.title);
    })[0];
    if (!hit) throw new Error('no unambiguous show ' + (want ? 'with' : 'without') + ' a theme');
    return hit.title;
  }

  /* The audio element the theme plays on, and whether the show on screen even
     has one to play. */
  function themeState() {
    return page.evaluate(function () {
      const a = document.getElementById('theme');
      const show = ShowPage.current();
      return { src: a.getAttribute('src') || '', paused: a.paused, loop: a.loop,
               volume: a.volume, offered: !!(show && show.theme) };
    });
  }

  return h.ready()

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
      return step('a series with a theme plays it, quietly and looping', function () {
        return openShowPage(themed)
          .then(function () {
            return waitFor('(function(){var a=document.getElementById("theme");' +
                           'return !a.paused && a.volume > 0.3;})()',
                           'the theme playing, faded up', 10000);
          })
          .then(themeState)
          .then(function (st) {
            if (!st.offered) throw new Error(themed + ' was picked for its theme and has none');
            if (st.src.indexOf('http://localhost:') !== 0 || st.src.indexOf('/theme/') < 0) {
              throw new Error('the theme is not the server\'s theme file: ' + st.src);
            }
            if (!st.loop) throw new Error('the theme does not loop');
            if (st.volume > 0.4) throw new Error('the theme plays at ' + st.volume + ', not quietly');
          });
      });
    })

    .then(function () {
      return step('BACK off the show page stops the theme', function () {
        return press('Backspace')
          .then(function () { return page.waitForTimeout(150); })
          .then(themeState)
          .then(function (st) {
            if (!st.paused) throw new Error('the theme followed us off the page');
            if (st.src) throw new Error('the theme still holds a source: ' + st.src);
          });
      });
    })

    .then(function () {
      return step('a series without a theme is silent', function () {
        return openShowPage(silent)
          .then(function () { return page.waitForTimeout(400); })
          .then(themeState)
          .then(function (st) {
            if (st.offered) throw new Error(silent + ' was picked for having no theme and has one');
            if (st.src || !st.paused) throw new Error('something played anyway: ' + st.src);
          });
      });
    })

    .then(function () {
      return step('starting an episode stops the theme dead', function () {
        return openShowPage(themed)
          .then(function () {
            return waitFor('!document.getElementById("theme").paused',
                           'the theme playing again', 10000);
          })
          /* Episode 1 of this show direct plays, so OK plays it rather than
             opening the copy chooser. */
          .then(function () { return playEpisode(1, 1); })
          .then(function () {
            return waitFor('!document.getElementById("video").classList.contains("hidden")',
                           'playback to start', 20000);
          })
          .then(themeState)
          .then(function (st) {
            if (!st.paused) throw new Error('the theme is still playing over the episode');
            /* A paused element with a source still holds the pipeline, which on
               ARC is the whole problem. */
            if (st.src) throw new Error('the theme still holds a source: ' + st.src);
          })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('theme music can be turned off, and off survives a reload', function () {
        return sidebarPick('Theme music: on')
          .then(function () { return openShowPage(themed); })
          .then(function () { return page.waitForTimeout(400); })
          .then(themeState)
          .then(function (st) {
            if (!st.offered) throw new Error(themed + ' lost its theme');
            if (st.src || !st.paused) throw new Error('turned off and it played anyway: ' + st.src);
          })
          .then(function () { return page.reload(); })
          .then(h.ready)
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            if (rows.indexOf('Theme music: off') < 0) {
              throw new Error('off did not survive the reload: ' + rows.join(' | '));
            }
          })
          .then(function () { return press('Backspace'); })
          /* Leave it as it was found: everything after this expects the default. */
          .then(function () { return sidebarPick('Theme music: off'); })
          .then(backToLibrary);
      });
    });
};
