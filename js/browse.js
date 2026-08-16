/* What is in the rails, and where the focus is.

   Browse owns the state the rest of the app reads: the section list, the rows,
   which row and tile are focused, and which mode is showing (the library, the
   kids cut of it, the curated rows, or a page of search results).

   Every row is built by asking each server separately and merging the answers,
   so a film held by both appears once, carrying both copies. Nothing here
   fetches or holds a whole section: Continue watching and the category rows
   arrive as small preloaded lists, and the All row is virtual over the servers'
   own totals, walking them in title order only as far as you scroll. */
var Browse = (function () {
  'use strict';

  var elBrowse = document.getElementById('browse');
  var elInput = document.getElementById('search-input');

  var sections = [], secIdx = 0;
  var rows = [], rowIdx = 0;
  var cats = {};                          // section title -> its row titles, for the sidebar
  var wantRow = 0;                        // row to land on once the next section is built
  var mode = 'library';                   // library | kids | discover
  var savedRows = null;                   // rows parked while showing search results
  var searchQuery = null;                 // non-null while the results page is showing
  var generation = 0;                     // bumps on any row change, kills stale paints
  var pageTimer = null;
  var opts = {};

  var RESULTS_PER_ROW = 10;

  function init(options) {
    opts = options || {};
    /* Enter from the on-screen keyboard arrives on the input, not the document.
       It must not go on to reach the browse key handler: runSearch switches
       back to the browse view synchronously, so by the time the event bubbled
       up it would read as OK on whatever was focused before the search. */
    elInput.addEventListener('keydown', function (e) {
      if (e.keyCode !== UI.KEY.OK) return;
      e.preventDefault();
      e.stopPropagation();
      runSearch();
    }, false);
  }

  /* ---------- state the rest of the app asks about ---------- */

  function focusedRow() { return rows[rowIdx]; }
  function focusedItem() { var r = focusedRow(); return r ? Rows.itemAt(r, r.focus) : null; }
  function hasRows() { return rows.length > 0; }
  function currentSection() { return sections[secIdx] || null; }

  /* A guard any in-flight load can check before it paints. */
  function generationGuard() {
    var gen = generation;
    return function () { return gen === generation; };
  }

  function render() {
    elBrowse.classList.toggle('results', !!searchQuery);
    Rail.render(rows, rowIdx);
    Masthead.render(focusedRow(), focusedItem(), rows.length > 0);
    scheduleWalk();
    /* The backdrop rides the same debounce the audio badge does — one settled
       focus, one metadata fetch, one full-screen image. */
    Meta.schedule(focusedItem(), function (ratingKey) {
      var here = focusedItem();
      if (here && here.ratingKey === ratingKey) {
        Masthead.render(focusedRow(), here, true);
        Masthead.art(here);
      }
    });
  }

  /* ---------- servers and sections ----------

     Each server has its own sections, with their own keys. Two servers both
     calling a section "Films" means one chip backed by two parts — and a
     section only one of them has still gets a chip of its own. */

  function setSections(perServer) {
    var byTitle = {}, order = [], i, j, list, sec, key;
    for (i = 0; i < perServer.length; i++) {
      list = perServer[i].sections || [];
      for (j = 0; j < list.length; j++) {
        sec = list[j];
        /* Title and type: a "Films" section and a "Films" show section would be
           two different things, however unlikely that is. */
        key = sec.title.toLowerCase() + '/' + sec.type;
        if (!byTitle[key]) {
          byTitle[key] = { title: sec.title, type: sec.type, parts: [] };
          order.push(key);
        }
        byTitle[key].parts.push({ server: perServer[i].server, key: sec.key,
                                  updatedAt: sec.updatedAt || 0 });
      }
    }
    var merged = order.map(function (k) { return byTitle[k]; });
    var currentTitle = sections[secIdx] && sections[secIdx].title;
    sections = merged;
    var at = 0;
    for (i = 0; i < merged.length; i++) if (merged[i].title === currentTitle) at = i;
    return at;
  }

  function serversOf(sec) {
    var out = [], seen = {}, i, id;
    for (i = 0; i < sec.parts.length; i++) {
      id = sec.parts[i].server.id;
      if (seen[id]) continue;
      seen[id] = true;
      out.push(sec.parts[i].server);
    }
    return out;
  }

  /* ---------- the sidebar ----------

     The Magic Remote has no colour buttons, so every action has to be reachable
     with the d-pad. Left from the first tile of a row lands here. */

  function openSidebar() {
    Sidebar.open(sections.map(function (sec, i) {
      /* Category titles are the row titles of a section we have already built,
         so this fetches nothing. A section never visited simply lists none. */
      return { title: sec.title, categories: cats[sec.title] || [],
               current: mode === 'library' && i === secIdx };
    }), activate);
  }

  function activate(choice) {
    if (choice.kind === 'search') { openSearch(); return; }
    if (choice.kind === 'kids') { loadKids(); return; }
    if (choice.kind === 'discover') { loadDiscover(); return; }
    if (choice.kind === 'prefer') {
      var now = Servers.get(Servers.cyclePreferred());
      UI.debug('preferring ' + (now ? now.name : '?') + ' where both servers have a film');
      /* Rebuild the rows: which copy of a shared film is shown changes with
         the preference. */
      loadSection(secIdx, true);
      return;
    }
    if (choice.kind === 'panel') {
      UI.message('What this panel claims it can play', Panel.report());
      return;
    }
    if (choice.kind === 'devices') {
      Devices.open(function (changed) {
        UI.show('browse');
        if (changed) loadSection(secIdx, true); else render();
      });
      return;
    }
    if (choice.kind === 'row') {
      if (mode === 'library' && choice.index === secIdx) {
        rowIdx = UI.clamp(choice.row, 0, rows.length - 1);
        render();
      } else {
        loadSection(choice.index, true, choice.row);
      }
      return;
    }
    mode = 'library';
    if (choice.index !== secIdx) loadSection(choice.index, true);
    else render();
  }

  /* Row titles are what the sidebar lists under a section, and their positions
     are what picking one jumps to, so the two must be the same list. */
  function noteCategories(sec) {
    cats[sec.title] = rows.map(function (r) { return r.title; });
  }

  /* ---------- building rows ---------- */

  function reset(newMode) {
    generation++;
    mode = newMode;
    rows = [];
    rowIdx = 0;
    render();
  }

  /* One page of one server's section, for the merge walk. */
  function pageFetcher() {
    return function (part, offset) {
      return Plex.items(part.server, part.key, offset, Rows.PAGE, part.filter)
        .then(function (res) { return { items: res.items, total: res.total }; });
    };
  }

  function allRow(sec, title, filter, tag) {
    /* type 2 asks a show section for shows rather than every episode in it. */
    var base = { type: sec.type === 'show' ? 2 : 1 };
    if (filter) {
      var keys = Object.keys(filter), i;
      for (i = 0; i < keys.length; i++) base[keys[i]] = filter[keys[i]];
    }
    var parts = sec.parts.map(function (p) {
      return { server: p.server, key: p.key, updatedAt: p.updatedAt,
               filter: base, tag: tag || '' };
    });
    return Rows.merged(title || (sec.type === 'show' ? 'All shows' : 'All films'),
                       parts, pageFetcher());
  }

  /* A section's length, cheaply: size=0 returns totalSize and no items, once
     per server. The merged length is the sum less whatever duplicates the walk
     has found so far, so it only gets more accurate. */
  function primeTotals(row, isCurrent) {
    if (!row || row.kind !== 'merge') return;
    var jobs = row.state.streams.map(function (s) {
      if (s.total) return Promise.resolve();
      var ck = 'total:' + s.part.server.id + ':' + s.part.key + ':' + s.part.tag;
      return Store.get(ck).then(function (cached) {
        if (cached && cached.total && cached.updatedAt === s.part.updatedAt) {
          s.total = cached.total;
          return;
        }
        return Plex.items(s.part.server, s.part.key, 0, 0, s.part.filter).then(function (res) {
          s.total = res.total;
          Store.put(ck, { updatedAt: s.part.updatedAt, total: res.total });
        });
      }).catch(function (e) { UI.debug('count: ' + e.message); });
    });
    Promise.all(jobs).then(function () {
      if (!isCurrent()) return;
      row.total = Merge.estimate(row.state);
      render();
      UI.debug(row.title + ': about ' + row.total + ' across ' +
               row.state.streams.length + ' server' +
               (row.state.streams.length === 1 ? '' : 's'));
    });
  }

  /* focusRow lands on a named category once its section is built, which is what
     picking one out of the sidebar has to do when it belongs to another
     section. */
  function loadSection(i, allowFetch, focusRow) {
    secIdx = i;
    wantRow = focusRow || 0;
    reset('library');
    var isCurrent = generationGuard();
    var sec = sections[i];
    var cacheKey = 'rows:' + sec.title;

    Store.get(cacheKey).then(function (cached) {
      if (!isCurrent()) return;
      if (cached && cached.rows && cached.rows.length) {
        rows = cached.rows.map(function (r) { return Rows.list(r.title, r.items); });
        rows.push(allRow(sec));
        noteCategories(sec);
        rowIdx = UI.clamp(wantRow, 0, rows.length - 1);
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        UI.debug(sec.title + ': rows from cache');
      }
      if (!allowFetch) return;

      /* Continue watching is per server; the category rows are per section. Two
         requests per server for the whole browse screen, however big the
         library is. */
      var servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map(function (sv) { return Plex.onDeck(sv); })),
        Promise.all(sec.parts.map(function (p) { return Plex.hubs(p.server, p.key); })),
        Devices.ensureHistory()
      ]).then(function (res) {
        if (!isCurrent()) return;
        var built = [];

        /* onDeck is per server, not per section: it hands back films and
           episodes together. A show section should carry on with episodes and a
           film section with films. */
        var want = sec.type === 'show' ? 'episode' : 'movie';
        var deck = Devices.mine(Merge.lists(res[0])).filter(function (m) {
          return m.type === want;
        });
        deck.sort(function (a, b) { return (b.lastViewedAt || 0) - (a.lastViewedAt || 0); });
        if (deck.length) built.push({ title: 'Continue watching', items: deck });

        mergeHubs(res[1]).forEach(function (hub) { built.push(hub); });

        Store.put(cacheKey, { rows: built });
        rows = built.map(function (r) { return Rows.list(r.title, r.items); });
        rows.push(allRow(sec));
        noteCategories(sec);
        rowIdx = UI.clamp(rowIdx || wantRow, 0, rows.length - 1);
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        UI.debug(sec.title + ': ' + rows.length + ' rows from ' + servers.length + ' server' +
                 (servers.length === 1 ? '' : 's'));
      });
    }).catch(function (e) {
      if (!isCurrent()) return;
      UI.debug('rows: ' + e.message);
      if (!rows.length) UI.toast('Could not reach the servers');
    });
  }

  /* Both servers offer a "Recently Added"; they are one row, deduplicated.
     Order within it is first-seen, which keeps each server's own ordering
     intact rather than inventing a ranking across them. */
  function mergeHubs(perPart) {
    var byTitle = {}, order = [], i, j, list;
    for (i = 0; i < perPart.length; i++) {
      list = perPart[i] || [];
      for (j = 0; j < list.length; j++) {
        if (!byTitle[list[j].title]) { byTitle[list[j].title] = []; order.push(list[j].title); }
        byTitle[list[j].title].push(list[j].items);
      }
    }
    return order.map(function (title) {
      return { title: title, items: Merge.lists(byTitle[title]) };
    }).filter(function (hub) { return hub.items.length > 0; });
  }

  /* ---------- walking the merge ---------- */

  /* Debounced: scrolling through twenty screens must not fire twenty walks,
     only one for wherever you come to rest. */
  function scheduleWalk() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(function () {
      var row = focusedRow();
      if (!row || row.kind !== 'merge') return;
      if (Rows.haveUpTo(row) > Rows.needsUpTo(row)) return;
      var isCurrent = generationGuard();
      var had = Rows.haveUpTo(row), was = row.total;
      Merge.advance(row.state, Rows.needsUpTo(row)).then(function () {
        if (!isCurrent()) return;
        row.total = Merge.estimate(row.state);
        /* Only repaint if the walk actually produced something, or this would
           schedule itself for ever once the servers are exhausted. */
        if (Rows.haveUpTo(row) === had && row.total === was) return;
        Rail.invalidateEmpty();
        render();
      }).catch(function (e) {
        if (!isCurrent()) return;
        UI.debug('walk: ' + e.message);
      });
    }, 150);
  }

  /* ---------- kids ---------- */

  function loadKids() {
    var sec = sections[secIdx];
    reset('kids');
    var isCurrent = generationGuard();

    /* Ask each library which certificates it uses, keep the ones at or below
       the cutoff, and let the servers do the filtering. */
    Promise.all(sec.parts.map(function (p) {
      return Plex.contentRatings(p.server, p.key);
    })).then(function (perPart) {
      if (!isCurrent()) return;
      var kid = [], seen = {};
      perPart.forEach(function (list) {
        list.filter(Media.isKidsRating).forEach(function (r) {
          if (!seen[r]) { seen[r] = true; kid.push(r); }
        });
      });
      UI.debug('kids certificates: ' + (kid.join(', ') || 'none'));

      var servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map(function (sv) { return Plex.onDeck(sv); })),
        Devices.ensureHistory()
      ]).then(function (res) {
        if (!isCurrent()) return;
        var kidsWant = sec.type === 'show' ? 'episode' : 'movie';
        var watching = Devices.mine(Merge.lists(res[0])).filter(function (m) {
          return m.type === kidsWant && Media.isKidsRating(m.contentRating);
        });
        rows = [];
        if (watching.length) rows.push(Rows.list('Kids · carry on watching', watching));

        if (kid.length) {
          var row = allRow(sec, 'Kids · all films',
                           { contentRating: kid.join(',') }, 'kids' + Media.KIDS_MAX_AGE);
          rows.push(row);
          render();
          primeTotals(row, isCurrent);
          return;
        }
        render();
        if (!watching.length) {
          UI.message('No age ratings', sec.title + ' has no certificate data, so ' +
            'there is nothing to filter on. BACK to return.');
        }
      });
    }).catch(function (e) {
      if (!isCurrent()) return;
      UI.debug('kids: ' + e.message);
      UI.toast('Could not load the kids list');
    });
  }

  /* ---------- discovery ---------- */

  function loadDiscover() {
    reset('discover');
    var isCurrent = generationGuard();

    if (!Discovery.enabled()) {
      mode = 'library';
      UI.message('Discovery needs a TMDB key',
        'Curated rows come from TMDB. Put a free v3 API key in tmdbKey in ' +
        'js/config.js. Everything else works without it.');
      return;
    }

    Discovery.load({
      isCurrent: isCurrent,
      /* Rows appear as they resolve rather than all at the end — the first one
         lands while the rest are still matching. */
      add: function (title, items) {
        rows.push(Rows.list(title, items));
        render();
      }
    }).then(function () {
      if (!isCurrent() || rows.length) return;
      UI.message('Nothing matched',
        'None of the curated titles are on either server, or the TMDB ids did ' +
        'not line up. Check the debug line for which rows came back empty.');
    });
  }

  function leaveMode() {
    if (mode === 'library') return false;
    loadSection(secIdx, true);
    return true;
  }

  /* ---------- search ---------- */

  function openSearch() {
    UI.show('search');
    elInput.value = '';
    /* webOS raises its own on-screen keyboard when an input takes focus —
       no need to build a letter grid. */
    setTimeout(function () { elInput.focus(); }, 50);
  }

  function closeSearch() {
    elInput.blur();
    UI.show('browse');
    render();
  }

  /* Results land on their own page, not back on the library rows — laid out as
     a grid of RESULTS_PER_ROW using the same row machinery. Both servers are
     asked, and a film on both appears once. */
  function runSearch() {
    var q = elInput.value.trim();
    if (!q) { closeSearch(); return; }
    elInput.blur();
    UI.show('browse');
    UI.toast('Searching…');
    var isCurrent = generationGuard();
    Promise.all(Servers.all().map(function (sv) {
      return Plex.search(sv, q);
    })).then(function (perServer) {
      if (!isCurrent()) return;
      var found = Merge.lists(perServer);
      if (!savedRows) savedRows = rows;
      searchQuery = q;
      var noun = countNoun(found);
      /* The results page has no chips to head it any more, so the first row's
         own title carries what was asked, what came back, and the way out. */
      var header = q + '  ·  ' + found.length + ' ' + noun + '  ·  BACK to library';
      rows = [];
      for (var i = 0; i < found.length; i += RESULTS_PER_ROW) {
        rows.push(Rows.list(i === 0 ? header : '', found.slice(i, i + RESULTS_PER_ROW)));
      }
      if (!rows.length) rows = [Rows.list(header, [])];
      rowIdx = 0;
      render();
      UI.debug('search "' + q + '": ' + found.length + ' ' + noun);
    }).catch(function (e) {
      UI.message('Search failed', e.message);
    });
  }

  /* "3 films", "1 show", or "7 results" when it is both. Saying "films" over a
     list that is half shows is the kind of small lie that makes a screen feel
     untrustworthy. */
  function countNoun(found) {
    var films = 0, shows = 0, i;
    for (i = 0; i < found.length; i++) {
      if (found[i].type === 'show') shows++; else films++;
    }
    if (shows && films) return 'results';
    if (shows) return 'show' + (shows === 1 ? '' : 's');
    return 'film' + (films === 1 ? '' : 's');
  }

  /* Back out of a results list to the rows we parked. */
  function clearResults() {
    if (!savedRows) return false;
    rows = savedRows;
    savedRows = null;
    searchQuery = null;
    rowIdx = 0;
    render();
    return true;
  }

  /* ---------- keys ---------- */

  /* The search view: the system keyboard owns every key, OK included — pressing
     OK picks a letter. Only Back is ours; Enter is handled on the input. */
  function searchKey(code) {
    if (UI.isBack(code)) { closeSearch(); return true; }
    return false;
  }

  function key(code) {
    if (Sidebar.isOpen()) return Sidebar.key(code);

    var row = focusedRow(), K = UI.KEY;

    switch (code) {
      case K.LEFT:
        /* Left off the front of a row is the way to the sections — there is
           nowhere else for it to go, and the rail has no header any more. */
        if (row && row.focus > 0) { row.focus--; render(); }
        else openSidebar();
        break;
      case K.RIGHT:
        if (row && row.focus < row.total - 1) { row.focus++; render(); }
        break;
      case K.UP:
        if (rowIdx > 0) { rowIdx--; render(); }
        break;
      case K.DOWN:
        if (rowIdx < rows.length - 1) { rowIdx++; render(); }
        break;
      case K.OK:
        if (opts.onOpen) opts.onOpen(focusedItem());
        break;
      case K.RED:                                 // red, on remotes that have it
        openSearch();
        break;
      default:
        if (!UI.isBack(code)) return false;
        if (!clearResults() && !leaveMode() && opts.onExit) opts.onExit();
        break;
    }
    return true;
  }

  return {
    init: init, render: render, key: key, searchKey: searchKey,
    setSections: setSections, currentSection: currentSection,
    loadSection: loadSection, focusedItem: focusedItem, hasRows: hasRows
  };
})();
