/* Which TMDB titles the servers hold among their kids and family libraries,
   built a server at a time and kept a week — the one large read the app makes
   of servers it does not own. */
import { genres, items, sections, tmdbId } from "../api/plex/library";
import * as cached from "./cached";
import * as servers from "./servers";
import { debug } from "../core/ui";

const PAGE = 500;
const KIDS_LIBRARY = /kids/i;
const KIDS_GENRE = /^(family|animation|children|kids)$/i;

/** The key discovery uses for a title: `tv/<id>` for a show, else the id. */
export function keyOf(item: PlexItem): string | null {
  const id = tmdbId(item);
  if (!id) return null;
  return item.type === "show" ? `tv/${id}` : id;
}

async function read(
  server: PlexServer,
  section: PlexSection,
  extra: Record<string, string | number>,
  into: Set<string>,
): Promise<void> {
  const filter = { type: section.type === "show" ? 2 : 1, ...extra };
  let start = 0;
  let total = 1;
  while (start < total) {
    // eslint-disable-next-line no-await-in-loop -- serial, by design
    const page = await items(server, section.key, start, PAGE, filter);
    page.items.forEach((item) => {
      const key = keyOf(item);
      if (key) into.add(key);
    });
    total = page.total;
    start += PAGE;
    if (!page.items.length) return;
  }
}

async function build(server: PlexServer): Promise<string[]> {
  const found = new Set<string>();
  for (const section of await sections(server)) {
    if (KIDS_LIBRARY.test(section.title)) {
      // eslint-disable-next-line no-await-in-loop -- serial, by design
      await read(server, section, {}, found);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- serial, by design
    for (const genre of await genres(server, section.key)) {
      // eslint-disable-next-line no-await-in-loop -- serial, by design
      if (KIDS_GENRE.test(genre.title))
        await read(server, section, { genre: genre.key }, found);
    }
  }
  return Array.from(found);
}

const building: Record<string, Promise<string[]> | undefined> = {};

function rebuild(server: PlexServer): Promise<string[]> {
  const running = building[server.id];
  if (running) return running;
  const started = build(server).then(
    (keys) => {
      building[server.id] = undefined;
      void cached.kids.put(server.id, keys);
      return keys;
    },
    (error: Error) => {
      building[server.id] = undefined;
      debug(`kids index ${server.id}: ${error.message}`);
      return [];
    },
  );
  building[server.id] = started;
  return started;
}

/** Kids and family titles across the servers. A stale index is returned at once and rebuilt behind it. */
export async function held(): Promise<Set<string>> {
  const all = new Set<string>();
  const lists = await Promise.all(
    servers.all().map(async (server) => {
      const hit = await cached.kids.get(server.id);
      if (!hit) return rebuild(server);
      if (!hit.fresh) void rebuild(server);
      return hit.value;
    }),
  );
  lists.forEach((keys) => keys.forEach((key) => all.add(key)));
  return all;
}

/** Is this discovery entry among the titles held? */
export function isHeld(set: Set<string>, entry: DiscoveryEntry): boolean {
  const id = entry.Guid?.[0]?.id ?? "";
  return set.has(id.substring(7));
}
