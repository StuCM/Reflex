'use strict';
/* the sidebar: modes, categories, Continue watching */
module.exports = function (h) {
  const { shot, press, waitFor, step, openSidebar, sidebarRows, sidebarPick,
    watchingPick, focusedRowTypes, shown, backToLibrary, pictures, detailFace, page } = h;

  /* Inside a section and off its Continue watching row, which is where the
     suite arrives from the series pages. It matters: the sidebar nests the
     cuts of Continue watching while the rail is resting on it, and the
     section's own categories otherwise. */
  return h.ready()
    .then(function () { return sidebarPick('TV Shows'); })
    .then(function () { return press('ArrowDown'); })

    .then(function () {
      return step('the sidebar lists the modes and jumps to a category', function () {
        let cats;
        return backToLibrary()
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            const text = rows.join(' | ');
            ['Discovery', 'Kids', 'Search'].forEach(function (want) {
              if (rows.indexOf(want) < 0) throw new Error('no ' + want + ' row: ' + text);
            });
            /* Continue watching carries the mark too when the rail is resting
               on it, so only the sections are counted here. */
            const current = rows.filter(function (r) {
              return r.indexOf('* ') === 0 && r.indexOf('Continue watching') < 0;
            });
            if (current.length !== 1) throw new Error('sections showing as current: ' + text);
            cats = rows.filter(function (r) { return r.indexOf('- ') === 0; })
                       .map(function (r) { return r.slice(2); });
            if (cats.indexOf('Continue watching') >= 0) {
              throw new Error('Continue watching is listed under a section as well: ' + text);
            }
          })
          .then(function () { return shot('sidebar'); })
          /* Picking a category is how the sidebar replaces scrolling to a row,
             so it has to actually land the rail on it. */
          .then(function () { return sidebarPick(cats[0]); })
          .then(function () {
            return waitFor('document.getElementById("mh-row").textContent.trim() === ' +
                           JSON.stringify(cats[0]), 'the rail to land on ' + cats[0]);
          });
      });
    })

    .then(function () {
      return step('the sidebar lists Continue watching, Movies and TV Shows, once each', function () {
        return backToLibrary()
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            const text = rows.join(' | ');
            const top = rows.filter(function (r) { return r.indexOf('- ') < 0; })
                            .map(function (r) { return r.replace('* ', ''); });
            ['Continue watching', 'Movies', 'TV Shows', 'Discovery', 'Kids', 'Search']
              .forEach(function (want) {
                if (top.indexOf(want) < 0) throw new Error('no ' + want + ' entry: ' + text);
              });
            /* The libraries themselves are gone: the mock's are Films, 4K Films
               and TV Shows, and only the last of those is also a section name. */
            ['Films', '4K Films'].forEach(function (lib) {
              if (top.indexOf(lib) >= 0) throw new Error('the library ' + lib +
                                                         ' is still listed: ' + text);
            });
            const watching = rows.filter(function (r) {
              return r.replace(/^\* /, '').replace(/^- /, '') === 'Continue watching';
            });
            if (watching.length !== 1) {
              throw new Error(watching.length + ' Continue watching entries: ' + text);
            }
          })
          .then(function () { return press('ArrowLeft'); });      // close it again
      });
    })

    .then(function () {
      return step('Continue watching can be cut to films or to episodes', function () {
        function types(what) {
          return focusedRowTypes().then(function (st) {
            if (!st) throw new Error('no focused row after ' + what);
            if (st.title !== 'Continue watching') {
              throw new Error('after ' + what + ' the rail is on "' + st.title + '"');
            }
            if (!st.types.length) throw new Error('nothing left in the row after ' + what);
            return st.types;
          });
        }
        return backToLibrary()
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return types('Continue watching'); })
          .then(function (all) {
            /* onDeck is films and episodes together — if it were not, the cuts
               below would prove nothing. */
            if (all.indexOf('movie') < 0 || all.indexOf('episode') < 0) {
              throw new Error('Continue watching is not mixed: ' + all.join(', '));
            }
          })
          /* Opening the sidebar from that row must land on it with its cuts
             showing, rather than a level up on the section — which is also
             current, and used to win. */
          .then(openSidebar)
          .then(function () {
            return page.evaluate(function () {
              const on = document.querySelector('#sidebar .sb-row.on');
              return {
                on: on ? on.textContent.trim() : '',
                subs: Array.prototype.map.call(
                  document.querySelectorAll('#sidebar .sb-row.sub'),
                  function (r) { return r.textContent.trim(); })
              };
            });
          })
          .then(function (st) {
            if (st.on !== 'Continue watching') {
              throw new Error('the sidebar opened on "' + st.on + '", not the row we were on');
            }
            if (st.subs.indexOf('Movies') < 0 || st.subs.indexOf('TV Shows') < 0) {
              throw new Error('Continue watching did not open its cuts: ' + st.subs.join(' | '));
            }
          })
          .then(function () { return press('ArrowLeft'); })
          .then(function () { return watchingPick('TV Shows'); })
          .then(function () { return types('the TV Shows cut'); })
          .then(function (only) {
            const stray = only.filter(function (t) { return t !== 'episode'; });
            if (stray.length) throw new Error('the TV Shows cut kept ' + stray.join(', '));
          })
          .then(function () { return watchingPick('Movies'); })
          .then(function () { return types('the Movies cut'); })
          .then(function (only) {
            const stray = only.filter(function (t) { return t !== 'movie'; });
            if (stray.length) throw new Error('the Movies cut kept ' + stray.join(', '));
          })
          /* And the cut lifts again, which is also how the rest of the run gets
             its mixed row back. */
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return types('the cut being lifted'); })
          .then(function (all) {
            if (all.indexOf('episode') < 0) throw new Error('the episodes did not come back');
          })
          .then(function () { return shot('continue-watching'); });
      });
    })

    .then(function () {
      return step('an episode tile is its show\'s poster, for no extra request', function () {
        /* Plex puts the show's poster on the episode as grandparentThumb, so
           the tile is a poster like every other without a lookup of any kind.
           Two episodes of one show therefore draw the same picture. */
        return backToLibrary()
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return watchingPick('TV Shows'); })
          .then(function () { return page.waitForTimeout(900); })
          .then(function () {
            return page.evaluate(function () {
              var tiles = document.querySelectorAll('#rows .row.on .tile:not(.hidden)');
              return Array.prototype.map.call(tiles, function (t) {
                var it = t._item || {};
                return {
                  type: it.type || '',
                  show: it.grandparentRatingKey || '',
                  src: (t._img && t._img.src) || '',
                  showThumb: encodeURIComponent(it.grandparentThumb || 'none'),
                  ownThumb: encodeURIComponent(it.thumb || 'none')
                };
              });
            });
          })
          .then(function (tiles) {
            var eps = tiles.filter(function (t) { return t.type === 'episode'; });
            if (!eps.length) throw new Error('no episodes in the TV Shows cut');
            var byShow = {};
            eps.forEach(function (t) {
              if (t.src.indexOf(t.showThumb) < 0) {
                throw new Error('an episode tile is not its show\'s poster: ' + t.src);
              }
              if (t.src.indexOf(t.ownThumb) >= 0) {
                throw new Error('an episode tile is still its own still: ' + t.src);
              }
              if (byShow[t.show] && byShow[t.show] !== t.src) {
                throw new Error('two episodes of one show drew different tiles');
              }
              byShow[t.show] = t.src;
            });
          })
          /* And put the row back the way the rest of the run expects it. */
          .then(function () { return sidebarPick('Continue watching'); });
      });
    })

    .then(function () {
      return step('OK on an episode opens its series, at that episode', function () {
        /* An episode is never a dead end: the point of landing on the series
           page is that the next episode is one keypress away, which the copy
           chooser for a single episode never gave you. */
        let ep;
        return backToLibrary()
          .then(function () { return sidebarPick('Continue watching'); })
          .then(function () { return watchingPick('TV Shows'); })
          .then(function () {
            return page.evaluate(function () {
              const t = document.querySelector('#rows .row.on .tile.on');
              const it = (t && t._item) || {};
              return { type: it.type || '', show: it.grandparentTitle || '',
                       season: it.parentIndex, episode: it.index };
            });
          })
          .then(function (st) {
            if (st.type !== 'episode') throw new Error('the focused tile is a ' + st.type);
            ep = st;
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('!document.getElementById("show").classList.contains("hidden") &&' +
                           ' document.querySelector(".sh-episode.on") !== null',
                           'the series page for the episode', 20000);
          })
          .then(function () {
            return page.evaluate(function () {
              const chip = document.querySelector('#sh-seasons .chip.cur');
              const on = document.querySelector('.sh-episode.on');
              return {
                title: document.getElementById('sh-title').textContent.trim(),
                season: chip ? chip.textContent.trim() : '',
                episode: on.querySelector('.sh-ep-num').textContent.trim(),
                detail: !document.getElementById('detail').classList.contains('hidden')
              };
            });
          })
          .then(function (st) {
            if (st.detail) throw new Error('the episode opened its own page, not the series');
            if (st.title !== ep.show) {
              throw new Error('opened "' + st.title + '", not "' + ep.show + '"');
            }
            /* The season chip is named by the server ("Season 3"); what has to
               match is the number the episode says it belongs to. */
            if (!new RegExp('(^|\\D)' + ep.season + '$').test(st.season)) {
              throw new Error('opened on "' + st.season + '", not season ' + ep.season);
            }
            if (st.episode !== String(ep.episode)) {
              throw new Error('highlighted episode ' + st.episode + ', not ' + ep.episode);
            }
          })
          .then(function () { return shot('episode-to-series'); })
          /* And onward: the next episode is right there, with its own copies. */
          .then(function () { return press('ArrowDown'); })
          .then(function () { return page.keyboard.press('ArrowRight'); })
          .then(function () {
            return waitFor('!document.getElementById("detail").classList.contains("hidden") &&' +
                           ' document.querySelectorAll("#dt-actions .dt-act").length > 0',
                           'the action row for the next episode', 20000);
          })
          .then(detailFace)
          .then(function (st) {
            const chips = st.chips.join(' | ');
            const m = chips.match(/S(\d+)E(\d+)/);
            if (!m) throw new Error('no season/episode among the chips: ' + chips);
            if (Number(m[2]) === ep.episode) {
              throw new Error('moving down stayed on episode ' + ep.episode);
            }
          })
          .then(backToLibrary)
          .then(function () {
            /* The same show a second time is free: the guid lookups that found
               it on every server are what OK must not pay for twice. */
            const asks = [];
            function watch(r) { if (/\/library\/all\?.*guid=/.test(r.url())) asks.push(r.url()); }
            page.on('request', watch);
            return page.keyboard.press('Enter')
              .then(function () {
                return waitFor('!document.getElementById("show").classList.contains("hidden") &&' +
                               ' document.querySelector(".sh-episode.on") !== null',
                               'the series page a second time', 20000);
              })
              .then(function () { return page.waitForTimeout(400); })
              .then(function () {
                page.off('request', watch);
                if (asks.length) {
                  throw new Error('the series was resolved again: ' + asks.join(', '));
                }
              }, function (e) { page.off('request', watch); throw e; });
          })
          .then(backToLibrary)
          /* Put the mixed row back for the rest of the run. */
          .then(function () { return sidebarPick('Continue watching'); });
      });
    })

    .then(function () {
      return step('the last sidebar entry can be reached and is on screen', function () {
        /* There is no pointer on this device, so anything past the fold is
           simply unreachable unless the list winds itself.

           The generated library is small enough that the real sidebar happens
           to fit, which is exactly why this drives Sidebar.open directly with a
           section that does not — the fault is about long lists, and asserting
           it against a short one proves nothing. */
        return backToLibrary()
          .then(openSidebar)
          .then(function () {
            return page.evaluate(function () {
              var many = [], i;
              for (i = 0; i < 30; i++) many.push('Category ' + (i + 1));
              Sidebar.open([{ title: 'Films', categories: many, current: true }],
                           function () {}, 'library');
              return document.querySelectorAll('#sidebar .sb-row').length;
            });
          })
          .then(function (n) {
            if (n < 30) throw new Error('only ' + n + ' sidebar rows built');
            return press('ArrowDown', n);        // more than enough to hit the end
          })
          .then(function () { return page.waitForTimeout(300); })
          .then(function () {
            return page.evaluate(function () {
              var rows = document.querySelectorAll('#sidebar .sb-row');
              var last = rows[rows.length - 1];
              var panel = document.getElementById('sidebar').getBoundingClientRect();
              var r = last.getBoundingClientRect();
              return { focused: last.classList.contains('on'), label: last.textContent.trim(),
                       top: Math.round(r.top), bottom: Math.round(r.bottom),
                       panelBottom: Math.round(panel.bottom) };
            });
          })
          .then(function (st) {
            if (!st.focused) throw new Error('the last entry never took focus');
            if (st.top < 0 || st.bottom > st.panelBottom) {
              throw new Error('"' + st.label + '" is focused but off screen at ' +
                              st.top + '–' + st.bottom + ' of ' + st.panelBottom);
            }
          })
          .then(function () { return press('ArrowLeft'); });        // close it again
      });
    })

    .then(function () {
      return step('the Mantis palette is what the stylesheet is serving', function () {
        /* Cheap, and it catches a half-applied swap: the accent is the one
           colour every focused thing on every screen is drawn in. */
        return page.evaluate(function () {
          var css = getComputedStyle(document.documentElement);
          var layer = getComputedStyle(document.querySelector('#hero-art .hero-layer'));
          var strip = getComputedStyle(document.querySelector('#rows .strip'));
          return { ac: css.getPropertyValue('--ac').trim(),
                   bg: css.getPropertyValue('--bg').trim(),
                   move: css.getPropertyValue('--t-move').trim(),
                   fade: css.getPropertyValue('--t-fade').trim(),
                   heroFor: layer.transitionDuration,
                   stripFor: strip.transitionDuration };
        }).then(function (st) {
          if (st.ac !== '#9d93d6') throw new Error('--ac is ' + st.ac + ', not the violet');
          if (st.bg !== '#161826') throw new Error('--bg is ' + st.bg + ', not the Mantis ground');
          if (st.move !== '340ms') throw new Error('--t-move is ' + st.move);
          if (st.fade !== '620ms') throw new Error('--t-fade is ' + st.fade);
          /* The backdrop crossfades gently; the UI's own motion must not be
             slowed with it. */
          if (st.heroFor !== '0.62s') throw new Error('a hero layer fades over ' + st.heroFor);
          if (st.stripFor !== '0.34s') throw new Error('a strip slides over ' + st.stripFor);
        });
      });
    })

    .then(function () {
      return step('the hero art follows focus, and comes back', function () {
        /* Resting on a title, moving on, and coming back used to leave the
           previous backdrop on screen: the art was painted from Meta's
           callback, and Meta skips an item whose payload it already holds.

           The hero and the focused tile are deliberately different pictures now
           — the two steps above are what check that — so what is checked here is
           that the backdrop belongs to whatever is under focus: it moves when
           focus moves, and comes back unchanged when focus comes back. */
        function state() {
          return page.evaluate(function () {
            var lit = document.querySelector('#hero-art .hero-layer.on');
            return { hero: lit ? lit.style.backgroundImage : '',
                     layers: document.querySelectorAll('#hero-art .hero-layer').length,
                     title: document.getElementById('mh-title').textContent.trim() };
          });
        }
        function settle() { return page.waitForTimeout(900); }
        var atA;
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })      // to the first row
          .then(settle)
          .then(function () { return press('ArrowRight'); })       // rest on A
          .then(settle)
          .then(state)
          .then(function (st) {
            /* Two layers, one lit: a crossfade needs both, and a stack of them
               would mean every backdrop stayed in memory. */
            if (st.layers !== 2) {
              throw new Error(st.layers + ' hero layers, not 2');
            }
            if (!st.hero) throw new Error('no backdrop on "' + st.title + '"');
            atA = st;
          })
          .then(function () { return press('ArrowRight'); })       // rest on B
          .then(settle)
          .then(state)
          .then(function (st) {
            if (st.hero === atA.hero) {
              throw new Error('the backdrop did not move from "' + atA.title +
                              '" to "' + st.title + '"');
            }
          })
          .then(function () { return press('ArrowLeft'); })        // back to A, now cached
          .then(settle)
          .then(state)
          .then(function (st) {
            if (st.hero !== atA.hero) {
              throw new Error('back on "' + st.title + '" the backdrop is not the one it had');
            }
          })
          /* And it must survive a fast sweep, where every item but the last is
             passed over before its request could have finished. */
          .then(function () { return press('ArrowRight', 12); })
          .then(settle)
          .then(state)
          .then(function (swept) {
            if (swept.hero === atA.hero) {
              throw new Error('after a fast sweep the backdrop is still the one from "' +
                              atA.title + '"');
            }
            /* Stepping off and back on has to land on the same picture, which is
               what says the backdrop belongs to the item and not to the sweep. */
            return press('ArrowLeft')
              .then(settle)
              .then(function () { return press('ArrowRight'); })
              .then(settle)
              .then(state)
              .then(function (st) {
                if (st.hero !== swept.hero) {
                  throw new Error('"' + st.title + '" has a different backdrop the second time');
                }
              });
          });
      });
    })

    .then(function () {
      return step('stepping down keeps the film on screen, over one row and a peek', function () {
        /* The tall hero leaves room for one row. If it does not collapse when
           the focus moves off row 0, the row you just moved to is drawn below
           the fold and moving down looks like nothing happening — and if it
           collapses to a bare band, browsing throws the picture away, which is
           the other half of what this step is for. */
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })
          .then(function () { return page.waitForTimeout(500); })
          .then(function () {
            return page.evaluate(function () {
              return document.getElementById('browse').classList.contains('dense');
            });
          })
          .then(function (dense) {
            if (dense) throw new Error('the hero is a band while the first row is focused');
          })
          .then(function () { return press('ArrowDown'); })
          .then(function () { return page.waitForTimeout(600); })
          .then(function () {
            return page.evaluate(function () {
              var row = document.querySelector('#rows .row.on');
              var tile = row && row.querySelector('.tile.on');
              var vp = document.getElementById('viewport').getBoundingClientRect();
              var t = tile && tile.getBoundingClientRect();
              /* Every row the pool has drawn, in the order they sit, with how
                 much of each one the viewport actually shows. */
              var rows = Array.prototype.map.call(
                document.querySelectorAll('#rows .row:not(.hidden)'), function (r) {
                  var b = r.getBoundingClientRect();
                  return { height: Math.round(b.height),
                           top: Math.round(b.top),
                           shown: Math.round(Math.min(b.bottom, vp.bottom) -
                                             Math.max(b.top, vp.top)) };
                }).sort(function (a, b) { return a.top - b.top; });
              /* Tiles whose whole width is on screen — the row is drawn wider
                 than the panel and clipped, so "seven across" is a count of
                 the ones you can actually see. */
              var across = Array.prototype.filter.call(
                row ? row.querySelectorAll('.tile:not(.hidden)') : [], function (el) {
                  var b = el.getBoundingClientRect();
                  return b.left >= -1 && b.right <= 1921;
                }).length;
              return {
                dense: document.getElementById('browse').classList.contains('dense'),
                label: row ? row.querySelector('.row-label').textContent.trim() : '',
                art: tile ? { w: Math.round(tile.querySelector('.tile-inner').offsetWidth),
                              h: Math.round(tile.querySelector('.tile-inner').offsetHeight) }
                          : null,
                across: across,
                top: t ? Math.round(t.top) : null, bottom: t ? Math.round(t.bottom) : null,
                vpTop: Math.round(vp.top), vpBottom: Math.round(vp.bottom),
                rows: rows,
                heroOpacity: Number(getComputedStyle(document.getElementById('hero-art')).opacity),
                desc: document.getElementById('mh-desc').textContent.trim(),
                cast: document.getElementById('mh-cast').textContent.trim()
              };
            });
          })
          .then(function (st) {
            if (!st.dense) throw new Error('the hero did not collapse off the first row');
            if (st.top === null) throw new Error('no focused tile on row 1');
            /* Portrait, 2:3, seven across. The row arithmetic hangs off these,
               so a change here is a change to how much of the rail you see. */
            if (!st.art || st.art.w !== 209 || st.art.h !== 314) {
              throw new Error('the tile art is ' + JSON.stringify(st.art) + ', not 209×314');
            }
            if (st.across !== 7) {
              throw new Error(st.across + ' tiles fit across, not 7');
            }
            if (st.top < st.vpTop - 1 || st.bottom > st.vpBottom + 1) {
              throw new Error('"' + st.label + '" is focused but drawn at ' + st.top + '–' +
                              st.bottom + ', outside the viewport ' + st.vpTop + '–' + st.vpBottom);
            }
            /* The header still carries the film: the picture behind it, what it
               is about, and who is in it. */
            if (!(st.heroOpacity > 0)) {
              throw new Error('the backdrop was thrown away off the first row');
            }
            if (!st.desc) throw new Error('the description vanished off the first row');
            if (!st.cast) throw new Error('the key actors vanished off the first row');
            /* One whole row under the header and the next peeking, which is the
               only thing saying there is more below. A 2:3 poster is taller than
               the landscape tile this replaced, so one row is the trade that was
               made for it, not a regression. */
            var whole = st.rows.filter(function (r) { return r.shown >= r.height - 1; });
            var peek = st.rows.filter(function (r) {
              return r.shown > 0 && r.shown < r.height - 1;
            });
            if (whole.length < 1) {
              throw new Error('no whole row fits under the header');
            }
            if (!peek.length) {
              throw new Error('no row peeks below the fold, so nothing says there is more');
            }
          })
          .then(function () { return shot('dense'); })
          /* And at the *end* of the list, where the window stops scrolling and
             the last row sits wherever the clamp leaves it. This is where the
             row height and the viewport height have to agree: get it wrong and
             the final row's title is below the clip, invisible. Every section
             has an All row at the bottom, so there is always one to land on. */
          .then(function () { return press('ArrowDown', 12); })
          .then(function () { return page.waitForTimeout(700); })
          .then(function () {
            return page.evaluate(function () {
              var row = document.querySelector('#rows .row.on');
              var tile = row && row.querySelector('.tile.on');
              var title = tile && tile.querySelector('.tile-title');
              var vp = document.getElementById('viewport').getBoundingClientRect();
              var n = title && title.getBoundingClientRect();
              return {
                label: row ? row.querySelector('.row-label').textContent.trim() : '',
                titleBottom: n ? Math.round(n.bottom) : null,
                vpBottom: Math.round(vp.bottom)
              };
            });
          })
          .then(function (st) {
            if (st.titleBottom === null) throw new Error('no focused tile on the last row');
            if (st.titleBottom > st.vpBottom + 1) {
              throw new Error('the last row is clipped: "' + st.label + '" title ends at ' +
                              st.titleBottom + ', past the viewport at ' + st.vpBottom);
            }
          });
      });
    });
};
