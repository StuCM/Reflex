/* The row model. A 'list' row holds its items; a 'merge' row is virtual over
   the servers' own totals and walks them as you scroll. */

import * as merge from '../data/merge';

/** Items held outright. */
export function list(title: string, items: PlexItem[]): ListRow {
  return { kind: 'list', title, items, total: items.length, focus: 0 };
}

/* A TMDB list asked for a page at a time; `next` is the page to ask for. */
export function paged(title: string, items: PlexItem[], next: number, pages: number): PagedRow {
  return {
    kind: 'paged',
    title,
    items,
    total: items.length,
    focus: 0,
    next,
    pages,
    asking: false,
  };
}

/* parts: one per server section. fetch(part, offset) resolves { items, total }. */
export function merged(title: string, parts: MergePart[], fetch: MergeFetch): MergeRow {
  return {
    kind: 'merge',
    title: title || 'All films',
    focus: 0,
    total: 0,
    parts,
    state: merge.stream(parts, fetch),
  };
}

/* Null is "not walked to yet" — the tile draws a placeholder, not a gap. */
export function itemAt(row: Row | null | undefined, index: number): PlexItem | null {
  if (!row || index < 0 || index >= row.total) return null;
  if (row.kind === 'list' || row.kind === 'paged') return row.items[index] ?? null;
  return merge.items(row.state)[index] ?? null;
}

/* A screenful, plus enough that holding a key does not outrun the walk. */
export const LOOKAHEAD = 24;

/** Items per request against a server section. */
export const PAGE = 100;

export function needsUpTo(row: Row): number {
  return row.focus + LOOKAHEAD;
}

export function haveUpTo(row: Row): number {
  return row.kind === 'merge' ? merge.items(row.state).length : row.total;
}

/** Should the screen ask for this row's next page? */
export function wantsMore(row: Row): row is PagedRow {
  return (
    row.kind === 'paged' && !row.asking && row.next <= row.pages && haveUpTo(row) <= needsUpTo(row)
  );
}

/* TMDB's popularity order shifts between requests, so a later page can repeat
   an earlier title. */
export function extend(row: PagedRow, items: PlexItem[]): void {
  const have: Record<string, boolean> = {};
  row.items.forEach((item) => {
    have[(item as DiscoveryEntry)._tmdb.id] = true;
  });
  items.forEach((item) => {
    const id = (item as DiscoveryEntry)._tmdb.id;
    if (have[id]) return;
    have[id] = true;
    row.items.push(item);
  });
  row.next += 1;
  row.total = row.items.length;
}
