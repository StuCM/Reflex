/* Reading the library: sections, paging, hubs, search, history, and the guid
   lookups that let a curated external list be joined to what a server holds. */
import { ask, queryString, request } from './client';
import * as servers from '../../data/servers';

/** Items per category row. The rail shows ten across, and this is on the
    critical path of the first paint. */
const HUB_COUNT = 12;

interface Container {
  MediaContainer?: {
    Metadata?: PlexItem[];
    Directory?: { key: string; title: string; type: string; updatedAt?: number }[];
    Hub?: { title: string; type?: string; Metadata?: PlexItem[] }[];
    Device?: { id: string | number; name?: string; clientIdentifier?: string; platform?: string }[];
    totalSize?: number;
    size?: number;
  };
}

function metadataOf(response: unknown): PlexItem[] {
  return (response as Container).MediaContainer?.Metadata ?? [];
}

export function sections(server: PlexServer): Promise<PlexSection[]> {
  return ask(server, '/library/sections')
    .then((response) =>
      ((response as Container).MediaContainer?.Directory ?? [])
        /* Movies and shows. Music and photos are not something this app has any
           business drawing. */
        .filter((entry) => entry.type === 'movie' || entry.type === 'show')
        .map((entry) => ({
          key: entry.key,
          title: entry.title,
          type: entry.type as 'movie' | 'show',
          /* What lets an unchanged section be skipped. */
          updatedAt: entry.updatedAt ?? 0,
          server: server.id,
        })),
    )
    .catch(() => []);
}

/** type 1 is movies, 2 is shows — pass it in `extra` for a show section. */
export function items(
  server: PlexServer,
  sectionKey: string,
  start: number,
  size: number,
  extra?: Record<string, string | number>,
): Promise<{ total: number; items: PlexItem[] }> {
  /* Filters are applied server side — never pull a section down to sieve it. */
  const parameters = {
    type: 1,
    sort: 'titleSort:asc',
    includeCollections: 0,
    includeExternalMedia: 0,
    includeGuids: 1,
    'X-Plex-Container-Start': start,
    'X-Plex-Container-Size': size,
    ...extra,
  };
  return ask(server, `/library/sections/${sectionKey}/all?${queryString(parameters)}`, {
    timeout: 20000,
  }).then((response) => {
    const container = (response as Container).MediaContainer ?? {};
    return {
      total: container.totalSize ?? container.size ?? 0,
      items: servers.stamp(container.Metadata ?? [], server),
    };
  });
}

/* Which certificates this library actually uses. Asking beats hardcoding — a
   server may label things BBFC, MPAA, or prefix them by region ("gb/12A"). */
export function contentRatings(server: PlexServer, sectionKey: string): Promise<string[]> {
  return ask(server, `/library/sections/${sectionKey}/contentRating`)
    .then((response) =>
      ((response as Container).MediaContainer?.Directory ?? []).map(
        (entry) => entry.title || entry.key,
      ),
    )
    .catch(() => []);
}

/* Continue watching. /library/onDeck is the universally supported endpoint —
   /hubs/continueWatching only exists on newer servers. Films and episodes both
   turn up, and an episode is the commoner case. */
export function onDeck(server: PlexServer): Promise<PlexItem[]> {
  return ask(server, `/library/onDeck?${queryString({ includeGuids: 1 })}`)
    .then((response) =>
      servers.stamp(
        metadataOf(response).filter((item) => item.type === 'movie' || item.type === 'episode'),
        server,
      ),
    )
    .catch(() => []);
}

/* Whether a server answered removeFromContinueWatching. Memory only, so a row
   of ten does not rediscover the same 404 ten times, and an upgraded server is
   not written off for ever. */
const canHide: Record<string, boolean> = {};

/* Hide an item from Continue watching without touching its watch state.
   Resolves false where the server has no such endpoint, so the caller can ask
   about the destructive alternative rather than fall into it. */
export function hideFromDeck(server: PlexServer, ratingKey: string): Promise<boolean> {
  if (canHide[server.id] === false) return Promise.resolve(false);
  return request(
    'PUT',
    `${server.base}/actions/removeFromContinueWatching?${queryString({ ratingKey })}`,
    { token: server.token },
  ).then(
    () => {
      canHide[server.id] = true;
      return true;
    },
    (error: Error) => {
      if (!/-> 40[04](\s|$)/.test(error.message)) throw error;
      canHide[server.id] = false;
      return false;
    },
  );
}

/* Mark watched, which is how an older server is made to forget it. Plex
   propagates a show's scrobble down to every episode. */
export function scrobble(server: PlexServer, ratingKey: string): Promise<unknown> {
  return request(
    'PUT',
    `${server.base}/:/scrobble?${queryString({
      key: ratingKey,
      identifier: 'com.plexapp.plugins.library',
    })}`,
    { token: server.token },
  );
}

/* One level at a time: a show's children are its seasons, a season's are its
   episodes. Never /allLeaves on a library we do not own. */
export function children(server: PlexServer, ratingKey: string): Promise<PlexItem[]> {
  return ask(
    server,
    `/library/metadata/${ratingKey}/children?${queryString({ includeGuids: 1 })}`,
    {
      timeout: 20000,
    },
  )
    .then((response) => servers.stamp(metadataOf(response), server))
    .catch(() => []);
}

/* The section's own categories. One request returns every hub with its items,
   which is how the stock app shows a huge library without listing it. */
export function hubs(server: PlexServer, sectionKey: string): Promise<PlexHub[]> {
  return ask(
    server,
    `/hubs/sections/${sectionKey}?${queryString({ count: HUB_COUNT, includeGuids: 1 })}`,
    { timeout: 20000 },
  )
    .then((response) =>
      ((response as Container).MediaContainer?.Hub ?? [])
        .filter((hub) => hub.Metadata?.length && (hub.type === 'movie' || hub.type === 'show'))
        .map((hub) => ({ title: hub.title, items: servers.stamp(hub.Metadata ?? [], server) })),
    )
    .catch(() => []);
}

export function search(server: PlexServer, query: string): Promise<PlexItem[]> {
  return ask(server, `/hubs/search?${queryString({ query, limit: 40 })}`, { timeout: 20000 })
    .then((response) => {
      const found: PlexItem[] = [];
      ((response as Container).MediaContainer?.Hub ?? []).forEach((hub) => {
        (hub.Metadata ?? []).forEach((item) => {
          if (item.type === 'movie' || item.type === 'show') found.push(item);
        });
      });
      return servers.stamp(found, server);
    })
    .catch(() => []);
}

/* Plex attributes everything to the account, not the person, but each entry
   records which device played it — the only handle on "that was the other TV". */
export function history(server: PlexServer, size?: number): Promise<PlexItem[]> {
  return ask(
    server,
    `/status/sessions/history/all?${queryString({
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': size ?? 200,
    })}`,
    { timeout: 20000 },
  )
    .then((response) => metadataOf(response))
    .catch(() => []);
}

export function devices(server: PlexServer): Promise<PlexDevice[]> {
  return ask(server, '/devices')
    .then((response) =>
      ((response as Container).MediaContainer?.Device ?? []).map((device) => ({
        id: String(device.id),
        name: device.name || device.clientIdentifier || `device ${device.id}`,
        platform: device.platform ?? '',
      })),
    )
    .catch(() => []);
}

/* Find a library item by external id, e.g. 'tmdb://27205'. This is the join
   that lets a curated external list be asked about, instead of crawling. */
export function copiesByGuid(server: PlexServer, guid: string): Promise<PlexItem[]> {
  return ask(server, `/library/all?${queryString({ guid, includeGuids: 1 })}`, { timeout: 15000 })
    .then((response) => servers.stamp(metadataOf(response), server))
    .catch(() => []);
}

export function findByGuid(server: PlexServer, guid: string): Promise<PlexItem | null> {
  return copiesByGuid(server, guid).then((found) => found[0] ?? null);
}

/* Every copy of a film on this server, wherever it lives. /library/all is
   global, which matters: these libraries keep the 4K version in a SEPARATE
   SECTION, so the other version is not another entry in Media[] — it is a
   different library item, and only a guid lookup finds it. */
export function allVersions(server: PlexServer, item: PlexItem): Promise<PlexItem[]> {
  const ids: string[] = [];
  if (String(item.guid ?? '').startsWith('plex://')) ids.push(item.guid as string);
  (item.Guid ?? []).forEach((guid) => {
    if (guid.id) ids.push(guid.id);
  });
  if (!ids.length) return Promise.resolve([]);

  /* Try the ids in order and take the first that finds anything — one request
     in the normal case. */
  function attempt(index: number): Promise<PlexItem[]> {
    const guid = ids[index];
    if (!guid) return Promise.resolve([]);
    return copiesByGuid(server, guid).then((found) => (found.length ? found : attempt(index + 1)));
  }
  return attempt(0);
}

/* Handles both the modern Guid array and the legacy agent form
   (com.plexapp.agents.themoviedb://123?lang=en). */
export function tmdbId(item: PlexItem | null | undefined): string | null {
  const modern = (item?.Guid ?? []).find((guid) => (guid.id ?? '').startsWith('tmdb://'));
  if (modern?.id) return modern.id.substring(7);
  const legacy = /themoviedb:\/\/(\d+)/.exec(String(item?.guid ?? ''));
  return legacy?.[1] ?? null;
}

/* includeMarkers is where "Skip intro" comes from: the server has already
   analysed the film, so there is nothing to detect on the panel — only
   something to offer at the right moment. includeChapters gives the trackbar
   its ticks. Both ride the payload the app already fetches. */
export function metadata(server: PlexServer, ratingKey: string): Promise<PlexItem | null> {
  return ask(
    server,
    `/library/metadata/${ratingKey}?${queryString({
      includeGuids: 1,
      includeExtras: 1,
      includeMarkers: 1,
      includeChapters: 1,
    })}`,
  ).then((response) => {
    const found = metadataOf(response);
    const item = found[0];
    if (!item) return null;
    /* Extras arrive nested and are playable in their own right, so they need
       stamping too or nothing can tell which server they came from. */
    const extras = (item as { Extras?: { Metadata?: PlexItem[] } }).Extras?.Metadata;
    if (extras) servers.stamp(extras, server);
    return servers.stamp(found, server)[0] ?? null;
  });
}
