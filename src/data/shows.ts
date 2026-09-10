/* Seasons and episodes of a show, merged across servers.
   One level at a time — a show's children are its seasons, a season's are its
   episodes — because /allLeaves on a library we do not own is not on. */
import { allVersions, children } from '../api/plex/library';
import * as merge from './merge';
import { load } from './meta';
import * as servers from './servers';

/** '<server>:<showKey>' -> the resolved series entry. */
const entries: Record<string, Promise<PlexItem | null>> = {};

function childrenOf(entry: PlexItem, type: string): Promise<PlexItem[]> {
  const copies = merge.sources(entry);
  return Promise.all(
    copies.map((copy) => {
      const server = servers.of(copy);
      return server ? children(server, copy.ratingKey) : Promise.resolve([]);
    }),
  ).then((perServer) => {
    const merged = merge.lists(perServer.map((list) => list.filter((one) => one.type === type)));
    merged.sort((one, two) => (one.index ?? 0) - (two.index ?? 0));
    return merged;
  });
}

/* Each returned season carries its own per-server copies, which is what the
   episode fetch then walks. */
export function seasons(entry: PlexItem): Promise<PlexItem[]> {
  return childrenOf(entry, 'season');
}

export function episodes(season: PlexItem): Promise<PlexItem[]> {
  return childrenOf(season, 'episode');
}

function resolve(episode: PlexItem): Promise<PlexItem | null> {
  return load({
    ratingKey: episode.grandparentRatingKey as string,
    _server: episode._server,
  })
    .then((show) => {
      if (!show) return null;
      /* Up to the show and out from there: episodes rarely carry ids of their
         own, but the show does, so its ids are what the other servers are asked
         for. Its own server's copy leads the fold, so a show only one server
         has is a one-source entry and the page is happy with that. */
      return Promise.all(servers.all().map((server) => allVersions(server, show))).then(
        (perServer) => merge.lists([[show], ...perServer])[0] ?? null,
      );
    })
    .catch(() => null);
}

/* The series an episode belongs to, merged across every server that has it.
   Cached per show, because pressing OK on three episodes of one show must cost
   one resolution. */
export function entryFor(episode: PlexItem | null | undefined): Promise<PlexItem | null> {
  if (!episode?.grandparentRatingKey) return Promise.resolve(null);
  const key = `${episode._server}:${episode.grandparentRatingKey}`;
  entries[key] ??= resolve(episode);
  return entries[key];
}

/* Is this merged entry a copy of that episode? Matched by rating key across
   every copy, because the episode playing is one server's and the merged entry
   may lead with the other's. */
function isCopyOf(entry: PlexItem, episode: PlexItem): boolean {
  return merge.sources(entry).some((copy) => String(copy.ratingKey) === String(episode.ratingKey));
}

/* The episode after `current` in a season's list, or null at the end of it or
   when `current` is not in the list at all. Pure, so it is unit tested. */
export function nextInList(
  list: PlexItem[] | null | undefined,
  current: PlexItem | null | undefined,
): PlexItem | null {
  if (!list || !current) return null;
  const at = list.findIndex((entry) => isCopyOf(entry, current));
  if (at < 0) return null;
  return list[at + 1] ?? null;
}

export function nextAfter(
  episode: PlexItem | null | undefined,
): Promise<{ episode: PlexItem; newSeason: boolean } | null> {
  if (!episode) return Promise.resolve(null);
  return entryFor(episode)
    .then((entry) => {
      if (!entry) return null;
      return seasons(entry).then((list) => {
        const at = list.findIndex((season) => season.index === episode.parentIndex);
        if (at < 0) return null;
        const season = list[at];
        if (!season) return null;
        return episodes(season).then((found) => {
          const next = nextInList(found, episode);
          if (next) return { episode: next, newSeason: false };
          /* seasons() is sorted by index, so the one after is simply the next. */
          const following = list[at + 1];
          if (!following) return null;
          return episodes(following).then((more) =>
            more[0] ? { episode: more[0], newSeason: true } : null,
          );
        });
      });
    })
    .catch(() => null);
}

/** "4 series · 38 episodes", or as much of it as the server told us. */
export function summary(entry: PlexItem): string {
  const bits: string[] = [];
  const seasonCount = entry.childCount;
  const leaves = (entry as { leafCount?: number }).leafCount;
  const watched = (entry as { viewedLeafCount?: number }).viewedLeafCount;
  if (seasonCount) bits.push(`${seasonCount} series`);
  if (leaves) bits.push(`${leaves} episode${leaves === 1 ? '' : 's'}`);
  if (leaves && watched) bits.push(`${watched} watched`);
  return bits.join('   ·   ');
}

/* The season a merged list should open on: the first with anything unwatched,
   else the first. Somebody part way through series three does not want to land
   on series one every time. */
export function openAt(list: PlexItem[]): number {
  const at = list.findIndex((season) => {
    const leaves = (season as { leafCount?: number }).leafCount ?? 0;
    const watched = (season as { viewedLeafCount?: number }).viewedLeafCount ?? 0;
    return leaves > watched;
  });
  return at < 0 ? 0 : at;
}
