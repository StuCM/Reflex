/* A TMDB list turned into rows of what the servers actually have.
   External-first: draw the tile from TMDB, and only ask a server whether we
   hold it for the tile that has the focus. Asking for every tile drawn is the
   crawl this page exists to avoid. */
import { search, tmdbId } from '../api/plex/library';
import * as tmdb from '../api/tmdb';
import * as cached from './cached';
import * as merge from './merge';
import * as servers from './servers';
import settings from '../core/config';
import { debug } from '../core/ui';

export function enabled(): boolean {
  return tmdb.enabled();
}

/* A TMDB result as something the rail can draw with no Plex request at all:
   the synthetic Guid is what art.ts keys the poster on, and _resolved stays
   undefined until someone asks whether we hold it. */
export function entry(result: TmdbFilm): DiscoveryEntry {
  return {
    type: result.media === 'tv' ? 'show' : 'movie',
    title: result.title,
    year: result.year,
    Guid: [{ id: `tmdb://${keyOf(result)}` }],
    _tmdb: result,
    _resolved: undefined,
  } as DiscoveryEntry;
}

/* TMDB numbers films and shows separately, so a show's id is prefixed to keep
   it from reading a film's cache or art entry. */
function keyOf(result: TmdbFilm): string {
  return result.media === 'tv' ? `tv/${result.id}` : result.id;
}

/** Is this a title drawn from TMDB rather than out of a library? */
export function isEntry(item: PlexItem | null | undefined): boolean {
  return !!(item as DiscoveryEntry | undefined)?._tmdb;
}

/* Whether we hold the title, which the masthead says before OK is pressed. */
function settle(item: DiscoveryEntry, found: PlexItem | null): void {
  item._resolved = found ?? null;
  item._availability = found ? 'held' : 'absent';
}

/* The servers ignore a tmdb:// guid filter, so search by title and keep the film whose TMDB id is
   this one. A show can share the number, hence the type. */
async function askServers(title: string, id: string, type: string): Promise<PlexItem | null> {
  const perServer = await Promise.all(
    servers.all().map(async (server) => {
      const found = await search(server, title);
      return found.find((hit) => hit.type === type && tmdbId(hit) === id) ?? null;
    }),
  );
  const hits = perServer.filter((hit): hit is PlexItem => !!hit);
  return hits.length ? (merge.lists([hits])[0] ?? null) : null;
}

/* The copy we hold of a TMDB title, or null for one we do not. Call it for the
   focused tile and on OK — never for a tile that is merely drawn. */
export function resolve(item: DiscoveryEntry): Promise<PlexItem | null> {
  if (item._resolved !== undefined) return Promise.resolve(item._resolved);
  if (item._asking) return item._asking;

  item._asking = ask(item);
  return item._asking;
}

async function ask(item: DiscoveryEntry): Promise<PlexItem | null> {
  let found: PlexItem | null;
  try {
    const key = keyOf(item._tmdb);
    const hit = await cached.lookup.get(key);
    if (hit !== undefined) {
      found = hit;
    } else {
      found = await askServers(item.title ?? '', item._tmdb.id, item.type ?? 'movie');
      void cached.lookup.put(key, found);
    }
  } catch (error) {
    item._asking = null; // a failed lookup is worth retrying
    debug(`resolve ${item.title}: ${(error as Error).message}`);
    return null;
  }
  /* Outside the try on purpose: only a failed lookup is worth retrying, so a
     throw from settle must not clear _asking and ask the servers again. */
  settle(item, found);
  return item._resolved ?? null;
}

interface LoadContext {
  isCurrent(): boolean;
  seeds?: string[];
  add(title: string, items: DiscoveryEntry[], category: DiscoveryCategory, pages: number): void;
  categories?: DiscoveryCategory[];
  keep?: (entry: DiscoveryEntry) => boolean;
}

/* The cache key for one page of a category. Two rows that differ only in their
   filters must not read each other's page, so the filters are in it. */
export function pageKey(category: DiscoveryCategory, seeds: string[], page: number): string {
  const parameters = category.params ?? {};
  const filters = Object.keys(parameters)
    .sort()
    .map((name) => `${name}=${parameters[name]}`)
    .join('&');
  const extra =
    filters || category.minVotes !== undefined ? `:${filters}:${category.minVotes}` : '';
  const who = category.id ?? category.seed ?? seeds.join('-');
  const day = category.window === 'day' ? 'day:' : '';
  return `${category.media === 'tv' ? 'tv:' : ''}${day}${category.kind}:${who}:${page}${extra}`;
}

/* One page of a category, from the day's cache or TMDB. A bare array is
   yesterday's format and counts as a miss. */
async function fetchPage(
  category: DiscoveryCategory,
  seeds: string[],
  page: number,
): Promise<tmdb.TmdbPage> {
  const key = pageKey(category, seeds, page);
  const store = cached.catalogue as unknown as {
    get(id: string): Promise<tmdb.TmdbPage | TmdbFilm[] | undefined>;
    put(id: string, value: tmdb.TmdbPage): Promise<unknown>;
  };
  const hit = await store.get(key);
  if (hit && !Array.isArray(hit) && hit.films.length) return hit;
  const found = await tmdb.catalogue(category, seeds, page);
  void store.put(key, found);
  return found;
}

/* Upcoming titles are not in any library yet, so a filter on what we hold would empty them. */
function kept(
  category: DiscoveryCategory,
  entries: DiscoveryEntry[],
  keep?: (entry: DiscoveryEntry) => boolean,
): DiscoveryEntry[] {
  const filtered =
    keep && category.kind !== 'upcoming' ? entries.filter((candidate) => keep(candidate)) : entries;
  return category.limit ? filtered.slice(0, category.limit) : filtered;
}

/** The next page of a paged row, as entries the rail can draw. */
export async function more(
  category: DiscoveryCategory,
  seeds: string[],
  page: number,
  keep?: (entry: DiscoveryEntry) => boolean,
): Promise<{ entries: DiscoveryEntry[]; pages: number }> {
  const got = await fetchPage(category, seeds, page);
  return {
    entries: kept(category, got.films.map(entry), keep),
    pages: got.pages,
  };
}

async function fetchRow(
  category: DiscoveryCategory,
  seeds: string[],
): Promise<tmdb.TmdbPage | undefined> {
  try {
    return await fetchPage(category, seeds, 1);
  } catch (error) {
    debug(`${category.title} failed: ${(error as Error).message}`);
    return undefined;
  }
}

function publish(
  context: LoadContext,
  category: DiscoveryCategory,
  found: tmdb.TmdbPage | undefined,
): void {
  if (!found || !context.isCurrent()) return;
  const entries = kept(category, found.films.map(entry), context.keep);
  if (!entries.length) {
    debug(`${category.title}: nothing to show`);
    return;
  }
  context.add(category.title, entries, category, category.limit ? 1 : found.pages);
  debug(`${category.title}: ${entries.length} from TMDB`);
}

/* The same cap art.ts puts on image fetches. */
const IN_FLIGHT = 4;

/* One row per category in core/config, each a TMDB request cached for the day.
   Up to IN_FLIGHT are asked at once, but a row is published only after the ones
   before it, so the page never reorders. isCurrent() guards against a section
   switch mid-flight; seeds are the TMDB ids of what has been watched, which the
   caller already holds. */
export async function load(context: LoadContext): Promise<void> {
  const categories = context.categories ?? settings.categories ?? [];
  const seeds = context.seeds ?? [];
  const published: Promise<void>[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    const at = next++;
    const category = categories[at];
    if (!category || !context.isCurrent()) return;
    const found = fetchRow(category, seeds);
    published[at] = Promise.all([found, published[at - 1]]).then(([row]) =>
      publish(context, category, row),
    );
    await found;
    return worker();
  }
  await Promise.all(Array.from({ length: IN_FLIGHT }, () => worker()));
  await Promise.all(published);
}
