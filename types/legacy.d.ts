/* The globals still published by js/ while the migration runs.
 *
 * Every entry here is a module that has not moved to src/ yet. Each one is
 * deleted the moment its file does — an empty file means the bridge is gone.
 * See docs/refactor-plan.md.
 */

interface PanelGlobal {
  supports(kind: 'video' | 'audio' | 'container', name: string | undefined): boolean;
}

declare const Panel: PanelGlobal;

/** js/data/merge.js — the walk behind a merge row. */
interface MergeGlobal {
  stream(parts: MergePart[], fetch: MergeFetch): MergeState;
  items(state: MergeState): PlexItem[];
}

declare const Merge: MergeGlobal;
