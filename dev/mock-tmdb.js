/* A fake TMDB, so artwork and the discovery rows can be exercised without a
   request ever leaving the machine. Runs on Node only.

     /__tmdb/...      stands in for https://api.themoviedb.org/3  (Config.tmdbBase)
     /__tmdbimg/...   stands in for https://image.tmdb.org/t/p/   (Config.tmdbImageBase)

   The ids it deals in are the generated library's own, so "trending" is a
   handful of films the mock servers really hold and every title lookup the
   app makes answers for a title on screen. */
'use strict';

/* Every fifth film is sparse: one backdrop and no posters at all, so the "TMDB
   has nothing for the tile, fall back to Plex" path is covered. Continue
   watching takes every eightieth film, so nothing in it is sparse — the smoke
   test compares the hero against the tile there, and that only means anything
   while both come from TMDB. */
function oneBackdrop(index) { return index % 5 === 4; }

/* And every seventh has no credits block at all, so the "no cast line rather
   than an empty label" path is walked by something. */
function noCredits(index) { return index % 7 === 3; }

/* A row's worth. Small on purpose: each id costs the app a guid lookup per
   server, and forty of them make the smoke test crawl for no more coverage. */
const ROW = 12;

function create(opts) {
  const films = opts.films || [];
  const lonely = {};
  const creditless = {};
  films.forEach(function (f, i) {
    if (oneBackdrop(i)) lonely[String(f.tmdb)] = true;
    if (noCredits(i)) creditless[String(f.tmdb)] = true;
  });

  function json(res, body) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  }

  /* A deterministic slice of the library, so each row is a different set and
     the same request always answers the same way. */
  function results(offset) {
    const out = [];
    for (let i = 0; i < ROW && i < films.length; i++) {
      const f = films[(offset + i * 3) % films.length];
      out.push({ id: f.tmdb, title: f.title, release_date: f.year + '-01-01',
                 poster_path: '/poster/' + f.tmdb + '/0.svg',
                 backdrop_path: '/backdrop/' + f.tmdb + '/0.svg',
                 vote_count: 900, vote_average: 7.5 });
    }
    return { results: out };
  }

  /* A genre row is titles the fake servers deliberately do NOT hold — the
     library's own ids are 1000-ish and these are nowhere near them — so the
     not-in-your-library path is walked rather than assumed. */
  function unheld(genreId) {
    const out = [];
    for (let i = 0; i < ROW; i++) {
      const id = 900000 + Number(genreId) * 100 + i;
      out.push({ id: id, title: 'Genre ' + genreId + ' Film ' + (i + 1),
                 release_date: '2019-01-01',
                 poster_path: '/poster/' + id + '/0.svg',
                 backdrop_path: '/backdrop/' + id + '/0.svg',
                 vote_count: 900, vote_average: 7.5 });
    }
    return { results: out };
  }

  /* Descending, so the pick is the payload's own order only by accident —
     js/art.js sorts, and the test for that has to have something to sort. */
  function shots(kind, id, n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      out.push({
        file_path: '/' + kind + '/' + id + '/' + k + '.svg',
        vote_average: 8 - k,
        vote_count: 400 - k * 10
      });
    }
    return out;
  }

  function imagesFor(id) {
    const n = lonely[id] ? 1 : 2 + (Number(id) % 3);
    return {
      id: Number(id),
      backdrops: shots('backdrop', id, n),
      /* A sparse title has none, so the tile has to fall back to Plex. */
      posters: lonely[id] ? [] : shots('poster', id, n),
      logos: []
    };
  }

  /* One request now carries the pictures, the description and the billing —
     append_to_response, as the real API does it. The overview names TMDB so a
     test can tell it apart from the Plex mock's summary, and so can an eye. */
  function detailsFor(id) {
    const body = {
      id: Number(id),
      overview: 'TMDB overview for ' + id + '. What this one is actually about, ' +
                'in the words of a database rather than a file name.',
      runtime: 90 + (Number(id) % 60),
      images: imagesFor(id)
    };
    if (!creditless[id]) body.credits = { cast: castFor(id) };
    return body;
  }

  /* In billing order, so taking the first four is taking the top of the bill. */
  function castFor(id) {
    const out = [];
    for (let k = 0; k < 5; k++) {
      out.push({ order: k, name: 'Actor ' + id + '-' + k, character: 'Someone ' + k });
    }
    return out;
  }

  function api(res, p, query) {
    let m = p.match(/^\/movie\/(\d+)\/recommendations$/);
    if (m) { json(res, results(Number(m[1]) % Math.max(1, films.length))); return true; }
    m = p.match(/^\/movie\/(\d+)$/);
    if (m) { json(res, detailsFor(m[1])); return true; }
    if (p === '/trending/movie/week') { json(res, results(0)); return true; }
    if (p === '/discover/movie') {
      if (query.with_genres) { json(res, unheld(query.with_genres)); return true; }
      json(res, results(Number(query.with_watch_providers || 0)));
      return true;
    }
    return false;
  }

  /* One flat gradient with a corner bar and its own caption, so a TMDB picture
     is obvious next to the Plex mock's in a screenshot — and so a poster and a
     backdrop of the same title can be told apart at a glance, by shape as well
     as by caption. */
  function image(res, p) {
    const m = p.match(/^\/(\w+)\/(backdrop|poster)\/(\d+)\/(\d+)\.svg$/);
    if (!m) return false;
    const size = m[1], kind = m[2], id = m[3], k = Number(m[4]);
    const hue = (Number(id) * 13 + k * 60 + (kind === 'poster' ? 180 : 0)) % 360;
    const w = kind === 'poster' ? 200 : 320, h = kind === 'poster' ? 300 : 180;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<rect width="' + w + '" height="' + h + '" fill="hsl(' + hue + ',44%,' +
      (18 + k * 8) + '%)"/>' +
      '<rect x="0" y="0" width="' + w + '" height="10" fill="hsl(' + hue + ',70%,60%)"/>' +
      '<text x="16" y="' + (h * 0.57) + '" font-family="Helvetica,Arial" font-size="26" ' +
      'fill="rgba(255,255,255,0.85)">TMDB ' + id + ' #' + k + '</text>' +
      '<text x="16" y="' + (h * 0.74) + '" font-family="Helvetica,Arial" font-size="18" ' +
      'fill="rgba(255,255,255,0.5)">' + kind + ' ' + size + '</text></svg>');
    return true;
  }

  return {
    /* Returns true if it answered. /__tmdbimg first: it also starts with /__tmdb. */
    handle: function (req, res, pathname, query) {
      if (pathname.indexOf('/__tmdbimg') === 0) {
        return image(res, pathname.slice('/__tmdbimg'.length));
      }
      if (pathname.indexOf('/__tmdb') === 0) {
        return api(res, pathname.slice('/__tmdb'.length), query || {});
      }
      return false;
    }
  };
}

module.exports = { create: create, oneBackdrop: oneBackdrop, noCredits: noCredits };
