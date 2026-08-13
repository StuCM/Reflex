/* Full metadata for the focused item, cached.

   The masthead has to show which audio track we would pick *before* the user
   presses OK, and that only comes from /library/metadata — the list endpoints
   carry no streams. So every focused item needs a fetch, which makes this the
   one place in the app that could hammer a server we do not own. Hence: a
   debounce on the focus, an IndexedDB layer under the memory cache, and a cap
   on what is held in RAM. */
var Meta = (function () {
  'use strict';

  var CAP = 500;                 // focused-item metadata kept in RAM
  var HOLD = 280;                // ms of stillness before asking the server

  var cache = {}, count = 0, timer = null;

  function get(ratingKey) { return cache[ratingKey] || null; }

  function remember(ratingKey, md) {
    /* ponytail: crude cap, drop the lot when it fills. A 30k library browsed
       hard would otherwise grow this without bound. LRU if it ever matters. */
    if (count > CAP) { cache = {}; count = 0; }
    cache[ratingKey] = md;
    count++;
  }

  function load(ratingKey) {
    if (cache[ratingKey]) return Promise.resolve(cache[ratingKey]);
    return Store.get('meta:' + ratingKey).then(function (cached) {
      if (cached) return cached;
      return Plex.metadata(ratingKey).then(function (md) {
        if (md) Store.put('meta:' + ratingKey, md);
        return md;
      });
    }).then(function (md) {
      if (md) remember(ratingKey, md);
      return md;
    }).catch(function (e) {
      UI.debug('meta: ' + e.message);
      return null;
    });
  }

  /* Fetch for whatever is focused now, once the user stops moving. onLoaded is
     called with the ratingKey so the caller can check it is still the focused
     one before repainting. */
  function schedule(item, onLoaded) {
    clearTimeout(timer);
    if (!item) return;
    /* Already held: the caller drew the badge from the cache a moment ago, so
       there is nothing to fetch and nothing to repaint. */
    if (cache[item.ratingKey]) return;
    var key = item.ratingKey;
    timer = setTimeout(function () {
      load(key).then(function (md) { if (md) onLoaded(key, md); });
    }, HOLD);
  }

  return { get: get, load: load, schedule: schedule };
})();
