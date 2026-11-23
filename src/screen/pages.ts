import { onDeck as plexOnDeck } from '../api/plex/library';
import * as devices from '../data/devices';
import * as merge from '../data/merge';
import * as rowModel from '../rules/rows';

/* The last state of each page, by key, so changing page does not blank it. */

export interface Page {
  rows: Row[];
  rowIndex: number;
  deckItems: PlexItem[];
  /** When the rows last came from the servers; 0 if only from the cache. */
  loadedAt: number;
  /** Kids only: the filter its later pages are cut by. */
  held?: (entry: DiscoveryEntry) => boolean;
}

export const FRESH_FOR = 2 * 60 * 1000;

const kept = new Map<string, Page>();

export function keep(key: string, page: Page): void {
  kept.set(key, page);
}

export function recall(key: string): Page | undefined {
  return kept.get(key);
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

/* Both servers offer a "Recently Added"; they are one row, deduplicated.
   Order within it is first-seen, which keeps each server's own ordering
   intact rather than inventing a ranking across them. */
export function mergeHubs(perPart: PlexHub[][]): { title: string; items: PlexItem[] }[] {
  const byTitle: Record<string, PlexItem[][]> = {};
  const order: string[] = [];
  perPart.forEach((hubs) => {
    hubs.forEach((hub) => {
      if (!byTitle[hub.title]) {
        byTitle[hub.title] = [];
        order.push(hub.title);
      }
      byTitle[hub.title]?.push(hub.items);
    });
  });
  return order
    .map((title) => ({ title, items: merge.lists(byTitle[title] ?? []) }))
    .filter((hub) => hub.items.length > 0);
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
