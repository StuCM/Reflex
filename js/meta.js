/* Full metadata for a copy of a film, cached.

   The masthead has to show which audio track we would pick *before* the user
   presses OK, and that only comes from /library/metadata — the list endpoints
   carry no streams. So every focused item needs a fetch, which makes this the
   one place in the app that could hammer servers we do not own. Hence: a
   debounce on the focus, an IndexedDB layer under the memory cache, and a cap
   on what is held in RAM.

   Keys are per server: the same film on two servers has two rating keys, two
   metadata payloads, and — the whole point — two different sets of streams. */
var Meta = (function () {
  'use strict';

  var CAP = 500;                 // metadata payloads kept in RAM
  var HOLD = 280;                // ms of stillness before asking a server

  var cache = {}, count = 0, timer = null;

  function keyOf(item) {
    return (item && item._server ? item._server : '?') + ':' + (item && item.ratingKey);
  }

  function get(item) { return cache[keyOf(item)] || null; }

  function remember(key, md) {
    /* ponytail: crude cap, drop the lot when it fills. A 30k library browsed
       hard would otherwise grow this without bound. LRU if it ever matters. */
    if (count > CAP) { cache = {}; count = 0; }
    cache[key] = md;
    count++;
  }

  function load(item) {
    if (!item || !item.ratingKey) return Promise.resolve(null);
    var key = keyOf(item);
    if (cache[key]) return Promise.resolve(cache[key]);
    var server = Servers.of(item);
    if (!server) return Promise.resolve(null);

    return Store.get('meta:' + key).then(function (cached) {
      if (cached) return cached;
      return Plex.metadata(server, item.ratingKey).then(function (md) {
        if (md) Store.put('meta:' + key, md);
        return md;
      });
    }).then(function (md) {
      if (md) {
        md._server = item._server;          // survives the round trip through Store
        remember(key, md);
      }
      return md;
    }).catch(function (e) {
      UI.debug('meta: ' + e.message);
      return null;
    });
  }

  /* Fetch for whatever is focused now, once the user stops moving. onLoaded is
     called with the rating key so the caller can check it is still the focused
     one before repainting. */
  function schedule(item, onLoaded) {
    clearTimeout(timer);
    if (!item) return;
    /* Already held: the caller drew the badge from the cache a moment ago, so
       there is nothing to fetch and nothing to repaint. */
    if (cache[keyOf(item)]) return;
    var ratingKey = item.ratingKey;
    timer = setTimeout(function () {
      load(item).then(function (md) { if (md) onLoaded(ratingKey, md); });
    }, HOLD);
  }

  return { get: get, load: load, schedule: schedule };
})();
