/* The row model. A 'list' row holds its items; a 'merge' row is virtual over
   the servers' own totals and walks them as you scroll. */

/** Items held outright. */
export function list(title: string, items: PlexItem[]): ListRow {
  return { kind: 'list', title, items, total: items.length, focus: 0 };
}

/* parts: one per server section. fetch(part, offset) resolves { items, total }. */
export function merged(title: string, parts: MergePart[], fetch: MergeFetch): MergeRow {
  return {
    kind: 'merge',
    title: title || 'All films',
    focus: 0,
    total: 0,
    parts,
    state: Merge.stream(parts, fetch),
  };
}

/* Null is "not walked to yet" — the tile draws a placeholder, not a gap. */
export function itemAt(row: Row | null | undefined, index: number): PlexItem | null {
  if (!row || index < 0 || index >= row.total) return null;
  if (row.kind === 'list') return row.items[index] ?? null;
  return Merge.items(row.state)[index] ?? null;
}

/* A screenful, plus enough that holding a key does not outrun the walk. */
export const LOOKAHEAD = 24;

/** Items per request against a server section. */
export const PAGE = 100;

export function needsUpTo(row: Row): number {
  return row.focus + LOOKAHEAD;
}

export function haveUpTo(row: Row): number {
  return row.kind === 'merge' ? Merge.items(row.state).length : row.total;
}
