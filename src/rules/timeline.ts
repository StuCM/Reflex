/* Where you are in the film: the intro and credits Plex found, and the
 * chapters the trackbar draws its ticks from.
 *
 * Plex analyses a film and reports both as offsets in milliseconds. "Skip
 * intro" is not detection — there is nothing to work out client side, only
 * something to offer at the right moment.
 */

/** The marker the playhead is inside, or null. */
export function markerAt(item: PlexItem | null | undefined, seconds: number): PlexMarker | null {
  const at = seconds * 1000;
  const found = (item?.Marker ?? []).find(
    (marker) => at >= (marker.startTimeOffset ?? 0) && at < (marker.endTimeOffset ?? 0),
  );
  return found ?? null;
}

export function markerLabel(marker: PlexMarker | null | undefined): string {
  const type = String(marker?.type ?? '').toLowerCase();
  if (type === 'intro') return 'Skip intro';
  if (type === 'credits') return 'Skip credits';
  if (type === 'commercial') return 'Skip ad break';
  return 'Skip';
}

/* In seconds and in order. `thumb` is null far more often than not — Plex only
   carries one where it indexed the file. */
export function chapters(item: PlexItem | null | undefined): Chapter[] {
  return (item?.Chapter ?? [])
    .map((chapter, position) => ({
      title: chapter.tag ?? chapter.title ?? `Chapter ${chapter.index ?? position + 1}`,
      start: (chapter.startTimeOffset ?? 0) / 1000,
      end: (chapter.endTimeOffset ?? 0) / 1000,
      thumb: chapter.thumb ?? null,
    }))
    .sort((one, two) => one.start - two.start);
}
