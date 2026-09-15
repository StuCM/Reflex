'use strict';
/* a series page: seasons, episodes, their copies, its theme tune */
const buildLibrary = require('../library').build;
const hasTheme = require('../mock-plex').hasTheme;

module.exports = function (h) {
  const {
    shot,
    press,
    waitFor,
    step,
    sidebarPick,
    backToLibrary,
    openShowPage,
    openSidebar,
    sidebarRows,
    playEpisode,
    detailFace,
    episodeDetails,
    holdOk,
    kickerParts,
    page,
  } = h;

  /* Two shows to open by name: one TheTVDB gave a theme tune to and one it did
     not, picked out of the same generated library the mock serves — the way
     dev/smoke.js picks its own titles. The themed one must also direct play, or
     OK on its first episode opens the copy chooser instead of playing. */
  const themed = pickShow(true),
    silent = pickShow(false),
    /* A 4K remux whose own track is TrueHD, with an AC3 beside it. TrueHD can
       never cross plain ARC, so the AC3 is what would actually be heard. */
    remuxed = pickShow(false, 'hevc-mixed');

  function pickShow(want, profile) {
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
      const inShows = lib.shows.filter(function (sh) {
        return sh.title.indexOf(title) >= 0;
      });
      const inFilms = lib.films.filter(function (f) {
        return f.title.indexOf(title) >= 0;
      });
      return inShows.length === 1 && inFilms.length === 0;
    }

    /* One copy only, or the two servers each bring their own encode and which
       one the page shows is not this step's to decide. */
    const wanted = profile || (want ? 'h264-eac3' : '');
    const hit = lib.shows.find(function (sh) {
      const copies = holders[sh.i] || [];
      if (hasTheme(sh.i) !== want || !copies.length) return false;
      if (wanted && (copies.length !== 1 || copies[0]._profile !== wanted)) return false;
      return unambiguous(sh.title);
    });
    if (!hit) {
      throw new Error(
        'no unambiguous show ' +
          (want ? 'with' : 'without') +
          ' a theme' +
          (profile ? ' on ' + profile : ''),
      );
    }
    return hit.title;
  }

  /* The audio element the theme plays on, and whether the show on screen even
     has one to play. */
  function themeState() {
    return page.evaluate(function () {
      const a = document.getElementById('theme');
      const show = ShowPage.current();
      return {
        src: a.getAttribute('src') || '',
        paused: a.paused,
        loop: a.loop,
        volume: a.volume,
        offered: !!(show && show.theme),
      };
    });
  }

  /* ---- holding OK on an episode, per 6e ---- */

  /** The card the menu was opened against, so the header can be checked against
      what the list actually says. */
  let held = null;

  function holdMenu() {
    return page.evaluate(function () {
      function text(host, selector) {
        const found = host.querySelector(selector);
        return found ? found.textContent.trim() : '';
      }
      const box = document.querySelector('#sh-menu');
      const open = !!box && !box.classList.contains('hidden');
      return {
        open: open,
        holding: document.getElementById('show').classList.contains('holding'),
        kicker: open ? text(box, '.menu-kicker') : '',
        title: open ? text(box, '.menu-head-title') : '',
        rows: open
          ? Array.prototype.map.call(box.querySelectorAll('.menu-row'), function (r) {
              return {
                label: text(r, '.menu-label'),
                note: text(r, '.menu-row-note'),
                icon: !!r.querySelector('.menu-icon svg'),
                sel: r.classList.contains('sel'),
              };
            })
          : [],
        box: open
          ? {
              left: box.offsetLeft,
              top: box.offsetTop,
              width: box.offsetWidth,
              height: box.offsetHeight,
            }
          : null,
        cards: Array.prototype.map.call(document.querySelectorAll('.sh-episode'), function (c) {
          return {
            on: c.classList.contains('on'),
            opacity: Number(getComputedStyle(c).opacity),
            ring: getComputedStyle(c).boxShadow,
          };
        }),
      };
    });
  }

  function selected(st) {
    const row = st.rows.find(function (r) {
      return r.sel;
    });
    return row ? row.label : 'nothing';
  }

  function focusedEpisodeRow() {
    return page.evaluate(function () {
      const on = document.querySelector('.sh-episode.on');
      if (!on) return null;
      function text(host, selector) {
        const found = host.querySelector(selector);
        return found ? found.textContent.trim() : '';
      }
      return {
        num: text(on, '.sh-ep-num'),
        title: text(on, '.sh-ep-title'),
        seen: text(on, '.sh-ep-seen'),
      };
    });
  }

  /* The strip slides for --t-move; a rect read before that is over reports the
     position it is leaving. */
  function settle() {
    return page.waitForTimeout(500);
  }

  /* What is actually on screen, read from committed positions: a card is on
     screen when it sits wholly inside the strip that clips it. */
  function stripShape() {
    return page.evaluate(function () {
      const strip = document.getElementById('sh-strip');
      const box = strip.getBoundingClientRect();
      const cards = Array.prototype.map.call(
        document.querySelectorAll('.sh-episode'),
        function (c) {
          const r = c.getBoundingClientRect();
          const still = c.querySelector('.sh-ep-still');
          return {
            left: Math.round(r.left),
            width: Math.round(r.width),
            whole: r.left >= box.left - 1 && r.right <= box.right + 1,
            on: c.classList.contains('on'),
            still: still
              ? Math.round(still.offsetWidth) + 'x' + Math.round(still.offsetHeight)
              : null,
            title: (c.querySelector('.sh-ep-title') || {}).textContent || '',
            blurb: (c.querySelector('.sh-ep-blurb') || {}).textContent || '',
          };
        },
      );
      return {
        pageHeight: document.documentElement.scrollHeight,
        stripBottom: Math.round(box.bottom),
        /* The committed offset, not a rect: a rect read mid-slide is where the
           strip is leaving, not where it is going. */
        offset: document.getElementById('sh-episodes').style.getPropertyValue('--strip-x'),
        cards: cards,
      };
    });
  }

  function castRow() {
    return page.evaluate(function () {
      return {
        label: !document.getElementById('show').classList.contains('no-cast'),
        chips: Array.prototype.map.call(
          document.querySelectorAll('#sh-chips .sh-chip'),
          function (c) {
            return c.textContent.trim();
          },
        ),
        faces: Array.prototype.map.call(document.querySelectorAll('.sh-actor'), function (a) {
          function text(sel) {
            const found = a.querySelector(sel);
            return found ? found.textContent.trim() : '';
          }
          return {
            name: text('.sh-actor-name'),
            role: text('.sh-actor-role'),
            on: a.classList.contains('on'),
          };
        }),
        episodeStillOn: !!document.querySelector('.sh-episode.on'),
      };
    });
  }

  function episodeRows() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('.sh-episode'), function (r) {
        function text(selector) {
          const found = r.querySelector(selector);
          return found ? found.textContent.trim() : '';
        }
        return { num: text('.sh-ep-num'), seen: text('.sh-ep-seen') };
      });
    });
  }

  /* Along to the end of the series, stopping when the focus stops moving or
     steps off the strip. */
  function toLastEpisode(left) {
    const tries = left === undefined ? 40 : left;
    if (!tries) throw new Error('never reached the end of the episode list');
    return focusedEpisodeRow().then(function (before) {
      return press('ArrowRight')
        .then(focusedEpisodeRow)
        .then(function (after) {
          if (!after) return press('ArrowLeft');
          if (before && after.num === before.num) return undefined;
          return toLastEpisode(tries - 1);
        });
    });
  }

  function onScreen(st, where) {
    if (!st.box) throw new Error('no menu box ' + where);
    if (st.box.top < 0 || st.box.top + st.box.height > 1080) {
      throw new Error(
        'the menu runs off the screen ' +
          where +
          ': top ' +
          st.box.top +
          ', ' +
          st.box.height +
          'px tall',
      );
    }
    if (st.box.left < 0 || st.box.left + st.box.width > 1920) {
      throw new Error(
        'the menu runs off the side ' +
          where +
          ': left ' +
          st.box.left +
          ', ' +
          st.box.width +
          'px wide',
      );
    }
  }

  const suite = h
    .ready()

    .then(function () {
      return step('a show section drills into series and episodes', function () {
        return backToLibrary()
          .then(function () {
            return sidebarPick('TV Shows');
          })
          .then(function () {
            /* The All shows row is below the visible pool, so wait on the hero
             naming the section and on the rows having been rebuilt. */
            return waitFor(
              '!document.getElementById("sidebar").classList.contains("open")',
              'the shows section',
              20000,
            );
          })
          .then(function () {
            return page.waitForTimeout(800);
          })
          .then(function () {
            return press('ArrowDown');
          }) // off Continue watching
          .then(function () {
            /* Shows are not films: no runtime, no audio verdict, a series count
             instead. */
            return waitFor(
              '/\\d+ series/.test(document.querySelector("#mh-meta").textContent)',
              'a show in the masthead',
              15000,
            );
          })
          .then(function () {
            return page.keyboard.press('Enter');
          })
          .then(function () {
            return waitFor(
              '!document.getElementById("show").classList.contains("hidden") &&' +
                ' document.querySelectorAll("#sh-seasons .chip").length > 0 &&' +
                ' document.querySelectorAll(".sh-episode").length > 1',
              'the show page with series and episodes',
              20000,
            );
          })
          .then(function () {
            return page.evaluate(function () {
              return {
                title: document.getElementById('sh-title').textContent,
                seasons: document.querySelectorAll('#sh-seasons .chip').length,
                episodes: Array.prototype.map.call(
                  document.querySelectorAll('.sh-episode'),
                  function (e) {
                    return e.textContent.replace(/\s+/g, ' ');
                  },
                ),
              };
            });
          })
          .then(function (st) {
            if (!st.title) throw new Error('the show page has no title');
            /* Episode rows must carry their number and a runtime, or the list is
             just a wall of titles. */
            if (!/^\s*1/.test(st.episodes[0])) {
              throw new Error(
                'first episode row does not start with its number: ' + st.episodes[0],
              );
            }
            if (!/\d+ min/.test(st.episodes[0])) {
              throw new Error('no runtime on the episode row: ' + st.episodes[0]);
            }
          })
          .then(function () {
            return shot('show');
          })
          .then(function () {
            /* The focused episode is checked in place, so OK means something. */
            return waitFor(
              '(function(){var e=document.querySelector(".sh-episode.on");' +
                'return e && /direct play|transcode|no passable/.test(e.textContent);})()',
              'a verdict on the focused episode',
              20000,
            );
          });
      });
    })

    .then(function () {
      return step('every episode row carries its still, present or not', function () {
        /* The still moved here off the rail tile. It is a picture per visible
         row on a page you drilled into, not one per tile in a 30,000 item
         walk, which is why it is affordable here and was not there. */
        return page
          .evaluate(function () {
            var rows = Array.prototype.slice.call(document.querySelectorAll('.sh-episode'));
            function shape() {
              return rows.map(function (r) {
                var s = r.querySelector('.sh-ep-still');
                return {
                  height: r.offsetHeight,
                  box: s ? Math.round(s.offsetWidth) + 'x' + Math.round(s.offsetHeight) : null,
                  art: s ? getComputedStyle(s).backgroundImage : 'none',
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
          })
          .then(function (st) {
            if (st.before.length < 2) throw new Error('too few episode rows to judge');
            st.before.forEach(function (r, i) {
              if (r.box !== '472x266') {
                throw new Error('episode ' + i + ' has a ' + r.box + ' still box');
              }
              if (r.art === 'none') throw new Error('episode ' + i + ' drew no still');
              if (r.height !== st.before[0].height) {
                throw new Error(
                  'episode ' + i + ' is ' + r.height + 'px, not ' + st.before[0].height,
                );
              }
            });
            if (st.after[0].art !== 'none') throw new Error('the still would not blank');
            if (st.after[0].height !== st.before[0].height) {
              throw new Error(
                'an episode with no still is ' +
                  st.after[0].height +
                  'px, not ' +
                  st.before[0].height,
              );
            }
          });
      });
    })

    .then(function () {
      return step('a series with more than one season can be switched', function () {
        return page
          .evaluate(function () {
            return document.querySelectorAll('#sh-seasons .chip').length;
          })
          .then(function (n) {
            if (n < 2) return; // this show has one series; nothing to switch
            return press('ArrowUp') // up off the strip, to the series chips
              .then(function () {
                return waitFor(
                  'document.querySelector("#sh-seasons .chip.on") !== null',
                  'series focus',
                );
              })
              .then(function () {
                return press('ArrowRight');
              })
              .then(function () {
                return waitFor(
                  'document.querySelectorAll(".sh-episode").length > 0',
                  'the next series to load',
                  15000,
                );
              });
          });
      });
    })

    .then(function () {
      return step("an episode's copy chooser is reached through the series page", function () {
        return (
          page
            .evaluate(function () {
              /* Make sure we are back on the strip before holding OK. */
              return !!document.querySelector('.sh-episode');
            })
            .then(function () {
              return press('ArrowDown');
            })
            /* ◀ ▶ run along the strip now, so Episode details in the hold menu is
             the way to an episode's copies. */
            .then(episodeDetails)
            .then(function () {
              return waitFor(
                '!document.getElementById("detail").classList.contains("hidden") &&' +
                  ' document.querySelectorAll("#dt-actions .dt-act").length > 0',
                'the action row for an episode',
                20000,
              );
            })
            .then(detailFace)
            .then(function (st) {
              /* An episode has to say which show and which number it is: the show
             is the kicker, the number is a chip. */
              const parts = kickerParts(st.kicker);
              if (!parts.length) throw new Error('an episode with no kicker at all');
              if (
                !st.chips.some(function (c) {
                  return /^S\d+E\d+$/.test(c);
                })
              ) {
                throw new Error('no season/episode among the chips: ' + st.chips.join(' | '));
              }
              /* The mock's episodes carry no scores and TMDB is never asked about
             one, so this is the "nothing to show" case: an empty row, not an
             unlabelled glyph or a stray separator. */
              if (st.ratings.length || st.glyphs) {
                throw new Error('an episode with scores from nowhere: ' + st.ratings.join(' | '));
              }
            })
            .then(function () {
              return shot('episode-copies');
            })
            .then(backToLibrary)
        );
      });
    })

    .then(function () {
      return step('a series with a theme plays it, quietly and looping', function () {
        return openShowPage(themed)
          .then(function () {
            return waitFor(
              '(function(){var a=document.getElementById("theme");' +
                'return !a.paused && a.volume > 0.3;})()',
              'the theme playing, faded up',
              10000,
            );
          })
          .then(themeState)
          .then(function (st) {
            if (!st.offered) throw new Error(themed + ' was picked for its theme and has none');
            if (st.src.indexOf('http://localhost:') !== 0 || st.src.indexOf('/theme/') < 0) {
              throw new Error("the theme is not the server's theme file: " + st.src);
            }
            if (!st.loop) throw new Error('the theme does not loop');
            if (st.volume > 0.4)
              throw new Error('the theme plays at ' + st.volume + ', not quietly');
          });
      });
    })

    .then(function () {
      return step('BACK off the show page stops the theme', function () {
        return press('Backspace')
          .then(function () {
            return page.waitForTimeout(150);
          })
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
          .then(function () {
            return page.waitForTimeout(400);
          })
          .then(themeState)
          .then(function (st) {
            if (st.offered) throw new Error(silent + ' was picked for having no theme and has one');
            if (st.src || !st.paused) throw new Error('something played anyway: ' + st.src);
          });
      });
    })

    .then(function () {
      return step('starting an episode stops the theme dead', function () {
        return (
          openShowPage(themed)
            .then(function () {
              return waitFor(
                '!document.getElementById("theme").paused',
                'the theme playing again',
                10000,
              );
            })
            /* Episode 1 of this show direct plays, so OK plays it rather than
           opening the copy chooser. */
            .then(function () {
              return playEpisode(1, 1);
            })
            .then(function () {
              return waitFor(
                '!document.getElementById("video").classList.contains("hidden")',
                'playback to start',
                20000,
              );
            })
            .then(themeState)
            .then(function (st) {
              if (!st.paused) throw new Error('the theme is still playing over the episode');
              /* A paused element with a source still holds the pipeline, which on
             ARC is the whole problem. */
              if (st.src) throw new Error('the theme still holds a source: ' + st.src);
            })
            .then(backToLibrary)
        );
      });
    })

    .then(function () {
      return step('theme music can be turned off, and off survives a reload', function () {
        return (
          sidebarPick('Theme music: on')
            .then(function () {
              return openShowPage(themed);
            })
            .then(function () {
              return page.waitForTimeout(400);
            })
            .then(themeState)
            .then(function (st) {
              if (!st.offered) throw new Error(themed + ' lost its theme');
              if (st.src || !st.paused)
                throw new Error('turned off and it played anyway: ' + st.src);
            })
            .then(function () {
              return page.reload();
            })
            .then(h.ready)
            .then(openSidebar)
            .then(sidebarRows)
            .then(function (rows) {
              if (rows.indexOf('Theme music: off') < 0) {
                throw new Error('off did not survive the reload: ' + rows.join(' | '));
              }
            })
            .then(function () {
              return press('Backspace');
            })
            /* Leave it as it was found: everything after this expects the default. */
            .then(function () {
              return sidebarPick('Theme music: off');
            })
            .then(backToLibrary)
        );
      });
    });

  /* Two chains, not one: past this length oxfmt parenthesises the whole thing
     and re-indents every step above, so joining them is a 600-line diff. */
  return (
    suite

      .then(function () {
        return step('holding OK on an episode opens its menu against the card', function () {
          return openShowPage(themed)
            .then(function () {
              return page.waitForTimeout(400);
            })
            .then(focusedEpisodeRow)
            .then(function (ep) {
              if (!ep) throw new Error('no focused episode to hold OK on');
              held = ep;
            })
            .then(holdOk)
            .then(holdMenu)
            .then(function (st) {
              if (!st.open) throw new Error('holding OK opened no menu');
              if (!st.holding) throw new Error('the page never went behind the scrim');

              const labels = st.rows.map(function (r) {
                return r.label;
              });
              const want = [
                'Mark as watched',
                'Mark all up to here',
                'Play from start',
                'Episode details',
              ];
              if (labels.join(' | ') !== want.join(' | ')) {
                throw new Error('the menu reads "' + labels.join(' | ') + '"');
              }
              st.rows.forEach(function (r) {
                if (!r.icon) throw new Error('the row "' + r.label + '" drew no icon');
              });

              /* The header names *this* episode, which is the whole point of
             anchoring the menu to a card rather than centring it. */
              if (!new RegExp('^S\\d+ E' + held.num + '$').test(st.kicker)) {
                throw new Error('the kicker reads "' + st.kicker + '" for episode ' + held.num);
              }
              if (st.title !== held.title) {
                throw new Error(
                  'the menu heads "' + st.title + '", the card says "' + held.title + '"',
                );
              }
              if (st.rows[1].note.indexOf('E' + held.num) < 0) {
                throw new Error(
                  '"Mark all up to here" spans "' + st.rows[1].note + '", not up to E' + held.num,
                );
              }
              if (!/\d+ min/.test(st.rows[2].note)) {
                throw new Error('"Play from start" has no runtime: "' + st.rows[2].note + '"');
              }

              /* The held card keeps full brightness; everything else drops. */
              const on = st.cards.filter(function (c) {
                return c.on;
              });
              const rest = st.cards.filter(function (c) {
                return !c.on;
              });
              if (on.length !== 1) throw new Error(on.length + ' cards are held at once');
              if (rest.length < 2) throw new Error('only ' + rest.length + ' other cards to judge');
              if (on[0].opacity !== 1) throw new Error('the held card sits at ' + on[0].opacity);
              rest.forEach(function (c, i) {
                if (c.opacity > 0.5) throw new Error('card ' + i + ' did not dim: ' + c.opacity);
              });
              if (!/rgb/.test(on[0].ring)) {
                throw new Error('the held card has no ring: ' + on[0].ring);
              }
            })
            .then(function () {
              return shot('episode-hold-menu');
            });
        });
      })

      .then(function () {
        return step('▲ ▼ walk the menu rows, and ◀ closes it', function () {
          return holdMenu()
            .then(function (st) {
              if (!st.open) throw new Error('the menu closed itself between steps');
              if (!st.rows[0].sel) throw new Error('the menu landed on "' + selected(st) + '"');
            })
            .then(function () {
              return press('ArrowDown', 2);
            })
            .then(holdMenu)
            .then(function (st) {
              if (!st.rows[2].sel) throw new Error('two downs landed on "' + selected(st) + '"');
            })
            .then(function () {
              return press('ArrowUp');
            })
            .then(holdMenu)
            .then(function (st) {
              if (!st.rows[1].sel) throw new Error('one up landed on "' + selected(st) + '"');
            })
            .then(function () {
              return press('ArrowLeft');
            })
            .then(holdMenu)
            .then(function (st) {
              if (st.open) throw new Error('◀ left the menu up');
              if (st.holding) throw new Error('the scrim outlived the menu');
              if (!st.cards.length) throw new Error('the episode list went with it');
              st.cards.forEach(function (c, i) {
                if (c.opacity !== 1) throw new Error('card ' + i + ' stayed dim: ' + c.opacity);
              });
            });
        });
      })

      /* The step that matters. A long press that quietly breaks ordinary playback
     is the expensive way to get this wrong, and OK moving to keyup is exactly
     the change that could do it. */
      .then(function () {
        return step('a normal OK press still plays the episode', function () {
          return playEpisode(1, 1)
            .then(function () {
              return waitFor(
                '!document.getElementById("video").classList.contains("hidden")',
                'playback from a short OK press',
                20000,
              );
            })
            .then(holdMenu)
            .then(function (st) {
              if (st.open) throw new Error('a short press opened the hold menu as well');
            })
            .then(backToLibrary);
        });
      })

      .then(function () {
        return step('the menu is clamped on screen at both ends of the list', function () {
          let first = null;
          return openShowPage(themed)
            .then(function () {
              return page.waitForTimeout(400);
            })
            .then(function () {
              return press('ArrowUp'); // to the series chips, above the strip
            })
            .then(function () {
              return press('ArrowDown'); // and back onto the strip
            })
            .then(function () {
              return press('ArrowLeft', 30); // and along to the first episode
            })
            .then(holdOk)
            .then(holdMenu)
            .then(function (st) {
              if (!st.open) throw new Error('no menu on the first episode');
              onScreen(st, 'on the first episode');
              first = st.box;
            })
            .then(function () {
              return press('Backspace');
            })
            .then(toLastEpisode)
            .then(holdOk)
            .then(holdMenu)
            .then(function (st) {
              if (!st.open) throw new Error('no menu on the last episode');
              onScreen(st, 'on the last episode');
              /* Without this the clamp could be a constant position and both
             readings would pass. Every card in a strip shares a top, so it is
             the left that has to have moved. */
              if (st.box.left === first.left) {
                throw new Error('the menu did not follow the card: both at left ' + first.left);
              }
            })
            .then(function () {
              return press('Backspace');
            });
        });
      })

      .then(function () {
        /* The remote repeats keydown for as long as OK is held. Playwright's
           keyboard.down() sends exactly one, so holdOk() above cannot produce
           the stream the panel produces — and the bug this catches shipped to
           the TV precisely because no step could see it. Dispatch the repeats
           page-side instead. */
        return step('a held OK is one gesture, not a stream of confirmations', function () {
          const before = h.deckWrites.length;
          return page
            .evaluate(function () {
              function ok(repeat) {
                const e = document.createEvent('Event');
                e.initEvent('keydown', true, true);
                Object.defineProperty(e, 'keyCode', { get: () => 13 });
                Object.defineProperty(e, 'repeat', { get: () => repeat });
                document.dispatchEvent(e);
              }
              ok(false);
              for (let i = 0; i < 8; i++) ok(true);
            })
            .then(function () {
              return page.waitForTimeout(400);
            })
            .then(holdMenu)
            .then(function (st) {
              if (!st.open) {
                throw new Error('eight repeats of a held OK left no menu open');
              }
              const wrote = h.deckWrites.slice(before).filter(function (u) {
                return u.indexOf('/:/scrobble') >= 0;
              });
              if (wrote.length) {
                throw new Error(
                  'holding OK confirmed the focused row ' +
                    wrote.length +
                    ' time(s) without a release: ' +
                    wrote.join(', '),
                );
              }
            })
            .then(function () {
              return page.keyboard.up('Enter');
            })
            .then(function () {
              return page.keyboard.press('Backspace');
            })
            .then(function () {
              return page.waitForTimeout(250);
            });
        });
      })

      .then(function () {
        return step('Mark as watched scrobbles the episode and the row says so', function () {
          const before = h.deckWrites.length;
          return holdOk()
            .then(holdMenu)
            .then(function (st) {
              if (!st.open || !st.rows[0].sel) {
                throw new Error('the menu did not open on Mark as watched: ' + selected(st));
              }
            })
            .then(function () {
              return page.keyboard.press('Enter');
            })
            .then(function () {
              return page.waitForTimeout(700);
            })
            .then(function () {
              const wrote = h.deckWrites.slice(before).filter(function (u) {
                return u.indexOf('/:/scrobble') >= 0;
              });
              if (!wrote.length) throw new Error('OK on Mark as watched scrobbled nothing');
              if (wrote.length !== 1) {
                throw new Error(
                  'one copy of this episode, ' + wrote.length + ' scrobbles: ' + wrote.join(', '),
                );
              }
            })
            .then(focusedEpisodeRow)
            .then(function (ep) {
              if (ep.seen !== 'watched') throw new Error('the row still reads "' + ep.seen + '"');
            });
        });
      })

      .then(function () {
        return step('Play from start plays the episode from the menu', function () {
          return holdOk()
            .then(function () {
              return press('ArrowDown', 2);
            })
            .then(holdMenu)
            .then(function (st) {
              if (selected(st) !== 'Play from start') {
                throw new Error('two downs landed on "' + selected(st) + '"');
              }
            })
            .then(function () {
              return page.keyboard.press('Enter');
            })
            .then(function () {
              return waitFor(
                '!document.getElementById("video").classList.contains("hidden")',
                'playback from the hold menu',
                20000,
              );
            })
            .then(backToLibrary);
        });
      })

      .then(function () {
        return step('Episode details opens the film page for that episode', function () {
          return openShowPage(themed)
            .then(function () {
              return page.waitForTimeout(400);
            })
            .then(focusedEpisodeRow)
            .then(function (ep) {
              held = ep;
            })
            .then(holdOk)
            .then(function () {
              return press('ArrowDown', 3);
            })
            .then(holdMenu)
            .then(function (st) {
              if (selected(st) !== 'Episode details') {
                throw new Error('three downs landed on "' + selected(st) + '"');
              }
            })
            .then(function () {
              return page.keyboard.press('Enter');
            })
            .then(function () {
              return waitFor(
                '!document.getElementById("detail").classList.contains("hidden") &&' +
                  ' document.querySelectorAll("#dt-actions .dt-act").length > 0',
                'the film page for the episode',
                20000,
              );
            })
            .then(function () {
              return page.evaluate(function () {
                return document.getElementById('dt-title').textContent.trim();
              });
            })
            .then(function (title) {
              if (title !== held.title) {
                throw new Error('the film page opened on "' + title + '", not ' + held.title);
              }
            })
            .then(backToLibrary);
        });
      })

      .then(function () {
        return step('Mark all up to here marks that stretch and no more', function () {
          let before = 0;
          return openShowPage(themed)
            .then(function () {
              return page.waitForTimeout(400);
            })
            .then(function () {
              return press('ArrowUp'); // to the series chips
            })
            .then(function () {
              return press('ArrowDown'); // and back onto the strip
            })
            .then(function () {
              return press('ArrowLeft', 30); // along to the first episode
            })
            .then(function () {
              return press('ArrowRight', 2); // and on to the third
            })
            .then(focusedEpisodeRow)
            .then(function (ep) {
              if (ep.num !== '3') throw new Error('landed on episode ' + ep.num + ', wanted 3');
              before = h.deckWrites.length;
            })
            .then(holdOk)
            .then(holdMenu)
            .then(function (st) {
              if (!/^S\d+ E1–E3$/.test(st.rows[1].note)) {
                throw new Error('the row spans "' + st.rows[1].note + '", not E1 to E3');
              }
            })
            .then(function () {
              return press('ArrowDown');
            })
            .then(holdMenu)
            .then(function (st) {
              if (selected(st) !== 'Mark all up to here') {
                throw new Error('one down landed on "' + selected(st) + '"');
              }
            })
            .then(function () {
              return page.keyboard.press('Enter');
            })
            .then(function () {
              return page.waitForTimeout(900);
            })
            .then(function () {
              /* One copy of this show, so one scrobble an episode: three
                 episodes, three writes, and a fourth would mean the slice runs
                 past the card that was held. */
              const wrote = h.deckWrites.slice(before).filter(function (u) {
                return u.indexOf('/:/scrobble') >= 0;
              });
              if (wrote.length !== 3) {
                throw new Error(
                  'E1 to E3 scrobbled ' + wrote.length + ' times: ' + (wrote.join(', ') || 'never'),
                );
              }
            })
            .then(episodeRows)
            .then(function (rows) {
              const seen = {};
              rows.forEach(function (r) {
                seen[r.num] = r.seen;
              });
              ['1', '2', '3'].forEach(function (n) {
                if (seen[n] !== 'watched') {
                  throw new Error('episode ' + n + ' reads "' + seen[n] + '", not watched');
                }
              });
              /* The control: the stretch stops at the card that was held. */
              if (seen['4'] === undefined) throw new Error('no fourth episode to check against');
              if (seen['4'] === 'watched') throw new Error('episode 4 was marked as well');
            })
            .then(backToLibrary);
        });
      })

      /* ---- 6d ---- */

      .then(function () {
        return step('a whole row of landscape stills sits on screen unscrolled', function () {
          return openShowPage(themed)
            .then(function () {
              return page.waitForTimeout(500);
            })
            .then(stripShape)
            .then(function (st) {
              if (st.cards.length < 4) {
                throw new Error('only ' + st.cards.length + ' episode cards drawn');
              }
              const whole = st.cards.filter(function (c) {
                return c.whole;
              });
              if (whole.length < 3) {
                throw new Error(whole.length + ' cards fit the strip whole, wanted at least 3');
              }
              st.cards.forEach(function (c, i) {
                if (c.width !== 472) throw new Error('card ' + i + ' is ' + c.width + 'px wide');
                if (c.still !== '472x266') {
                  throw new Error('card ' + i + ' has a ' + c.still + ' still');
                }
                if (!c.title) throw new Error('card ' + i + ' has no title');
                if (!c.blurb) throw new Error('card ' + i + ' has no blurb');
              });
              /* 6d's 36px between them, read off the cards rather than assumed. */
              const stride = st.cards[1].left - st.cards[0].left;
              if (stride !== 508) throw new Error('the cards step by ' + stride + 'px, not 508');
              /* The point of the compressed header: no scrolling to see them. */
              if (st.stripBottom > 1080) {
                throw new Error('the strip runs to ' + st.stripBottom + 'px, past the screen');
              }
              if (st.pageHeight > 1080) {
                throw new Error('the page scrolls: ' + st.pageHeight + 'px tall');
              }
            })
            .then(function () {
              return shot('show-6d');
            });
        });
      })

      .then(function () {
        return step('◀ ▶ run along the strip and it winds to follow', function () {
          return stripShape()
            .then(function (st) {
              const at = st.cards.findIndex(function (c) {
                return c.on;
              });
              if (at < 0) throw new Error('no focused card to start from');
              return press('ArrowLeft', 30); // back to the first
            })
            .then(settle)
            .then(stripShape)
            .then(function (st) {
              if (!st.cards[0].on) throw new Error('◀ did not reach the first card');
              if (st.offset !== '0px') {
                throw new Error('the strip sits at ' + st.offset + ' on the first card');
              }
              if (!st.cards[0].whole) throw new Error('the first card is not wholly on screen');
              return press('ArrowRight', 3);
            })
            .then(settle)
            .then(stripShape)
            .then(function (st) {
              if (!st.cards[3].on) {
                const at = st.cards.findIndex(function (c) {
                  return c.on;
                });
                throw new Error('three ▶ landed on card ' + at + ', not 3');
              }
              /* 6d keeps the focused card in the second slot, so by the fourth
                 the strip has wound two cards' worth. */
              if (st.offset !== '-1016px') {
                throw new Error('the strip wound to ' + st.offset + ', not -1016px');
              }
              if (!st.cards[3].whole) throw new Error('the focused card is not wholly on screen');
            });
        });
      })

      .then(function () {
        return step('▼ off the strip reaches the cast, and ◀ ▶ run along it', function () {
          return castRow()
            .then(function (st) {
              if (!st.faces.length) throw new Error('the show drew no cast at all');
              if (!st.label) throw new Error('the cast row is labelled as absent');
              const named = st.faces.filter(function (f) {
                return f.name && f.role;
              });
              if (named.length !== st.faces.length) {
                throw new Error(
                  named.length + ' of ' + st.faces.length + ' faces carry a name and a part',
                );
              }
              if (
                st.faces.some(function (f) {
                  return f.on;
                })
              ) {
                throw new Error('the cast is focused before ▼ was pressed');
              }
              return press('ArrowDown');
            })
            .then(castRow)
            .then(function (st) {
              if (!st.faces[0].on) throw new Error('▼ did not land on the first cast member');
              if (st.episodeStillOn) throw new Error('the episode kept its ring as well');
              return press('ArrowRight', 2);
            })
            .then(castRow)
            .then(function (st) {
              if (!st.faces[2].on) {
                const at = st.faces.findIndex(function (f) {
                  return f.on;
                });
                throw new Error('two ▶ landed on face ' + at + ', not 2');
              }
              return press('ArrowUp');
            })
            .then(castRow)
            .then(function (st) {
              if (!st.episodeStillOn) throw new Error('▲ did not go back to the episodes');
              if (
                st.faces.some(function (f) {
                  return f.on;
                })
              ) {
                throw new Error('the cast kept its ring');
              }
            })
            .then(function () {
              return shot('show-cast');
            });
        });
      })

      .then(function () {
        return step('the header chips name the track that will actually play', function () {
          return (
            castRow()
              .then(function (st) {
                /* The themed show is h264-eac3: 1080p, and an E-AC3 5.1 track the
                 panel gets as-is. */
                if (st.chips.join(' | ') !== '1080p | EAC3 5.1 ENG | Subtitles off') {
                  throw new Error('the header reads "' + st.chips.join(' | ') + '"');
                }
              })
              /* The control, and the reason the chip exists: a 4K remux whose own
               track is TrueHD. TrueHD cannot cross plain ARC, so naming it would
               be a lie — the AC3 beside it is what would be heard. */
              .then(function () {
                return openShowPage(remuxed);
              })
              .then(function () {
                return waitFor(
                  'document.querySelectorAll("#sh-chips .sh-chip").length > 0',
                  'the header chips for the remux',
                  20000,
                );
              })
              .then(castRow)
              .then(function (st) {
                if (st.chips.join(' | ') !== '4K | AC3 5.1 ENG | Subtitles off') {
                  throw new Error('the remux header reads "' + st.chips.join(' | ') + '"');
                }
              })
              .then(backToLibrary)
          );
        });
      })
  );
};
