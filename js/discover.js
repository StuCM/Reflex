/* Curated discovery. Chromium 53.

   Deliberately external-first: fetch a small curated list from TMDB (one
   request, ~20 titles), then ask Plex which of them it has, by TMDB id. The
   opposite direction — indexing 30k library items against TMDB — would need a
   full crawl of a server we don't own, and a backend to run it on.

   Needs a free TMDB v3 API key. Without one the discovery rows simply don't
   appear; nothing else is affected. */
var Discover = (function () {
  'use strict';

  var KEY = '';                                  // <-- paste a TMDB v3 API key
  var API = 'https://api.themoviedb.org/3';
  var REGION = 'GB';

  /* JustWatch provider ids as TMDB exposes them. */
  var PROVIDERS = [
    { id: 8,   name: 'Netflix' },
    { id: 9,   name: 'Prime Video' },
    { id: 337, name: 'Disney+' }
  ];

  /* The rubbish filter. Junk has almost no votes, so a floor removes most of it
     without any taste modelling at all. */
  var MIN_VOTES = 500;

  function enabled() { return !!KEY; }

  function qs(params) {
    var keys = Object.keys(params), parts = [], i, v;
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
      var xhr = new XMLHttpRequest();
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

  function ids(results) {
    var out = [], i;
    for (i = 0; i < (results || []).length; i++) {
      if (goodEnough(results[i])) out.push(String(results[i].id));
    }
    return out;
  }

  function trending() {
    return get('/trending/movie/week').then(function (r) { return ids(r.results); });
  }

  /* What's on a streaming service right now, in this region. */
  function onProvider(providerId) {
    return get('/discover/movie', {
      with_watch_providers: providerId,
      watch_region: REGION,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES
    }).then(function (r) { return ids(r.results); });
  }

  /* Content-based recommendations: ask TMDB what resembles each thing recently
     watched, then count how often each suggestion comes up. No model, no
     training — frequency across several seeds is enough to be useful. */
  function recommendedFrom(seedTmdbIds) {
    var seeds = (seedTmdbIds || []).slice(0, 8);
    if (!seeds.length) return Promise.resolve([]);
    var score = {};
    return serial(seeds, function (id) {
      return get('/movie/' + id + '/recommendations').then(function (r) {
        var list = r.results || [], i, m;
        for (i = 0; i < list.length; i++) {
          m = list[i];
          if (!goodEnough(m)) continue;
          if (seeds.indexOf(String(m.id)) >= 0) continue;      // don't suggest the seed
          score[m.id] = (score[m.id] || 0) + 1;
        }
      }, function () { /* one bad seed shouldn't sink the row */ });
    }).then(function () {
      return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
    });
  }

  /* One at a time, on purpose — this is a courtesy API and the rows are small. */
  function serial(list, fn) {
    var i = 0;
    function step() {
      if (i >= list.length) return Promise.resolve();
      return fn(list[i++]).then(step);
    }
    return step();
  }

  return {
    enabled: enabled,
    providers: PROVIDERS,
    trending: trending,
    onProvider: onProvider,
    recommendedFrom: recommendedFrom
  };
})();
