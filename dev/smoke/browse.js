'use strict';
/* the rail: artwork, paging, the All row, kids */
module.exports = function (h) {
  const { FILMS, artLookups, tilePosters, shot, debugLine, press, waitFor, step,
    sidebarPick, backToLibrary, searchFor, pictures, openTitle, openChooser,
    sourceRows, detailFace, kickerParts, page, titles } = h;

  /* What every tile of the focused row is showing, against what Art says that
     tile's own item should show: fresh is its own picture, stale is one that
     belongs to another film, blank is waiting on the settle. Blank and stale
     tiles are named by their title, which is never deferred and so is there
     whatever the picture is doing.

     The reading is taken in the page rather than over a round trip, because a
     round trip is slower than the 160ms settle: by the time it lands the rail
     has stopped and every tile is its own again. Recording it from a keydown
     listener — registered after the app's, so it runs after the render — is
     what catches the rail actually moving. */
  function installTileArt() {
    return page.evaluate(function () {
      if (window.__tileArt) return;
      /* Where the app has just put something, which is not where it is being
         drawn: the strip transitions into place, so a rect read from a keydown
         is the position it is leaving rather than the one it is taking. */
      function xOf(el) {
        var m = /translate\((-?[\d.]+)px/.exec(el.style.transform || el.style.webkitTransform || '');
        return m ? parseFloat(m[1]) : 0;
      }
      window.__tileArt = function () {
        var out = { focused: 'none', fresh: 0, stale: [], blank: [] };
        var row = document.querySelector('#rows .row.on');
        if (!row) return out;
        var base = xOf(row.querySelector('.strip'));
        var tiles = row.querySelectorAll('.tile');
        for (var i = 0; i < tiles.length; i++) {
          var t = tiles[i];
          if (t.classList.contains('hidden') || !t._item) continue;
          var x = base + xOf(t);
          if (x + 209 <= 0 || x >= 1920) continue;            // wound off the side
          var title = t.querySelector('.tile-title').textContent.trim();
          var got = t.querySelector('img').getAttribute('src') || '';
          var state = !got ? 'blank' : (got === Art.tile(t._item, 209, 314) ? 'fresh' : 'stale');
          if (t.classList.contains('on')) out.focused = state;
          if (state === 'fresh') out.fresh++; else out[state].push(title || '(no title)');
        }
        return out;
      };
      document.addEventListener('keydown', function () {
        if (window.__sweep) window.__sweep.push(window.__tileArt());
      }, false);
    });
  }

  function tileArt() {
    return installTileArt().then(function () {
      return page.evaluate(function () { return window.__tileArt(); });
    });
  }

  /* Every reading taken during the presses fn makes, one per key, each as the
     app left the rail at that moment. */
  function sweepReadings(fn) {
    return installTileArt()
      .then(function () { return page.evaluate(function () { window.__sweep = []; }); })
      .then(fn)
      .then(function () {
        return page.evaluate(function () {
          var got = window.__sweep; window.__sweep = null; return got;
        });
      });
  }

  return h.ready()

    .then(function () {
      return step('posters load', function () {
        return waitFor('(function(){var i=document.querySelectorAll("#rows img");' +
                       'for(var n=0;n<i.length;n++) if(i[n].naturalWidth>0) return true;' +
                       'return false;})()', 'a loaded poster');
      });
    })

    .then(function () {
      return step('artwork is looked up once per title, and only for what is on screen', function () {
        let first;
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () {
            if (!artLookups.length) throw new Error('no artwork was looked up at all');
            /* Four rows of twelve tiles is the whole pool; anything near the
               library's size would mean the deferred rows were fetched too. */
            if (artLookups.length > 60) {
              throw new Error(artLookups.length + ' lookups for one screen of tiles');
            }
          })
          /* Walk the row to its end once, so every tile in it has been drawn,
             then walk it again: the second pass must cost nothing. */
          .then(function () { return press('ArrowRight', 8); })
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () { first = artLookups.length; })
          .then(function () { return press('ArrowLeft', 8); })
          .then(function () { return page.waitForTimeout(600); })
          .then(function () { return press('ArrowRight', 8); })
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () {
            if (artLookups.length !== first) {
              throw new Error('walking the row again cost ' + (artLookups.length - first) +
                              ' more lookups');
            }
          });
      });
    })

    .then(function () {
      return step('a moving rail fetches only what has the focus, and fills in when it stops', function () {
        /* Sweeping used to cost a poster and a lookup per tile passed, every one
           of them for a tile already gone by. A tile that has not paid yet
           waits on the surface colour; what it must never do is fetch while the
           rail is moving, and what it must never show is another film. */
        const SWEEP = 10;
        let before;
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })
          .then(function () { return page.waitForTimeout(1500); })
          /* Two rows down in one movement, onto a row that was below the fold:
             none of its tiles has ever had a picture of its own. */
          .then(function () {
            return sweepReadings(function () { return press('ArrowDown', 2); });
          })
          .then(function (readings) {
            const st = readings[readings.length - 1];
            if (st.focused !== 'fresh') {
              throw new Error('the focused tile is ' + st.focused + ', not its own poster');
            }
            if (st.blank.length < 5) {
              throw new Error('only ' + st.blank.length + ' of ' +
                              (st.blank.length + st.fresh + st.stale.length) +
                              ' tiles waited — the rail is still fetching while it moves');
            }
          })
          .then(function () { return page.waitForTimeout(1500); })
          .then(tileArt)
          .then(function (st) {
            if (st.blank.length) {
              throw new Error('after resting, no poster on: ' + st.blank.join(', '));
            }
          })
          /* Well inside the row and settled, so from here every press winds
             exactly one new tile into the strip. */
          .then(function () { return press('ArrowRight', 4); })
          .then(function () { return page.waitForTimeout(1500); })
          .then(function () { before = tilePosters.length; })
          .then(function () { return press('ArrowRight', SWEEP); })
          .then(function () {
            /* One request per tile passed is what the old code cost; anything
               near that means the sweep is still fetching what it goes by. */
            const during = tilePosters.length - before;
            if (during * 2 >= SWEEP) {
              throw new Error(during + ' poster requests while sweeping past ' + SWEEP + ' tiles');
            }
          })
          .then(function () { return page.waitForTimeout(1500); })
          .then(tileArt)
          .then(function (st) {
            if (st.blank.length) {
              throw new Error('after the sweep settled, no poster on: ' + st.blank.join(', '));
            }
          });
      });
    })

    .then(function () {
      return step('a tile carries no picture but its own while the row sweeps', function () {
        /* The pool hands each element the item its neighbour was showing, so a
           picture kept across that reassignment is another film's, travelling
           with the tile and swapping when the settle catches up. Every press is
           read as the app leaves it: nothing may be stale, a tile still waiting
           shows the surface colour, and its title is there throughout.

           Two rows down first, and well into that one: Continue watching is
           short enough that the strip stops winding, and a strip that does not
           wind never hands a tile anything new. */
        return backToLibrary()
          .then(function () { return press('ArrowUp', 8); })
          .then(function () { return press('ArrowDown', 2); })
          .then(function () { return press('ArrowRight', 4); })
          .then(function () { return page.waitForTimeout(1500); })
          .then(function () {
            return sweepReadings(function () { return press('ArrowRight', 6); });
          })
          .then(function (readings) {
            if (readings.length !== 6) {
              throw new Error('read ' + readings.length + ' of 6 presses');
            }
            readings.forEach(function (st, n) {
              if (st.stale.length) {
                throw new Error('press ' + (n + 1) + ' left another film\'s poster on: ' +
                                st.stale.join(', '));
              }
              if (st.focused !== 'fresh') {
                throw new Error('press ' + (n + 1) + ': the focused tile is ' + st.focused +
                                ', not its own poster');
              }
              if (st.blank.indexOf('(no title)') >= 0) {
                throw new Error('press ' + (n + 1) + ': a waiting tile has no title either');
              }
            });
          })
          .then(function () { return page.waitForTimeout(1500); })
          .then(tileArt)
          .then(function (st) {
            if (st.stale.length || st.blank.length) {
              throw new Error('after the sweep settled: ' +
                              st.stale.concat(st.blank).join(', '));
            }
          });
      });
    })

    .then(function () {
      return step('the tile is a poster and the hero behind it is a backdrop', function () {
        /* The whole point of the feature: the tile asks for a different kind of
           picture from the hero, so the two can never be the same image. Same
           title, both from TMDB, one portrait and one wide. */
        return searchFor(titles.manyShots.title)
          .then(function () { return page.waitForTimeout(900); })
          .then(pictures)
          .then(function (st) {
            if (!st.tile.shot) throw new Error('the tile is not a TMDB picture: ' + st.tile.url);
            if (!st.hero.shot) throw new Error('the hero is not a TMDB picture: ' + st.hero.url);
            if (st.tile.shot.title !== st.hero.shot.title) {
              throw new Error('the hero is title ' + st.hero.shot.title +
                              ' while the tile is ' + st.tile.shot.title);
            }
            if (st.tile.shot.kind !== 'poster') {
              throw new Error('the tile drew a ' + st.tile.shot.kind + ': ' + st.tile.url);
            }
            if (st.hero.shot.kind !== 'backdrop') {
              throw new Error('the hero drew a ' + st.hero.shot.kind + ': ' + st.hero.url);
            }
            if (!st.tile.painted) throw new Error('the tile drew nothing');
          })
          .then(function () { return shot('artwork'); })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      return step('a title with no TMDB poster falls back to a Plex one', function () {
        /* TMDB has a backdrop for this title and no poster at all, so the tile
           must fall back to Plex rather than go blank or borrow the hero's — a
           16:9 picture in the 2:3 box is the smear the whole shape exists to
           stop. */
        return searchFor(titles.oneShot.title)
          .then(function () { return page.waitForTimeout(900); })
          .then(pictures)
          .then(function (st) {
            if (!st.hero.shot) throw new Error('the hero is not a TMDB picture: ' + st.hero.url);
            if (st.tile.shot) {
              throw new Error('the tile took TMDB art there was none of: ' + st.tile.url);
            }
            if (st.tile.url.indexOf('/photo/:/transcode') < 0) {
              throw new Error('the tile did not fall back to Plex: ' + st.tile.url);
            }
            /* Plex's own poster, never its wide `art`: the box is 2:3. */
            if (st.tile.url.indexOf('%2Fthumb%2F') < 0) {
              throw new Error('the tile fell back to something other than a poster: ' +
                              st.tile.url);
            }
            if (!st.tile.painted) throw new Error('the tile drew nothing');
          })
          .then(function () { return press('Backspace'); });
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
          .then(function () { return shot('browse'); });
      });
    })

    .then(function () {
      return step('the header carries the description and the cast, on both screens', function () {
        /* The one TMDB request that fetched the backdrops carries the overview
           and the billing too, so the header can say what the film is without
           a Plex metadata fetch per tile. The mock's overview names itself, and
           its actors are named after the title, so neither can be confused with
           the Plex summary that stands in until TMDB answers. */
        let head;
        return searchFor(titles.manyShots.title)
          .then(function () { return page.waitForTimeout(1200); })
          .then(function () {
            return page.evaluate(function () {
              return { desc: document.getElementById('mh-desc').textContent.trim(),
                       cast: document.getElementById('mh-cast').textContent.trim() };
            });
          })
          .then(function (st) {
            if (!st.desc.startsWith('TMDB overview')) {
              throw new Error('the header description is not TMDB\'s: "' + st.desc + '"');
            }
            if (!st.cast.startsWith('Actor ')) {
              throw new Error('the key actors did not come from TMDB: "' + st.cast + '"');
            }
            head = st;
          })
          /* And OK opens a page that says the same things, not a second
             description of the same film. */
          .then(function () { return openTitle(titles.manyShots.title); })
          .then(function () {
            return page.evaluate(function () {
              return { desc: document.getElementById('dt-summary').textContent.trim(),
                       cast: document.getElementById('dt-names').textContent.trim() };
            });
          })
          .then(function (st) {
            if (st.desc !== head.desc) {
              throw new Error('the detail page describes it differently: "' + st.desc + '"');
            }
            if (st.cast !== head.cast) {
              throw new Error('the detail page bills it differently: "' + st.cast + '"');
            }
          })
          .then(function () { return shot('header'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('a film says what it is, in chips and a kicker with no gaps', function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            /* The kicker's genre and director only exist once metadata lands. */
            return waitFor('document.getElementById("dt-kicker").textContent.indexOf("·") > 0',
                           'the kicker to fill in', 15000);
          })
          .then(detailFace)
          .then(function (st) {
            const parts = kickerParts(st.kicker);
            if (parts[0] !== 'movie') {
              throw new Error('the kicker does not lead with what it is: "' + st.kicker + '"');
            }
            if (parts.length !== 3) {
              throw new Error('expected type, genre and director: "' + st.kicker + '"');
            }
            /* Certificate, year, run time and the quality of the copy that
               would play — each present only if we have it. */
            const chips = st.chips.join(' | ');
            if (!st.chips.some(function (c) { return /^\d{4}$/.test(c); })) {
              throw new Error('no year among the chips: ' + chips);
            }
            if (!st.chips.some(function (c) { return /^(\d+h )?\d+m$/.test(c); })) {
              throw new Error('no runtime among the chips: ' + chips);
            }
            if (!st.chips.some(function (c) { return /^(4K|\d+p|SD)( HDR)?$/.test(c); })) {
              throw new Error('no quality among the chips: ' + chips);
            }
            if (st.chips.some(function (c) { return !c; })) {
              throw new Error('an empty chip: ' + chips);
            }
          })
          .then(function () { return shot('detail-face'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('every score is labelled with the source it came from', function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            return waitFor('document.querySelectorAll("#dt-ratings .dt-rating").length > 0',
                           'the ratings row', 15000);
          })
          .then(detailFace)
          .then(function (st) {
            /* Plex gives critics and audience; TMDB gives its own. We have no
               IMDb, so nothing may claim to be one. */
            st.ratings.forEach(function (r) {
              if (!/^\d+% Critics$|^\d+% Audience$|^[\d.]+ TMDB$/.test(r)) {
                throw new Error('a score with no honest label: "' + r + '"');
              }
            });
            if (st.glyphs !== st.ratings.length) {
              throw new Error(st.glyphs + ' glyphs for ' + st.ratings.length + ' scores');
            }
            if (/IMDb/i.test(st.page)) {
              throw new Error('a score labelled IMDb, which we never fetched');
            }
          })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('a cast member with no photograph shows initials', function () {
        /* Every mock actor has a picture, so the fallback is only reached by
           taking the pictures away — Plex.photoUrl is what castHtml asks. */
        return page.evaluate(function () {
          Plex._photoUrl = Plex.photoUrl;
          Plex.photoUrl = function () { return ''; };
        })
          .then(function () { return openTitle(titles.directPlays.title); })
          .then(function () {
            return waitFor('document.querySelectorAll("#dt-cast .dt-actor").length > 0',
                           'the cast row', 15000);
          })
          .then(function () {
            return page.evaluate(function () {
              return {
                blanks: Array.prototype.map.call(
                  document.querySelectorAll('#dt-cast .dt-actor-blank'),
                  function (b) { return b.textContent.trim(); }),
                names: Array.prototype.map.call(
                  document.querySelectorAll('#dt-cast .dt-actor-name'),
                  function (n) { return n.textContent.trim(); }),
                broken: document.querySelectorAll('#dt-cast img').length
              };
            });
          })
          .then(function (st) {
            if (st.broken) throw new Error('an img with no picture behind it');
            if (st.blanks.length !== st.names.length) {
              throw new Error(st.blanks.length + ' discs for ' + st.names.length + ' actors');
            }
            st.blanks.forEach(function (letters, i) {
              const want = st.names[i].split(/\s+/).slice(0, 2)
                .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
              if (letters !== want) {
                throw new Error('"' + st.names[i] + '" is shown as "' + letters + '"');
              }
            });
          })
          .then(backToLibrary)
          .then(function () {
            return page.evaluate(function () { Plex.photoUrl = Plex._photoUrl; });
          });
      });
    })

    .then(function () {
      return step('the All row knows its size without crawling it', function () {
        return press('ArrowDown', 5)
          .then(function () {
            return waitFor('/All films\\s+\\(\\d+\\)/.test(document.querySelector("#rows").textContent)',
                           'the All row count');
          })
          .then(function () {
            return page.evaluate(function () {
              const m = document.querySelector('#rows').textContent.match(/All films\s+\((\d+)\)/);
              return m ? Number(m[1]) : 0;
            });
          })
          .then(function (count) {
            /* Every film is on at least one server and many are on both, so the
               estimate starts at the sum of the two and settles down towards the
               true count as the walk finds duplicates. It must never claim fewer
               than the library holds. */
            if (count < FILMS) throw new Error('claims only ' + count + ' films of ' + FILMS);
            if (count > FILMS * 2) throw new Error('claims ' + count + ', more than both servers hold');
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
      return step('the All row spans every movie library, deduplicated', function () {
        /* Main splits its films across two libraries and Backup has a third, so
           the count proves both halves of the fold: more than any one library
           holds, and fewer than all three added up. The walk above has already
           found duplicates, which is what brings it down off the sum. */
        return page.evaluate(function () {
          const m = document.querySelector('#rows').textContent.match(/All films\s+\((\d+)\)/);
          return m ? Number(m[1]) : 0;
        }).then(function (count) {
          if (count <= titles.movies.biggest) {
            throw new Error('All films claims ' + count + ', no more than the biggest library (' +
                            titles.movies.biggest + '): the libraries were not merged');
          }
          if (count >= titles.movies.sum) {
            throw new Error('All films claims ' + count + ' of ' + titles.movies.sum +
                            ' copies: nothing was deduplicated');
          }
        });
      });
    })

    .then(function () {
      return step('a film in two of one server\'s libraries keeps both copies', function () {
        /* Main holds 4K remuxes of films it also has at 1080, in a library of
           their own. Folded into one Movies section they are one entry — but
           two copies, and only one of them plays. Reached by walking the All
           row rather than by searching: search folds per server, which is
           right for a hub and would hide the second copy here. */
        function findTwin(left) {
          return page.evaluate(function () {
            const tile = document.querySelector('#rows .row.on .tile.on');
            const item = tile && tile._item;
            if (!item) return null;
            const copies = Merge.sources(item);
            const here = copies.filter(function (c) { return c._server === item._server; });
            return { title: item.title, copies: copies.length, sameServer: here.length };
          }).then(function (st) {
            if (st && st.sameServer > 1) return st;
            if (left <= 0) throw new Error('no film with two copies on one server in the All row');
            return press('ArrowRight').then(function () { return findTwin(left - 1); });
          });
        }
        let entry;
        return findTwin(60)
          .then(function (st) { entry = st; return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('(function(){var c=document.querySelector("#dt-actions .dt-act-cap");' +
                           'return c && !/checking/.test(c.textContent);})()',
                           'a verdict for ' + entry.title, 20000);
          })
          .then(function () { return openChooser('source'); })
          .then(function () {
            /* Every copy has to be checked before the notes mean anything. */
            return waitFor('(function(){var r=document.querySelectorAll(' +
                           '"#dt-menu:not(.hidden) .menu-row");' +
                           'if (!r.length) return false;' +
                           'for (var i=0;i<r.length;i++) if (/checking/.test(r[i].textContent)) return false;' +
                           'return true;})()', 'every copy of ' + entry.title + ' checked', 20000);
          })
          .then(sourceRows)
          .then(function (src) {
            /* The chooser lists exactly what the merge holds — a copy dropped in
               the fold would show up as one row fewer. */
            if (src.length !== entry.copies) {
              throw new Error(src.length + ' copies listed for ' + entry.title +
                              ' but the merge holds ' + entry.copies);
            }
            const names = {};
            src.forEach(function (s) { names[s.server] = (names[s.server] || 0) + 1; });
            const twice = Object.keys(names).filter(function (n) { return names[n] > 1; });
            if (!twice.length) throw new Error('no server listed twice: ' +
                                               src.map(function (s) { return s.server; }).join(' | '));
            const media = src.filter(function (s) { return s.server === twice[0]; })
                             .map(function (s) { return s.version; });
            if (media[0] === media[1]) {
              throw new Error('the same server\'s two copies read alike: ' + media[0]);
            }
            /* And they differ where it counts: one plays, one is refused. */
            const text = src.map(function (s) { return s.verdict; }).join(' | ');
            if (!/direct play/.test(text) || !/4K/.test(text)) {
              throw new Error('expected a playable copy and a refused 4K one: ' + text);
            }
          })
          .then(function () { return press('Backspace'); })
          .then(function () { return shot('detail-two-libraries'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('kids rows exclude everything above the cutoff', function () {
        return sidebarPick('Kids')
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
    });
};
