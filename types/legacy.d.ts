/* The globals still published by js/ while the migration runs.
 *
 * Every entry here is a module that has not moved to src/ yet. Each one is
 * deleted the moment its file does — an empty file means the bridge is gone.
 * See docs/refactor-plan.md.
 */

interface PanelGlobal {
  supports(kind: 'video' | 'audio' | 'container', name: string | undefined): boolean;
  clientProfile(): string;
}

declare const Panel: PanelGlobal;

/** js/core/config.js — settings that differ between the TV and a laptop. */
interface ConfigGlobal {
  plexTvBase: string;
  tmdbKey: string;
  tmdbBase: string;
  tmdbImageBase: string;
  youtubeKey: string;
  youtubeBase: string;
  youtubeEmbedBase: string;
  beacon: string;
  categories: DiscoveryCategory[];
  recapChannel: string;
}

declare const Config: ConfigGlobal;

/** js/data/merge.js — the walk behind a merge row. */
interface MergeGlobal {
  stream(parts: MergePart[], fetch: MergeFetch): MergeState;
  items(state: MergeState): PlexItem[];
}

declare const Merge: MergeGlobal;

/** js/data/servers.js — which servers we can reach, and which one an item came from. */
interface ServersGlobal {
  load(): void;
  all(): PlexServer[];
  set(list: PlexServer[]): void;
  forget(): void;
  stamp<T>(items: T[], server: PlexServer): T[];
  of(item: unknown): PlexServer | null;
  count(): number;
}

declare const Servers: ServersGlobal;

/** js/core/ui.js — the debug line, toasts, and which view is showing. */
interface UiGlobal {
  debug(message: string): void;
}

declare const UI: UiGlobal;

/** js/data/cache.js — every key the IndexedDB cache holds. */
interface CachedFamily<T> {
  get(id: string): Promise<T | undefined>;
  put(id: string, value: T): Promise<unknown>;
  drop?(id: string): Promise<unknown>;
}

interface CacheGlobal {
  ytChannel: CachedFamily<string>;
}

declare const Cached: CacheGlobal;
