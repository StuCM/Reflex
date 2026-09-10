/* The row model, and nothing else — no DOM, no network.
 *
 * Two kinds of row:
 *   'list'   items are held outright (hubs, Continue watching, search results)
 *   'merge'  virtual over one or more server sections, merged and deduplicated
 *            as you scroll
 *
 * The merge row is what makes a 30,000 film library browsable across two
 * servers: it knows roughly how long it is without crawling anything, holds
 * only what you have walked past, and shows one entry per film with every copy
 * of it attached. See js/data/merge.js for the walk itself.
 */

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

/* Null means "position exists but has not been walked to yet" — the tile draws
   a placeholder rather than a gap. */
export function itemAt(row: Row | null | undefined, index: number): PlexItem | null {
  if (!row || index < 0 || index >= row.total) return null;
  if (row.kind === 'list') return row.items[index] ?? null;
  return Merge.items(row.state)[index] ?? null;
}

/* How far ahead of the focus to materialise: a screenful, plus enough that
   holding a direction key does not outrun the walk. */
export const LOOKAHEAD = 24;

/** Items per request against a server section. */
export const PAGE = 100;

export function needsUpTo(row: Row): number {
  return row.focus + LOOKAHEAD;
}

export function haveUpTo(row: Row): number {
  return row.kind === 'merge' ? Merge.items(row.state).length : row.total;
}
