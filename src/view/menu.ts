/* The menu shell the film page and the player both draw with: tabs, rows, the
   winding transform, and an overlay that swallows every key.
   It knows nothing about playback or copies — a row carries a `value` and the
   caller decides what that means. */
import { clamp, isBack } from '../core/ui';
import { clone, fill, pick, put, span, svg } from './dom';

/** .menu-row, in CSS pixels. */
/** .menu-row and .menu-list in css/base.css, per 7b. */
const ROW_H = 94;
const ROWS_SHOWN = 4;

/** phosphor check — the chosen row's mark, per 7b. */
const CHECK =
  '<svg viewBox="0 0 256 256" fill="currentColor" width="28" height="28">' +
  '<path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>';

export interface MenuRow {
  label: string;
  note?: string;
  on?: boolean;
  off?: boolean;
  value?: unknown;
  /** Inline SVG for this row alone, where the tab's one icon will not do. */
  icon?: string;
}

/** A kicker over a title, in place of the tab strip: what the menu is *of*,
    when a menu of one tab has no name worth showing. */
export interface MenuHead {
  kicker: string;
  title: string;
}

export interface MenuTab {
  label: string;
  note?: string;
  /** Inline SVG, drawn beside every row. The caller supplies it: this file
      draws a menu and has no opinion about what the menu is of. */
  icon?: string;
  rows(): MenuRow[];
}

let host: HTMLElement | null = null;
let tabs: MenuTab[] = [];
let tab = 0;
let selected = 0;
let built: MenuRow[] = [];
let onChoose: ((value: unknown, row: MenuRow) => void) | null = null;
let onClose: (() => void) | null = null;
let head: MenuHead | null = null;
let headElement: HTMLElement | null = null;
let tabsElement: HTMLElement | null = null;
let innerElement: HTMLElement | null = null;
let noteElement: HTMLElement | null = null;

/* A tab's rows are asked for when the tab is shown, not when the menu opens:
   what is on offer depends on where playback has got to, and a list built four
   tabs ago is stale by the time you reach it. */
function build(): void {
  const list = tabs[tab]?.rows() ?? [];
  built = list.length ? list : [{ label: 'Nothing to choose here', off: true }];
}

/* Land on what is already in use, so OK on the first press is a no-op rather
   than a surprise. */
function land(): void {
  const at = built.findIndex((row) => row.on);
  selected = at < 0 ? 0 : at;
}

function paint(): void {
  if (!headElement || !tabsElement || !innerElement || !noteElement) return;

  if (head)
    fill(headElement, span('menu-kicker', head.kicker), span('menu-head-title', head.title));
  else fill(headElement);

  fill(
    tabsElement,
    ...tabs.map((entry, at) => span(`menu-tab${at === tab ? ' on' : ''}`, entry.label)),
  );

  fill(
    innerElement,
    ...built.map((row, at) => {
      const line = clone('tpl-menu-row');
      line.className =
        `menu-row${at === selected ? ' sel' : ''}` +
        (row.on ? ' on' : '') +
        (row.off ? ' off' : '');
      const icon = row.icon ?? tabs[tab]?.icon;
      if (icon) put(pick(line, 'menu-icon'), svg(icon));
      pick(line, 'menu-label').textContent = row.label;
      pick(line, 'menu-row-note').textContent = row.note ?? '';
      if (row.on) put(pick(line, 'menu-check'), svg(CHECK));
      return line;
    }),
  );

  /* Keep the selection in view without a scrollbar the remote cannot use. */
  const top = clamp(selected - 1, 0, Math.max(0, built.length - ROWS_SHOWN));
  innerElement.style.setProperty('--wind', `${-top * ROW_H}px`);
  noteElement.textContent = tabs[tab]?.note ?? '';
}

function shell(): HTMLElement[] {
  const headRow = document.createElement('div');
  headRow.className = 'menu-head';
  const tabsRow = document.createElement('div');
  tabsRow.className = 'menu-tabs';
  const list = document.createElement('div');
  list.className = 'menu-list';
  const inner = document.createElement('div');
  inner.className = 'menu-inner';
  put(list, inner);
  const note = document.createElement('div');
  note.className = 'menu-note';
  return [headRow, tabsRow, list, note];
}

/* Draw tabs into `host` and take the d-pad until a row is chosen or BACK closes
   it. Each tab's rows() returns what to draw; `value` is whatever onChoose acts
   on. */
export function open(options: {
  host: HTMLElement;
  tabs?: MenuTab[];
  tab?: number;
  head?: MenuHead;
  onChoose?: (value: unknown, row: MenuRow) => void;
  onClose?: () => void;
}): void {
  host = options.host;
  tabs = options.tabs ?? [];
  tab = options.tab ?? 0;
  head = options.head ?? null;
  onChoose = options.onChoose ?? null;
  onClose = options.onClose ?? null;

  /* Built once per host and then kept: the winding transition lives on
     .menu-inner, and an element replaced on every paint never runs one. */
  if (!host.firstChild) fill(host, ...shell());

  headElement = host.querySelector('.menu-head');
  tabsElement = host.querySelector('.menu-tabs');
  innerElement = host.querySelector('.menu-inner');
  noteElement = host.querySelector('.menu-note');
  build();
  land();
  host.classList.remove('hidden');
  paint();
}

export function close(): void {
  if (!host) return;
  const done = onClose;
  host.classList.add('hidden');
  host = null;
  tabs = [];
  head = null;
  onChoose = null;
  onClose = null;
  done?.();
}

export function isOpen(): boolean {
  return !!host;
}

/* Closed before the choice is acted on, so a screen that reopens the menu or
   tears itself down in response is not fighting an overlay still up. */
function choose(): void {
  const row = built[selected];
  const act = onChoose;
  close();
  if (row && !row.off && act) act(row.value, row);
}

export function key(code: number): boolean {
  if (code === 38) {
    selected = (selected + built.length - 1) % built.length;
    paint();
    return true;
  }
  if (code === 40) {
    selected = (selected + 1) % built.length;
    paint();
    return true;
  }
  if (code === 37 || code === 39) {
    /* With more than one tab the sideways axis switches them. With one it has
       nothing to do, so it closes — 6e asks for a menu any direction key
       dismisses, and ▲▼ are spoken for by the rows. */
    if (tabs.length < 2) {
      close();
      return true;
    }
    tab = (tab + (code === 39 ? 1 : tabs.length - 1)) % tabs.length;
    build();
    land();
    paint();
    return true;
  }
  if (code === 13 || code === 415 || code === 19) {
    choose();
    return true;
  }
  if (isBack(code) || code === 413) {
    close();
    return true;
  }
  return true; // the menu swallows everything else
}
