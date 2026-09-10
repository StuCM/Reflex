/* Everything the app caches, in one list.
   store.ts knows nothing about what it holds. Three ways a thing goes stale,
   different enough to name: `kept` until replaced, `daily` on a clock, and
   `misses` — a hit kept for ever while a miss is retried. */
import { get, put } from './store';

const DAY = 24 * 60 * 60 * 1000;

interface Stamped<T> {
  at: number;
  value: T;
}

/* drop() writes null rather than deleting: Store is get and put, and a null
   reads back as a miss. */
function kept<T>(prefix: string) {
  const at = (id?: string) => prefix + (id ?? '');
  return {
    get: (id?: string) => get<T>(at(id)),
    put: (id: string | undefined, value: T) => put(at(id), value),
    drop: (id?: string) => put(at(id), null),
  };
}

/** A single value rather than a family of them. */
function one<T>(key: string) {
  return {
    get: () => get<T>(key),
    put: (value: T) => put(key, value),
  };
}

/** Cached for maxAge, hit or miss. */
function daily<T>(prefix: string, maxAge: number) {
  return {
    get: (id: string) =>
      get<Stamped<T>>(prefix + id).then((hit) =>
        hit && Date.now() - hit.at < maxAge ? hit.value : undefined,
      ),
    put: (id: string, value: T) => put(prefix + id, { at: Date.now(), value }),
  };
}

/* A hit is kept; a miss is asked again after maxAge. Returns undefined for
   "never asked", null for "asked, and there is none". */
function misses<T>(prefix: string, maxAge: number) {
  return {
    get: (id: string) =>
      get<Stamped<T | null>>(prefix + id).then((hit) => {
        if (!hit) return undefined;
        if (hit.value) return hit.value;
        return Date.now() - hit.at < maxAge ? null : undefined;
      }),
    put: (id: string, value: T | null) => put(prefix + id, { at: Date.now(), value }),
  };
}

export const sections = one<CachedSections[]>('sections');
export const rows = kept<{ rows: unknown[] } | null>('rows:');
export const total = kept<{ updatedAt?: number; total: number }>('total:');
export const art = kept<unknown>('art:');
export const meta = kept<PlexItem>('meta:');
export const recaps = kept<Recap[]>('recaps:');
export const ytChannel = kept<string>('youtube:channel:');

/* A film can be added to a library but is rarely taken out, so a hit stands
   and only a miss is ever asked again. */
export const lookup = misses<PlexItem>('tmdb:', 7 * DAY);
export const catalogue = daily<TmdbFilm[]>('disc:', DAY);
