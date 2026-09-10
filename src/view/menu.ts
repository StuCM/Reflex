/* The menu shell the film page and the player both draw with: tabs, rows, the
   winding transform, and an overlay that swallows every key.
   It knows nothing about playback or copies — a row carries a `value` and the
   caller decides what that means. */
import { clamp, isBack } from '../core/ui';
import { span, fill, put } from './dom';

/** .menu-row, in CSS pixels. */
const ROW_H = 56;
const ROWS_SHOWN = 7;

export interface MenuRow {
  label: string;
  note?: string;
  on?: boolean;
  off?: boolean;
  value?: unknown;
}

export interface MenuTab {
  label: string;
  note?: string;
  rows(): MenuRow[];
}

let host: HTMLElement | null = null;
let tabs: MenuTab[] = [];
let tab = 0;
let selected = 0;
let built: MenuRow[] = [];
let onChoose: ((value: unknown, row: MenuRow) => void) | null = null;
let onClose: (() => void) | null = null;
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
  if (!tabsElement || !innerElement || !noteElement) return;

  fill(
    tabsElement,
    ...tabs.map((entry, at) => span(`menu-tab${at === tab ? ' on' : ''}`, entry.label)),
  );

  fill(
    innerElement,
    ...built.map((row, at) => {
      const line = document.createElement('div');
      line.className =
        `menu-row${at === selected ? ' sel' : ''}` +
        (row.on ? ' on' : '') +
        (row.off ? ' off' : '');
      put(line, span('menu-mark', row.on ? '●' : ''), span('menu-label', row.label));
      if (row.note) put(line, span('menu-note-inline', row.note));
      return line;
    }),
  );

  /* Keep the selection in view without a scrollbar the remote cannot use. */
  const top = clamp(selected - 3, 0, Math.max(0, built.length - ROWS_SHOWN));
  innerElement.style.setProperty('--wind', `${-top * ROW_H}px`);
  noteElement.textContent = tabs[tab]?.note ?? '';
}

function shell(): HTMLElement[] {
  const tabsRow = document.createElement('div');
  tabsRow.className = 'menu-tabs';
  const list = document.createElement('div');
  list.className = 'menu-list';
  const inner = document.createElement('div');
  inner.className = 'menu-inner';
  put(list, inner);
  const note = document.createElement('div');
  note.className = 'menu-note';
  return [tabsRow, list, note];
}

/* Draw tabs into `host` and take the d-pad until a row is chosen or BACK closes
   it. Each tab's rows() returns what to draw; `value` is whatever onChoose acts
   on. */
export function open(options: {
  host: HTMLElement;
  tabs?: MenuTab[];
  tab?: number;
  onChoose?: (value: unknown, row: MenuRow) => void;
  onClose?: () => void;
}): void {
  host = options.host;
  tabs = options.tabs ?? [];
  tab = options.tab ?? 0;
  onChoose = options.onChoose ?? null;
  onClose = options.onClose ?? null;

  /* Built once per host and then kept: the winding transition lives on
     .menu-inner, and an element replaced on every paint never runs one. */
  if (!host.firstChild) fill(host, ...shell());

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
  if ((code === 37 || code === 39) && tabs.length > 1) {
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
