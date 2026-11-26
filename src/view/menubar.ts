/* The v2 top menu: the tab bar at rest, and the glass tiles Up opens. */
import { KEY } from '../core/ui';
import { div, fill, must, put, svg } from './dom';
import * as glyphs from './glyphs';

const TILES = [
  { id: 'home', label: 'Home', icon: glyphs.home },
  { id: 'movies', label: 'Movies', icon: glyphs.movies },
  { id: 'tv', label: 'TV', icon: glyphs.television },
  { id: 'collections', label: 'Collections', icon: glyphs.collections },
  { id: 'discover', label: 'Discover', icon: glyphs.discover },
  { id: 'streaming', label: 'Streaming', icon: glyphs.streaming },
  { id: 'kids', label: 'Kids', icon: glyphs.kids },
  { id: 'search', label: 'Search', icon: glyphs.search },
  { id: 'settings', label: 'Settings', icon: glyphs.settings },
  { id: 'servers', label: 'Servers', icon: glyphs.servers },
];

/* The board's tile row, in px: it starts at the edge, and past the right edge it winds. */
const EDGE = 96;
const REST = 160;
const FOCUSED = 220;
const GAP = 28;

const strip = must('mb-strip');
const tabList = must('tab-list');
const hint = must('menu-hint-title');
const browseView = must('browse');
const ground = must('bg');
let focus = 0;
let showing = false;
let tabsAt = '';

function label(id: string): string {
  const tile = TILES.find((each) => each.id === id);
  return tile ? tile.label : id;
}

/** Draws the tab bar over `pages`, underlining `current`; a repeat of the last call draws nothing. */
export function tabs(pages: readonly string[], current: string): void {
  const drawn = `${pages.join()}/${current}`;
  if (drawn === tabsAt) return;
  tabsAt = drawn;
  fill(tabList, ...pages.map((id) => div(id === current ? 'tab on' : 'tab', label(id))));
}

const tileElements = TILES.map((tile) => {
  const element = div('mb-tile');
  put(element, svg(tile.icon), div('mb-label', tile.label));
  return element;
});
fill(strip, ...tileElements);

function paint(): void {
  tileElements.forEach((element, index) => element.classList.toggle('on', index === focus));
  const right = EDGE + focus * (REST + GAP) + FOCUSED;
  strip.style.setProperty('--mb-x', `${-Math.max(0, right - (1920 - EDGE))}px`);
}

/** Opens on the tile `id`, over the row titled `rowTitle`. */
export function open(id: string, rowTitle: string): void {
  focus = Math.max(
    0,
    TILES.findIndex((tile) => tile.id === id),
  );
  hint.textContent = rowTitle;
  showing = true;
  browseView.classList.add('menu');
  ground.classList.add('menu');
  paint();
}

export function close(): void {
  showing = false;
  browseView.classList.remove('menu');
  ground.classList.remove('menu');
}

export function isOpen(): boolean {
  return showing;
}

/** The id of the tile the focus is on. */
export function focused(): string {
  return TILES[focus]!.id;
}

/** Each arrow offers the tile to `load` unsettled, so a page seen before can show at once; the one the focus rests on is offered settled. */
const SETTLE_MS = 150;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function cancelSettle(): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
}

/** Loads the focused tile now if it is still waiting to settle. */
export function flush(load: (id: string, settled: boolean) => void): void {
  if (!settleTimer) return;
  cancelSettle();
  load(focused(), true);
}

/** Left and right move the focus, wrapping, and load the tile once it settles; true if the key was one of them. */
export function key(code: number, load: (id: string, settled: boolean) => void): boolean {
  if (code !== KEY.LEFT && code !== KEY.RIGHT) return false;
  focus = (focus + (code === KEY.RIGHT ? 1 : TILES.length - 1)) % TILES.length;
  paint();
  cancelSettle();
  const landed = focused();
  load(landed, false);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    load(landed, true);
  }, SETTLE_MS);
  return true;
}

/** Drops a pending page load, for when something else has chosen the page. */
export function abandon(): void {
  cancelSettle();
}
