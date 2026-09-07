/* Which picture goes where. Chromium 53.

   Plex carries two images per item — `art` (wide) and `thumb` (a poster, or an
   episode still) — and both the tile and the hero reach for `art` first, so the
   hero ends up a blown-up copy of the tile. TMDB holds many backdrops per title,
   which is the second picture this needs.

   The same request carries the overview, the run time and the billing order, so
   the header's description and key actors cost nothing beyond the backdrops.

   Nothing here ever waits: tile(), hero() and factsFor() answer synchronously
   from cache or fall back to what Plex has, and warm() tells its listeners when
   a title's payload lands so the tile, the backdrop and the header can be
   repainted. One lookup per title actually on screen, cached both ways — never
   a crawl. */
var Art = (function () {
  'use strict';

  var TILE_SIZE = 'w500', HERO_SIZE = 'w1280';
  var MAX_IN_FLIGHT = 4;
  var CAST = 4;          // names in the header's key actors line

  var cache = {};        // tmdbId -> { hero: path|null, tile: path|null, facts: {} }
  var pending = {};      // tmdbId -> true while a lookup is queued or running
  var queue = [];
  var active = 0;
  var listeners = [];

  /* The best backdrop for the hero and the next best for the tile, so the two
     surfaces never show the same picture. Pure, and never throws: a payload
     with nothing usable in it gives two nulls. */
  function pick(payload) {
    /* The backdrops used to be the whole payload and are now appended to it,
       so both shapes are read — the old cache entries are still the old one. */
    var images = (payload && payload.images) || payload || {};
    var list = images.backdrops || [], usable = [], i;
    if (!Array.isArray(list)) list = [];
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].file_path) usable.push(list[i]);
    }
    usable.sort(function (a, b) {
      var byScore = (b.vote_average || 0) - (a.vote_average || 0);
      return byScore || (b.vote_count || 0) - (a.vote_count || 0);
    });
    return {
      hero: usable.length ? usable[0].file_path : null,
      tile: usable.length > 1 ? usable[1].file_path : null
    };
  }

  /* What the header says about a title, out of the same payload the backdrops
     came from. Pure, and never throws: anything missing gives empty. */
  function facts(payload) {
    var credits = (payload && payload.credits) || {};
    var billing = Array.isArray(credits.cast) ? credits.cast : [];
    var cast = [], i;
    for (i = 0; i < billing.length && cast.length < CAST; i++) {
      if (billing[i] && billing[i].name) cast.push(billing[i].name);
    }
    return {
      overview: (payload && typeof payload.overview === 'string') ? payload.overview : '',
      runtime: (payload && typeof payload.runtime === 'number') ? payload.runtime : null,
      cast: cast
    };
  }

  function url(path, size) { return Config.tmdbImageBase + size + path; }

  /* An episode's own still is the picture already, so it is never looked up. */
  function idOf(item) {
    if (!item || item.type === 'episode') return null;
    return Plex.tmdbId(item);
  }

  function picked(item) {
    var id = idOf(item);
    return id ? (cache[id] || null) : null;
  }

  /* The tile picture: an episode's still, else TMDB's second backdrop, else
     whatever Plex has — plenty of a library has no art at all. */
  function tile(item, w, h) {
    if (!item) return '';
    if (item.type === 'episode') return Plex.posterUrl(item, w, h);
    var got = picked(item);
    if (got && got.tile) return url(got.tile, TILE_SIZE);
    return Plex.artUrl(item, w, h) || Plex.posterUrl(item, w, h);
  }

  /* The backdrop: TMDB's best, else the same Plex fallback the masthead used. */
  function hero(item) {
    var got = picked(item);
    if (got && got.hero) return url(got.hero, HERO_SIZE);
    return Plex.artUrl(item, 1920, 1080) || Plex.posterUrl(item, 1920, 1080);
  }

  /* The description, run time and key actors for a title, or null if TMDB has
     not answered for it yet. Synchronous, like tile() and hero(). */
  function factsFor(item) {
    var got = picked(item);
    return (got && got.facts) || null;
  }

  /* Look this title's backdrops up once, then tell the listeners so they can
     repaint. Cheap to call on every draw: a hit, a miss and a request already in
     flight all return without doing anything. */
  function warm(item) {
    var id = idOf(item);
    if (!id || !Tmdb.enabled() || cache[id] || pending[id]) return;
    pending[id] = true;
    queue.push(id);
    pump();
  }

  /* Whoever wants to know a title's art has landed. Called with the TMDB id. */
  function onReady(fn) { listeners.push(fn); }

  function pump() {
    while (active < MAX_IN_FLIGHT && queue.length) {
      active++;
      fetchOne(queue.shift());
    }
  }

  function fetchOne(id) {
    Store.get('art:' + id).then(function (hit) {
      /* An entry cached before the facts existed is a miss for them, or an old
         cache would leave a title with no description for ever. */
      if (hit && hit.facts) return hit;
      return Tmdb.details(id).then(function (payload) {
        var got = pick(payload);
        got.facts = facts(payload);
        Store.put('art:' + id, got);
        return got;
      });
    }).then(function (got) { landed(id, got); },
            function () { landed(id, { hero: null, tile: null }); });
  }

  /* A title with no usable backdrops is cached too, or an obscure one costs a
     request every time the row is walked past. */
  function landed(id, got) {
    var i;
    active--;
    delete pending[id];
    cache[id] = got;
    pump();
    for (i = 0; i < listeners.length; i++) listeners[i](id);
  }

  return { pick: pick, facts: facts, url: url, tile: tile, hero: hero,
           factsFor: factsFor, warm: warm, onReady: onReady };
})();
