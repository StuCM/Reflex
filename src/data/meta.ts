/* Full metadata for one copy, debounced and cached per server. */
import { metadata } from '../api/plex/library';
import * as cached from './cached';
import * as servers from './servers';
import { debug } from '../core/ui';

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

export async function load(item: PlexItem | null | undefined): Promise<PlexItem | null> {
  if (!item?.ratingKey) return null;
  const key = keyOf(item);
  const already = held[key];
  if (already) return already;

  const server = servers.of(item);
  if (!server) return null;

  try {
    const hit = await cached.meta.get(key);
    const found = hit ?? (await metadata(server, item.ratingKey));
    /* Only a fresh fetch is written back — putting a cache hit straight back
       would be an IndexedDB write per focused tile. */
    if (!hit && found) void cached.meta.put(key, found);
    if (!found) return null;
    found._server = item._server; // survives the round trip through Store
    remember(key, found);
    return found;
  } catch (error) {
    debug(`meta: ${(error as Error).message}`);
    return null;
  }
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
  timer = setTimeout(async () => {
    const found = await load(item);
    if (found) onLoaded(ratingKey, found);
  }, HOLD);
}
