import { onDeck as plexOnDeck } from '../api/plex/library';
import * as devices from '../data/devices';
import * as merge from '../data/merge';
import * as rowModel from '../rules/rows';

/* The last state of each library page, so changing page does not blank it. */

export interface Page {
  rows: Row[];
  rowIndex: number;
  deckItems: PlexItem[];
  /** When the rows last came from the servers; 0 if only from the cache. */
  loadedAt: number;
}

export const FRESH_FOR = 2 * 60 * 1000;

const kept = new Map<number, Page>();

export function keep(section: number, page: Page): void {
  kept.set(section, page);
}

export function recall(section: number): Page | undefined {
  return kept.get(section);
}

export function isFresh(page: Page): boolean {
  return Date.now() - page.loadedAt < FRESH_FOR;
}

/** Every page and the deck are out of date: the preference or viewer changed, or something was played. */
export function clear(): void {
  kept.clear();
  prefetched = null;
}

function sameItem(one: PlexItem, two: PlexItem): boolean {
  return (
    one.ratingKey === two.ratingKey &&
    one._server === two._server &&
    one.viewOffset === two.viewOffset
  );
}

/* The row for fresh items: the one on screen if nothing changed, else a new one
   that keeps the focus on the same item. */
export function refreshed(shown: Row[], fresh: { title: string; items: PlexItem[] }): Row {
  const old = shown.find((row) => row.kind === 'list' && row.title === fresh.title);
  if (!old || old.kind !== 'list') return rowModel.list(fresh.title, fresh.items);
  if (
    old.items.length === fresh.items.length &&
    old.items.every((item, at) => sameItem(item, fresh.items[at]!))
  ) {
    return old;
  }
  const row = rowModel.list(fresh.title, fresh.items);
  const was = old.items[old.focus];
  const moved = was ? fresh.items.findIndex((item) => sameItem(was, item)) : -1;
  row.focus = moved >= 0 ? moved : Math.min(old.focus, Math.max(0, row.total - 1));
  return row;
}

/* onDeck is per server, not per section, and hands back films and episodes
   together — which is what you want to carry on with, so it is kept whole
   rather than cut to the section's own type. Most recently watched first. */
export function buildDeck(perServer: PlexItem[][]): PlexItem[] {
  const deck = merge.newestPerShow(devices.mine(merge.lists(perServer)));
  deck.sort((one, two) => (two.lastViewedAt ?? 0) - (one.lastViewedAt ?? 0));
  return deck;
}

interface DeckFetch {
  ids: string;
  at: number;
  lists: Promise<PlexItem[][]>;
}
/** The last refreshDeck, for loadSection to take once instead of asking again. */
let prefetched: DeckFetch | null = null;
const PREFETCH_FOR = FRESH_FOR;

/* One onDeck per server, and the history `mine` needs. A launch asks twice —
   once from the cached servers, once after discovery — so loadSection takes
   the answer refreshDeck already has rather than asking again. */
export function fetchDeck(reachable: PlexServer[], fresh: boolean): Promise<PlexItem[][]> {
  const ids = reachable.map((server) => server.id).join(',');
  const held = prefetched;
  if (!fresh && held && held.ids === ids && Date.now() - held.at < PREFETCH_FOR) return held.lists;
  const lists = Promise.all([
    Promise.all(reachable.map((server) => plexOnDeck(server))),
    devices.ensureHistory(),
  ]).then((results) => results[0]);
  prefetched = { ids, at: Date.now(), lists };
  return lists;
}
