/* TMDB client. Chromium 53.

   Deliberately external-first: fetch a small curated list from TMDB (one
   request, ~20 titles), then ask Plex which of them it has, by TMDB id. The
   opposite direction — indexing 30k library items against TMDB — would need a
   full crawl of a server we don't own, and a backend to run it on.

   Needs a free TMDB v3 API key. Without one the discovery rows simply don't
   appear; nothing else is affected. */
var Tmdb = (function () {
  'use strict';

  const KEY = Config.tmdbKey;                      // see js/config.js
  const API = Config.tmdbBase;                     // see js/config.js
  const REGION = 'GB';

  /* The rubbish filter. Junk has almost no votes, so a floor removes most of it
     without any taste modelling at all. */
  const MIN_VOTES = 500;

  function enabled() { return !!KEY; }

  function qs(params) {
    let keys = Object.keys(params), parts = [], i, v;
    for (i = 0; i < keys.length; i++) {
      v = params[keys[i]];
      if (v === null || v === undefined) continue;
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(v));
    }
    return parts.join('&');
  }

  function get(path, params) {
    params = params || {};
    params.api_key = KEY;
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', API + path + '?' + qs(params), true);
      xhr.timeout = 15000;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error('TMDB ' + path + ' -> ' + xhr.status));
          return;
        }
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('TMDB bad json')); }
      };
      xhr.ontimeout = function () { reject(new Error('TMDB timeout')); };
      xhr.onerror = function () { reject(new Error('TMDB network')); };
      xhr.send(null);
    });
  }

  function goodEnough(m) {
    return m && m.id && (m.vote_count || 0) >= MIN_VOTES;
  }

  /* Enough to draw a tile with and nothing more: the rest of a TMDB result is
     never shown, and a discovery row holds a dozen of these per category. */
  function film(m) {
    return { id: String(m.id), title: m.title || '',
             year: Number(String(m.release_date || '').slice(0, 4)) || null,
             poster_path: m.poster_path || null,
             backdrop_path: m.backdrop_path || null,
             vote_average: m.vote_average || 0 };
  }

  function films(results) {
    let out = [], i;
    for (i = 0; i < (results || []).length; i++) {
      if (goodEnough(results[i])) out.push(film(results[i]));
    }
    return out;
  }

  function trending() {
    return get('/trending/movie/week').then(function (r) { return films(r.results); });
  }

  /* What's on a streaming service right now, in this region. */
  function onProvider(providerId) {
    return get('/discover/movie', {
      with_watch_providers: providerId,
      watch_region: REGION,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES
    }).then(function (r) { return films(r.results); });
  }

  /* One genre, most popular first. Ids come from /genre/movie/list. */
  function byGenre(genreId) {
    return get('/discover/movie', {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES
    }).then(function (r) { return films(r.results); });
  }

  /* Content-based recommendations: ask TMDB what resembles each thing recently
     watched, then count how often each suggestion comes up. No model, no
     training — frequency across several seeds is enough to be useful. */
  function recommendedFrom(seedTmdbIds) {
    const seeds = (seedTmdbIds || []).slice(0, 8);
    if (!seeds.length) return Promise.resolve([]);
    const score = {}, seen = {};
    return serial(seeds, function (id) {
      return get('/movie/' + id + '/recommendations').then(function (r) {
        let list = films(r.results), i, m;
        for (i = 0; i < list.length; i++) {
          m = list[i];
          if (seeds.indexOf(m.id) >= 0) continue;              // don't suggest the seed
          seen[m.id] = m;
          score[m.id] = (score[m.id] || 0) + 1;
        }
      }, function () { /* one bad seed shouldn't sink the row */ });
    }).then(function () {
      return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; })
        .map(function (id) { return seen[id]; });
    });
  }

  /* One category from Config.categories to its films. An unknown kind is a typo
     in the config rather than a crash: it gives an empty row. `seeds` are TMDB
     ids of what has been watched, and only the recommended kind uses them. */
  function catalogue(category, seeds) {
    const kind = category && category.kind;
    if (kind === 'trending') return trending();
    if (kind === 'provider') return onProvider(category.id);
    if (kind === 'genre') return byGenre(category.id);
    if (kind === 'recommended') return recommendedFrom(seeds);
    return Promise.resolve([]);
  }

  /* Everything js/art.js keeps about a film in one request: the backdrops, the
     overview, the run time and the billing order. `include_image_language`
     matters — without it the appended images are filtered to the request
     language and most backdrops disappear. */
  function details(tmdbId) {
    return get('/movie/' + tmdbId, {
      append_to_response: 'images,credits',
      include_image_language: 'en,null'
    });
  }

  /* One at a time, on purpose — this is a courtesy API and the rows are small. */
  function serial(list, fn) {
    let i = 0;
    function step() {
      if (i >= list.length) return Promise.resolve();
      return fn(list[i++]).then(step);
    }
    return step();
  }

  return {
    enabled: enabled,
    trending: trending,
    onProvider: onProvider,
    byGenre: byGenre,
    recommendedFrom: recommendedFrom,
    catalogue: catalogue,
    details: details
  };
})();
