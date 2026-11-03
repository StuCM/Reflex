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
    hasFixture,
  } = h;

  /* The rows the rail holds, by label, with the title each opens on. */
  function railRows() {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#rows .row'), function (el) {
        const row = el._rowRef;
        const first = row && row.items && row.items[0];
        return {
          label: el.querySelector('.row-label').textContent.trim(),
          first: first ? first.grandparentTitle || first.title : null,
        };
      });
    });
  }

  /* Page-side, so it can be handed to waitFor: Continue watching is on screen
     and opens on this title. */
  function deckOpensOn(title) {
    return (
      '(function(){var r=document.querySelectorAll("#rows .row"),i,f;' +
      'for(i=0;i<r.length;i++){' +
      'if(r[i].querySelector(".row-label").textContent.trim()!=="Continue watching") continue;' +
      'f=r[i]._rowRef&&r[i]._rowRef.items&&r[i]._rowRef.items[0];' +
      'if(f&&(f.grandparentTitle||f.title)===' +
      JSON.stringify(title) +
      ') return true;}return false;})()'
    );
  }

  function slowHubs(ms) {
    return page.evaluate(function (n) {
      return fetch('/__plextv/slow-hubs?ms=' + n).then(function (r) {
        return r.json();
      });
    }, ms);
  }

  function writeRows(section, value) {
    return page.evaluate(
      function (args) {
        return new Promise(function (resolve, reject) {
          const req = indexedDB.open('reflex', 1);
          req.onerror = function () {
            reject(new Error('no database'));
          };
          req.onsuccess = function () {
            const tx = req.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(args.value, 'rows:' + args.section);
            tx.oncomplete = function () {
              resolve(true);
            };
          };
        });
      },
      { section: section, value: value },
    );
  }

  function titleOf(m) {
    return m.grandparentTitle || m.title;
  }

  function cachedDeckFirst(section) {
    return cachedRows(section).then(function (hit) {
      const row =
        hit &&
        hit.rows &&
        hit.rows.find(function (r) {
          return r.title === 'Continue watching';
        });
      return row && row.items.length ? titleOf(row.items[0]) : null;
    });
  }

  return (
    h
      .ready()

      /* ---- Continue watching is the servers' list, promptly ---- */

      .then(function () {
        return step('the deck lands before the hubs do', function () {
          let expected;
          return cachedRows('Movies')
            .then(function (hit) {
              const row = hit.rows.find(function (r) {
                return r.title === 'Continue watching';
              });
              if (!row || row.items.length < 3) throw new Error('no cached deck to make stale');
              expected = titleOf(row.items[0]);
              /* Stale: the same entries with the first one moved to the back, and
                 no hub rows at all, so a hub row can only have come from the
                 network. */
              const stale = row.items.slice(1).concat(row.items.slice(0, 1));
              if (titleOf(stale[0]) === expected) throw new Error('could not make a stale deck');
              return writeRows('Movies', {
                rows: [{ title: 'Continue watching', items: stale }],
              });
            })
            .then(function () {
              return slowHubs(5000);
            })
            .then(function () {
              return page.reload();
            })
            .then(function () {
              /* Well inside the 5s the hubs are held for. */
              return waitFor(
                deckOpensOn('' + expected),
                'the deck to refresh to ' + expected,
                3500,
              );
            })
            .then(railRows)
            .then(function (rows) {
              const hubs = rows.filter(function (r) {
                return r.label === 'Recently Added';
              });
              if (hubs.length) throw new Error('a hub row was already on screen');
              if (!rows.length) throw new Error('no rows read');
            })
            .then(function () {
              /* The control: the hubs do arrive, so the check above was looking
                 at a screen that had somewhere to put one. */
              return waitFor(
                '(function(){var l=document.querySelectorAll("#rows .row .row-label"),i;' +
                  'for(i=0;i<l.length;i++) if(l[i].textContent.trim()==="Recently Added") return true;' +
                  'return false;})()',
                'the hub row to arrive',
                12000,
              );
            })
            .then(
              function () {
                return slowHubs(0);
              },
              function (error) {
                return slowHubs(0).then(function () {
                  throw error;
                });
              },
            );
        });
      })

      .then(function () {
        if (!hasFixture()) return;
        let watched;
        return step('what you watched comes first when you come back', function () {
          watched = titles.directPlays.title;
          return h
            .ready()
            .then(railRows)
            .then(function (rows) {
              const deck = rows.find(function (r) {
                return r.label === 'Continue watching';
              });
              if (!deck || !deck.first) throw new Error('no Continue watching to start from');
              if (deck.first === watched) throw new Error(watched + ' is already first');
              return openTitle(watched);
            })
            .then(function () {
              return page.keyboard.press('Enter');
            })
            .then(function () {
              return waitFor(
                '(function(){var v=document.getElementById("video");' +
                  'return !v.classList.contains("hidden") && !v.paused && v.currentTime > 1;})()',
                'the film to be playing',
                15000,
              );
            })
            .then(function () {
              return press('Backspace');
            }) // stop: back on the detail page
            .then(function () {
              return page.waitForTimeout(300);
            })
            .then(function () {
              return backToLibrary();
            })
            .then(function () {
              return waitFor(deckOpensOn(watched), watched + ' to lead Continue watching', 8000);
            });
        });
      })

      .then(function () {
        if (!hasFixture()) return;
        return step('the refreshed deck is what the cache holds', function () {
          const watched = titles.directPlays.title;
          return cachedDeckFirst('Movies')
            .then(function (first) {
              if (first !== watched) {
                throw new Error('cache opens Continue watching on "' + first + '"');
              }
              /* Servers that never answer, so the only place the deck can come
                 from is what was stored. A held request logs no error when the
                 reload cancels it; a refused one would. */
              return page.route(/\/__plex/, function () {});
            })
            .then(function () {
              return page.reload();
            })
            .then(function () {
              return waitFor(deckOpensOn(watched), 'the cached deck to open on ' + watched, 8000);
            })
            .then(function () {
              return page.waitForTimeout(1500);
            })
            .then(railRows)
            .then(function (rows) {
              const deck = rows.find(function (r) {
                return r.label === 'Continue watching';
              });
              if (!deck || deck.first !== watched) {
                throw new Error(
                  'the unanswered servers changed the deck to ' + (deck && deck.first),
                );
              }
            })
            .then(function () {
              return page.unroute(/\/__plex/);
            })
            .then(function () {
              return page.reload();
            })
            .then(function () {
              return h.ready();
            });
        });
      })

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
