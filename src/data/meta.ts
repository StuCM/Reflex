/* Full metadata for one copy, debounced and cached per server. */
import { metadata } from '../api/plex/library';
import * as cached from './cached';
import * as servers from './servers';

/** Metadata payloads kept in RAM. */
const CAP = 500;

/** Milliseconds of stillness before asking a server. */
const HOLD = 280;

let held: Record<string, PlexItem> = {};
let count = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function keyOf(item: PlexItem | null | undefined): string {
  return `${item?._server ?? '?'}:${item?.ratingKey ?? ''}`;
}

export function get(item: PlexItem | null | undefined): PlexItem | null {
  return held[keyOf(item)] ?? null;
}

function remember(key: string, item: PlexItem): void {
  /* Crude cap: drop the lot when it fills. A 30k library browsed hard would
     otherwise grow this without bound. LRU if it ever matters. */
  if (count > CAP) {
    held = {};
    count = 0;
  }
  held[key] = item;
  count++;
}

export function load(item: PlexItem | null | undefined): Promise<PlexItem | null> {
  if (!item?.ratingKey) return Promise.resolve(null);
  const key = keyOf(item);
  const already = held[key];
  if (already) return Promise.resolve(already);

  const server = servers.of(item);
  if (!server) return Promise.resolve(null);

  return cached.meta
    .get(key)
    .then(
      (hit) =>
        /* Only a fresh fetch is written back — putting a cache hit straight
           back would be an IndexedDB write per focused tile. */
        hit ??
        metadata(server, item.ratingKey).then((found) => {
          if (found) void cached.meta.put(key, found);
          return found;
        }),
    )
    .then((found) => {
      if (!found) return null;
      found._server = item._server; // survives the round trip through Store
      remember(key, found);
      return found;
    })
    .catch((error: Error) => {
      UI.debug(`meta: ${error.message}`);
      return null;
    });
}

/* Fetch for whatever is focused now, once the user stops moving. onLoaded is
   given the rating key so the caller can check it is still the focused one
   before repainting. */
export function schedule(
  item: PlexItem | null | undefined,
  onLoaded: (ratingKey: string, found: PlexItem) => void,
): void {
  if (timer) clearTimeout(timer);
  if (!item) return;
  /* Already held: the caller drew from the cache a moment ago, so there is
     nothing to fetch and nothing to repaint. */
  if (held[keyOf(item)]) return;
  const ratingKey = item.ratingKey;
  timer = setTimeout(() => {
    void load(item).then((found) => {
      if (found) onLoaded(ratingKey, found);
    });
  }, HOLD);
}
