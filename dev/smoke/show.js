'use strict';
/* a series page: seasons, episodes, their copies */
module.exports = function (h) {
  const { shot, visible, press, waitFor, step, sidebarPick, backToLibrary,
    detailFace, kickerParts, page, titles } = h;

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
    });
};
