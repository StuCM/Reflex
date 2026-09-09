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

  const elBrowse = document.getElementById('browse');
  const elInput = document.getElementById('search-input');
  const elHint = document.getElementById('browse-hint');
  const elConfirm = document.getElementById('confirm');

  let sections = [];
  let secIdx = 0;
  let rows = [];
  let rowIdx = 0;
  const cats = {};                          // section title -> its row titles, for the sidebar
  let deckItems = [];                     // Continue watching, before any type filter
  let watchingType = null;                // the cut applied to it: null, movie or episode
  let wantRow = 0;                        // row to land on once the next section is built
  let mode = 'library';                   // library | kids | discover
  let savedRows = null;                   // rows parked while showing search results
  let searchQuery = null;                 // non-null while the results page is showing
  let generation = 0;                     // bumps on any row change, kills stale paints
  let pageTimer = null;
  let resolveTimer = null;                // a Discovery tile, once you stop on it
  const RESOLVE_HOLD = 420;                 // the stillness the backdrop also waits for
  const MAX_SEEDS = 8;                      // titles the recommended row is built from
  let opts = {};

  let picking = false;                    // green has the deck row in select mode
  let picks = [];                         // the entries picked, while it has
  let pickAt = -1;                        // the row that is happening on

  const RESULTS_PER_ROW = 10;
  const WATCHING = 'Continue watching';
  /* UI.KEY carries red, which search already uses; green is free on this
     screen and is the only other key the Magic Remote's siblings all have. */
  const GREEN = 404;

  /* One section per kind of thing this app can play, whatever the servers call
     their libraries. Music and photos are neither, so they are left out. */
  const SECTION_TITLES = { movie: 'Movies', show: 'TV Shows' };
  const SECTION_ORDER = ['movie', 'show'];

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
  function focusedItem() { const r = focusedRow(); return r ? Rows.itemAt(r, r.focus) : null; }
  function hasRows() { return rows.length > 0; }
  function currentSection() { return sections[secIdx] || null; }

  /* A guard any in-flight load can check before it paints. */
  function generationGuard() {
    const gen = generation;
    return function () { return gen === generation; };
  }

  function render() {
    elBrowse.classList.toggle('results', !!searchQuery);
    /* The hero is full height on the first row and a band everywhere else, so
       the rows have somewhere to go the moment you step into them. */
    elBrowse.classList.toggle('dense', rowIdx !== 0);
    Rail.render(rows, rowIdx);
    Masthead.render(focusedRow(), focusedItem(), rows.length > 0);
    /* The backdrop keeps its own debounce — Meta's skips a cached item and
       would leave the last film's art under the new one's title. */
    Masthead.art(focusedItem());
    scheduleResolve(focusedItem());
    markPicks();
    scheduleWalk();
  }

  /* ---------- servers and sections ----------

     Every movie library on every server is one part of Movies, and every show
     library one part of TV Shows. A server that splits its films across a 4K
     library and an LQ one contributes two parts; the merge folds them back to
     one entry per film, the way it already does across servers. */

  function setSections(perServer) {
    const byType = {};
    let i;
    let type;
    for (i = 0; i < perServer.length; i++) {
      const list = perServer[i].sections || [];
      for (let j = 0; j < list.length; j++) {
        const sec = list[j];
        type = sec.type;
        if (!SECTION_TITLES[type]) continue;
        if (!byType[type]) byType[type] = { title: SECTION_TITLES[type], type: type, parts: [] };
        byType[type].parts.push({ server: perServer[i].server, key: sec.key,
                                  updatedAt: sec.updatedAt || 0 });
      }
    }
    const merged = [];
    for (i = 0; i < SECTION_ORDER.length; i++) {
      if (byType[SECTION_ORDER[i]]) merged.push(byType[SECTION_ORDER[i]]);
    }
    const currentTitle = sections[secIdx] && sections[secIdx].title;
    sections = merged;
    let at = 0;
    for (i = 0; i < merged.length; i++) if (merged[i].title === currentTitle) at = i;
    return at;
  }

  function serversOf(sec) {
    const out = [];
    const seen = {};
    for (let i = 0; i < sec.parts.length; i++) {
      const id = sec.parts[i].server.id;
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
    /* Continue watching is per account rather than per section, so it heads the
       list on its own rather than once under every section. */
    const at = watchingRowIdx();
    const watching = { current: mode === 'library' && rowIdx === at,
                     type: watchingType,
                     has: at >= 0 && rows[at].total > 0 };
    Sidebar.open(sections.map(function (sec, i) {
      /* Category titles are the row titles of a section we have already built,
         so this fetches nothing. A section never visited simply lists none. */
      return { title: sec.title, categories: cats[sec.title] || [],
               current: mode === 'library' && i === secIdx };
    }), activate, mode, watching);
  }

  /* Select mode renames the row, so while it is on the row is known by where it
     is rather than by what it says. */
  function watchingRowIdx() {
    if (picking) return pickAt;
    for (let i = 0; i < rows.length; i++) if (rows[i].title === WATCHING) return i;
    return -1;
  }

  function deckCut() {
    if (!watchingType) return deckItems;
    return deckItems.filter(function (m) { return m.type === watchingType; });
  }

  /* Continue watching, cut to films or episodes. The unfiltered deck is kept so
     the cut can be lifted without asking the servers again, and an empty cut
     leaves the row where it is — a row vanishing on a keypress reads as a
     crash. */
  function showWatching(type) {
    const at = watchingRowIdx();
    if (at < 0) { UI.toast('Nothing part-watched there'); return; }
    watchingType = type || null;
    const items = deckCut();
    rows[at] = Rows.list(WATCHING, items);
    rowIdx = at;
    render();
    if (!items.length) UI.toast('Nothing part-watched there');
  }

  /* ---------- clearing Continue watching ----------

     The row grows and never shrinks, and Plex's own way out is marking things
     watched — which for a series two seasons in means losing the fact that you
     have seen two. So an item is hidden where the server can, and only where it
     cannot is the user asked to mark it watched instead. Nothing goes without a
     confirmation, and nothing leaves the row before the server has agreed. */

  function pickIndex(item) {
    const key = Media.identity(item);
    for (let i = 0; i < picks.length; i++) if (Media.identity(picks[i]) === key) return i;
    return -1;
  }

  /* Amber on tiles the rail has already drawn. The row model knows nothing
     about a mode that lasts seconds, and Rail owns no state to teach. */
  function markPicks() {
    const tiles = document.querySelectorAll('#rows .tile');
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      tile.classList.toggle('picked',
        !!(picking && tile._item && pickIndex(tile._item) >= 0));
    }
  }

  function paintPicking() {
    const row = rows[pickAt];
    /* A new row object rather than a renamed one: the rail repaints a label
       only when the row it is handed changes identity. */
    rows[pickAt] = Rows.list(picking ? 'Select to remove — ' + picks.length + ' picked'
                                     : WATCHING, row.items);
    rows[pickAt].focus = row.focus;
    elHint.textContent = '◀ ▶ move  ·  OK picks one  ·  green removes what is picked  ·  ' +
                         'BACK leaves it all as it was';
    elHint.classList.toggle('hidden', !picking);
    render();
  }

  function startPicking() {
    const at = watchingRowIdx();
    if (at < 0 || at !== rowIdx) { UI.toast('Green clears things out of Continue watching'); return; }
    if (!rows[at].total) { UI.toast('Nothing part-watched to remove'); return; }
    picking = true;
    pickAt = at;
    picks = [];
    paintPicking();
  }

  function stopPicking() {
    if (!picking) return;
    picking = false;
    picks = [];
    paintPicking();
  }

  function togglePick() {
    const item = focusedItem();
    let at;
    if (!item) return;
    at = pickIndex(item);
    if (at >= 0) picks.splice(at, 1); else picks.push(item);
    paintPicking();
  }

  /* The confirmation, in the shared menu shell — a title saying what will
     happen and to how many, the action, and Cancel. Cancel is what it lands on:
     the action is one key away and never the default. */
  function askThen(count, mode, go) {
    const hide = mode === 'hide';
    Menu.open({
      host: elConfirm,
      tabs: [{
        label: hide ? 'Remove ' + count + ' from Continue watching'
                    : 'Mark ' + count + ' watched',
        note: hide ? 'They stay part-watched.'
                   : 'This server cannot hide them. Marking a show watched marks ' +
                     'every episode.',
        rows: function () {
          return [{ label: hide ? 'Remove them' : 'Mark them watched', value: 'go' },
                  { label: 'Cancel', on: true, value: null }];
        }
      }],
      onChoose: function (value) { if (value === 'go') go(); },
      onClose: render
    });
  }

  /* Marking an episode watched only advances the deck to the next episode, so
     the series stays in the row. Its show is what removes it — and marks every
     episode of it, which is why this path is confirmed in exactly those
     words. */
  function watchedKey(copy) {
    if (copy.type === 'episode' && copy.grandparentRatingKey) return copy.grandparentRatingKey;
    return copy.ratingKey;
  }

  /* Out of the row and out of the cache, so a reload does not bring it back.
     ponytail: the whole section's cached rows go rather than the one row —
     Continue watching is per account and so sits in every section's entry, and
     they are refetched on the next visit anyway. */
  function dropFromDeck(entry) {
    const gone = Media.identity(entry);
    let at;
    let row;
    deckItems = deckItems.filter(function (m) { return Media.identity(m) !== gone; });
    for (let i = 0; i < sections.length; i++) Cache.rows.drop(sections[i].title);
    at = watchingRowIdx();
    if (at < 0) return;
    row = Rows.list(rows[at].title, deckCut());
    row.focus = UI.clamp(rows[at].focus, 0, Math.max(0, row.total - 1));
    rows[at] = row;
  }

  /* A job is an entry and the copies of it still to be dealt with — a film on
     both servers is still in the row if only one of them is told, and a copy
     that has already been hidden must not then be marked watched as well. */
  function jobFor(entry) { return { entry: entry, copies: Merge.sources(entry) }; }

  /* The entry leaves the row only once every copy of it has gone; whatever a
     server would not hide comes back as `copies` for the caller to ask about. */
  function clearFromDeck(job, mode) {
    return Promise.all(job.copies.map(function (copy) {
      const server = Servers.of(copy);
      if (mode !== 'watched') return Plex.hideFromDeck(server, copy.ratingKey);
      return Plex.scrobble(server, watchedKey(copy)).then(function () { return true; });
    })).then(function (done) {
      const refused = [];
      for (let i = 0; i < done.length; i++) if (!done[i]) refused.push(job.copies[i]);
      if (refused.length) return { needsWatched: true, copies: refused };
      dropFromDeck(job.entry);
      return { ok: true };
    }, function (e) {
      UI.debug('clear: ' + e.message);
      return { ok: false };
    });
  }

  /* Clear a list of jobs, asking again about only the copies the server would
     not hide. A server that refuses both leaves its item in the row and says
     so. */
  function clearAll(jobs, mode, after) {
    Promise.all(jobs.map(function (job) {
      return clearFromDeck(job, mode);
    })).then(function (res) {
      const again = [];
      let failed = 0;
      for (let i = 0; i < res.length; i++) {
        if (res[i].ok) continue;
        if (res[i].needsWatched) again.push({ entry: jobs[i].entry, copies: res[i].copies });
        else failed++;
      }
      if (picking) {
        picks = again.map(function (job) { return job.entry; });
        paintPicking();
      } else render();
      if (failed) {
        UI.toast(failed + (failed === 1 ? ' was' : ' were') + ' refused — still in the row');
      }
      if (again.length) {
        askThen(again.length, 'watched', function () { clearAll(again, 'watched', after); });
        return;
      }
      stopPicking();
      if (after) after();
    });
  }

  /* Green a second time: confirm everything picked. */
  function confirmPicks() {
    const chosen = picks.map(jobFor);
    if (!chosen.length) { UI.toast('Nothing picked — OK picks the tile you are on'); return; }
    askThen(chosen.length, 'hide', function () { clearAll(chosen, 'hide', null); });
  }

  /* The same action for one title, from its own page. */
  function clearOne(entry, after) {
    askThen(1, 'hide', function () { clearAll([jobFor(entry)], 'hide', after); });
  }

  /* Is this on Continue watching? The detail page only offers to clear
     something the row actually holds. */
  function isOnDeck(item) {
    const key = item && Media.identity(item);
    if (!key) return false;
    for (let i = 0; i < deckItems.length; i++) {
      if (Media.identity(deckItems[i]) === key) return true;
    }
    return false;
  }

  function activate(choice) {
    if (choice.kind === 'search') { openSearch(); return; }
    if (choice.kind === 'watching') {
      /* Kids and discovery have no Continue watching row, so the library comes
         back first — it lands on row 0, which is it. */
      if (mode !== 'library') loadSection(secIdx, true);
      else showWatching(choice.type);
      return;
    }
    if (choice.kind === 'clear') {
      /* The focus can be anywhere when this is chosen, so land on the row
         first: a mode you then have to go and find is not reachable, which is
         the whole reason this entry exists beside the green key. */
      const deckAt = watchingRowIdx();
      if (deckAt < 0) { UI.toast('Nothing part-watched to remove'); return; }
      rowIdx = deckAt;
      startPicking();
      return;
    }
    if (choice.kind === 'kids') { loadKids(); return; }
    if (choice.kind === 'discover') { loadDiscover(); return; }
    if (choice.kind === 'prefer') {
      const now = Servers.get(Servers.cyclePreferred());
      UI.debug('preferring ' + (now ? now.name : '?') + ' where both servers have a film');
      /* Rebuild the rows: which copy of a shared film is shown changes with
         the preference. */
      loadSection(secIdx, true);
      return;
    }
    if (choice.kind === 'autoplay') {
      Player.cycleAutoplay();
      UI.toast('Autoplay next: ' + Player.autoplayLabel());
      render();
      return;
    }
    if (choice.kind === 'theme') {
      ShowPage.cycleTheme();
      UI.toast('Theme music: ' + ShowPage.themeLabel());
      render();
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
    watchingType = null;
    /* The rows the mode was over are gone, so it goes with them rather than
       counting picks nobody can see. */
    picking = false;
    picks = [];
    elHint.classList.add('hidden');
    render();
  }

  /* Rows from titled item lists, remembering the part-watched ones so the
     Continue watching cut has something to filter. */
  function listRows(built) {
    deckItems = [];
    for (let i = 0; i < built.length; i++) {
      if (built[i].title === WATCHING) deckItems = built[i].items;
    }
    return built.map(function (r) { return Rows.list(r.title, r.items); });
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
    const base = { type: sec.type === 'show' ? 2 : 1 };
    if (filter) {
      const keys = Object.keys(filter);
      for (let i = 0; i < keys.length; i++) base[keys[i]] = filter[keys[i]];
    }
    const parts = sec.parts.map(function (p) {
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
    const jobs = row.state.streams.map(function (s) {
      if (s.total) return Promise.resolve();
      const ck = s.part.server.id + ':' + s.part.key + ':' + s.part.tag;
      return Cache.total.get(ck).then(function (cached) {
        if (cached && cached.total && cached.updatedAt === s.part.updatedAt) {
          s.total = cached.total;
          return;
        }
        return Plex.items(s.part.server, s.part.key, 0, 0, s.part.filter).then(function (res) {
          s.total = res.total;
          Cache.total.put(ck, { updatedAt: s.part.updatedAt, total: res.total });
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
    const isCurrent = generationGuard();
    const sec = sections[i];
    Cache.rows.get(sec.title).then(function (cached) {
      if (!isCurrent()) return;
      if (cached && cached.rows && cached.rows.length) {
        rows = listRows(cached.rows);
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
      const servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map(function (sv) { return Plex.onDeck(sv); })),
        Promise.all(sec.parts.map(function (p) { return Plex.hubs(p.server, p.key); })),
        Devices.ensureHistory()
      ]).then(function (res) {
        if (!isCurrent()) return;
        const built = [];

        /* onDeck is per server, not per section, and hands back films and
           episodes together — which is what you want to carry on with, so it is
           kept whole rather than cut to the section's own type. Most recently
           watched first. */
        const deck = Devices.mine(Merge.lists(res[0]));
        deck.sort(function (a, b) { return (b.lastViewedAt || 0) - (a.lastViewedAt || 0); });
        if (deck.length) built.push({ title: WATCHING, items: deck });

        mergeHubs(res[1]).forEach(function (hub) { built.push(hub); });

        Cache.rows.put(sec.title, { rows: built });
        rows = listRows(built);
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
    const byTitle = {};
    const order = [];
    for (let i = 0; i < perPart.length; i++) {
      const list = perPart[i] || [];
      for (let j = 0; j < list.length; j++) {
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
      const row = focusedRow();
      if (!row || row.kind !== 'merge') return;
      if (Rows.haveUpTo(row) > Rows.needsUpTo(row)) return;
      const isCurrent = generationGuard();
      const had = Rows.haveUpTo(row);
      const was = row.total;
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
    const sec = sections[secIdx];
    reset('kids');
    const isCurrent = generationGuard();

    /* Ask each library which certificates it uses, keep the ones at or below
       the cutoff, and let the servers do the filtering. */
    Promise.all(sec.parts.map(function (p) {
      return Plex.contentRatings(p.server, p.key);
    })).then(function (perPart) {
      if (!isCurrent()) return;
      const kid = [];
      const seen = {};
      perPart.forEach(function (list) {
        list.filter(Media.isKidsRating).forEach(function (r) {
          if (!seen[r]) { seen[r] = true; kid.push(r); }
        });
      });
      UI.debug('kids certificates: ' + (kid.join(', ') || 'none'));

      const servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map(function (sv) { return Plex.onDeck(sv); })),
        Devices.ensureHistory()
      ]).then(function (res) {
        if (!isCurrent()) return;
        const kidsWant = sec.type === 'show' ? 'episode' : 'movie';
        const watching = Devices.mine(Merge.lists(res[0])).filter(function (m) {
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
    }).catch(function (e) {
      if (!isCurrent()) return;
      UI.debug('kids: ' + e.message);
      UI.toast('Could not load the kids list');
    });
  }

  /* ---------- discovery ---------- */

  /* A Discovery tile is looked up on the servers only once you have stopped on
     it, on the same stillness the backdrop waits for — so sweeping a row costs
     nothing and painting the page costs nothing at all. */
  function scheduleResolve(item) {
    clearTimeout(resolveTimer);
    if (!Discovery.isEntry(item) || item._resolved !== undefined) return;
    const gen = generation;
    resolveTimer = setTimeout(function () {
      Discovery.resolve(item).then(function () {
        if (gen === generation && focusedItem() === item) render();
      });
    }, RESOLVE_HOLD);
  }

  /* Seeds for the recommended row, out of the Continue watching row already in
     memory. Asking a server for them would cost the page its whole point. */
  function deckSeeds() {
    const out = [];
    for (let i = 0; i < deckItems.length && out.length < MAX_SEEDS; i++) {
      const id = Plex.tmdbId(deckItems[i]);
      if (id && out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }

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
      seeds: deckSeeds(),
      /* Rows appear as they arrive rather than all at the end — the first one
         lands while the rest are still being fetched. */
      add: function (title, items) {
        rows.push(Rows.list(title, items));
        render();
      }
    }).then(function () {
      if (!isCurrent() || rows.length) return;
      UI.message('Nothing to show',
        'TMDB returned no titles for any of the categories in js/config.js. ' +
        'Check the debug line for which came back empty.');
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
    const q = elInput.value.trim();
    if (!q) { closeSearch(); return; }
    elInput.blur();
    UI.show('browse');
    UI.toast('Searching…');
    const isCurrent = generationGuard();
    Promise.all(Servers.all().map(function (sv) {
      return Plex.search(sv, q);
    })).then(function (perServer) {
      if (!isCurrent()) return;
      const found = Merge.lists(perServer);
      if (!savedRows) savedRows = rows;
      searchQuery = q;
      const noun = countNoun(found);
      /* The results page has no chips to head it any more, so the first row's
         own title carries what was asked, what came back, and the way out. */
      const header = q + '  ·  ' + found.length + ' ' + noun + '  ·  BACK to library';
      rows = [];
      for (let i = 0; i < found.length; i += RESULTS_PER_ROW) {
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
    let films = 0;
    let shows = 0;
    for (let i = 0; i < found.length; i++) {
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
    if (Menu.isOpen()) return Menu.key(code);
    if (Sidebar.isOpen()) return Sidebar.key(code);

    let row = focusedRow();
    const K = UI.KEY;

    switch (code) {
      case K.LEFT:
        /* Left off the front of a row is the way to the sections — there is
           nowhere else for it to go, and the rail has no header any more.
           Not while picking: the way out of the mode is BACK, not wandering. */
        if (row && row.focus > 0) { row.focus--; render(); }
        else if (!picking) openSidebar();
        break;
      case K.RIGHT:
        if (row && row.focus < row.total - 1) { row.focus++; render(); }
        break;
      case K.UP:
        if (!picking && rowIdx > 0) { rowIdx--; render(); }
        break;
      case K.DOWN:
        if (!picking && rowIdx < rows.length - 1) { rowIdx++; render(); }
        break;
      case K.OK:
        if (picking) { togglePick(); break; }
        if (opts.onOpen) opts.onOpen(focusedItem());
        break;
      case K.RED:                                 // red, on remotes that have it
        openSearch();
        break;
      case GREEN:                                 // enter the mode, then confirm it
        if (picking) confirmPicks(); else startPicking();
        break;
      default:
        if (!UI.isBack(code)) return false;
        if (picking) { stopPicking(); break; }
        if (!clearResults() && !leaveMode() && opts.onExit) opts.onExit();
        break;
    }
    return true;
  }

  return {
    init: init, render: render, key: key, searchKey: searchKey,
    setSections: setSections, currentSection: currentSection,
    loadSection: loadSection, focusedItem: focusedItem, hasRows: hasRows,
    clearOne: clearOne, isOnDeck: isOnDeck
  };
})();
