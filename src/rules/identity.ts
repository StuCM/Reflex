/* Is this the same film as that one, on a different server?
 *
 * Plex itself answers this every time it syncs a watch position between the two
 * servers, and it does it by matching the item's global identifiers. So do we.
 * Every id an item carries is a candidate key, and two items are the same film
 * if they agree on *any* of them — servers running different agent versions
 * expose different subsets, and requiring them all to line up would mean
 * silently showing duplicates.
 *
 * Title and year come last, and only as a fallback. Two genuinely different
 * films sharing both is rare enough to accept; the same film failing to match
 * because one server has no external id is not.
 */

function externalIds(item: PlexItem | null | undefined): string[] {
  const out: string[] = [];
  (item?.Guid ?? []).forEach((guid) => {
    const id = String(guid.id ?? '').toLowerCase();
    if (id.startsWith('imdb://') || id.startsWith('tmdb://') || id.startsWith('tvdb://')) {
      out.push(id);
    }
  });

  /* The legacy agent form: com.plexapp.agents.imdb://tt0133093?lang=en */
  const legacy = /agents\.(imdb|themoviedb|thetvdb):\/\/([^?/]+)/.exec(String(item?.guid ?? ''));
  if (legacy?.[1] && legacy[2]) {
    const agent = legacy[1] === 'themoviedb' ? 'tmdb' : legacy[1] === 'thetvdb' ? 'tvdb' : 'imdb';
    out.push(`${agent}://${legacy[2].toLowerCase()}`);
  }
  return out;
}

function titleKey(item: PlexItem | null | undefined): string {
  const title = String(item?.titleSort ?? item?.title ?? '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
  return `title://${title}/${item?.year ?? ''}`;
}

/* An episode is identified by which show it belongs to and where it sits in it.
   Episodes often carry no external ids of their own, and their titles are not
   unique across shows — "Pilot" is everywhere — so season and episode number
   against the show's identity is what actually holds. */
function episodeKey(item: PlexItem): string {
  const show = String(item.grandparentGuid ?? item.grandparentTitle ?? '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9:/.]+/g, '');
  const season = item.parentIndex === undefined ? '?' : item.parentIndex;
  const number = item.index === undefined ? '?' : item.index;
  return `episode://${show}/${season}/${number}`;
}

/** Every key this item could be recognised by, best first. */
export function identities(item: PlexItem | null | undefined): string[] {
  const out = externalIds(item);
  const guid = String(item?.guid ?? '');
  if (guid.startsWith('plex://')) out.push(guid.toLowerCase());
  if (item?.type === 'episode') {
    out.push(episodeKey(item));
    return out;
  }
  out.push(titleKey(item));
  return out;
}

/** One stable key, for caching and for saying "this film" in a log line. */
export function identity(item: PlexItem | null | undefined): string {
  return identities(item)[0] ?? '';
}
