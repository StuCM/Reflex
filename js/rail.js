/* The rail: stacked rows of landscape tiles, drawn from a fixed pool of elements.

   Nothing here grows with the library. Four row elements and twelve tiles each
   exist for the life of the app; scrolling moves transforms and reassigns
   contents. On a 2018 SoC that is the difference between a rail that keeps up
   with the remote and one that does not.

   Rail draws whatever it is handed and owns no state beyond the pool — see
   js/browse.js for what is in the rows. */
var Rail = (function () {
  'use strict';

  var TILE_W = 372, TILE_H = 209, GAP = 44, STRIDE = TILE_W + GAP;
  var ROW_H = 361;               // 44 header + 209 art + 74 two lines + 34 below
  var TILE_POOL = 12;            // tiles per row element
  var ROW_POOL = 4;              // row elements in the DOM, ever
  var TILES_VISIBLE = 4;         // tiles across at 1920 wide
  var LEAD = 1;                  // tiles kept to the left of the focused one
  /* Two different questions, and answering both with one number clipped the
     last row of every section. ROWS_FIT is how many rows fit *whole* in the
     viewport, and is what stops the window scrolling past the end — get it
     wrong and the final row is pinned half below the fold, title and all.
     ROWS_VISIBLE is how many are on screen at all, including the one peeking
     at the bottom, and is only about which posters are worth fetching. */
  var ROWS_FIT = 2;              // 335 + 301 fits in 862; a third would not
  var ROWS_VISIBLE = 3;          // the third peeks, so its posters still load
  /* The tall hero and the band differ by this much, and the rows carry the
     whole move on one transform rather than anything animating a height. The
     figure is the viewport less one row, so the first screen shows Continue
     watching whole and nothing of the row after it. */
  var BIG_DROP = 862 - ROW_H;

  var elRows = document.getElementById('rows');
  var rowEls = [];

  function translate(el, x, y) {
    var t = 'translate(' + x + 'px,' + y + 'px)';
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  function build() {
    var r, i, rowEl, label, strip, tile, inner, img, name, sub, prog;
    for (r = 0; r < ROW_POOL; r++) {
      rowEl = document.createElement('div');
      rowEl.className = 'row hidden';
      label = document.createElement('div');
      label.className = 'row-label';
      strip = document.createElement('div');
      strip.className = 'strip';
      rowEl.appendChild(label);
      rowEl.appendChild(strip);
      rowEl._label = label; rowEl._strip = strip; rowEl._row = -1;
      rowEl._rowRef = null; rowEl._tiles = [];

      for (i = 0; i < TILE_POOL; i++) {
        tile = document.createElement('div');
        /* Hidden until something is in it — otherwise the pool shows as a
           stack of empty cards for as long as the first rows take to arrive. */
        tile.className = 'tile hidden';
        inner = document.createElement('div');
        inner.className = 'tile-inner';
        img = document.createElement('img');
        img.alt = '';
        prog = document.createElement('div');
        prog.className = 'tile-progress';
        /* The title sits under the art rather than over it: landscape art is
           often the title card already, and text on top of it is unreadable. */
        name = document.createElement('div');
        name.className = 'tile-title';
        sub = document.createElement('div');
        sub.className = 'tile-sub';
        inner.appendChild(img);
        inner.appendChild(prog);
        tile.appendChild(inner);
        tile.appendChild(name);
        tile.appendChild(sub);
        tile._img = img; tile._name = name; tile._sub = sub; tile._prog = prog;
        tile._idx = -1; tile._filled = false; tile._item = null;
        strip.appendChild(tile);
        rowEl._tiles.push(tile);
      }
      elRows.appendChild(rowEl);
      rowEls.push(rowEl);
    }
    Art.onReady(repaint);
  }

  /* Backdrops arrive after the tile was drawn, so the one tile that was waiting
     for them is reassigned in place. A whole-rail render per image would be far
     more work than one picture is worth. */
  function repaint(tmdbId) {
    var r, i, t, url;
    for (r = 0; r < ROW_POOL; r++) {
      for (i = 0; i < TILE_POOL; i++) {
        t = rowEls[r]._tiles[i];
        if (!t._item || t._deferred || Plex.tmdbId(t._item) !== tmdbId) continue;
        url = Art.tile(t._item, TILE_W, TILE_H);
        if (url) t._img.src = url;
      }
    }
  }

  /* A tile showing a placeholder must re-render once its page lands. One that
     already shows a poster must not, or we reassign src for nothing. */
  function invalidateEmpty() {
    var r, i, t;
    for (r = 0; r < ROW_POOL; r++) {
      for (i = 0; i < TILE_POOL; i++) {
        t = rowEls[r]._tiles[i];
        if (!t._filled || t._deferred) t._idx = -1;
      }
    }
  }

  function drawRow(rowEl, rows, r, rowIdx, onScreen) {
    /* Position alone does not identify a row: search results replace the rows
       in place and keep rowIdx 0, so a pool element holding row 0 went on
       showing the library's row 0 — right title over the wrong tiles. */
    var row = rows[r], reused = rowEl._row !== r || rowEl._rowRef !== row;
    var i, idx, tile, item, url, firstVisible, start;

    rowEl.classList.remove('hidden');
    translate(rowEl, 0, r * ROW_H);
    rowEl.classList.toggle('on', r === rowIdx);

    if (reused) {
      rowEl._row = r;
      rowEl._rowRef = row;
      rowEl._label.textContent = row.title;
      for (i = 0; i < TILE_POOL; i++) { rowEl._tiles[i]._idx = -1; rowEl._tiles[i]._filled = false; }
    }
    /* A merged row's length is an estimate until it has been walked, so the
       count is re-read on every paint rather than only when the row is reused. */
    if (row.kind === 'merge') {
      rowEl._label.textContent = row.title + (row.total ? '  (' + row.total + ')' : '');
    }

    firstVisible = UI.clamp(row.focus - LEAD, 0, Math.max(0, row.total - TILES_VISIBLE));
    start = UI.clamp(firstVisible - 2, 0, Math.max(0, row.total - TILE_POOL));
    translate(rowEl._strip, -firstVisible * STRIDE, 0);

    for (i = 0; i < TILE_POOL; i++) {
      tile = rowEl._tiles[i];
      idx = start + i;
      if (idx >= row.total) { tile.classList.add('hidden'); tile._idx = -1; tile._item = null; continue; }
      tile.classList.remove('hidden');
      translate(tile, idx * STRIDE, 0);
      tile.classList.toggle('on', r === rowIdx && idx === row.focus);
      /* A tile whose poster was skipped has to be redrawn when its row comes
         into view, so the short circuit has to know about that. */
      if (tile._idx === idx && !(tile._deferred && onScreen)) continue;
      tile._idx = idx;
      item = Rows.itemAt(row, idx);
      tile._filled = !!item;
      tile._item = item;
      if (!item) {
        tile._name.textContent = '';
        tile._sub.textContent = '';
        tile._prog.style.width = '0';
        tile._img.removeAttribute('src');
        continue;
      }
      tile._name.textContent = Media.railTitle(item);
      tile._sub.textContent = Media.railSub(item);
      tile._prog.style.width = (item.viewOffset && item.duration)
        ? Math.round(100 * item.viewOffset / item.duration) + '%' : '0';
      /* Rows below the fold get their titles but not their posters. On a first
         run every poster is generated on demand by a server we do not own, so
         asking for two screens' worth before the first one has painted is the
         single most expensive thing this app does. They load when scrolled to. */
      if (!onScreen) {
        tile._deferred = true;
        tile._img.removeAttribute('src');
        continue;
      }
      tile._deferred = false;
      /* Art decides between TMDB and Plex; only a tile that is actually on
         screen is worth a lookup, which is why this sits below the guard. */
      Art.warm(item);
      url = Art.tile(item, TILE_W, TILE_H);
      if (url) tile._img.src = url; else tile._img.removeAttribute('src');
    }
  }

  function render(rows, rowIdx) {
    var firstVisible = UI.clamp(rowIdx - 1, 0, Math.max(0, rows.length - ROWS_FIT));
    var start = UI.clamp(firstVisible, 0, Math.max(0, rows.length - ROW_POOL));
    var i, r;
    /* Row 0 sits under the tall hero; everything below it sits under the band.
       Both states are one translate on this element, so the collapse animates
       for free on the transform that was moving anyway. */
    translate(elRows, 0, (rowIdx === 0 ? BIG_DROP : 0) - firstVisible * ROW_H);
    for (i = 0; i < ROW_POOL; i++) {
      r = start + i;
      if (r >= rows.length) { rowEls[i].classList.add('hidden'); rowEls[i]._row = -1; continue; }
      drawRow(rowEls[i], rows, r, rowIdx, r < firstVisible + ROWS_VISIBLE);
    }
  }

  return { build: build, render: render, invalidateEmpty: invalidateEmpty };
})();
