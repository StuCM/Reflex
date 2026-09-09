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
  const API = 'https://api.themoviedb.org/3';
  const REGION = 'GB';

  /* JustWatch provider ids as TMDB exposes them. */
  const PROVIDERS = [
    { id: 8,   name: 'Netflix' },
    { id: 9,   name: 'Prime Video' },
    { id: 337, name: 'Disney+' }
  ];

  /* The rubbish filter. Junk has almost no votes, so a floor removes most of it
     without any taste modelling at all. */
  const MIN_VOTES = 500;

  function enabled() { return !!KEY; }

  function qs(params) {
    const keys = Object.keys(params);
    const parts = [];
    let v;
    for (let i = 0; i < keys.length; i++) {
      v = params[keys[i]];
      if (v === null || v === undefined) continue;
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(v));
    }
    return parts.join('&');
  }

  function get(path, params) {
    params = params || {};
    params.api_key = KEY;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', API + path + '?' + qs(params), true);
      xhr.timeout = 15000;
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`TMDB ${path} -> ${xhr.status}`));
          return;
        }
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('TMDB bad json')); }
      };
      xhr.ontimeout = () => { reject(new Error('TMDB timeout')); };
      xhr.onerror = () => { reject(new Error('TMDB network')); };
      xhr.send(null);
    });
  }

  function goodEnough(m) {
    return m && m.id && (m.vote_count || 0) >= MIN_VOTES;
  }

  function ids(results) {
    const out = [];
    for (let i = 0; i < (results || []).length; i++) {
      if (goodEnough(results[i])) out.push(String(results[i].id));
    }
    return out;
  }

  function trending() {
    return get('/trending/movie/week').then(r => ids(r.results));
  }

  /* What's on a streaming service right now, in this region. */
  function onProvider(providerId) {
    return get('/discover/movie', {
      with_watch_providers: providerId,
      watch_region: REGION,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES
    }).then(r => ids(r.results));
  }

  /* Content-based recommendations: ask TMDB what resembles each thing recently
     watched, then count how often each suggestion comes up. No model, no
     training — frequency across several seeds is enough to be useful. */
  function recommendedFrom(seedTmdbIds) {
    const seeds = (seedTmdbIds || []).slice(0, 8);
    if (!seeds.length) return Promise.resolve([]);
    const score = {};
    return serial(seeds, id => {
      return get(`/movie/${id}/recommendations`).then(r => {
        const list = r.results || [];
        let m;
        for (let i = 0; i < list.length; i++) {
          m = list[i];
          if (!goodEnough(m)) continue;
          if (seeds.indexOf(String(m.id)) >= 0) continue;      // don't suggest the seed
          score[m.id] = (score[m.id] || 0) + 1;
        }
      }, () => { /* one bad seed shouldn't sink the row */ });
    }).then(() => {
      return Object.keys(score).sort((a, b) => score[b] - score[a]);
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
    providers: PROVIDERS,
    trending: trending,
    onProvider: onProvider,
    recommendedFrom: recommendedFrom
  };
})();
