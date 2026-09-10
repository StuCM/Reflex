/* Draws rows from a fixed pool: 4 row elements, 12 tiles each, whatever the
   library size. Owns no state — everything it needs is on the row model. */
import { tmdbId } from '../api/plex/library';
import { clamp } from '../core/ui';
import * as art from '../data/art';
import { railSub, railTitle } from '../rules/labels';
import { itemAt } from '../rules/rows';

/** 2:3, so seven fit across at 1920: 96 margin + 7×209 + 6×44 = 1823. */
const TILE_W = 209;
const TILE_H = 314;
const GAP = 44;
const STRIDE = TILE_W + GAP;

/** 44 header + 314 art + 74 two lines + 34 below. */
const ROW_H = 466;

/** css #viewport, well below the 264px header. */
const VIEWPORT_H = 580;

const TILE_POOL = 12;
const ROW_POOL = 4;
const TILES_VISIBLE = 7;

/** Tiles kept to the left of the focused one. */
const LEAD = 1;

/* Two different questions, and answering both with one number clipped the last
   row of every section. ROWS_FIT is how many fit *whole*, and is what stops the
   window scrolling past the end. ROWS_VISIBLE is how many are on screen at all,
   including the one peeking, and is only about which posters are worth
   fetching. */
const ROWS_FIT = Math.floor(VIEWPORT_H / ROW_H);
const ROWS_VISIBLE = ROWS_FIT + 1;

/* The tall hero and the header differ by this much, and the rows carry the
   whole move on one transform rather than anything animating a height. */
const BIG_DROP = VIEWPORT_H - ROW_H;

/* Sweeping a row used to cost a poster and a TMDB lookup per tile passed, all
   for tiles already gone by. A tile's cheap parts still draw at once; its
   picture waits this long for the movement to stop. */
const SETTLE = 160;

const rowsElement = document.getElementById('rows');
if (!rowsElement) throw new Error('index.html has no #rows');
const container: HTMLElement = rowsElement;

const pool: RailRowElement[] = [];
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function translate(element: HTMLElement, across: number, down: number): void {
  element.style.setProperty('--tx', `${across}px`);
  element.style.setProperty('--ty', `${down}px`);
}

/* Moving within a row animates; being recycled to a different row must not. A
   pool element carries the last row's scroll position, so letting that
   transition means the row you just stepped onto slides in from wherever you
   had walked to on the one above. The offsetWidth read commits the jump before
   the transition comes back — without it the browser coalesces both changes and
   animates anyway. */
function place(element: HTMLElement, across: number, animate: boolean): void {
  if (animate) {
    translate(element, across, 0);
    return;
  }
  element.classList.add('no-anim');
  translate(element, across, 0);
  void element.offsetWidth;
  element.classList.remove('no-anim');
}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

export function build(): void {
  for (let slot = 0; slot < ROW_POOL; slot++) {
    const rowElement = div('row hidden') as RailRowElement;
    const label = div('row-label');
    const strip = div('strip');
    rowElement.append(label, strip);
    rowElement._label = label;
    rowElement._strip = strip;
    rowElement._row = -1;
    rowElement._rowRef = null;
    rowElement._tiles = [];
    rowElement._onScreen = false;

    for (let i = 0; i < TILE_POOL; i++) {
      /* Hidden until something is in it — otherwise the pool shows as a stack
         of empty cards for as long as the first rows take to arrive. */
      const tile = div('tile hidden') as RailTileElement;
      const inner = div('tile-inner');
      const image = document.createElement('img');
      image.alt = '';
      const progress = div('tile-progress');
      /* The title sits under the art rather than over it: a poster carries its
         own title already, and text on top of it is unreadable. */
      const name = div('tile-title');
      const sub = div('tile-sub');
      inner.append(image, progress);
      tile.append(inner, name, sub);
      tile._img = image;
      tile._name = name;
      tile._sub = sub;
      tile._prog = progress;
      tile._idx = -1;
      tile._filled = false;
      tile._item = null;
      tile._wait = false;
      tile._deferred = false;
      strip.append(tile);
      rowElement._tiles.push(tile);
    }
    container.append(rowElement);
    pool.push(rowElement);
  }
  art.onReady(repaint);
}

function repaint(id: string): void {
  pool.forEach((rowElement) => {
    rowElement._tiles.forEach((tile) => {
      if (!tile._item || tile._deferred || tile._wait || tmdbId(tile._item) !== id) return;
      const url = art.tile(tile._item, TILE_W, TILE_H);
      if (url) tile._img.src = url;
    });
  });
}

/* A tile showing a placeholder must re-render once its page lands. One that
   already shows a poster must not, or we reassign src for nothing. */
export function invalidateEmpty(): void {
  pool.forEach((rowElement) => {
    rowElement._tiles.forEach((tile) => {
      if (!tile._filled || tile._deferred) tile._idx = -1;
    });
  });
}

/* The expensive half of a tile: the lookup and the picture. Art decides between
   TMDB and Plex, so only a tile worth looking at is worth calling on. */
function paint(tile: RailTileElement): void {
  tile._wait = false;
  art.warm(tile._item);
  const url = art.tile(tile._item, TILE_W, TILE_H);
  if (url) tile._img.src = url;
  else tile._img.removeAttribute('src');
}

/* The rail has stopped moving, so the tiles still on it can have their
   pictures. Off-screen rows keep waiting — they have their own reason to. */
function settled(): void {
  pool.forEach((rowElement) => {
    if (!rowElement._onScreen) return;
    rowElement._tiles.forEach((tile) => {
      if (tile._wait && tile._item) paint(tile);
    });
  });
}

function drawRow(
  rowElement: RailRowElement,
  rows: Row[],
  at: number,
  rowIndex: number,
  onScreen: boolean,
): void {
  /* Position alone does not identify a row: search results replace the rows in
     place and keep rowIndex 0, so a pool element holding row 0 went on showing
     the library's row 0 — right title over the wrong tiles. */
  const row = rows[at];
  if (!row) return;
  const reused = rowElement._row !== at || rowElement._rowRef !== row;

  rowElement._onScreen = onScreen;
  rowElement.classList.remove('hidden');
  translate(rowElement, 0, at * ROW_H);
  rowElement.classList.toggle('on', at === rowIndex);

  if (reused) {
    rowElement._row = at;
    rowElement._rowRef = row;
    rowElement._label.textContent = row.title;
    rowElement._tiles.forEach((tile) => {
      tile._idx = -1;
      tile._filled = false;
    });
  }
  /* A merged row's length is an estimate until it has been walked, so the count
     is re-read on every paint rather than only when the row is reused. */
  if (row.kind === 'merge') {
    rowElement._label.textContent = row.title + (row.total ? `  (${row.total})` : '');
  }

  const firstVisible = clamp(row.focus - LEAD, 0, Math.max(0, row.total - TILES_VISIBLE));
  const start = clamp(firstVisible - 2, 0, Math.max(0, row.total - TILE_POOL));
  place(rowElement._strip, -firstVisible * STRIDE, !reused);

  rowElement._tiles.forEach((tile, offset) => {
    const index = start + offset;
    if (index >= row.total) {
      tile.classList.add('hidden');
      tile._idx = -1;
      tile._item = null;
      return;
    }
    tile.classList.remove('hidden');
    translate(tile, index * STRIDE, 0);
    const focused = at === rowIndex && index === row.focus;
    tile.classList.toggle('on', focused);

    /* A tile whose poster was skipped has to be redrawn when its row comes into
       view, so the short circuit has to know about that. */
    if (tile._idx === index && !(tile._deferred && onScreen)) {
      /* Nothing else changed, but the focus can arrive on a tile still waiting
         for its picture, and that one never waits. */
      if (focused && tile._wait) paint(tile);
      return;
    }
    tile._idx = index;
    const item = itemAt(row, index);
    /* A slot in the pool is not an identity. Sweeping hands this element the
       item its neighbour was showing, and keeping the picture then draws one
       film's poster over another film's title until the settle catches up. */
    const held = !!item && item === tile._item;
    tile._filled = !!item;
    tile._item = item;

    if (!item) {
      tile._name.textContent = '';
      tile._sub.textContent = '';
      tile._prog.style.setProperty('--progress', '0');
      tile._img.removeAttribute('src');
      return;
    }

    tile._name.textContent = railTitle(item);
    tile._sub.textContent = railSub(item);
    tile._prog.style.setProperty(
      '--progress',
      item.viewOffset && item.duration
        ? `${Math.round((100 * item.viewOffset) / item.duration)}%`
        : '0',
    );

    /* Rows below the fold get their titles but not their posters. On a first
       run every poster is generated on demand by a server we do not own, so
       asking for two screens' worth before the first has painted is the single
       most expensive thing this app does. */
    if (!onScreen) {
      tile._deferred = true;
      tile._wait = false;
      tile._img.removeAttribute('src');
      return;
    }
    tile._deferred = false;
    /* The focused tile is the one being looked at and the one the hero is about
       to draw, so it pays immediately. The rest wait for the movement to
       settle: one still holding the same item keeps its picture, and one handed
       a different film shows the surface colour rather than the film it was. */
    tile._wait = !focused;
    if (focused) paint(tile);
    else if (!held) tile._img.removeAttribute('src');
  });
}

export function render(rows: Row[], rowIndex: number): void {
  /* Rows of context kept above the focused one — every row that fits bar the
     focused one itself. A portrait row leaves room for exactly one, so this is
     zero and the focused row sits at the top. */
  const firstVisible = clamp(rowIndex - (ROWS_FIT - 1), 0, Math.max(0, rows.length - ROWS_FIT));
  const start = clamp(firstVisible, 0, Math.max(0, rows.length - ROW_POOL));
  /* Row 0 sits under the tall hero; everything below sits under the band. Both
     states are one translate on this element, so the collapse animates for free
     on the transform that was moving anyway. */
  translate(container, 0, (rowIndex === 0 ? BIG_DROP : 0) - firstVisible * ROW_H);

  pool.forEach((rowElement, offset) => {
    const at = start + offset;
    if (at >= rows.length) {
      rowElement.classList.add('hidden');
      rowElement._row = -1;
      rowElement._onScreen = false;
      return;
    }
    drawRow(rowElement, rows, at, rowIndex, at < firstVisible + ROWS_VISIBLE);
  });

  /* One timer for the whole rail, restarted by every render: a sweep resets it
     on each key and the pictures arrive once, when it stops. */
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(settled, SETTLE);
}
