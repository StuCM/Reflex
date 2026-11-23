import { collections as plexCollections } from '../api/plex/library';
import * as cached from '../data/cached';

/* The menu's pages, and what loads each. */

export const IDS = ['home', 'movies', 'tv', 'kids', 'collections', 'discover'] as const;
export type PageId = (typeof IDS)[number];

type Load = (settled: boolean) => void;

const loaders: Partial<Record<PageId, Load>> = {};

export function register(id: PageId, load: Load): void {
  loaders[id] = load;
}

export function indexOf(id: PageId): number {
  return IDS.indexOf(id);
}

/** Offers a menu page to its loader; an index past the pages (More) is ignored. */
export function goTo(index: number, settled: boolean): void {
  const id = IDS[index];
  if (id) loaders[id]?.(settled);
}

export interface CollectionEntry {
  title: string;
  count: number;
  parts: { server: string; key: string }[];
}

/** Fewer films than this across every server and it is not a collection worth a place. */
const MIN_COLLECTION = 5;

let entries: CollectionEntry[] = [];

export function collectionEntries(): CollectionEntry[] {
  return entries;
}

/* Each movie library's collections, from the daily cache or one request. LQ
   libraries hold only cam copies, so their collections are skipped. */
async function fetchCollections(part: MergePart): Promise<PlexCollection[]> {
  const id = `${part.server.id}:${part.key}`;
  const hit = await cached.collections.get(id);
  if (hit) return hit;
  const found = await plexCollections(part.server, part.key);
  void cached.collections.put(id, found);
  return found;
}

/* setSections runs twice at boot, from cache and then live, so the first ask
   is shared rather than repeated before the cache has been written. */
const asked: Record<string, Promise<PlexCollection[]>> = {};
function libraryCollections(part: MergePart): Promise<PlexCollection[]> {
  const id = `${part.server.id}:${part.key}`;
  asked[id] ??= fetchCollections(part);
  return asked[id];
}

/* Merged by title across servers; a failure leaves the sidebar group empty. */
export async function listCollections(libraries: MergePart[]): Promise<void> {
  const parts = libraries.filter((part) => !/\bLQ\b/i.test(part.title ?? ''));
  const perPart = await Promise.all(parts.map((part) => libraryCollections(part)));
  const byTitle: Record<string, CollectionEntry> = {};
  const merged: CollectionEntry[] = [];
  perPart.forEach((list) => {
    list.forEach((one) => {
      if (!one.title) return;
      let entry = byTitle[one.title];
      if (!entry) {
        entry = { title: one.title, count: 0, parts: [] };
        byTitle[one.title] = entry;
        merged.push(entry);
      }
      entry.count += one.count;
      entry.parts.push({ server: one.server, key: one.ratingKey });
    });
  });
  entries = merged
    .filter((entry) => entry.count >= MIN_COLLECTION)
    .sort((one, two) => (one.title < two.title ? -1 : 1));
}
