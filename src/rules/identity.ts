/* Is this the same film as that one, on a different server?
   Two items match on ANY shared id, not all of them: servers run different
   agent versions and expose different subsets, and requiring agreement
   everywhere would show the same film twice. */

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

/* Episodes rarely carry ids of their own and "Pilot" is not unique, so it is
   the show's identity plus season and number. */
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
