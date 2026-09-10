/* Everything the app caches, in one list.

   js/store.js is a key/value store and knows nothing about what it holds.
   Before this, seven files built their own key strings, three invented their
   own way of stamping an entry with a time, and Continue watching was dropped
   by writing null into a row — a convention nothing else knew about. What is
   cached, under what key, and how long a hit is good for is one question, so
   it is answered here.

   Three ways a thing can go stale, and they are different enough to name:
   `kept` until something replaces it, `daily` on a clock, and `misses` — a hit
   kept for ever while a miss is retried after a while, which is what a lookup
   against a library that may yet gain the film needs. */
var Cache = (function () {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;

  /* Cached until it is replaced. drop() writes null rather than deleting:
     Store is get and put, and a null reads back as a miss. */
  function kept(prefix) {
    return {
      get: (id) => Store.get(prefix + (id === undefined ? '' : id)),
      put: (id, value) => Store.put(prefix + (id === undefined ? '' : id), value),
      drop: (id) => Store.put(prefix + (id === undefined ? '' : id), null),
    };
  }

  /* A single value rather than a family of them. */
  function one(key) {
    return {
      get: () => Store.get(key),
      put: (value) => Store.put(key, value),
    };
  }

  /* Cached for maxAge, hit or miss. */
  function daily(prefix, maxAge) {
    return {
      get: (id) =>
        Store.get(prefix + id).then((hit) =>
          hit && Date.now() - hit.at < maxAge ? hit.value : undefined,
        ),
      put: (id, value) => Store.put(prefix + id, { at: Date.now(), value: value }),
    };
  }

  /* A hit is kept; a miss is asked again after maxAge. Returns undefined for
     "never asked", null for "asked, and there is none". */
  function misses(prefix, maxAge) {
    return {
      get: (id) =>
        Store.get(prefix + id).then((hit) => {
          if (!hit) return undefined;
          if (hit.value) return hit.value;
          return Date.now() - hit.at < maxAge ? null : undefined;
        }),
      put: (id, value) => Store.put(prefix + id, { at: Date.now(), value: value }),
    };
  }

  return {
    sections: one('sections'), // the servers' library lists
    rows: kept('rows:'), // a section's built rows, by section title
    total: kept('total:'), // a library part's length, by server:key:tag
    art: kept('art:'), // TMDB art and facts, by TMDB id
    meta: kept('meta:'), // full metadata, by server:ratingKey
    recaps: kept('recaps:'), // YouTube recaps for a show, by identity
    ytChannel: kept('youtube:channel:'), // the recap channel's id, by handle
    /* A film can be added to a library but is rarely taken out, so a hit
       stands and only a miss is ever asked again. */
    lookup: misses('tmdb:', 7 * DAY), // do the servers hold this TMDB title
    catalogue: daily('disc:', DAY), // a discovery category's films
  };
})();

/* Bridge, deleted with this file when it becomes a module. index.html now
   loads one entry, so a top-level `var` here is module-scoped rather than
   global — and every other file still reaches this one by bare name. */
window.Cache = Cache;
