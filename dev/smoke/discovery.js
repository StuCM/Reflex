'use strict';
/* Discovery: your own categories, drawn from TMDB, asking the servers only
   when a title is actually rested on or opened. */
module.exports = function (h) {
  const makeShow = require('../library').makeShow;
  const { shot, press, waitFor, step, sidebarPick, backToLibrary, page, pictures, actionRow } = h;

  /* Every title any server was searched for. This is the cost the whole page
     exists to avoid: one per title you stop on, and never one per title drawn.
     Counted off the wire, and by title rather than by request — a title costs
     one search per server, which is two here. The control is the step that
     asserts exactly one after resting on a tile. */
  const guids = [];
  page.on('request', function (r) {
    const query = r.url().match(/\/hubs\/search\?(.*)$/);
    if (!query) return;
    const term = /(?:^|&)query=([^&]+)/.exec(query[1]);
    if (term) guids.push(decodeURIComponent(term[1]));
  });

  /* Every page of Trending TMDB was asked for, off the wire — the control for
     the paging step is that this collector is not empty. */
  const trendingPages = [];
  page.on('request', function (r) {
    const m = /\/trending\/movie\/week\?(.*)$/.exec(r.url());
    const n = m && /(?:^|&)page=(\d+)/.exec(m[1]);
    if (n) trendingPages.push(Number(n[1]));
  });

  function asked(n) {
    return trendingPages.filter(function (p) {
      return p === n;
    }).length;
  }

  function titlesAsked(from) {
    const seen = [];
    guids.slice(from).forEach(function (g) {
      if (seen.indexOf(g) < 0) seen.push(g);
    });
    return seen;
  }

  /* The rows the rail is actually showing, in the order they are on screen.
     The pool is four elements and they are recycled, so the DOM order is not
     the row order — _row is. */
  function railRows() {
    return page.evaluate(function () {
      const out = [];
      Array.prototype.forEach.call(document.querySelectorAll('#rows .row'), function (el) {
        if (el.classList.contains('hidden') || el._row < 0) return;
        out.push({
          at: el._row,
          label: el.querySelector('.row-label').textContent.trim(),
          tiles: el.querySelectorAll('.tile:not(.hidden)').length,
          named: Array.prototype.filter.call(
            el.querySelectorAll('.tile:not(.hidden)'),
            function (t) {
              return t._name.textContent.trim();
            },
          ).length,
          on: el.classList.contains('on'),
        });
      });
      out.sort(function (a, b) {
        return a.at - b.at;
      });
      return out;
    });
  }

  /* Every Plex metadata read: an unheld page must make none, and the held
     film's page is the control that this collector sees them at all. */
  const metadataReads = [];
  page.on('request', function (r) {
    if (/\/library\/metadata\//.test(r.url())) metadataReads.push(r.url());
  });

  /* OK on a title neither server holds: its TMDB page, no Play, a Trailer that
     loads the recap frame, and nothing asked of Plex. Leaves the rail focused. */
  function unheldPage(title) {
    let reads;
    return settle()
      .then(function () {
        reads = metadataReads.length;
        return page.keyboard.press('Enter');
      })
      .then(function () {
        return waitFor(
          '!document.getElementById("detail").classList.contains("hidden") &&' +
            ' document.getElementById("dt-title").textContent.trim() === ' +
            JSON.stringify(title) +
            ' && document.getElementById("dt-chips").textContent' +
            '.indexOf("Not available on the server") >= 0' +
            ' && document.getElementById("dt-summary").textContent' +
            '.indexOf("TMDB overview for") >= 0' +
            ' && !!document.querySelector("#dt-actions [data-act=trailer]")',
          'the page for ' + title + ' with its TMDB overview and trailer',
          20000,
        );
      })
      .then(actionRow)
      .then(function (row) {
        if (
          row.some(function (a) {
            return a.act === 'play';
          })
        ) {
          throw new Error('a title nobody holds has a Play button');
        }
      })
      .then(function () {
        return page.keyboard.press('Enter');
      })
      .then(function () {
        return waitFor(
          '/^\\/__ytembed\\/trailer\\d+\\?autoplay=1$/.test(' +
            'document.getElementById("recap-frame").getAttribute("src"))',
          'the recap frame to load the TMDB trailer',
        );
      })
      .then(function () {
        return press('Backspace');
      })
      .then(function () {
        if (metadataReads.length !== reads) {
          throw new Error('an unheld page read Plex metadata: ' + metadataReads.slice(reads));
        }
        return press('Backspace');
      });
  }

  /* The masthead's own line about the focused title, and which title that is. */
  function masthead() {
    return page.evaluate(function () {
      return {
        title: document.getElementById('mh-title').textContent.trim(),
        meta: document.getElementById('mh-meta').textContent.trim(),
      };
    });
  }

  /* Walk the rail to a named row. By its position in the configured list rather
     than by what is drawn: the pool is four elements, so a row two above the
     focus is not on screen to be found. */
  function toRow(label) {
    const want = ALL.indexOf(label);
    if (want < 0) throw new Error('no category called ' + label);
    return railRows().then(function (rows) {
      const at = rows.find(function (r) {
        return r.on;
      });
      const by = want - (at ? at.at : 0);
      return press(by > 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(by));
    });
  }

  /* Long enough that every debounced lookup the page was going to make has been
     made — the assertions are about what did NOT happen, so they have to be
     asked after the app has had every chance to do it. */
  function settle() {
    return page.waitForTimeout(1500);
  }

  /* js/config.js, in order. The first four are what the four-element pool can
     show at once; the fifth is reached by walking down to it. */
  const ALL = [
    'Trending this week',
    'On Netflix',
    'On Prime Video',
    'Science fiction',
    'Because of what you have been watching',
    'Trending shows this week',
    'Shows on Netflix',
    'Shows on Prime Video',
    'Sci-fi & fantasy shows',
  ];
  const WANT = ALL.slice(0, 4);
  let mark = 0;
  let held = '';

  return h
    .ready()

    .then(function () {
      return step(
        'discovery draws its categories from TMDB and asks the servers nothing',
        function () {
          return (
            backToLibrary()
              .then(function () {
                mark = guids.length;
              })
              .then(function () {
                return sidebarPick('Discovery');
              })
              .then(function () {
                return waitFor(
                  '(function(){var n=0,i,r=document.querySelectorAll("#rows .row");' +
                    'for(i=0;i<r.length;i++) if(!r[i].classList.contains("hidden")) n++;' +
                    'return n >= 4;})()',
                  'four category rows',
                  20000,
                );
              })
              /* Read the count the moment the rows are up: a page that resolved
               its titles to paint them has already spent it by now. */
              .then(function () {
                const spent = titlesAsked(mark).length;
                if (spent) {
                  throw new Error(
                    'painting Discovery cost ' +
                      spent +
                      ' searches, ' +
                      'and the point of the page is that it costs none',
                  );
                }
                return railRows();
              })
              .then(function (rows) {
                const got = rows.map(function (r) {
                  return r.label;
                });
                WANT.forEach(function (label, i) {
                  if (got[i] !== label) {
                    throw new Error(
                      'row ' +
                        i +
                        ' is "' +
                        got[i] +
                        '", wanted "' +
                        label +
                        '" — the categories are js/config.js in order',
                    );
                  }
                });
                rows.forEach(function (r) {
                  if (!r.tiles || r.named !== r.tiles) {
                    throw new Error(r.label + ': ' + r.named + ' of ' + r.tiles + ' tiles named');
                  }
                });
              })
              /* Drawn is not painted: the poster has to be TMDB's own, since the
               entry has no Plex thumb to fall back to. */
              .then(function () {
                return waitFor(
                  '(function(){var i=document.querySelector("#rows .row.on .tile.on img");' +
                    'return !!i && i.naturalWidth > 0;})()',
                  'a TMDB poster on the tile',
                );
              })
              .then(pictures)
              .then(function (pic) {
                if (!pic.tile.shot || pic.tile.shot.kind !== 'poster') {
                  throw new Error('the tile is not showing a TMDB poster: ' + pic.tile.url);
                }
              })
              .then(function () {
                return shot('discovery');
              })
          );
        },
      );
    })

    .then(function () {
      return step('resting on a title costs one lookup and sweeping past costs none', function () {
        /* The tile the page landed on is a rest like any other, so by now
             exactly one title has been asked about. */
        return settle()
          .then(function () {
            const spent = titlesAsked(mark);
            if (spent.length !== 1) {
              throw new Error(
                'resting on one tile asked about ' + spent.length + ' titles: ' + spent.join(', '),
              );
            }
            mark = guids.length;
          })
          .then(function () {
            return press('ArrowRight', 5);
          })
          .then(settle)
          .then(function () {
            const spent = titlesAsked(mark);
            if (spent.length !== 1) {
              throw new Error(
                'sweeping five tiles asked about ' +
                  spent.length +
                  ' titles; only the one it came to rest on should have ' +
                  'been asked about',
              );
            }
            mark = guids.length;
          })
          .then(masthead)
          .then(function (mh) {
            if (!mh.meta.startsWith('In your library')) {
              throw new Error('a title both servers hold says "' + mh.meta + '"');
            }
            held = mh.title;
          });
      });
    })

    .then(function () {
      return step('a title neither server has says so before OK is pressed', function () {
        let film;
        return toRow('Science fiction')
          .then(function () {
            return waitFor(
              'document.getElementById("mh-meta").textContent.trim() === ' +
                '"Not in your library"',
              'the masthead to say we have not got it',
            );
          })
          .then(masthead)
          .then(function (mh) {
            film = mh.title;
          })
          .then(function () {
            return shot('discovery-unheld');
          })
          .then(function () {
            return unheldPage(film);
          });
      });
    })

    .then(function () {
      return step('a title we do hold opens the ordinary film page', function () {
        return (
          toRow('Trending this week')
            .then(function () {
              return waitFor(
                'document.getElementById("mh-title").textContent.trim() === ' +
                  JSON.stringify(held),
                'the focus back on ' + held,
              );
            })
            .then(function () {
              return page.keyboard.press('Enter');
            })
            .then(function () {
              return waitFor(
                '!document.getElementById("detail").classList.contains("hidden") &&' +
                  ' document.getElementById("dt-title").textContent.trim() === ' +
                  JSON.stringify(held),
                'the film page for ' + held,
                20000,
              );
            })
            /* The same page the library screen opens, with the same verdict on
             the same copy — nothing about it knows it came from TMDB. */
            .then(function () {
              return waitFor(
                '(function(){var c=document.querySelector("#dt-actions .dt-act-cap");' +
                  'return c && !/checking/.test(c.textContent);})()',
                'a verdict on the selected copy',
                20000,
              );
            })
            .then(actionRow)
            .then(function (row) {
              const play = row.find(function (a) {
                return a.act === 'play';
              });
              if (!play) throw new Error('no Play button on the page');
              if (!play.caption) throw new Error('Play says nothing about what it would do');
              if (!metadataReads.length) throw new Error('a held page read no Plex metadata');
            })
            .then(function () {
              return shot('discovery-detail');
            })
            .then(function () {
              return press('Backspace');
            })
        );
      });
    })

    .then(function () {
      return step(
        'a TV row opens the held show and tells a show from a film with its number',
        function () {
          const first = makeShow(0).title;
          const clash = makeShow(1).title;
          function seriesPage(title) {
            return waitFor(
              '!document.getElementById("show").classList.contains("hidden") &&' +
                ' document.getElementById("sh-title").textContent.trim() === ' +
                JSON.stringify(title),
              'the series page for ' + title,
              20000,
            );
          }
          function resting(title, meta) {
            return waitFor(
              'document.getElementById("mh-title").textContent.trim() === ' +
                JSON.stringify(title) +
                ' && ' +
                JSON.stringify(meta) +
                ' === document.getElementById("mh-meta").textContent.trim().slice(0, ' +
                meta.length +
                ')',
              title + ' to read "' + meta + '"',
            );
          }
          return (
            toRow('Trending shows this week')
              .then(function () {
                return resting(first, 'In your library');
              })
              .then(function () {
                return page.keyboard.press('Enter');
              })
              .then(function () {
                return seriesPage(first);
              })
              .then(function () {
                return shot('discovery-show');
              })
              .then(function () {
                return press('Backspace');
              })
              /* Its TMDB number is a film's, and that film was resolved first, on
               the Trending row: the show has to read its own cache entry. */
              .then(function () {
                return press('ArrowRight');
              })
              .then(function () {
                return resting(clash, 'In your library');
              })
              .then(function () {
                return page.keyboard.press('Enter');
              })
              .then(function () {
                return seriesPage(clash);
              })
              .then(function () {
                return press('Backspace');
              })
              .then(function () {
                return press('ArrowRight');
              })
              .then(function () {
                return resting('TV 0 Show 3', 'Not in your library');
              })
              .then(function () {
                return unheldPage('TV 0 Show 3');
              })
          );
        },
      );
    })

    .then(function () {
      return step('coming back to discovery asks the servers nothing again', function () {
        return backToLibrary()
          .then(function () {
            mark = guids.length;
          })
          .then(function () {
            return sidebarPick('Discovery');
          })
          .then(function () {
            return waitFor(
              '(function(){var n=0,i,r=document.querySelectorAll("#rows .row");' +
                'for(i=0;i<r.length;i++) if(!r[i].classList.contains("hidden")) n++;' +
                'return n >= 4;})()',
              'the category rows again',
              20000,
            );
          })
          .then(settle)
          .then(function () {
            const spent = titlesAsked(mark).length;
            if (spent) {
              throw new Error(
                'a second visit cost ' +
                  spent +
                  ' searches; every answer ' +
                  'was already in the cache',
              );
            }
          })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('a Trending row asks for its next page and stops at the last', function () {
        function total() {
          return page.evaluate(function () {
            const el = document.querySelector('#rows .row.on');
            return el && el._rowRef ? el._rowRef.total : -1;
          });
        }
        let grown = 0;
        return sidebarPick('Discovery')
          .then(function () {
            return waitFor(
              '(function(){var el=document.querySelector("#rows .row.on");' +
                'return !!el && !!el._rowRef && el._rowRef.title === "Trending this week";})()',
              'the Trending row focused',
              20000,
            );
          })
          .then(function () {
            return press('ArrowRight', 40);
          })
          .then(settle)
          .then(total)
          .then(function (n) {
            /* ROW is 12 in the mock: more than that is a second page arriving. */
            if (n <= 12)
              throw new Error('Trending still holds ' + n + ' titles after walking to its end');
            grown = n;
            /* The control: the same collector saw page 1, so a zero for page 4
               means the app did not ask rather than that nothing was counted. */
            if (asked(1) < 1)
              throw new Error('no page=1 request counted; the collector sees nothing');
            if (asked(2) !== 1) throw new Error('page 2 was requested ' + asked(2) + ' times');
            if (asked(3) !== 1) throw new Error('page 3 was requested ' + asked(3) + ' times');
            return press('ArrowRight', 20);
          })
          .then(settle)
          .then(total)
          .then(function (n) {
            if (n !== grown)
              throw new Error('the row grew from ' + grown + ' to ' + n + ' past its last page');
            if (asked(4) !== 0) throw new Error('page 4 was requested ' + asked(4) + ' times');
          })
          .then(backToLibrary);
      });
    });
};
