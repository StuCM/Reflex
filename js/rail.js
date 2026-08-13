/* The rail: stacked rows of poster tiles, drawn from a fixed pool of elements.

   Nothing here grows with the library. Four row elements and twelve tiles each
   exist for the life of the app; scrolling moves transforms and reassigns
   contents. On a 2018 SoC that is the difference between a rail that keeps up
   with the remote and one that does not.

   Rail draws whatever it is handed and owns no state beyond the pool — see
   js/browse.js for what is in the rows. */
var Rail = (function () {
  'use strict';

  var TILE_W = 160, TILE_H = 240, GAP = 24, STRIDE = TILE_W + GAP;
  var ROW_H = 304;
  var TILE_POOL = 12;            // tiles per row element
  var ROW_POOL = 4;              // row elements in the DOM, ever
  var TILES_VISIBLE = 10;        // tiles across at 1920 wide
  var ROWS_VISIBLE = 2;

  var elRows = document.getElementById('rows');
  var rowEls = [];

  function translate(el, x, y) {
    var t = 'translate(' + x + 'px,' + y + 'px)';
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  function build() {
    var r, i, rowEl, label, strip, tile, inner, img, fb, prog;
    for (r = 0; r < ROW_POOL; r++) {
      rowEl = document.createElement('div');
      rowEl.className = 'row hidden';
      label = document.createElement('div');
      label.className = 'row-label';
      strip = document.createElement('div');
      strip.className = 'strip';
      rowEl.appendChild(label);
      rowEl.appendChild(strip);
      rowEl._label = label; rowEl._strip = strip; rowEl._row = -1; rowEl._tiles = [];

      for (i = 0; i < TILE_POOL; i++) {
        tile = document.createElement('div');
        /* Hidden until something is in it — otherwise the pool shows as a
           stack of empty cards for as long as the first rows take to arrive. */
        tile.className = 'tile hidden';
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

  /* A tile showing a placeholder must re-render once its page lands. One that
     already shows a poster must not, or we reassign src for nothing. */
  function invalidateEmpty() {
    var r, i, t;
    for (r = 0; r < ROW_POOL; r++) {
      for (i = 0; i < TILE_POOL; i++) {
        t = rowEls[r]._tiles[i];
        if (!t._filled) t._idx = -1;
      }
    }
  }

  function drawRow(rowEl, rows, r, rowIdx) {
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

    firstVisible = UI.clamp(row.focus - 3, 0, Math.max(0, row.total - TILES_VISIBLE));
    start = UI.clamp(firstVisible - 2, 0, Math.max(0, row.total - TILE_POOL));
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
      item = Rows.itemAt(row, idx);
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
      url = Plex.posterUrl(item, TILE_W, TILE_H);
      if (url) tile._img.src = url; else tile._img.removeAttribute('src');
    }
  }

  function render(rows, rowIdx) {
    var firstVisible = UI.clamp(rowIdx - 1, 0, Math.max(0, rows.length - ROWS_VISIBLE));
    var start = UI.clamp(firstVisible, 0, Math.max(0, rows.length - ROW_POOL));
    var i, r;
    translate(elRows, 0, -firstVisible * ROW_H);
    for (i = 0; i < ROW_POOL; i++) {
      r = start + i;
      if (r >= rows.length) { rowEls[i].classList.add('hidden'); rowEls[i]._row = -1; continue; }
      drawRow(rowEls[i], rows, r, rowIdx);
    }
  }

  return { build: build, render: render, invalidateEmpty: invalidateEmpty };
})();
