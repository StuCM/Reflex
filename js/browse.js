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

  const elSections = document.getElementById('sections');
  const elInput = document.getElementById('search-input');

  let sections = [], secIdx = 0;
  let rows = [], rowIdx = 0;
  let headerFocus = false, chipIdx = 0;   // d-pad focus on the chips above the rail
  let mode = 'library';                   // library | kids | discover
  let savedRows = null;                   // rows parked while showing search results
  let searchQuery = null;                 // non-null while the results page is showing
  let searchCount = 0;
  let searchNoun = 'results';             // films, shows, or a mix of both
  let generation = 0;                     // bumps on any row change, kills stale paints
  let lastChips = null;                   // last chip HTML written, to skip pointless writes
  let pageTimer = null;
  let opts = {};

  const RESULTS_PER_ROW = 10;

  function init(options) {
    opts = options || {};
    /* Enter from the on-screen keyboard arrives on the input, not the document.
       It must not go on to reach the browse key handler: runSearch switches
       back to the browse view synchronously, so by the time the event bubbled
       up it would read as OK on whatever was focused before the search. */
    elInput.addEventListener('keydown', e => {
      if (e.keyCode !== UI.KEY.OK) return;
      e.preventDefault();
      e.stopPropagation();
      runSearch();
    }, false);
  }

  /* ---------- state the rest of the app asks about ---------- */

  function focusedRow() { return rows[rowIdx]; }
  function focusedItem() { const r = focusedRow(); return r ? Rows.itemAt(r, r.focus) : null; }
  function hasRows() { return rows.length > 0; }
  function currentSection() { return sections[secIdx] || null; }

  /* A guard any in-flight load can check before it paints. */
  function generationGuard() {
    const gen = generation;
    return () => gen === generation;
  }

  function render() {
    renderChips();
    Rail.render(rows, rowIdx);
    Masthead.render(focusedRow(), focusedItem(), rows.length > 0);
    scheduleWalk();
    Meta.schedule(focusedItem(), ratingKey => {
      const here = focusedItem();
      if (here && here.ratingKey === ratingKey) {
        Masthead.render(focusedRow(), here, true);
      }
    });
  }

  /* ---------- servers and sections ----------

     Each server has its own sections, with their own keys. Two servers both
     calling a section "Films" means one chip backed by two parts — and a
     section only one of them has still gets a chip of its own. */

  function setSections(perServer) {
    let byTitle = {}, order = [], i, j, list, sec, key;
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
    const merged = order.map(k => byTitle[k]);
    const currentTitle = sections[secIdx] && sections[secIdx].title;
    sections = merged;
    let at = 0;
    for (i = 0; i < merged.length; i++) if (merged[i].title === currentTitle) at = i;
    return at;
  }

  function serversOf(sec) {
    let out = [], seen = {}, i, id;
    for (i = 0; i < sec.parts.length; i++) {
      id = sec.parts[i].server.id;
      if (seen[id]) continue;
      seen[id] = true;
      out.push(sec.parts[i].server);
    }
    return out;
  }

  /* ---------- the chips above the rail ----------

     The Magic Remote has no colour buttons, so every action has to be reachable
     with the d-pad. Up from the top row lands here. */

  function chips() {
    let out = [], i;
    for (i = 0; i < sections.length; i++) {
      out.push({ label: sections[i].title, kind: 'section', index: i,
                 current: mode === 'library' && i === secIdx });
    }
    out.push({ label: 'kids', kind: 'kids', current: mode === 'kids' });
    out.push({ label: 'discover', kind: 'discover', current: mode === 'discover' });
    /* Which server a film is shown as, when both have it. One chip that names
       the current choice and cycles on OK — the remote has no colour buttons,
       and a whole settings screen for one preference would be worse. */
    if (Servers.count() > 1) {
      const pref = Servers.get(Servers.preferred());
      out.push({ label: 'prefer: ' + (pref ? pref.name : '?'), kind: 'prefer', current: false });
    }
    out.push({ label: 'devices', kind: 'devices', current: false });
    out.push({ label: 'panel', kind: 'panel', current: false });
    out.push({ label: 'search', kind: 'search', current: false });
    return out;
  }

  function chipHtml() {
    /* On the results page the chips are replaced by a header, so it never reads
       as the library screen having reloaded. */
    if (searchQuery) {
      return '<span class="chip cur">' + UI.escapeHtml(searchQuery) + '</span>' +
             '<span class="chip">' + searchCount + ' ' + searchNoun +
             '</span><span class="chip">back to library</span>';
    }
    let list = chips(), html = '', i, cls;
    for (i = 0; i < list.length; i++) {
      cls = 'chip' + (list[i].current ? ' cur' : '') +
            (headerFocus && i === chipIdx ? ' on' : '');
      html += `<span class="${cls}">${UI.escapeHtml(list[i].label)}</span>`;
    }
    return html;
  }

  function renderChips() {
    let html = chipHtml();
    if (html === lastChips) return;      // rebuilding this on every keypress is not free
    lastChips = html;
    elSections.innerHTML = html;
  }

  function activateChip() {
    const chip = chips()[chipIdx];
    if (!chip) return;
    if (chip.kind === 'search') { openSearch(); return; }
    if (chip.kind === 'kids') { loadKids(); return; }
    if (chip.kind === 'discover') { loadDiscover(); return; }
    if (chip.kind === 'prefer') {
      let at = chipIdx;
      const now = Servers.get(Servers.cyclePreferred());
      UI.debug(`preferring ${now ? now.name : '?'} where both servers have a film`);
      /* Rebuild the rows: which copy of a shared film is shown changes with
         the preference. */
      loadSection(secIdx, true);
      headerFocus = true;
      chipIdx = at;
      renderChips();
      return;
    }
    if (chip.kind === 'panel') {
      UI.message('What this panel claims it can play', Panel.report());
      return;
    }
    if (chip.kind === 'devices') {
      Devices.open(changed => {
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

  /* ---------- building rows ---------- */

  function reset(newMode) {
    generation++;
    mode = newMode;
    headerFocus = false;
    rows = [];
    rowIdx = 0;
    render();
  }

  /* One page of one server's section, for the merge walk. */
  function pageFetcher() {
    return (part, offset) => {
      return Plex.items(part.server, part.key, offset, Rows.PAGE, part.filter)
        .then(res => ({ items: res.items, total: res.total }));
    };
  }

  function allRow(sec, title, filter, tag) {
    /* type 2 asks a show section for shows rather than every episode in it. */
    const base = { type: sec.type === 'show' ? 2 : 1 };
    if (filter) {
      let keys = Object.keys(filter), i;
      for (i = 0; i < keys.length; i++) base[keys[i]] = filter[keys[i]];
    }
    const parts = sec.parts.map(p => {
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
    const jobs = row.state.streams.map(s => {
      if (s.total) return Promise.resolve();
      const ck = `total:${s.part.server.id}:${s.part.key}:${s.part.tag}`;
      return Store.get(ck).then(cached => {
        if (cached && cached.total && cached.updatedAt === s.part.updatedAt) {
          s.total = cached.total;
          return;
        }
        return Plex.items(s.part.server, s.part.key, 0, 0, s.part.filter).then(res => {
          s.total = res.total;
          Store.put(ck, { updatedAt: s.part.updatedAt, total: res.total });
        });
      }).catch(e => { UI.debug('count: ' + e.message); });
    });
    Promise.all(jobs).then(() => {
      if (!isCurrent()) return;
      row.total = Merge.estimate(row.state);
      render();
      UI.debug(row.title + ': about ' + row.total + ' across ' +
               row.state.streams.length + ' server' +
               (row.state.streams.length === 1 ? '' : 's'));
    });
  }

  function loadSection(i, allowFetch) {
    secIdx = i;
    reset('library');
    const isCurrent = generationGuard();
    let sec = sections[i];
    const cacheKey = 'rows:' + sec.title;

    Store.get(cacheKey).then(cached => {
      if (!isCurrent()) return;
      if (cached && cached.rows && cached.rows.length) {
        rows = cached.rows.map(r => Rows.list(r.title, r.items));
        rows.push(allRow(sec));
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        UI.debug(sec.title + ': rows from cache');
      }
      if (!allowFetch) return;

      /* Continue watching is per server; the category rows are per section. Two
         requests per server for the whole browse screen, however big the
         library is. */
      const servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map(sv => Plex.onDeck(sv))),
        Promise.all(sec.parts.map(p => Plex.hubs(p.server, p.key))),
        Devices.ensureHistory()
      ]).then(res => {
        if (!isCurrent()) return;
        const built = [];

        /* onDeck is per server, not per section: it hands back films and
           episodes together. A show section should carry on with episodes and a
           film section with films. */
        const want = sec.type === 'show' ? 'episode' : 'movie';
        const deck = Devices.mine(Merge.lists(res[0])).filter(m => {
          return m.type === want;
        });
        deck.sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));
        if (deck.length) built.push({ title: 'Continue watching', items: deck });

        mergeHubs(res[1]).forEach(hub => { built.push(hub); });

        Store.put(cacheKey, { rows: built });
        rows = built.map(r => Rows.list(r.title, r.items));
        rows.push(allRow(sec));
        rowIdx = UI.clamp(rowIdx, 0, rows.length - 1);
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        UI.debug(sec.title + ': ' + rows.length + ' rows from ' + servers.length + ' server' +
                 (servers.length === 1 ? '' : 's'));
      });
    }).catch(e => {
      if (!isCurrent()) return;
      UI.debug('rows: ' + e.message);
      if (!rows.length) UI.toast('Could not reach the servers');
    });
  }

  /* Both servers offer a "Recently Added"; they are one row, deduplicated.
     Order within it is first-seen, which keeps each server's own ordering
     intact rather than inventing a ranking across them. */
  function mergeHubs(perPart) {
    let byTitle = {}, order = [], i, j, list;
    for (i = 0; i < perPart.length; i++) {
      list = perPart[i] || [];
      for (j = 0; j < list.length; j++) {
        if (!byTitle[list[j].title]) { byTitle[list[j].title] = []; order.push(list[j].title); }
        byTitle[list[j].title].push(list[j].items);
      }
    }
    return order.map(title => {
      return { title: title, items: Merge.lists(byTitle[title]) };
    }).filter(hub => hub.items.length > 0);
  }

  /* ---------- walking the merge ---------- */

  /* Debounced: scrolling through twenty screens must not fire twenty walks,
     only one for wherever you come to rest. */
  function scheduleWalk() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => {
      const row = focusedRow();
      if (!row || row.kind !== 'merge') return;
      if (Rows.haveUpTo(row) > Rows.needsUpTo(row)) return;
      const isCurrent = generationGuard();
      const had = Rows.haveUpTo(row), was = row.total;
      Merge.advance(row.state, Rows.needsUpTo(row)).then(() => {
        if (!isCurrent()) return;
        row.total = Merge.estimate(row.state);
        /* Only repaint if the walk actually produced something, or this would
           schedule itself for ever once the servers are exhausted. */
        if (Rows.haveUpTo(row) === had && row.total === was) return;
        Rail.invalidateEmpty();
        render();
      }).catch(e => {
        if (!isCurrent()) return;
        UI.debug('walk: ' + e.message);
      });
    }, 150);
  }

  /* ---------- kids ---------- */

  function loadKids() {
    let sec = sections[secIdx];
    reset('kids');
    const isCurrent = generationGuard();

    /* Ask each library which certificates it uses, keep the ones at or below
       the cutoff, and let the servers do the filtering. */
    Promise.all(sec.parts.map(p => {
      return Plex.contentRatings(p.server, p.key);
    })).then(perPart => {
      if (!isCurrent()) return;
      const kid = [], seen = {};
      perPart.forEach(list => {
        list.filter(Media.isKidsRating).forEach(r => {
          if (!seen[r]) { seen[r] = true; kid.push(r); }
        });
      });
      UI.debug('kids certificates: ' + (kid.join(', ') || 'none'));

      const servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map(sv => Plex.onDeck(sv))),
        Devices.ensureHistory()
      ]).then(res => {
        if (!isCurrent()) return;
        const kidsWant = sec.type === 'show' ? 'episode' : 'movie';
        const watching = Devices.mine(Merge.lists(res[0])).filter(m => {
          return m.type === kidsWant && Media.isKidsRating(m.contentRating);
        });
        rows = [];
        if (watching.length) rows.push(Rows.list('Kids · carry on watching', watching));

        if (kid.length) {
          const row = allRow(sec, 'Kids · all films',
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
    }).catch(e => {
      if (!isCurrent()) return;
      UI.debug('kids: ' + e.message);
      UI.toast('Could not load the kids list');
    });
  }

  /* ---------- discovery ---------- */

  function loadDiscover() {
    reset('discover');
    const isCurrent = generationGuard();

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
      add: (title, items) => {
        rows.push(Rows.list(title, items));
        render();
      }
    }).then(() => {
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
    setTimeout(() => { elInput.focus(); }, 50);
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
    const q = elInput.value.trim();
    if (!q) { closeSearch(); return; }
    elInput.blur();
    UI.show('browse');
    UI.toast('Searching…');
    const isCurrent = generationGuard();
    Promise.all(Servers.all().map(sv => {
      return Plex.search(sv, q);
    })).then(perServer => {
      if (!isCurrent()) return;
      const found = Merge.lists(perServer);
      if (!savedRows) savedRows = rows;
      searchQuery = q;
      searchCount = found.length;
      searchNoun = countNoun(found);
      headerFocus = false;
      rows = [];
      for (let i = 0; i < found.length; i += RESULTS_PER_ROW) {
        rows.push(Rows.list(i === 0 ? 'Results' : '', found.slice(i, i + RESULTS_PER_ROW)));
      }
      if (!rows.length) rows = [Rows.list('No matches', [])];
      rowIdx = 0;
      render();
      UI.debug(`search "${q}": ${found.length} ${searchNoun}`);
    }).catch(e => {
      UI.message('Search failed', e.message);
    });
  }

  /* "3 films", "1 show", or "7 results" when it is both. Saying "films" over a
     list that is half shows is the kind of small lie that makes a screen feel
     untrustworthy. */
  function countNoun(found) {
    let films = 0, shows = 0, i;
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
    const row = focusedRow(), K = UI.KEY;

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
        if (headerFocus) activateChip(); else if (opts.onOpen) opts.onOpen(focusedItem());
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
