/* Remote keys, stacked rows, masthead. Chromium 53.

   The library is ~30k movies, so nothing here fetches or holds a whole section.
   Continue Watching and the category rows arrive as small preloaded lists; the
   All row is virtual over a total count and pages in only what you look at. */
(function () {
  'use strict';

  var TILE_W = 160, GAP = 24, STRIDE = TILE_W + GAP;
  var ROW_H = 304;
  var TILE_POOL = 12;            // tiles per row element
  var ROW_POOL = 4;              // row elements in the DOM, ever
  var TILES_VISIBLE = 10;        // tiles across at 1920 wide
  var ROWS_VISIBLE = 2;
  var PAGE = 100;                // items per request on the All row
  var EDGE = 20;                 // how close to a page edge before prefetching
  var META_CAP = 500;            // focused-item metadata kept in RAM

  var elBrowse = document.getElementById('browse');
  var elLink = document.getElementById('link');
  var elMessage = document.getElementById('message');
  var elSearch = document.getElementById('search');
  var elDevices = document.getElementById('devices');
  var elInput = document.getElementById('search-input');
  var elRows = document.getElementById('rows');
  var elSections = document.getElementById('sections');
  var elToast = document.getElementById('toast');
  var elDebug = document.getElementById('debug');

  var view = 'browse';
  var sections = [], secIdx = 0;
  var rows = [], rowIdx = 0;
  var headerFocus = false, chipIdx = 0;   // d-pad focus on the section/search chips
  var savedRows = null;          // browse rows, parked while showing search results
  var searchQuery = null;        // non-null while the results page is showing
  var searchCount = 0;
  var kidsMode = false;
  var discoverMode = false;
  var deviceMap = null;          // ratingKey -> deviceID of the most recent play
  var myDevices = null;          // null = not configured, so don't filter
  var deviceList = [], devIdx = 0;
  var generation = 0;            // bumps on section switch, kills stale paints
  var rowEls = [];
  var metaCache = {}, metaCount = 0;
  var metaTimer = null, pageTimer = null, toastTimer = null;

  /* ---------- chrome ---------- */

  var BEACON = Config.beacon;

  function debug(msg) {
    elDebug.textContent = msg;
    if (window.console && console.log) console.log('REFLEX ' + msg);
    if (!BEACON) return;
    try {
      var x = new XMLHttpRequest();
      x.open('GET', BEACON + '?m=' + encodeURIComponent(msg), true);
      x.send(null);
    } catch (e) { /* never let logging break the app */ }
  }

  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.classList.add('hidden'); }, 4000);
  }

  function show(name) {
    view = name;
    elBrowse.classList.toggle('hidden', name !== 'browse');
    elLink.classList.toggle('hidden', name !== 'link');
    elMessage.classList.toggle('hidden', name !== 'message');
    elSearch.classList.toggle('hidden', name !== 'search');
    elDevices.classList.toggle('hidden', name !== 'devices');
  }

  function message(title, body) {
    document.getElementById('message-title').textContent = title;
    document.getElementById('message-body').textContent = body;
    show('message');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------- row model ----------
     kind 'list': items are held outright (hubs, on deck, search results)
     kind 'all' : virtual over row.total, pages fetched on demand           */

  function listRow(title, items) {
    return { kind: 'list', title: title, items: items, total: items.length, focus: 0 };
  }

  function allRow(sec, title, filter, tag) {
    return { kind: 'all', title: title || 'All films', focus: 0, total: 0,
             key: sec.key, version: sec.updatedAt || 0,
             filter: filter || null, tag: tag || '',
             pages: {}, inflight: {} };
  }

  function itemAt(row, i) {
    if (!row || i < 0 || i >= row.total) return null;
    if (row.kind === 'list') return row.items[i];
    var p = row.pages[Math.floor(i / PAGE)];
    return p ? p[i % PAGE] : null;
  }

  function focusedRow() { return rows[rowIdx]; }
  function focusedItem() { var r = focusedRow(); return r ? itemAt(r, r.focus) : null; }

  /* ---------- DOM ---------- */

  function buildRows() {
    var r, i, rowEl, label, strip, tile, inner, img, fb, prog;
    for (r = 0; r < ROW_POOL; r++) {
      rowEl = document.createElement('div');
      rowEl.className = 'row';
      label = document.createElement('div');
      label.className = 'row-label';
      strip = document.createElement('div');
      strip.className = 'strip';
      rowEl.appendChild(label);
      rowEl.appendChild(strip);
      rowEl._label = label; rowEl._strip = strip; rowEl._row = -1; rowEl._tiles = [];

      for (i = 0; i < TILE_POOL; i++) {
        tile = document.createElement('div');
        tile.className = 'tile';
        inner = document.createElement('div');
        inner.className = 'tile-inner';
        fb = document.createElement('div');
        fb.className = 'tile-fallback';
        img = document.createElement('img');
        img.alt = '';
        prog = document.createElement('div');
        prog.className = 'tile-progress';
        inner.appendChild(fb);
        inner.appendChild(img);
        inner.appendChild(prog);
        tile.appendChild(inner);
        tile._img = img; tile._fb = fb; tile._prog = prog;
        tile._idx = -1; tile._filled = false;
        strip.appendChild(tile);
        rowEl._tiles.push(tile);
      }
      elRows.appendChild(rowEl);
      rowEls.push(rowEl);
    }
  }

  function translate(el, x, y) {
    var t = 'translate(' + x + 'px,' + y + 'px)';
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  /* A tile showing a placeholder must re-render once its page lands. One that
     already shows a poster must not, or we reassign src for nothing. */
  function invalidateEmptyTiles() {
    var r, i, t;
    for (r = 0; r < ROW_POOL; r++) {
      for (i = 0; i < TILE_POOL; i++) {
        t = rowEls[r]._tiles[i];
        if (!t._filled) t._idx = -1;
      }
    }
  }

  function renderRowInto(rowEl, r) {
    var row = rows[r], reused = rowEl._row !== r;
    var i, idx, tile, item, url, firstVisible, start;

    rowEl.classList.remove('hidden');
    translate(rowEl, 0, r * ROW_H);
    rowEl.classList.toggle('on', r === rowIdx);

    if (reused) {
      rowEl._row = r;
      rowEl._label.textContent = row.title;
      for (i = 0; i < TILE_POOL; i++) { rowEl._tiles[i]._idx = -1; rowEl._tiles[i]._filled = false; }
    }
    if (row.kind === 'all') {
      rowEl._label.textContent = row.title + (row.total ? '  (' + row.total + ')' : '');
    }

    firstVisible = clamp(row.focus - 3, 0, Math.max(0, row.total - TILES_VISIBLE));
    start = clamp(firstVisible - 2, 0, Math.max(0, row.total - TILE_POOL));
    translate(rowEl._strip, -firstVisible * STRIDE, 0);

    for (i = 0; i < TILE_POOL; i++) {
      tile = rowEl._tiles[i];
      idx = start + i;
      if (idx >= row.total) { tile.classList.add('hidden'); tile._idx = -1; continue; }
      tile.classList.remove('hidden');
      translate(tile, idx * STRIDE, 0);
      tile.classList.toggle('on', r === rowIdx && idx === row.focus);
      if (tile._idx === idx) continue;
      tile._idx = idx;
      item = itemAt(row, idx);
      tile._filled = !!item;
      if (!item) {
        tile._fb.textContent = '';
        tile._prog.style.width = '0';
        tile._img.removeAttribute('src');
        continue;
      }
      tile._fb.textContent = item.title || '';
      tile._prog.style.width = (item.viewOffset && item.duration)
        ? Math.round(100 * item.viewOffset / item.duration) + '%' : '0';
      url = Plex.posterUrl(item, TILE_W, 240);
      if (url) tile._img.src = url; else tile._img.removeAttribute('src');
    }
  }

  function renderRows() {
    var firstVisible = clamp(rowIdx - 1, 0, Math.max(0, rows.length - ROWS_VISIBLE));
    var start = clamp(firstVisible, 0, Math.max(0, rows.length - ROW_POOL));
    var i, r;
    translate(elRows, 0, -firstVisible * ROW_H);
    for (i = 0; i < ROW_POOL; i++) {
      r = start + i;
      if (r >= rows.length) { rowEls[i].classList.add('hidden'); rowEls[i]._row = -1; continue; }
      renderRowInto(rowEls[i], r);
    }
  }

  /* The Magic Remote has no colour buttons, so every action has to be
     reachable with the d-pad. Up from the top row lands here. */
  function chipCount() { return sections.length + 4; }
  function kidsChip() { return sections.length; }
  function discoverChip() { return sections.length + 1; }
  function devicesChip() { return sections.length + 2; }
  function searchChip() { return sections.length + 3; }

  function renderSections() {
    var html = '', i, cls;
    /* On the results page the chips are replaced by a header, so it never reads
       as the library screen having reloaded. */
    if (searchQuery) {
      elSections.innerHTML =
        '<span class="chip cur">' + escapeHtml(searchQuery) + '</span>' +
        '<span class="chip">' + searchCount + ' film' + (searchCount === 1 ? '' : 's') +
        '</span><span class="chip">back to library</span>';
      return;
    }
    for (i = 0; i < sections.length; i++) {
      cls = 'chip' + (i === secIdx && !kidsMode ? ' cur' : '') +
            (headerFocus && i === chipIdx ? ' on' : '');
      html += '<span class="' + cls + '">' + escapeHtml(sections[i].title) + '</span>';
    }
    cls = 'chip' + (kidsMode ? ' cur' : '') +
          (headerFocus && chipIdx === kidsChip() ? ' on' : '');
    html += '<span class="' + cls + '">kids</span>';
    cls = 'chip' + (discoverMode ? ' cur' : '') +
          (headerFocus && chipIdx === discoverChip() ? ' on' : '');
    html += '<span class="' + cls + '">discover</span>';
    cls = 'chip' + (headerFocus && chipIdx === devicesChip() ? ' on' : '');
    html += '<span class="' + cls + '">devices</span>';
    cls = 'chip' + (headerFocus && chipIdx === searchChip() ? ' on' : '');
    html += '<span class="' + cls + '">search</span>';
    elSections.innerHTML = html;
  }

  function activateChip() {
    if (chipIdx === searchChip()) { openSearch(); return; }
    if (chipIdx === kidsChip()) { loadKids(); return; }
    if (chipIdx === discoverChip()) { loadDiscover(); return; }
    if (chipIdx === devicesChip()) { openDevices(); return; }
    headerFocus = false;
    kidsMode = false;
    discoverMode = false;
    if (chipIdx !== secIdx) loadSection(chipIdx, true);
    else render();
  }

  /* ---------- masthead ---------- */

  function badge(text, cls) {
    return '<span class="badge' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>';
  }

  function renderMasthead() {
    var row = focusedRow(), item = focusedItem();
    var position = row && row.total ? ((row.focus + 1) + ' of ' + row.total) : '';

    if (!item) {
      document.getElementById('mh-title').textContent = rows.length ? '…' : 'Loading…';
      document.getElementById('mh-meta').textContent = position;
      document.getElementById('mh-badges').innerHTML = '';
      document.getElementById('mh-summary').textContent = '';
      return;
    }

    document.getElementById('mh-title').textContent = item.title || '';

    var meta = [];
    if (item.year) meta.push(item.year);
    if (item.duration) meta.push(Math.round(item.duration / 60000) + ' min');
    if (item.contentRating) meta.push(item.contentRating);
    if (item.viewOffset && item.duration) {
      meta.push(Math.round(100 * item.viewOffset / item.duration) + '% watched');
    }
    meta.push(position);
    document.getElementById('mh-meta').textContent = meta.join('   ·   ');

    document.getElementById('mh-summary').textContent = item.summary || '';

    var media = (item.Media && item.Media[0]) || {};
    var b = '';
    if (media.videoResolution) {
      b += badge(String(media.videoResolution).toUpperCase(), Media.isUHD(media) ? 'warn' : '');
    }
    if (media.videoCodec) b += badge(String(media.videoCodec).toUpperCase());
    if (media.container) b += badge(String(media.container).toUpperCase());

    var md = metaCache[item.ratingKey];
    if (md) {
      var part = md.Media && md.Media[0] && md.Media[0].Part && md.Media[0].Part[0];
      var audio = Media.pickAudio(part);
      b += audio
        ? badge('AUDIO ' + Media.audioLabel(audio), audio.channels > 2 ? 'good' : 'warn')
        : badge('NO PASSABLE AUDIO', 'bad');
    } else {
      b += badge('AUDIO …');
    }
    document.getElementById('mh-badges').innerHTML = b;
  }

  /* Fetch full metadata for the focused item so the audio track we WOULD pick
     is on screen before the user presses OK (CLAUDE.md). Debounced so holding
     a direction key doesn't hammer someone else's server. */
  function scheduleMeta() {
    clearTimeout(metaTimer);
    var item = focusedItem();
    if (!item) return;
    if (metaCache[item.ratingKey]) { renderMasthead(); return; }
    metaTimer = setTimeout(function () { loadMeta(item.ratingKey); }, 280);
  }

  function rememberMeta(ratingKey, md) {
    /* ponytail: crude cap, drop the lot when it fills. A 30k library browsed
       hard would otherwise grow this without bound. LRU if it ever matters. */
    if (metaCount > META_CAP) { metaCache = {}; metaCount = 0; }
    metaCache[ratingKey] = md;
    metaCount++;
  }

  function loadMeta(ratingKey) {
    if (metaCache[ratingKey]) return Promise.resolve(metaCache[ratingKey]);
    return Store.get('meta:' + ratingKey).then(function (cached) {
      if (cached) return cached;
      return Plex.metadata(ratingKey).then(function (md) {
        if (md) Store.put('meta:' + ratingKey, md);
        return md;
      });
    }).then(function (md) {
      if (md) {
        rememberMeta(ratingKey, md);
        var here = focusedItem();
        if (here && here.ratingKey === ratingKey) renderMasthead();
      }
      return md;
    }).catch(function (e) { debug('meta: ' + e.message); return null; });
  }

  function render() {
    renderRows();
    renderMasthead();
    schedulePages();
    scheduleMeta();
  }

  /* ---------- paging (the All row only) ---------- */

  /* Debounced: scrolling through twenty screens must not fire twenty page
     requests, only one for wherever you come to rest. */
  function schedulePages() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(function () {
      var row = focusedRow();
      if (!row || row.kind !== 'all') return;
      var n = Math.floor(row.focus / PAGE), within = row.focus % PAGE;
      ensurePage(row, n);
      if (within > PAGE - EDGE) ensurePage(row, n + 1);
      if (within < EDGE) ensurePage(row, n - 1);
    }, 150);
  }

  function ensurePage(row, n) {
    if (n < 0 || row.pages[n] || row.inflight[n]) return;
    if (row.total && n * PAGE >= row.total) return;
    var gen = generation;
    row.inflight[n] = true;
    /* updatedAt is in the key, so a changed section simply misses the cache.
       ponytail: stale entries linger — Store has no delete. Add a cursor sweep
       if the cache ever grows past a few hundred MB. */
    var key = 'page:' + row.key + ':' + row.version + ':' + row.tag + ':' + n;

    Store.get(key).then(function (cached) {
      if (gen !== generation) return null;
      if (cached && cached.length) return cached;
      return Plex.items(row.key, n * PAGE, PAGE, row.filter).then(function (res) {
        if (gen !== generation) return null;
        if (res.total) row.total = res.total;
        Store.put(key, res.items);
        return res.items;
      });
    }).then(function (list) {
      delete row.inflight[n];
      if (gen !== generation || !list) return;
      row.pages[n] = list;
      invalidateEmptyTiles();
      render();
      debug('page ' + n + ' of ' + row.total);
    }).catch(function (e) {
      delete row.inflight[n];
      if (gen !== generation) return;
      debug('page ' + n + ': ' + e.message);
    });
  }

  /* ---------- sections ---------- */

  function loadSection(i, allowFetch) {
    secIdx = i;
    var gen = ++generation;
    var sec = sections[i];
    kidsMode = false;
    discoverMode = false;
    rows = [];
    rowIdx = 0;
    renderSections();
    renderRows();
    renderMasthead();

    var cacheKey = 'rows:' + sec.key;

    Store.get(cacheKey).then(function (cached) {
      if (gen !== generation) return;
      if (cached && cached.rows && cached.rows.length) {
        rows = cached.rows.map(function (r) { return listRow(r.title, r.items); });
        rows.push(allRow(sec));
        restoreTotal(rows[rows.length - 1], gen);
        render();
        debug(sec.title + ': rows from cache');
      }
      if (!allowFetch) return;

      /* Continue Watching plus the section's own categories: two requests for
         the whole browse screen, no matter how big the library is. */
      return Promise.all([Plex.onDeck(), Plex.hubs(sec.key), ensureHistory()])
        .then(function (res) {
        if (gen !== generation) return;
        var built = [], deck = mine(res[0]), hubList = res[1], i2;
        if (deck.length) built.push({ title: 'Continue watching', items: deck });
        for (i2 = 0; i2 < hubList.length; i2++) {
          built.push({ title: hubList[i2].title, items: hubList[i2].items });
        }
        Store.put(cacheKey, { rows: built });
        rows = built.map(function (r) { return listRow(r.title, r.items); });
        rows.push(allRow(sec));
        rowIdx = clamp(rowIdx, 0, rows.length - 1);
        restoreTotal(rows[rows.length - 1], gen);
        render();
        debug(sec.title + ': ' + rows.length + ' rows');
      });
    }).catch(function (e) {
      if (gen !== generation) return;
      debug('rows: ' + e.message);
      if (!rows.length) toast('Could not reach the server');
    });
  }

  /* A virtual row's length. Size=0 returns totalSize and no items — one cheap
     request instead of crawling 300 pages of a library we don't own. */
  function restoreTotal(row, gen) {
    if (!row || row.kind !== 'all') return;
    var ck = 'total:' + row.key + ':' + row.tag;
    Store.get(ck).then(function (cached) {
      if (gen !== generation) return;
      if (cached && cached.total && cached.updatedAt === row.version) {
        row.total = cached.total;
        render();
        return;
      }
      return Plex.items(row.key, 0, 0, row.filter).then(function (res) {
        if (gen !== generation) return;
        row.total = res.total;
        Store.put(ck, { updatedAt: row.version, total: res.total });
        render();
        debug(row.title + ': ' + res.total + ' films');
      });
    }).catch(function (e) { debug('count: ' + e.message); });
  }

  /* ---------- devices: whose viewing is this ---------- */

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* full */ } }

  function loadMyDevices() {
    var raw = lsGet('myDevices');
    if (!raw) return;
    try { myDevices = JSON.parse(raw); } catch (e) { myDevices = null; }
  }

  /* One history fetch per session gives us ratingKey -> which device last
     played it. onDeck carries no device information of its own, so this is the
     only way to tell your viewing from the other TV's. */
  function ensureHistory() {
    if (deviceMap) return Promise.resolve(deviceMap);
    return Plex.history(200).then(function (entries) {
      var map = {}, i, e;
      /* Sorted newest first, so the first entry per ratingKey is the latest. */
      for (i = 0; i < entries.length; i++) {
        e = entries[i];
        if (!e.ratingKey || e.deviceID === undefined) continue;
        if (map[e.ratingKey] === undefined) map[e.ratingKey] = String(e.deviceID);
      }
      deviceMap = map;
      debug('history: ' + entries.length + ' entries, ' +
            Object.keys(map).length + ' items, ' + countDevices(map) + ' devices');
      return map;
    }).catch(function (e) {
      debug('history unavailable: ' + e.message);
      deviceMap = {};                 // don't retry all session; filtering just stays off
      return deviceMap;
    });
  }

  function countDevices(map) {
    var seen = {}, keys = Object.keys(map), i;
    for (i = 0; i < keys.length; i++) seen[map[keys[i]]] = true;
    return Object.keys(seen).length;
  }

  /* Items last played on a device the user hasn't claimed are dropped. Unknown
     provenance is kept — better a stray entry than silently hiding your own. */
  function mine(list) {
    if (!myDevices || !deviceMap) return list;
    return list.filter(function (m) {
      var dev = deviceMap[m.ratingKey];
      return !dev || myDevices[dev];
    });
  }

  function openDevices() {
    show('devices');
    devIdx = 0;
    document.getElementById('device-list').innerHTML = '<div class="device-row">Reading history…</div>';
    Promise.all([ensureHistory(), Plex.devices()]).then(function (res) {
      var map = res[0] || {}, named = res[1] || [];
      var names = {}, counts = {}, keys = Object.keys(map), i, id;
      for (i = 0; i < named.length; i++) names[named[i].id] = named[i].name;
      for (i = 0; i < keys.length; i++) {
        id = map[keys[i]];
        counts[id] = (counts[id] || 0) + 1;
      }
      deviceList = Object.keys(counts).map(function (d) {
        return { id: d, name: names[d] || ('device ' + d), count: counts[d],
                 mine: myDevices ? !!myDevices[d] : true };
      }).sort(function (a, b) { return b.count - a.count; });
      renderDevices();
    });
  }

  function renderDevices() {
    if (!deviceList.length) {
      document.getElementById('device-list').innerHTML =
        '<div class="device-row">No device history available on this server.</div>';
      return;
    }
    var html = '', i, d;
    for (i = 0; i < deviceList.length; i++) {
      d = deviceList[i];
      html += '<div class="device-row' + (i === devIdx ? ' on' : '') + '">' +
              (d.mine ? '[x] ' : '[ ] ') + escapeHtml(d.name) +
              ' <span class="device-count">' + d.count + ' items</span></div>';
    }
    document.getElementById('device-list').innerHTML = html;
  }

  function saveDevices() {
    if (!deviceList.length) { show('browse'); render(); return; }
    var map = {}, i;
    for (i = 0; i < deviceList.length; i++) if (deviceList[i].mine) map[deviceList[i].id] = true;
    myDevices = map;
    lsSet('myDevices', JSON.stringify(map));
    debug('devices: ' + Object.keys(map).length + ' of ' + deviceList.length + ' claimed');
    show('browse');
    loadSection(secIdx, true);
  }

  /* ---------- kids ---------- */

  /* Everything rated at or below this counts as kids viewing. */
  var KIDS_MAX_AGE = 12;

  function isKids(item) {
    var age = Media.ageLimit(item && item.contentRating);
    return age !== null && age <= KIDS_MAX_AGE;
  }

  function loadKids() {
    var gen = ++generation;
    var sec = sections[secIdx];
    kidsMode = true;
    headerFocus = false;
    rows = [];
    rowIdx = 0;
    renderSections();
    renderRows();
    renderMasthead();

    /* Ask the library which certificates it uses, keep the ones at or below the
       cutoff, and let the server do the filtering. */
    Plex.contentRatings(sec.key).then(function (all) {
      if (gen !== generation) return;
      var kid = all.filter(function (r) {
        var age = Media.ageLimit(r);
        return age !== null && age <= KIDS_MAX_AGE;
      });
      debug('kids certificates: ' + (kid.join(', ') || 'none'));

      return Promise.all([Plex.onDeck(), ensureHistory()]).then(function (res) {
        if (gen !== generation) return;
        var watching = mine(res[0]).filter(isKids);
        rows = [];
        if (watching.length) rows.push(listRow('Kids · carry on watching', watching));

        if (kid.length) {
          rows.push(allRow(sec, 'Kids · all films',
                           { contentRating: kid.join(',') }, 'kids' + KIDS_MAX_AGE));
          render();
          restoreTotal(rows[rows.length - 1], gen);
        } else {
          render();
          if (!watching.length) {
            message('No age ratings', sec.title + ' has no certificate data, so ' +
              'there is nothing to filter on. BACK to return.');
          }
        }
      });
    }).catch(function (e) {
      if (gen !== generation) return;
      debug('kids: ' + e.message);
      toast('Could not load the kids list');
    });
  }

  function leaveKids() {
    if (!kidsMode) return false;
    kidsMode = false;
    loadSection(secIdx, true);
    return true;
  }

  /* ---------- discovery ---------- */

  /* Bounded concurrency: guid lookups are one small request each, but firing
     forty at a remote server at once is rude and slower in practice. */
  function mapLimit(list, max, fn) {
    return new Promise(function (resolve) {
      var results = new Array(list.length), i = 0, done = 0, active = 0;
      if (!list.length) { resolve([]); return; }
      function launch() {
        while (active < max && i < list.length) {
          active++;
          (function (k) {
            fn(list[k]).then(function (v) { results[k] = v; }, function () { results[k] = null; })
              .then(function () {
                active--; done++;
                if (done === list.length) resolve(results); else launch();
              });
          })(i++);
        }
      }
      launch();
    });
  }

  /* TMDB ids -> the library items we actually hold, order preserved. */
  function matchToLibrary(tmdbIds) {
    return mapLimit(tmdbIds.slice(0, 40), 4, function (id) {
      return Plex.findByGuid('tmdb://' + id);
    }).then(function (found) {
      return found.filter(function (m) { return !!m; });
    });
  }

  function seedsFromViewing() {
    return Plex.onDeck().then(function (deck) {
      var seeds = [], i, id, list = mine(deck);
      for (i = 0; i < list.length && seeds.length < 8; i++) {
        id = Plex.tmdbId(list[i]);
        if (id) seeds.push(id);
      }
      return seeds;
    }).catch(function () { return []; });
  }

  function loadDiscover() {
    var gen = ++generation;
    discoverMode = true;
    kidsMode = false;
    headerFocus = false;
    rows = [];
    rowIdx = 0;
    renderSections();
    renderRows();
    renderMasthead();

    if (!Discover.enabled()) {
      discoverMode = false;
      message('Discovery needs a TMDB key',
        'Curated rows come from TMDB. Paste a free v3 API key into KEY at the ' +
        'top of js/discover.js and rebuild. Everything else works without it.');
      return;
    }

    var tasks = [{ title: 'Trending this week', get: Discover.trending }];
    Discover.providers.forEach(function (p) {
      tasks.push({ title: 'On ' + p.name,
                   get: function () { return Discover.onProvider(p.id); } });
    });

    /* Rows appear as they resolve rather than all at the end — the first one
       lands while the rest are still matching. */
    function runTask(t) {
      return t.get().then(matchToLibrary).then(function (items) {
        if (gen !== generation) return;
        if (!items.length) { debug(t.title + ': nothing on this server'); return; }
        rows.push(listRow(t.title, items));
        render();
        debug(t.title + ': ' + items.length + ' on this server');
      }, function (e) {
        debug(t.title + ' failed: ' + e.message);
      });
    }

    var i = 0;
    function step() {
      if (gen !== generation) return Promise.resolve();
      if (i >= tasks.length) return Promise.resolve();
      return runTask(tasks[i++]).then(step);
    }

    step().then(function () {
      if (gen !== generation) return;
      return seedsFromViewing().then(function (seeds) {
        if (gen !== generation || !seeds.length) return;
        return Discover.recommendedFrom(seeds).then(matchToLibrary).then(function (items) {
          if (gen !== generation || !items.length) return;
          rows.push(listRow('Because of what you have been watching', items));
          render();
        });
      });
    }).then(function () {
      if (gen !== generation) return;
      if (!rows.length) {
        message('Nothing matched',
          'None of the curated titles are on this server, or the TMDB ids did ' +
          'not line up. Check the debug line for which rows came back empty.');
      }
    });
  }

  function leaveDiscover() {
    if (!discoverMode) return false;
    discoverMode = false;
    loadSection(secIdx, true);
    return true;
  }

  /* ---------- search ---------- */

  function openSearch() {
    show('search');
    elInput.value = '';
    /* webOS raises its own on-screen keyboard when an input takes focus —
       no need to build a letter grid. */
    setTimeout(function () { elInput.focus(); }, 50);
  }

  /* Results land on their own page, not back on the library rows — laid out as
     a grid of RESULTS_PER_ROW using the same row machinery. */
  var RESULTS_PER_ROW = 10;

  function runSearch() {
    var q = elInput.value.trim();
    if (!q) { closeSearch(); return; }
    elInput.blur();
    show('browse');
    toast('Searching…');
    Plex.search(q).then(function (found) {
      if (!savedRows) savedRows = rows;
      searchQuery = q;
      searchCount = found.length;
      headerFocus = false;
      rows = [];
      for (var i = 0; i < found.length; i += RESULTS_PER_ROW) {
        rows.push(listRow(i === 0 ? 'Results' : '', found.slice(i, i + RESULTS_PER_ROW)));
      }
      if (!rows.length) rows = [listRow('No matches', [])];
      rowIdx = 0;
      renderSections();          // swap the chips for the results header
      render();
      debug('search "' + q + '": ' + found.length + ' film' + (found.length === 1 ? '' : 's'));
    }).catch(function (e) {
      message('Search failed', e.message);
    });
  }

  function closeSearch() {
    elInput.blur();
    show('browse');
    render();
  }

  /* Back out of a results list to the rows we parked. */
  function clearSearchResults() {
    if (!savedRows) return false;
    rows = savedRows;
    savedRows = null;
    searchQuery = null;
    rowIdx = 0;
    renderSections();          // and back to the chips
    render();
    return true;
  }

  /* ---------- playback ---------- */

  function playSelected() {
    var item = focusedItem();
    if (!item) return;
    toast('Checking…');
    loadMeta(item.ratingKey).then(function (md) {
      if (!md) { toast('No metadata'); return; }
      var media = md.Media && md.Media[0];
      var part = media && media.Part && media.Part[0];
      if (!part) { message('Nothing to play', 'This item has no playable part.'); return; }

      var audio = Media.pickAudio(part);
      if (!audio) {
        message('No passable audio track', item.title +
          ' only offers TrueHD or DTS-HD MA. Neither can pass over plain HDMI ARC ' +
          'on this set, so playing it would force an audio transcode on a server ' +
          'we do not own. Refused.');
        return;
      }

      return Plex.decide(md, 0, 0, audio.id).then(function (verdict) {
        debug('decision: ' + verdict.decision + ' ' + verdict.text);
        if (verdict.decision === 'directplay') {
          md.viewOffset = item.viewOffset || md.viewOffset || 0;
          Player.play({
            item: md,
            part: part,
            onExit: function () { show('browse'); render(); },
            onError: function (msg) { message('Playback failed', msg); }
          });
          show('player');
          return;
        }
        var why = verdict.text || ('the server returned "' + verdict.decision + '"');
        if (Media.isUHD(media)) {
          message('4K transcode refused', item.title + ' will not direct play — ' + why +
            '. Starting it would register a 4K transcode on the server, which gets killed. ' +
            'Run probe.py against this file to find which declared capability flips it.');
        } else {
          message('Would transcode', item.title + ' will not direct play — ' + why +
            '. Reflex plays direct only.');
        }
      });
    }).catch(function (e) {
      message('Could not check playback', e.message);
    });
  }

  /* ---------- keys ---------- */

  function onKey(e) {
    var code = e.keyCode, row;

    if (Player.playing()) {
      if (Player.key(code)) e.preventDefault();
      return;
    }

    /* The system keyboard owns every key here, OK included — pressing OK picks
       a letter. Only Back is ours; Enter is handled on the input itself. */
    if (view === 'search') {
      if (code === 461 || code === 27 || code === 8) { closeSearch(); e.preventDefault(); }
      return;
    }

    if (view === 'devices') {
      if (code === 38 && devIdx > 0) { devIdx--; renderDevices(); }
      else if (code === 40 && devIdx < deviceList.length - 1) { devIdx++; renderDevices(); }
      else if (code === 13 && deviceList[devIdx]) {
        deviceList[devIdx].mine = !deviceList[devIdx].mine;
        renderDevices();
      } else if (code === 461 || code === 27 || code === 8) { saveDevices(); }
      e.preventDefault();
      return;
    }

    if (view === 'message') {
      if (code === 461 || code === 27 || code === 8 || code === 13) {
        if (!Plex.hasToken()) doLink();
        else { show('browse'); render(); }
      }
      e.preventDefault();
      return;
    }

    if (view !== 'browse') return;

    row = focusedRow();

    switch (code) {
      case 37:
        if (headerFocus) { chipIdx = clamp(chipIdx - 1, 0, chipCount() - 1); renderSections(); }
        else if (row && row.focus > 0) { row.focus--; render(); }
        break;
      case 39:
        if (headerFocus) { chipIdx = clamp(chipIdx + 1, 0, chipCount() - 1); renderSections(); }
        else if (row && row.focus < row.total - 1) { row.focus++; render(); }
        break;
      case 38:
        if (headerFocus) break;
        if (rowIdx > 0) { rowIdx--; render(); }
        else if (!searchQuery) { headerFocus = true; chipIdx = secIdx; renderSections(); }
        break;
      case 40:
        if (headerFocus) { headerFocus = false; renderSections(); }
        else if (rowIdx < rows.length - 1) { rowIdx++; render(); }
        break;
      case 13:
        if (headerFocus) activateChip(); else playSelected();
        break;
      case 403:                                   // red, on remotes that have it
        openSearch();
        break;
      case 461: case 27: case 8:
        if (headerFocus) { headerFocus = false; renderSections(); }
        else if (!clearSearchResults() && !leaveKids() && !leaveDiscover()) exitApp();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function exitApp() {
    if (window.webOS && window.webOS.platformBack) window.webOS.platformBack();
    else window.close();
  }

  /* ---------- boot ---------- */

  function doLink() {
    show('link');
    debug('requesting a pin from plex.tv…');
    Plex.linkStart().then(function (pin) {
      document.getElementById('link-code').textContent = pin.code;
      debug('pin ' + pin.id + ' · client ' + String(Plex.state.clientId).substring(0, 8) +
            ' · code ' + pin.code);
      return Plex.linkPoll(pin.id, Date.now() + 15 * 60 * 1000, debug);
    }).then(function (token) {
      if (!token) {                          // pin expired, issue a fresh one
        debug('pin expired after 15 min, requesting another');
        doLink();
        return;
      }
      show('browse');
      start();
    }).catch(function (e) {
      message('Could not reach plex.tv', e.message + '  ·  BACK to retry');
    });
  }

  function start() {
    show('browse');
    /* Paint from cache before any network work — the whole point of the app. */
    Store.get('sections').then(function (cached) {
      if (cached && cached.length && Plex.state.base) {
        sections = cached;
        loadSection(0, false);
      }
      return Plex.discover();
    }).then(function () {
      debug('server: ' + (Plex.state.serverName || Plex.state.base));
      return Plex.sections();
    }).then(function (secs) {
      if (!secs.length) { message('No movie libraries', 'This server shares no movie sections.'); return; }
      Store.put('sections', secs);
      var currentKey = sections[secIdx] && sections[secIdx].key;
      sections = secs;
      var i = 0, j;
      for (j = 0; j < secs.length; j++) if (secs[j].key === currentKey) i = j;
      loadSection(i, true);
    }).catch(function (e) {
      debug('start failed: ' + e.message);
      /* Match the status precisely — a bare '401' also appears inside URLs, and
         signing out on a false positive dumps the user back to a fresh code
         with no explanation, which looks exactly like a login loop. */
      if (/-> 40[13]$/.test(e.message)) {
        /* Only plex.tv can invalidate the login. A 401 from the media server
           means the per-server token is stale — rediscover, don't make the
           user link again. Conflating the two is what turned one bug into a
           repeating login loop. */
        if (e.message.indexOf(Config.plexTvBase) >= 0) {
          Plex.signOut();
          message('Plex rejected the login', e.message +
            '  ·  The stored login is no longer valid. BACK to link again.');
        } else {
          Plex.forgetServer();
          message('Server rejected the token', e.message +
            '  ·  Dropped the cached server. BACK to retry.');
        }
        return;
      }
      if (!rows.length) message('Could not reach the server', e.message + '  ·  BACK to retry');
      else toast('Offline — showing cache');
    });
  }

  window.onerror = function (msg, url, line) {
    debug('JS ERROR ' + msg + ' @' + String(url).split('/').pop() + ':' + line);
    return false;
  };

  /* Does persistence actually work here? If not, every launch is a first
     launch, which looks like a login loop. */
  function storageSelfTest() {
    var ok;
    try {
      localStorage.setItem('selftest', 'y');
      ok = localStorage.getItem('selftest') === 'y';
      localStorage.removeItem('selftest');
    } catch (e) {
      debug('localStorage THROWS: ' + e.message);
      return;
    }
    debug('localStorage ' + (ok ? 'ok' : 'SILENTLY DROPS WRITES') +
          ' · token ' + (Plex.hasToken() ? 'present' : 'absent'));
  }

  buildRows();
  document.addEventListener('keydown', onKey, false);
  /* Enter from the on-screen keyboard arrives on the input, not the document.
     It must not go on to reach onKey: runSearch switches back to the browse
     view synchronously, so by the time the event bubbles up, onKey would read
     it as OK on whatever was focused before the search and start a playback
     decision on it. */
  elInput.addEventListener('keydown', function (e) {
    if (e.keyCode !== 13) return;
    e.preventDefault();
    e.stopPropagation();
    runSearch();
  }, false);
  Plex.init();
  loadMyDevices();
  storageSelfTest();
  if (Plex.hasToken()) start(); else doLink();
})();
