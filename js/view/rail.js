/* The rail: stacked rows of portrait posters, drawn from a fixed pool of elements.

   Nothing here grows with the library. Four row elements and twelve tiles each
   exist for the life of the app; scrolling moves transforms and reassigns
   contents. On a 2018 SoC that is the difference between a rail that keeps up
   with the remote and one that does not.

   Rail draws whatever it is handed and owns no state beyond the pool — see
   js/browse.js for what is in the rows. */
var Rail = (function () {
  'use strict';

  /* 2:3, so seven fit across at 1920: 96 left margin + 7×209 + 6×44 = 1823. */
  const TILE_W = 209;
  const TILE_H = 314;
  const GAP = 44;
  const STRIDE = TILE_W + GAP;
  const ROW_H = 466;               // 44 header + 314 art + 74 two lines + 34 below
  const VIEWPORT_H = 580;          // css #viewport, well below the 264px header
  const TILE_POOL = 12;            // tiles per row element
  const ROW_POOL = 4;              // row elements in the DOM, ever
  const TILES_VISIBLE = 7;         // tiles across at 1920 wide
  const LEAD = 1;                  // tiles kept to the left of the focused one
  /* Two different questions, and answering both with one number clipped the
     last row of every section. ROWS_FIT is how many rows fit *whole* in the
     viewport, and is what stops the window scrolling past the end — get it
     wrong and the final row is pinned half below the fold, title and all.
     ROWS_VISIBLE is how many are on screen at all, including the one peeking
     at the bottom, and is only about which posters are worth fetching. */
  const ROWS_FIT = Math.floor(VIEWPORT_H / ROW_H);
  const ROWS_VISIBLE = ROWS_FIT + 1;   // the last one peeks, so its posters load
  /* The tall hero and the header differ by this much, and the rows carry the
     whole move on one transform rather than anything animating a height. The
     figure is the viewport less one row, so the first screen shows Continue
     watching whole and nothing of the row after it. */
  const BIG_DROP = VIEWPORT_H - ROW_H;
  /* Sweeping a row used to cost a poster and a TMDB lookup per tile passed, all
     of them for tiles already gone by. A tile's cheap parts still draw at once;
     its picture waits this long for the movement to stop. */
  const SETTLE = 160;

  const elRows = document.getElementById('rows');
  const rowEls = [];
  let settleTimer = null;

  function translate(el, x, y) {
    const t = `translate(${x}px,${y}px)`;
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  /* Moving within a row animates; being recycled to a different row must not.
     A pool element carries the last row's scroll position, so letting that
     transition means the row you just stepped onto slides in from wherever you
     had walked to on the one above. Same reason .tile itself never transitions.
     The offsetWidth read commits the jump before the transition comes back —
     without it the browser coalesces both changes and animates anyway. */
  function place(el, x, animate) {
    if (animate) { translate(el, x, 0); return; }
    el.style.transition = 'none';
    el.style.webkitTransition = 'none';
    translate(el, x, 0);
    void el.offsetWidth;
    el.style.transition = '';
    el.style.webkitTransition = '';
  }

  function build() {
    let label;
    let strip;
    let inner;
    let img;
    let name;
    let sub;
    let prog;
    for (let r = 0; r < ROW_POOL; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'row hidden';
      label = document.createElement('div');
      label.className = 'row-label';
      strip = document.createElement('div');
      strip.className = 'strip';
      rowEl.appendChild(label);
      rowEl.appendChild(strip);
      rowEl._label = label; rowEl._strip = strip; rowEl._row = -1;
      rowEl._rowRef = null; rowEl._tiles = []; rowEl._onScreen = false;

      for (let i = 0; i < TILE_POOL; i++) {
        const tile = document.createElement('div');
        /* Hidden until something is in it — otherwise the pool shows as a
           stack of empty cards for as long as the first rows take to arrive. */
        tile.className = 'tile hidden';
        inner = document.createElement('div');
        inner.className = 'tile-inner';
        img = document.createElement('img');
        img.alt = '';
        prog = document.createElement('div');
        prog.className = 'tile-progress';
        /* The title sits under the art rather than over it: a poster carries
           its own title already, and text on top of it is unreadable. */
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
        tile._idx = -1; tile._filled = false; tile._item = null; tile._wait = false;
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
    let url;
    for (let r = 0; r < ROW_POOL; r++) {
      for (let i = 0; i < TILE_POOL; i++) {
        const t = rowEls[r]._tiles[i];
        if (!t._item || t._deferred || t._wait || Plex.tmdbId(t._item) !== tmdbId) continue;
        url = Art.tile(t._item, TILE_W, TILE_H);
        if (url) t._img.src = url;
      }
    }
  }

  /* A tile showing a placeholder must re-render once its page lands. One that
     already shows a poster must not, or we reassign src for nothing. */
  function invalidateEmpty() {
    for (let r = 0; r < ROW_POOL; r++) {
      for (let i = 0; i < TILE_POOL; i++) {
        const t = rowEls[r]._tiles[i];
        if (!t._filled || t._deferred) t._idx = -1;
      }
    }
  }

  /* The expensive half of a tile: the lookup and the picture. Art decides
     between TMDB and Plex, so only a tile worth looking at is worth calling on. */
  function paint(tile) {
    tile._wait = false;
    Art.warm(tile._item);
    const url = Art.tile(tile._item, TILE_W, TILE_H);
    if (url) tile._img.src = url; else tile._img.removeAttribute('src');
  }

  /* The rail has stopped moving, so the tiles still on it can have their
     pictures. Off-screen rows keep waiting — they have their own reason to. */
  function settled() {
    for (let r = 0; r < ROW_POOL; r++) {
      if (!rowEls[r]._onScreen) continue;
      for (let i = 0; i < TILE_POOL; i++) {
        const t = rowEls[r]._tiles[i];
        if (t._wait && t._item) paint(t);
      }
    }
  }

  function drawRow(rowEl, rows, r, rowIdx, onScreen) {
    /* Position alone does not identify a row: search results replace the rows
       in place and keep rowIdx 0, so a pool element holding row 0 went on
       showing the library's row 0 — right title over the wrong tiles. */
    const row = rows[r];
    const reused = rowEl._row !== r || rowEl._rowRef !== row;
    let i;
    let idx;
    let item;
    let held;
    let focused;
    let firstVisible;
    let start;

    rowEl._onScreen = onScreen;
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
      rowEl._label.textContent = row.title + (row.total ? `  (${row.total})` : '');
    }

    firstVisible = UI.clamp(row.focus - LEAD, 0, Math.max(0, row.total - TILES_VISIBLE));
    start = UI.clamp(firstVisible - 2, 0, Math.max(0, row.total - TILE_POOL));
    place(rowEl._strip, -firstVisible * STRIDE, !reused);

    for (i = 0; i < TILE_POOL; i++) {
      const tile = rowEl._tiles[i];
      idx = start + i;
      if (idx >= row.total) { tile.classList.add('hidden'); tile._idx = -1; tile._item = null; continue; }
      tile.classList.remove('hidden');
      translate(tile, idx * STRIDE, 0);
      focused = r === rowIdx && idx === row.focus;
      tile.classList.toggle('on', focused);
      /* A tile whose poster was skipped has to be redrawn when its row comes
         into view, so the short circuit has to know about that. */
      if (tile._idx === idx && !(tile._deferred && onScreen)) {
        /* Nothing else changed, but the focus can arrive on a tile still
           waiting for its picture, and that one never waits. */
        if (focused && tile._wait) paint(tile);
        continue;
      }
      tile._idx = idx;
      item = Rows.itemAt(row, idx);
      /* A slot in the pool is not an identity. Sweeping hands this element the
         item its neighbour was showing, and keeping the picture then draws one
         film's poster over another film's title until the settle catches up. */
      held = !!item && item === tile._item;
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
        tile._wait = false;
        tile._img.removeAttribute('src');
        continue;
      }
      tile._deferred = false;
      /* The focused tile is the one being looked at and the one the hero is
         about to draw, so it pays immediately. The rest wait for the movement
         to settle: one still holding the same item keeps its picture, and one
         that has been handed a different film shows the surface colour rather
         than the film it used to be. */
      tile._wait = !focused;
      if (focused) paint(tile);
      else if (!held) tile._img.removeAttribute('src');
    }
  }

  function render(rows, rowIdx) {
    /* Rows of context kept above the focused one — every row that fits bar the
       focused one itself. A portrait row leaves room for exactly one, so this
       is zero now and the focused row sits at the top; typed as 1 it would draw
       the row you just moved to half below the fold. */
    const firstVisible = UI.clamp(rowIdx - (ROWS_FIT - 1), 0, Math.max(0, rows.length - ROWS_FIT));
    const start = UI.clamp(firstVisible, 0, Math.max(0, rows.length - ROW_POOL));
    /* Row 0 sits under the tall hero; everything below it sits under the band.
       Both states are one translate on this element, so the collapse animates
       for free on the transform that was moving anyway. */
    translate(elRows, 0, (rowIdx === 0 ? BIG_DROP : 0) - firstVisible * ROW_H);
    for (let i = 0; i < ROW_POOL; i++) {
      const r = start + i;
      if (r >= rows.length) {
        rowEls[i].classList.add('hidden');
        rowEls[i]._row = -1;
        rowEls[i]._onScreen = false;
        continue;
      }
      drawRow(rowEls[i], rows, r, rowIdx, r < firstVisible + ROWS_VISIBLE);
    }
    /* One timer for the whole rail, restarted by every render: a sweep resets
       it on each key and the pictures arrive once, when it stops. */
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settled, SETTLE);
  }

  return { build: build, render: render, invalidateEmpty: invalidateEmpty };
})();
