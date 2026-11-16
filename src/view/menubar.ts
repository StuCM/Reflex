/* The v2 top menu: a row of glass tiles that pushes the page down. */
import { KEY, setPage } from '../core/ui';
import { fill } from './dom';

export const PAGES = ['Home', 'Movies', 'TV', 'Collections', 'Discover', 'Kids', 'More'];

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}

const bar = must('menubar');
const browseView = must('browse');
let focus = 0;
let showing = false;

function paint(): void {
  fill(
    bar,
    ...PAGES.map((title, index) => {
      const tile = document.createElement('div');
      tile.className = `mb-tile${index === focus ? ' on' : ''}`;
      tile.textContent = title;
      return tile;
    }),
  );
}

export function open(page: number): void {
  focus = page;
  showing = true;
  browseView.classList.add('menu');
  paint();
}

export function close(): void {
  showing = false;
  browseView.classList.remove('menu');
}

export function isOpen(): boolean {
  return showing;
}

export const MORE = PAGES.length - 1;

/** The page the focus is on. */
export function focused(): number {
  return focus;
}

/** Sweeping past pages loads nothing; only the one the focus rests on does. */
const SETTLE_MS = 300;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function cancelSettle(): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
}

/** Loads the focused page now if it is still waiting to settle. */
export function flush(load: (page: number) => void): void {
  if (!settleTimer) return;
  cancelSettle();
  load(focus);
}

/** Left and right move the focus, wrapping, and load the page once it settles; true if the key was one of them. */
export function key(code: number, load: (page: number) => void): boolean {
  if (code !== KEY.LEFT && code !== KEY.RIGHT) return false;
  focus = (focus + (code === KEY.RIGHT ? 1 : PAGES.length - 1)) % PAGES.length;
  paint();
  cancelSettle();
  if (focus === MORE) return true;
  setPage(focus);
  const landed = focus;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    load(landed);
  }, SETTLE_MS);
  return true;
}

/** Drops a pending page load, for when something else has chosen the page. */
export function abandon(): void {
  cancelSettle();
}
