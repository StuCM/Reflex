/* What is in the rails, and where the focus is.

   Browse owns the state the rest of the app reads: the section list, the rows,
   which row and tile are focused, and which mode is showing (the library, the
   kids cut of it, the curated rows, or a page of search results). It builds
   rows and hands them to Rail to draw.

   Nothing here fetches or holds a whole section. Continue watching and the
   category rows arrive as small preloaded lists; the All row is virtual over a
   total count and pages in only what you look at. */
var Browse = (function () {
  'use strict';

  var elSections = document.getElementById('sections');
  var elInput = document.getElementById('search-input');

  var sections = [], secIdx = 0;
  var rows = [], rowIdx = 0;
  var headerFocus = false, chipIdx = 0;   // d-pad focus on the chips above the rail
  var mode = 'library';                   // library | kids | discover
  var savedRows = null;                   // rows parked while showing search results
  var searchQuery = null;                 // non-null while the results page is showing
  var searchCount = 0;
  var generation = 0;                     // bumps on any row change, kills stale paints
  var lastChips = null;                   // last chip HTML written, to skip pointless writes
  var pageTimer = null;
  var opts = {};

  var RESULTS_PER_ROW = 10;

  function init(options) {
    opts = options || {};
    /* Enter from the on-screen keyboard arrives on the input, not the document.
       It must not go on to reach the browse key handler: runSearch switches
       back to the browse view synchronously, so by the time the event bubbled
       up it would read as OK on whatever was focused before the search, and
       start a playback decision on it. */
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
    renderChips();
    Rail.render(rows, rowIdx);
    Masthead.render(focusedRow(), focusedItem(), rows.length > 0);
    schedulePages();
    Meta.schedule(focusedItem(), function (ratingKey) {
      var here = focusedItem();
      if (here && here.ratingKey === ratingKey) {
        Masthead.render(focusedRow(), here, true);
      }
    });
  }

  /* ---------- the chips above the rail ----------

     The Magic Remote has no colour buttons, so every action has to be reachable
     with the d-pad. Up from the top row lands here. */

  function chips() {
    var out = [], i;
    for (i = 0; i < sections.length; i++) {
      out.push({ label: sections[i].title, kind: 'section', index: i,
                 current: mode === 'library' && i === secIdx });
    }
    out.push({ label: 'kids', kind: 'kids', current: mode === 'kids' });
    out.push({ label: 'discover', kind: 'discover', current: mode === 'discover' });
    out.push({ label: 'devices', kind: 'devices', current: false });
    out.push({ label: 'search', kind: 'search', current: false });
    return out;
  }

  function chipHtml() {
    /* On the results page the chips are replaced by a header, so it never reads
       as the library screen having reloaded. */
    if (searchQuery) {
      return '<span class="chip cur">' + UI.escapeHtml(searchQuery) + '</span>' +
             '<span class="chip">' + searchCount + ' film' + (searchCount === 1 ? '' : 's') +
             '</span><span class="chip">back to library</span>';
    }
    var list = chips(), html = '', i, cls;
    for (i = 0; i < list.length; i++) {
      cls = 'chip' + (list[i].current ? ' cur' : '') +
            (headerFocus && i === chipIdx ? ' on' : '');
      html += '<span class="' + cls + '">' + UI.escapeHtml(list[i].label) + '</span>';
    }
    return html;
  }

  function renderChips() {
    var html = chipHtml();
    if (html === lastChips) return;      // rebuilding this on every keypress is not free
    lastChips = html;
    elSections.innerHTML = html;
  }

  function activateChip() {
    var chip = chips()[chipIdx];
    if (!chip) return;
    if (chip.kind === 'search') { openSearch(); return; }
    if (chip.kind === 'kids') { loadKids(); return; }
    if (chip.kind === 'discover') { loadDiscover(); return; }
    if (chip.kind === 'devices') {
      Devices.open(function (changed) {
        UI.show('browse');
        if (changed) loadSection(secIdx, true); else render();
      });
      return;
    }
    headerFocus = false;
    mode = 'library';
    if (chip.index !== secIdx) loadSection(chip.index, true);
    else render();
  }

  /* ---------- sections ---------- */

  /* Adopt a fresh section list, keeping whatever section was showing. */
  function setSections(list) {
    var currentKey = sections[secIdx] && sections[secIdx].key;
    sections = list;
    var i = 0, j;
    for (j = 0; j < list.length; j++) if (list[j].key === currentKey) i = j;
    return i;
  }

  function reset(newMode) {
    generation++;
    mode = newMode;
    headerFocus = false;
    rows = [];
    rowIdx = 0;
    render();
  }

  function loadSection(i, allowFetch) {
    secIdx = i;
    reset('library');
    var isCurrent = generationGuard();
    var sec = sections[i];
    var cacheKey = 'rows:' + sec.key;

    Store.get(cacheKey).then(function (cached) {
      if (!isCurrent()) return;
      if (cached && cached.rows && cached.rows.length) {
        rows = cached.rows.map(function (r) { return Rows.list(r.title, r.items); });
        rows.push(Rows.all(sec));
        restoreTotal(rows[rows.length - 1], isCurrent);
        render();
        UI.debug(sec.title + ': rows from cache');
      }
      if (!allowFetch) return;

      /* Continue watching plus the section's own categories: two requests for
         the whole browse screen, no matter how big the library is. */
      return Promise.all([Plex.onDeck(), Plex.hubs(sec.key), Devices.ensureHistory()])
        .then(function (res) {
          if (!isCurrent()) return;
          var built = [], deck = Devices.mine(res[0]), hubList = res[1], n;
          if (deck.length) built.push({ title: 'Continue watching', items: deck });
          for (n = 0; n < hubList.length; n++) {
            built.push({ title: hubList[n].title, items: hubList[n].items });
          }
          Store.put(cacheKey, { rows: built });
          rows = built.map(function (r) { return Rows.list(r.title, r.items); });
          rows.push(Rows.all(sec));
          rowIdx = UI.clamp(rowIdx, 0, rows.length - 1);
          restoreTotal(rows[rows.length - 1], isCurrent);
          render();
          UI.debug(sec.title + ': ' + rows.length + ' rows');
        });
    }).catch(function (e) {
      if (!isCurrent()) return;
      UI.debug('rows: ' + e.message);
      if (!rows.length) UI.toast('Could not reach the server');
    });
  }

  /* A virtual row's length. Size=0 returns totalSize and no items — one cheap
     request instead of crawling 300 pages of a library we don't own. */
  function restoreTotal(row, isCurrent) {
    if (!row || row.kind !== 'all') return;
    var ck = 'total:' + row.key + ':' + row.tag;
    Store.get(ck).then(function (cached) {
      if (!isCurrent()) return;
      if (cached && cached.total && cached.updatedAt === row.version) {
        row.total = cached.total;
        render();
        return;
      }
      return Plex.items(row.key, 0, 0, row.filter).then(function (res) {
        if (!isCurrent()) return;
        row.total = res.total;
        Store.put(ck, { updatedAt: row.version, total: res.total });
        render();
        UI.debug(row.title + ': ' + res.total + ' films');
      });
    }).catch(function (e) { UI.debug('count: ' + e.message); });
  }

  /* ---------- paging (the All row only) ---------- */

  /* Debounced: scrolling through twenty screens must not fire twenty page
     requests, only one for wherever you come to rest. */
  function schedulePages() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(function () {
      var row = focusedRow();
      if (!row || row.kind !== 'all') return;
      var want = Rows.pagesNeeded(row.focus), i;
      for (i = 0; i < want.length; i++) ensurePage(row, want[i]);
    }, 150);
  }

  function ensurePage(row, n) {
    if (n < 0 || row.pages[n] || row.inflight[n]) return;
    if (row.total && n * Rows.PAGE >= row.total) return;
    var isCurrent = generationGuard();
    row.inflight[n] = true;
    /* updatedAt is in the key, so a changed section simply misses the cache.
       ponytail: stale entries linger — Store has no delete. Add a cursor sweep
       if the cache ever grows past a few hundred MB. */
    var key = 'page:' + row.key + ':' + row.version + ':' + row.tag + ':' + n;

    Store.get(key).then(function (cached) {
      if (!isCurrent()) return null;
      if (cached && cached.length) return cached;
      return Plex.items(row.key, n * Rows.PAGE, Rows.PAGE, row.filter).then(function (res) {
        if (!isCurrent()) return null;
        if (res.total) row.total = res.total;
        Store.put(key, res.items);
        return res.items;
      });
    }).then(function (list) {
      delete row.inflight[n];
      if (!isCurrent() || !list) return;
      row.pages[n] = list;
      Rail.invalidateEmpty();
      render();
      UI.debug('page ' + n + ' of ' + row.total);
    }).catch(function (e) {
      delete row.inflight[n];
      if (!isCurrent()) return;
      UI.debug('page ' + n + ': ' + e.message);
    });
  }

  /* ---------- kids ---------- */

  function loadKids() {
    var sec = sections[secIdx];
    reset('kids');
    var isCurrent = generationGuard();

    /* Ask the library which certificates it uses, keep the ones at or below the
       cutoff, and let the server do the filtering. */
    Plex.contentRatings(sec.key).then(function (all) {
      if (!isCurrent()) return;
      var kid = all.filter(Media.isKidsRating);
      UI.debug('kids certificates: ' + (kid.join(', ') || 'none'));

      return Promise.all([Plex.onDeck(), Devices.ensureHistory()]).then(function (res) {
        if (!isCurrent()) return;
        var watching = Devices.mine(res[0]).filter(function (m) {
          return Media.isKidsRating(m.contentRating);
        });
        rows = [];
        if (watching.length) rows.push(Rows.list('Kids · carry on watching', watching));

        if (kid.length) {
          rows.push(Rows.all(sec, 'Kids · all films',
                             { contentRating: kid.join(',') }, 'kids' + Media.KIDS_MAX_AGE));
          render();
          restoreTotal(rows[rows.length - 1], isCurrent);
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
        'None of the curated titles are on this server, or the TMDB ids did ' +
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
     a grid of RESULTS_PER_ROW using the same row machinery. */
  function runSearch() {
    var q = elInput.value.trim();
    if (!q) { closeSearch(); return; }
    elInput.blur();
    UI.show('browse');
    UI.toast('Searching…');
    var isCurrent = generationGuard();
    Plex.search(q).then(function (found) {
      if (!isCurrent()) return;
      if (!savedRows) savedRows = rows;
      searchQuery = q;
      searchCount = found.length;
      headerFocus = false;
      rows = [];
      for (var i = 0; i < found.length; i += RESULTS_PER_ROW) {
        rows.push(Rows.list(i === 0 ? 'Results' : '', found.slice(i, i + RESULTS_PER_ROW)));
      }
      if (!rows.length) rows = [Rows.list('No matches', [])];
      rowIdx = 0;
      render();
      UI.debug('search "' + q + '": ' + found.length + ' film' + (found.length === 1 ? '' : 's'));
    }).catch(function (e) {
      UI.message('Search failed', e.message);
    });
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
    var row = focusedRow(), K = UI.KEY;

    switch (code) {
      case K.LEFT:
        if (headerFocus) { chipIdx = UI.clamp(chipIdx - 1, 0, chips().length - 1); renderChips(); }
        else if (row && row.focus > 0) { row.focus--; render(); }
        break;
      case K.RIGHT:
        if (headerFocus) { chipIdx = UI.clamp(chipIdx + 1, 0, chips().length - 1); renderChips(); }
        else if (row && row.focus < row.total - 1) { row.focus++; render(); }
        break;
      case K.UP:
        if (headerFocus) break;
        if (rowIdx > 0) { rowIdx--; render(); }
        else if (!searchQuery) { headerFocus = true; chipIdx = secIdx; renderChips(); }
        break;
      case K.DOWN:
        if (headerFocus) { headerFocus = false; renderChips(); }
        else if (rowIdx < rows.length - 1) { rowIdx++; render(); }
        break;
      case K.OK:
        if (headerFocus) activateChip(); else if (opts.onPlay) opts.onPlay();
        break;
      case K.RED:                                 // red, on remotes that have it
        openSearch();
        break;
      default:
        if (!UI.isBack(code)) return false;
        if (headerFocus) { headerFocus = false; renderChips(); }
        else if (!clearResults() && !leaveMode() && opts.onExit) opts.onExit();
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
