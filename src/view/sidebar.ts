/* The section and category list, and select mode.
   There is no pointer on this set, so overflow:auto would put the entries past
   the fold behind a scrollbar nothing can reach — the list is wound instead,
   the way the rail moves a strip. */
import * as servers from '../data/servers';
import { KEY, clamp, isBack } from '../core/ui';

/** The panel less its top padding and a little breathing room. */
const VIEW_H = 968;

/** Nothing expanded; sections are 0-up and Continue watching is -1. */
const NONE = -2;

interface SidebarRow {
  label: string;
  kind: string;
  index?: number;
  row?: number;
  type?: string | null;
  sub?: boolean;
  opens?: boolean;
  current?: boolean;
}

interface Section {
  title: string;
  categories?: string[];
  current?: boolean;
}

interface WatchingState {
  current?: boolean;
  type?: string | null;
  has?: boolean;
}

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}

const listElement = must('sidebar-list');

let offset = 0;
let sections: Section[] = [];
let watching: WatchingState | null = null;
let rows: SidebarRow[] = [];
let selected = 0;
let showing = false;
let expanded = NONE;
let onPick: ((row: SidebarRow) => void) | null = null;
let atMode = '';

/* Kids, discovery and search are modes rather than sections; the last four are
   the settings the chip row used to carry. */
function modes(): SidebarRow[] {
  const out: SidebarRow[] = [
    { label: 'Discovery', kind: 'discover', current: atMode === 'discover' },
    { label: 'Kids', kind: 'kids', current: atMode === 'kids' },
    { label: 'Search', kind: 'search' },
  ];
  if (servers.count() > 1) {
    const preferred = servers.get(servers.preferred() ?? undefined);
    out.push({ label: `Prefer ${preferred ? preferred.name : '?'}`, kind: 'prefer' });
  }
  /* An action on Continue watching rather than a mode, but this remote has no
     colour buttons, so this is the route. Absent when the row is empty. */
  if (watching?.has) out.push({ label: 'Clear from Continue watching', kind: 'clear' });
  out.push(
    { label: 'Devices', kind: 'devices' },
    { label: 'Panel', kind: 'panel' },
    { label: `Autoplay next: ${Player.autoplayLabel()}`, kind: 'autoplay' },
    { label: `Theme music: ${ShowPage.themeLabel()}`, kind: 'theme' },
  );
  return out;
}

/* Continue watching answers "what was I in the middle of" across films and
   shows at once, so it heads the list rather than hanging under a section. */
function watchingRows(): SidebarRow[] {
  if (!watching) return [];
  const type = watching.type ?? null;
  const out: SidebarRow[] = [
    {
      label: 'Continue watching',
      kind: 'watching',
      index: -1,
      type: null,
      opens: true,
      current: !!watching.current && type === null,
    },
  ];
  if (expanded !== -1) return out;
  out.push(
    {
      label: 'Movies',
      kind: 'watching',
      index: -1,
      type: 'movie',
      sub: true,
      current: !!watching.current && type === 'movie',
    },
    {
      label: 'TV Shows',
      kind: 'watching',
      index: -1,
      type: 'episode',
      sub: true,
      current: !!watching.current && type === 'episode',
    },
  );
  return out;
}

function build(): SidebarRow[] {
  const out = watchingRows();
  sections.forEach((section, position) => {
    const categories = section.categories ?? [];
    out.push({
      label: section.title,
      kind: 'section',
      index: position,
      opens: categories.length > 0,
      current: !!section.current,
    });
    if (position !== expanded) return;
    categories.forEach((category, row) => {
      /* Continue watching has its own entry above, and every section builds
         one — listing them all is the duplication this is rid of. */
      if (category === 'Continue watching') return;
      out.push({ label: category, kind: 'row', index: position, row, sub: true });
    });
  });
  return out.concat(modes());
}

/* Keep the focused row in view by winding the list. Rows are two different
   heights, so the offsets are read off the DOM rather than arithmetic that
   would have to know about both. */
function reveal(): void {
  const row = listElement.children[selected] as HTMLElement | undefined;
  if (!row) return;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (bottom > offset + VIEW_H) offset = bottom - VIEW_H;
  if (top < offset) offset = top;
  if (offset < 0) offset = 0;
  listElement.style.setProperty('--wind', `${-offset}px`);
}

function render(): void {
  listElement.replaceChildren(
    ...rows.map((row, position) => {
      const line = document.createElement('div');
      line.className =
        `sb-row${row.sub ? ' sub' : ''}` +
        (row.current ? ' cur' : '') +
        (position === selected ? ' on' : '');
      line.textContent = row.label;
      return line;
    }),
  );
  reveal();
}

function at(kind: string, index: number): number {
  const found = rows.findIndex((row) => row.kind === kind && row.index === index);
  return found < 0 ? 0 : found;
}

/* The current section opens expanded, so the thing most likely to be wanted is
   already on screen. */
export function open(
  list: Section[],
  pick: (row: SidebarRow) => void,
  mode: string,
  watchingState: WatchingState | null,
): void {
  sections = list ?? [];
  watching = watchingState ?? null;
  onPick = pick;
  atMode = mode || '';
  expanded = NONE;
  sections.forEach((section, index) => {
    if (section.current) expanded = index;
  });
  /* The section is current too whenever Continue watching is, so this comes
     second: the list opens on where the focus actually is, not a level up. */
  if (watching?.current) expanded = -1;
  rows = build();
  selected = at(expanded === -1 ? 'watching' : 'section', expanded);
  offset = 0;
  showing = true;
  (listElement.parentNode as HTMLElement).classList.add('open');
  render();
}

export function close(): void {
  showing = false;
  (listElement.parentNode as HTMLElement).classList.remove('open');
}

export function isOpen(): boolean {
  return showing;
}

/* True for every key: an overlay that lets some keys through to the rail behind
   it would move a selection you cannot see. */
export function key(code: number): boolean {
  const row = rows[selected];

  if (isBack(code) || code === KEY.LEFT) {
    close();
    return true;
  }
  if (code === KEY.UP) {
    selected = clamp(selected - 1, 0, rows.length - 1);
    render();
    return true;
  }
  if (code === KEY.DOWN) {
    selected = clamp(selected + 1, 0, rows.length - 1);
    render();
    return true;
  }
  if (code !== KEY.RIGHT && code !== KEY.OK) return true;
  if (!row) return true;

  /* An entry with children opens them in place; pressing again on the open one
     — or on a section never visited, whose categories nobody has yet — picks
     it. */
  if (row.opens && row.index !== expanded) {
    expanded = row.index ?? NONE;
    rows = build();
    selected = at(row.kind, row.index ?? NONE);
    render();
    return true;
  }

  close();
  onPick?.(row);
  return true;
}
