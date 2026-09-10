'use strict';
/* clearing things out of Continue watching */
module.exports = function (h) {
  const {
    deckWrites,
    shot,
    press,
    waitFor,
    step,
    openSidebar,
    sidebarRows,
    sidebarPick,
    deckRow,
    focusDeck,
    onMain,
    onBackup,
    onBoth,
    waitForConfirm,
    takeConfirm,
    cachedRows,
    reloadDeck,
    backToLibrary,
    openTitle,
    actionRow,
    pressButton,
    page,
    titles,
  } = h;

  return (
    h
      .ready()

      /* ---- getting things out of Continue watching ----

       Green turns the row into a multi-select, and nothing goes without a
       confirmation naming which of two different things is about to happen: the
       item hidden, watch state untouched, or marked watched, which is not the
       same and is not reversible. The mock's Backup server has no
       removeFromContinueWatching, so both paths are walked here rather than
       described. These steps come last because they shorten the row. */

      .then(function () {
        return step(
          'green picks things off Continue watching, and BACK changes nothing',
          function () {
            let was;
            return (
              backToLibrary()
                .then(function () {
                  return sidebarPick('Continue watching');
                })
                .then(deckRow)
                .then(function (row) {
                  was = row;
                  if (row.label !== 'Continue watching') {
                    throw new Error('the rail is on "' + row.label + '"');
                  }
                  if (row.entries.length < 3) {
                    throw new Error('only ' + row.entries.length + ' part-watched entries');
                  }
                  if (row.hint) throw new Error('the select-mode hint is up before green');
                })
                .then(function () {
                  return press('F3');
                }) // green
                .then(deckRow)
                .then(function (row) {
                  if (row.label !== 'Select to remove — 0 picked') {
                    throw new Error('green left the row labelled "' + row.label + '"');
                  }
                  if (!row.hint) throw new Error('the select-mode hint never appeared');
                })
                .then(function () {
                  return page.keyboard.press('Enter');
                }) // pick this one
                .then(function () {
                  return press('ArrowRight');
                })
                .then(function () {
                  return page.keyboard.press('Enter');
                }) // and the next
                .then(deckRow)
                .then(function (row) {
                  if (row.label !== 'Select to remove — 2 picked') {
                    throw new Error('two picks read as "' + row.label + '"');
                  }
                  if (row.picked !== 2) throw new Error(row.picked + ' tiles are marked, not 2');
                })
                /* OK again unpicks, and up and down are ignored so the mode cannot
               be left by wandering out of it. */
                .then(function () {
                  return page.keyboard.press('Enter');
                })
                .then(function () {
                  return press('ArrowDown');
                })
                .then(deckRow)
                .then(function (row) {
                  if (row.label !== 'Select to remove — 1 picked') {
                    throw new Error('after unpicking and a down press: "' + row.label + '"');
                  }
                })
                .then(function () {
                  return shot('deck-picking');
                })
                .then(function () {
                  return press('Backspace');
                })
                .then(deckRow)
                .then(function (row) {
                  if (row.label !== 'Continue watching') {
                    throw new Error('BACK left the row labelled "' + row.label + '"');
                  }
                  if (row.picked || row.hint) throw new Error('BACK left the mode half up');
                  if (row.entries.length !== was.entries.length) {
                    throw new Error(
                      'BACK removed ' + (was.entries.length - row.entries.length) + ' entries',
                    );
                  }
                })
            );
          },
        );
      })

      .then(function () {
        return step(
          'the sidebar reaches select mode too, for a remote with no green key',
          function () {
            return (
              backToLibrary()
                .then(function () {
                  return sidebarPick('Continue watching');
                })
                /* Off the row entirely, so picking the entry has to land the focus
               back on it rather than arm a mode nobody can see. */
                .then(function () {
                  return press('ArrowDown');
                })
                .then(openSidebar)
                .then(sidebarRows)
                .then(function (rows) {
                  const listed = rows.map(function (r) {
                    return r.replace(/^[*-] /g, '').trim();
                  });
                  if (listed.indexOf('Clear from Continue watching') < 0) {
                    throw new Error('no clear entry in the sidebar: ' + rows.join(' | '));
                  }
                })
                .then(function () {
                  return press('ArrowLeft');
                }) // close it again
                .then(function () {
                  return sidebarPick('Clear from Continue watching');
                })
                .then(deckRow)
                .then(function (row) {
                  if (row.label !== 'Select to remove — 0 picked') {
                    throw new Error('the sidebar left the row labelled "' + row.label + '"');
                  }
                  if (!row.hint) throw new Error('the select-mode hint never appeared');
                })
                .then(function () {
                  return press('Backspace');
                })
                /* And it is not offered where there is no Continue watching row to
               clear — Kids builds its own rows. */
                .then(function () {
                  return sidebarPick('Kids');
                })
                .then(function () {
                  return page.waitForTimeout(400);
                })
                .then(openSidebar)
                .then(sidebarRows)
                .then(function (rows) {
                  if (rows.join(' | ').indexOf('Clear from Continue watching') >= 0) {
                    throw new Error('the clear entry is offered in Kids: ' + rows.join(' | '));
                  }
                  if (rows.join(' | ').indexOf('Devices') < 0) {
                    throw new Error(
                      'the sidebar is not even listing its modes: ' + rows.join(' | '),
                    );
                  }
                })
                .then(function () {
                  return press('ArrowLeft');
                })
                .then(backToLibrary)
            );
          },
        );
      })

      .then(function () {
        return step(
          "a title's own page offers the same removal, and only on the deck",
          function () {
            let film;
            return (
              backToLibrary()
                .then(function () {
                  return sidebarPick('Continue watching');
                })
                .then(function () {
                  return focusDeck(function (e) {
                    return e.type === 'movie' && onMain(e);
                  });
                })
                .then(function (entry) {
                  film = entry;
                  return page.keyboard.press('Enter');
                })
                .then(function () {
                  return waitFor(
                    '!document.getElementById("detail").classList.contains("hidden")',
                    'the page for ' + film.title,
                  );
                })
                .then(actionRow)
                .then(function (row) {
                  const acts = row.map(function (a) {
                    return a.act;
                  });
                  if (acts.indexOf('remove') < 0) {
                    throw new Error('no remove button on a deck title: ' + acts.join(', '));
                  }
                  const btn = row[acts.indexOf('remove')];
                  if (!/Continue watching/.test(btn.caption)) {
                    throw new Error('the remove button says "' + btn.caption + '"');
                  }
                })
                .then(function () {
                  return pressButton('remove');
                })
                .then(function () {
                  return waitForConfirm('from the film page');
                })
                .then(function (box) {
                  if (box.title !== 'Remove 1 from Continue watching') {
                    throw new Error('the confirmation says "' + box.title + '"');
                  }
                })
                .then(takeConfirm)
                /* Back on the rail, with the row already redrawn without it. */
                .then(function () {
                  return waitFor(
                    'document.getElementById("detail").classList.contains("hidden")',
                    'the page to close onto the rail',
                  );
                })
                .then(deckRow)
                .then(function (row) {
                  const still = row.entries.filter(function (e) {
                    return e.title === film.title;
                  });
                  if (still.length) throw new Error(film.title + ' is still in the row');
                })
                /* And a title that is not part-watched is not offered it at all. */
                .then(function () {
                  return openTitle(titles.directPlays.title);
                })
                .then(actionRow)
                .then(function (row) {
                  const acts = row.map(function (a) {
                    return a.act;
                  });
                  if (acts.join(',') !== 'play,trailer,quality,source,audio,subtitles') {
                    throw new Error('a film that is not on the deck offers: ' + acts.join(', '));
                  }
                })
            );
          },
        );
      })

      .then(function () {
        return step('a picked entry is hidden, and stays gone after a reload', function () {
          let film;
          const before = deckWrites.length;
          /* Through a real reload first, so the rows cache is freshly written and
           the check below is about this removal rather than an earlier one. */
          return (
            reloadDeck()
              .then(function () {
                return focusDeck(function (e) {
                  return e.type === 'movie' && onMain(e);
                });
              })
              .then(function (entry) {
                film = entry;
                return cachedRows('Movies');
              })
              /* Read before as well as after: a check that the cache is empty
             afterwards proves nothing if the key was never the right one. */
              .then(function (cached) {
                if (!cached || !cached.rows) {
                  throw new Error('nothing cached under rows:Movies to begin with');
                }
              })
              .then(function () {
                return press('F3');
              })
              .then(function () {
                return page.keyboard.press('Enter');
              })
              .then(function () {
                return press('F3');
              })
              .then(function () {
                return waitForConfirm('for one picked film');
              })
              .then(function (box) {
                if (box.title !== 'Remove 1 from Continue watching') {
                  throw new Error('the confirmation says "' + box.title + '"');
                }
                if (box.note !== 'They stay part-watched.') {
                  throw new Error('the note says "' + box.note + '"');
                }
                /* Cancel is what it lands on: the action is a key away and never
               the default. */
                if (box.rows.join(' | ') !== 'Remove them | > Cancel') {
                  throw new Error('the confirmation rows are: ' + box.rows.join(' | '));
                }
              })
              .then(takeConfirm)
              .then(function () {
                const wrote = deckWrites.slice(before);
                const hid = wrote.filter(function (u) {
                  return /__plex\/actions\/removeFromContinueWatching/.test(u);
                });
                if (hid.length !== 1) {
                  throw new Error('the hide went: ' + (wrote.join(', ') || 'nowhere'));
                }
                /* Hiding leaves watch state alone, so nothing may have been
               scrobbled on the way. */
                const marked = wrote.filter(function (u) {
                  return /scrobble/.test(u);
                });
                if (marked.length) throw new Error('it scrobbled as well: ' + marked.join(', '));
              })
              .then(deckRow)
              .then(function (row) {
                if (
                  row.entries.filter(function (e) {
                    return e.title === film.title;
                  }).length
                ) {
                  throw new Error(film.title + ' is still in the row');
                }
              })
              /* The cached rows carry Continue watching too, in every section, so
             they have to go or a reload paints it straight back. */
              .then(function () {
                return Promise.all([cachedRows('Movies'), cachedRows('TV Shows')]);
              })
              .then(function (cached) {
                const kept = cached.filter(Boolean);
                if (kept.length) {
                  throw new Error(
                    kept.length + ' section(s) still have cached rows after a removal',
                  );
                }
              })
              .then(reloadDeck)
              .then(function (row) {
                if (
                  row.entries.filter(function (e) {
                    return e.title === film.title;
                  }).length
                ) {
                  throw new Error(film.title + ' came back after a reload');
                }
              })
          );
        });
      })

      .then(function () {
        return step(
          'a server that cannot hide says so, and cancelling keeps the entry',
          function () {
            let entry;
            const before = deckWrites.length;
            return (
              backToLibrary()
                .then(function () {
                  return sidebarPick('Continue watching');
                })
                /* An episode, because marking one watched is the destructive case:
               it is the show that has to be scrobbled, and the confirmation
               says so before it happens. */
                .then(function () {
                  return focusDeck(function (e) {
                    return e.type === 'episode' && onBackup(e);
                  });
                })
                .then(function (e) {
                  entry = e;
                  return press('F3');
                })
                .then(function () {
                  return page.keyboard.press('Enter');
                })
                .then(function () {
                  return press('F3');
                })
                .then(function () {
                  return waitForConfirm('for the Backup copy');
                })
                .then(takeConfirm)
                /* Backup has no removeFromContinueWatching, so the app asks again —
               and says plainly that this one is not the same thing. */
                .then(function () {
                  return waitForConfirm('offering to mark it watched');
                })
                .then(function (box) {
                  if (box.title !== 'Mark 1 watched') {
                    throw new Error('the second confirmation says "' + box.title + '"');
                  }
                  if (!/cannot hide them/.test(box.note) || !/marks every episode/.test(box.note)) {
                    throw new Error(
                      'the note does not say what marking watched costs: ' + box.note,
                    );
                  }
                  if (box.rows.join(' | ') !== 'Mark them watched | > Cancel') {
                    throw new Error('the rows are: ' + box.rows.join(' | '));
                  }
                })
                /* Cancel is selected, so OK cancels — and nothing is marked. */
                .then(function () {
                  return page.keyboard.press('Enter');
                })
                .then(function () {
                  return page.waitForTimeout(200);
                })
                .then(function () {
                  const marked = deckWrites.slice(before).filter(function (u) {
                    return /scrobble/.test(u);
                  });
                  if (marked.length)
                    throw new Error('cancelling scrobbled anyway: ' + marked.join(', '));
                })
                .then(function () {
                  return press('Backspace');
                }) // out of the mode
                .then(reloadDeck)
                .then(function (row) {
                  if (
                    !row.entries.filter(function (e) {
                      return e.title === entry.title;
                    }).length
                  ) {
                    throw new Error(entry.title + ' left the row after a cancelled removal');
                  }
                })
            );
          },
        );
      })

      .then(function () {
        return step(
          'marking a part-watched series watched scrobbles the show, not the episode',
          function () {
            let entry;
            const before = deckWrites.length;
            return backToLibrary()
              .then(function () {
                return sidebarPick('Continue watching');
              })
              .then(function () {
                return focusDeck(function (e) {
                  return e.type === 'episode' && onBackup(e);
                });
              })
              .then(function (e) {
                entry = e;
                if (!e.showKey) throw new Error(e.title + ' carries no show to scrobble');
                return press('F3');
              })
              .then(function () {
                return page.keyboard.press('Enter');
              })
              .then(function () {
                return press('F3');
              })
              .then(function () {
                return waitForConfirm('to hide the episode');
              })
              .then(takeConfirm)
              .then(function () {
                return waitForConfirm('to mark the series watched');
              })
              .then(takeConfirm)
              .then(function () {
                return page.waitForTimeout(300);
              })
              .then(function () {
                const wrote = deckWrites.slice(before).filter(function (u) {
                  return u.indexOf('/:/scrobble') >= 0;
                });
                /* The episode's own key would only advance the deck to the next
                 episode and leave the series exactly where it was — which is
                 the thing the user says they are stuck in. */
                const onShow = wrote.filter(function (u) {
                  return u.indexOf('key=' + entry.showKey + '&') >= 0;
                });
                if (!onShow.length) {
                  throw new Error(
                    'nothing was scrobbled against show ' +
                      entry.showKey +
                      ': ' +
                      (wrote.join(', ') || 'no scrobble at all'),
                  );
                }
                const onEpisode = wrote.filter(function (u) {
                  return u.indexOf('key=' + entry.key + '&') >= 0;
                });
                if (onEpisode.length) {
                  throw new Error(
                    'the episode was scrobbled instead of its show: ' + onEpisode.join(', '),
                  );
                }
              })
              .then(reloadDeck)
              .then(function (row) {
                if (
                  row.entries.filter(function (e) {
                    return e.title === entry.title;
                  }).length
                ) {
                  throw new Error(entry.title + ' is still part-watched after the show was marked');
                }
              });
          },
        );
      })

      .then(function () {
        return step('an entry on both servers is cleared on each as that one allows', function () {
          let entry;
          const before = deckWrites.length;
          return (
            backToLibrary()
              .then(function () {
                return sidebarPick('Continue watching');
              })
              .then(function () {
                return focusDeck(onBoth);
              })
              .then(function (e) {
                entry = e;
                return press('F3');
              })
              .then(function () {
                return page.keyboard.press('Enter');
              })
              .then(function () {
                return press('F3');
              })
              .then(function () {
                return waitForConfirm('for the shared film');
              })
              .then(takeConfirm)
              /* Main hides it; Backup cannot, so the whole entry falls to the
             second question rather than half-vanishing. */
              .then(function () {
                return waitForConfirm('after Backup refused to hide it');
              })
              .then(takeConfirm)
              .then(function () {
                return page.waitForTimeout(300);
              })
              .then(function () {
                const wrote = deckWrites.slice(before);
                function went(path) {
                  return wrote.some(function (u) {
                    return u.indexOf(path) >= 0;
                  });
                }
                if (!went('/__plex/actions/removeFromContinueWatching')) {
                  throw new Error('Main was never asked to hide it: ' + wrote.join(', '));
                }
                if (!went('/__plex2/:/scrobble')) {
                  throw new Error('Backup was never marked watched: ' + wrote.join(', '));
                }
                /* Main had already hidden its copy, so it must not then be
               scrobbled: the fallback is for the copy that was refused, not for
               every copy of the entry. Hiding leaves watch state alone and that
               is the whole point of preferring it. */
                if (went('/__plex/:/scrobble')) {
                  throw new Error(
                    'Main was scrobbled after it had already hidden it: ' + wrote.join(', '),
                  );
                }
              })
              .then(reloadDeck)
              .then(function (row) {
                if (
                  row.entries.filter(function (e) {
                    return e.title === entry.title;
                  }).length
                ) {
                  throw new Error(entry.title + ' survived on one of the two servers');
                }
              })
          );
        });
      })
  );
};
