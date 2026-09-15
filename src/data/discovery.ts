/* A TMDB list turned into rows of what the servers actually have.
   External-first: draw the tile from TMDB, and only ask a server whether we
   hold it for the tile that has the focus. Asking for every tile drawn is the
   crawl this page exists to avoid. */
import { findByGuid } from '../api/plex/library';
import * as tmdb from '../api/tmdb';
import { railSub } from '../rules/labels';
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
    type: 'movie',
    title: result.title,
    year: result.year,
    Guid: [{ id: `tmdb://${result.id}` }],
    _tmdb: result,
    _resolved: undefined,
  } as DiscoveryEntry;
}

/** Is this a title drawn from TMDB rather than out of a library? */
export function isEntry(item: PlexItem | null | undefined): boolean {
  return !!(item as DiscoveryEntry | undefined)?._tmdb;
}

/* The line the masthead shows under the name — the honest answer before OK is
   pressed. */
function settle(item: DiscoveryEntry, found: PlexItem | null): void {
  const sub = found ? railSub(found) : '';
  item._resolved = found ?? null;
  item._availability = !found
    ? 'Not in your library'
    : sub
      ? `In your library  ·  ${sub}`
      : 'In your library';
}

async function askServers(id: string): Promise<PlexItem | null> {
  const perServer = await Promise.all(
    servers.all().map((server) => findByGuid(server, `tmdb://${id}`).catch(() => null)),
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
    const hit = await cached.lookup.get(item._tmdb.id);
    if (hit !== undefined) {
      found = hit;
    } else {
      found = await askServers(item._tmdb.id);
      void cached.lookup.put(item._tmdb.id, found);
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
  add(title: string, items: DiscoveryEntry[]): void;
}

async function one(context: LoadContext, category: DiscoveryCategory): Promise<void> {
  const seeds = context.seeds ?? [];
  const key = `${category.kind}:${category.id ?? seeds.join('-')}`;
  let found: TmdbFilm[];
  try {
    const hit = await cached.catalogue.get(key);
    if (hit?.length) {
      found = hit;
    } else {
      found = await tmdb.catalogue(category, seeds);
      void cached.catalogue.put(key, found);
    }
  } catch (error) {
    debug(`${category.title} failed: ${(error as Error).message}`);
    return;
  }
  /* Outside the try: a throw from the rail's own drawing is not a failed
     TMDB fetch and must not be reported as one. */
  if (!context.isCurrent()) return;
  if (!found.length) {
    debug(`${category.title}: TMDB returned nothing`);
    return;
  }
  context.add(category.title, found.map(entry));
  debug(`${category.title}: ${found.length} from TMDB`);
}

/* One row per category in core/config, each a TMDB request cached for the day
   and published the moment it lands. isCurrent() guards against a section
   switch mid-flight; seeds are the TMDB ids of what has been watched, which the
   caller already holds. */
export function load(context: LoadContext): Promise<void> {
  const categories = settings.categories ?? [];
  /* One at a time, and recursive rather than a loop: the rows go to a server we
     do not own, so they are asked for in order, which `no-await-in-loop` reads
     as the mistake it usually is. */
  async function step(at: number): Promise<void> {
    const category = categories[at];
    if (!context.isCurrent() || !category) return;
    await one(context, category);
    return step(at + 1);
  }
  return step(0);
}
