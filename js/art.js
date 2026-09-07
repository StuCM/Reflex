/* Which picture goes where. Chromium 53.

   The tile is a poster and the hero is a backdrop, so the two can never be the
   same picture — a portrait 2:3 and a landscape 16:9 are different images by
   construction rather than by a fallback ladder. TMDB carries both in one
   payload; Plex carries `thumb` (a poster, or an episode still) and `art`.

   The same request carries the overview, the run time and the billing order, so
   the header's description and key actors cost nothing beyond the backdrops.

   Nothing here ever waits: tile(), hero() and factsFor() answer synchronously
   from cache or fall back to what Plex has, and warm() tells its listeners when
   a title's payload lands so the tile, the backdrop and the header can be
   repainted. One lookup per title actually on screen, cached both ways — never
   a crawl. */
var Art = (function () {
  'use strict';

  /* The tile is 209 wide, so w342 is the next size up — w500 was for a tile
     nearly twice as wide and is now a third of a megabyte per poster wasted. */
  var POSTER_SIZE = 'w342', HERO_SIZE = 'w1280';
  var MAX_IN_FLIGHT = 4;
  var CAST = 4;          // names in the header's key actors line

  var cache = {};        // tmdbId -> { hero: path|null, poster: path|null, facts: {} }
  var pending = {};      // tmdbId -> true while a lookup is queued or running
  var queue = [];
  var active = 0;
  var listeners = [];

  /* The best-voted path out of one of TMDB's image lists, or null. */
  function bestOf(list) {
    var usable = [], i;
    if (!Array.isArray(list)) return null;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].file_path) usable.push(list[i]);
    }
    usable.sort(function (a, b) {
      var byScore = (b.vote_average || 0) - (a.vote_average || 0);
      return byScore || (b.vote_count || 0) - (a.vote_count || 0);
    });
    return usable.length ? usable[0].file_path : null;
  }

  /* The backdrop behind the header and the poster on the tile, from one
     payload. Pure, and never throws: nothing usable gives two nulls. */
  function pick(payload) {
    /* The images used to be the whole payload and are now appended to it,
       so both shapes are read — the old cache entries are still the old one. */
    var images = (payload && payload.images) || payload || {};
    return { hero: bestOf(images.backdrops), poster: bestOf(images.posters) };
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

  /* An episode has no film id of its own, and its show's poster already came
     from Plex for nothing, so it is never looked up. */
  function idOf(item) {
    if (!item || item.type === 'episode') return null;
    return Plex.tmdbId(item);
  }

  function picked(item) {
    var id = idOf(item);
    return id ? (cache[id] || null) : null;
  }

  /* The tile picture, always a poster: TMDB's, else for an episode its show's
     — Plex hands that over as `grandparentThumb`, so it costs no lookup — else
     the item's own thumb. Never a backdrop: 16:9 in a 2:3 box is a smear. */
  function tile(item, w, h) {
    if (!item) return '';
    var got = picked(item);
    if (got && got.poster) return url(got.poster, POSTER_SIZE);
    if (item.type === 'episode') {
      return Plex.photoUrl(Servers.of(item), item.grandparentThumb, w, h) ||
             Plex.posterUrl(item, w, h);
    }
    return Plex.posterUrl(item, w, h);
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

  /* Look this title's artwork up once, then tell the listeners so they can
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
      /* An entry cached before the facts or the poster existed is a miss for
         them, or an old cache would leave a title short of one for ever. */
      if (hit && hit.facts && hit.poster !== undefined) return hit;
      return Tmdb.details(id).then(function (payload) {
        var got = pick(payload);
        got.facts = facts(payload);
        Store.put('art:' + id, got);
        return got;
      });
    }).then(function (got) { landed(id, got); },
            function () { landed(id, { hero: null, poster: null }); });
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
