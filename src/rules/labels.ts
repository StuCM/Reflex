/* What a tile and the hero above it are called.
 *
 * An episode is named by its show: its own title says nothing on its own, and a
 * rail of them all read as unrelated films.
 */

/** "Adventure Time · S2E7" — an episode's title alone says nothing. */
export function episodeLabel(item: PlexItem | null | undefined): string {
  if (item?.type !== 'episode') return '';
  const season = item.parentIndex;
  const number = item.index;
  if (season === undefined && number === undefined) return item.grandparentTitle ?? '';
  const numbered = number === undefined ? '?' : number < 10 ? `0${number}` : String(number);
  return `${item.grandparentTitle ?? ''}  ·  S${season === undefined ? '?' : season}E${numbered}`;
}

export function railTitle(item: PlexItem | null | undefined): string {
  if (!item) return '';
  if (item.type === 'episode') return item.grandparentTitle ?? item.title ?? '';
  return item.title ?? '';
}

/* The line under it: where you are in a show, how long a film runs, how much of
   a series there is. Never more than one fact — this is a rail, not a detail
   page. */
export function railSub(item: PlexItem | null | undefined): string {
  if (!item) return '';

  if (item.type === 'episode') {
    const season = item.parentIndex;
    const number = item.index;
    let at = season === undefined ? '' : `S${season}`;
    if (number !== undefined) at += `${at ? ' ' : ''}E${number}`;
    if (!at) return item.title ?? '';
    return item.title ? `${at}  ·  ${item.title}` : at;
  }

  if (item.type === 'show') {
    if (item.childCount) return `${item.childCount} series`;
    return item.year ? String(item.year) : '';
  }

  return item.duration ? `${Math.round(item.duration / 60000)} min` : '';
}
