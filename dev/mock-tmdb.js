/* A fake TMDB, so artwork and the discovery rows can be exercised without a
   request ever leaving the machine. Runs on Node only.

     /__tmdb/...      stands in for https://api.themoviedb.org/3  (Config.tmdbBase)
     /__tmdbimg/...   stands in for https://image.tmdb.org/t/p/   (Config.tmdbImageBase)

   The ids it deals in are the generated library's own, so "trending" is a
   handful of films the mock servers really hold and every title lookup the
   app makes answers for a title on screen. */
'use strict';
const library = require('./library');

/* Every fifth film is sparse: one backdrop and no posters at all, so the "TMDB
   has nothing for the tile, fall back to Plex" path is covered. Continue
   watching takes every eightieth film, so nothing in it is sparse — the smoke
   test compares the hero against the tile there, and that only means anything
   while both come from TMDB. */
function oneBackdrop(index) {
  return index % 5 === 4;
}

/* And every seventh has no credits block at all, so the "no cast line rather
   than an empty label" path is walked by something. */
function noCredits(index) {
  return index % 7 === 3;
}

/* A row's worth. Small on purpose: each id costs the app a guid lookup per
   server, and forty of them make the smoke test crawl for no more coverage. */
const ROW = 12;

/* Pages a list has, so the end of a row is reachable. */
const PAGES = 3;

function create(opts) {
  const films = opts.films || [];
  const lonely = {};
  const creditless = {};
  films.forEach(function (f, i) {
    if (oneBackdrop(i)) lonely[String(f.tmdb)] = true;
    if (noCredits(i)) creditless[String(f.tmdb)] = true;
  });

  function json(res, body) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(body));
  }

  /* A deterministic slice of the library, so each row is a different set and
     the same request always answers the same way. */
  function results(offset, page) {
    const out = [];
    const shift = ((page || 1) - 1) * ROW;
    for (let i = 0; i < ROW && i < films.length; i++) {
      const f = films[(offset + (shift + i) * 3) % films.length];
      out.push({
        id: f.tmdb,
        title: f.title,
        release_date: f.year + '-01-01',
        poster_path: '/poster/' + f.tmdb + '/0.svg',
        backdrop_path: '/backdrop/' + f.tmdb + '/0.svg',
        vote_count: 900,
        vote_average: 7.5,
      });
    }
    return { results: out, total_pages: PAGES };
  }

  /* A genre row is titles the fake servers deliberately do NOT hold — the
     library's own ids are 1000-ish and these are nowhere near them — so the
     not-in-your-library path is walked rather than assumed. */
  function unheld(genreId, page) {
    const out = [];
    const p = page || 1;
    for (let i = 0; i < ROW; i++) {
      const id = 900000 + Number(genreId) * 100 + (p - 1) * ROW + i;
      out.push({
        id: id,
        title: 'Genre ' + genreId + ' Film ' + ((p - 1) * ROW + i + 1),
        release_date: '2019-01-01',
        poster_path: '/poster/' + id + '/0.svg',
        backdrop_path: '/backdrop/' + id + '/0.svg',
        vote_count: 900,
        vote_average: 7.5,
      });
    }
    return { results: out, total_pages: PAGES };
  }

  /* Descending, so the pick is the payload's own order only by accident —
     js/art.js sorts, and the test for that has to have something to sort. */
  function shots(kind, id, n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      out.push({
        file_path: '/' + kind + '/' + id + '/' + k + '.svg',
        vote_average: 8 - k,
        vote_count: 400 - k * 10,
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
      logos: [],
    };
  }

  /* One request now carries the pictures, the description and the billing —
     append_to_response, as the real API does it. The overview names TMDB so a
     test can tell it apart from the Plex mock's summary, and so can an eye. */
  function detailsFor(id, tv) {
    const body = {
      id: Number(id),
      overview:
        'TMDB overview for ' +
        id +
        '. What this one is actually about, ' +
        'in the words of a database rather than a file name.',
      runtime: 90 + (Number(id) % 60),
      images: imagesFor(id),
      videos: {
        results: [
          {
            key: 'teaser' + id,
            site: 'YouTube',
            type: 'Teaser',
            official: true,
          },
          {
            key: 'trailer' + id,
            site: 'YouTube',
            type: 'Trailer',
            official: true,
          },
        ],
      },
    };
    if (!creditless[id]) body.credits = { cast: castFor(id, tv) };
    return body;
  }

  /* In billing order, so taking the first four is taking the top of the bill. */
  function castFor(id, tv) {
    const out = [];
    /* A held show's billing is the names its Plex roles carry, which is how
       the series page matches an actor to a TMDB person. */
    const shown =
      tv &&
      held.find(function (s) {
        return String(s.tmdb) === String(id);
      });
    for (let k = 0; k < 5; k++) {
      out.push({
        order: k,
        id: Number(id) * 10 + k,
        name: shown && shown.cast[k] ? shown.cast[k].name : 'Actor ' + id + '-' + k,
        character: 'Someone ' + k,
        profile_path: '/profile/' + (Number(id) * 10 + k) + '/0.svg',
      });
    }
    return out;
  }

  /* Unsorted on purpose, with years in common and one undated; the low-vote
     one is filtered. Film 0 and show 0 are held by the mock servers. */
  function personFor(id) {
    const credits = [];
    function add(media, cid, title, date, votes) {
      const credit = { id: cid, media_type: media, vote_count: votes, vote_average: 7 };
      credit[media === 'tv' ? 'name' : 'title'] = title;
      credit[media === 'tv' ? 'first_air_date' : 'release_date'] = date;
      credits.push(credit);
    }
    add('movie', 910001, 'Credit A', '2001-03-01', 900);
    add('movie', 910002, 'Credit B', '2019-01-01', 900);
    add('movie', 910003, 'Credit C', '2019-06-01', 900);
    add('movie', films[0].tmdb, films[0].title, films[0].year + '-01-01', 900);
    add('movie', 910004, 'Credit D', '2019-09-01', 900);
    add('tv', held[0].tmdb, held[0].title, held[0].year + '-01-01', 900);
    add('movie', 910005, 'Credit E', '1998-01-01', 900);
    add('movie', 910006, 'Credit F', '2012-01-01', 900);
    add('tv', 910007, 'Credit G', '2012-05-01', 900);
    add('movie', 910008, 'Credit H', '2019-11-01', 900);
    add('movie', 910009, 'Credit I', '2001-09-01', 900);
    add('movie', 910010, 'Credit J', '', 900);
    add('movie', 910011, 'Credit K', '2005-01-01', 900);
    add('movie', 910012, 'Hardly Seen', '2015-01-01', 3);
    return {
      id: Number(id),
      name: 'Person ' + id,
      birthday: '1962-05-12',
      deathday: Number(id) % 2 ? null : '2020-01-03',
      place_of_birth: 'London, England',
      profile_path: '/profile/' + id + '/0.svg',
      combined_credits: { cast: credits },
    };
  }

  /* The shows the mock servers hold: show 0, and show 1, whose TMDB number is
     film 0's. Both are on every TV list, then shows nobody holds. */
  const held = [library.makeShow(0), library.makeShow(1)];

  function tvResults(seed, page) {
    const p = page || 1;
    const out = [];
    if (p === 1) {
      held.forEach(function (s) {
        out.push({
          id: s.tmdb,
          name: s.title,
          first_air_date: s.year + '-01-01',
          poster_path: '/poster/' + s.tmdb + '/0.svg',
          backdrop_path: '/backdrop/' + s.tmdb + '/0.svg',
          vote_count: 900,
          vote_average: 7.5,
        });
      });
    }
    for (let i = out.length; i < ROW; i++) {
      const id = 800000 + Number(seed) * 100 + (p - 1) * ROW + i;
      out.push({
        id: id,
        name: 'TV ' + seed + ' Show ' + ((p - 1) * ROW + i + 1),
        first_air_date: '2015-01-01',
        poster_path: '/poster/' + id + '/0.svg',
        backdrop_path: '/backdrop/' + id + '/0.svg',
        vote_count: 900,
        vote_average: 7.5,
      });
    }
    return { results: out, total_pages: PAGES };
  }

  /* Every /discover query, so a test can read what the app asked for. */
  const discovered = [];

  function api(res, p, query) {
    if (p === '/discover/movie' || p === '/discover/tv')
      discovered.push(Object.assign({ path: p }, query));
    let m = p.match(/^\/tv\/(\d+)$/);
    if (m) {
      json(res, detailsFor(m[1], true));
      return true;
    }
    m = p.match(/^\/person\/(\d+)$/);
    if (m) {
      json(res, personFor(m[1]));
      return true;
    }
    if (p === '/trending/tv/week') {
      json(res, tvResults(0, Number(query.page || 1)));
      return true;
    }
    if (p === '/discover/tv') {
      json(
        res,
        tvResults(query.with_genres || query.with_watch_providers, Number(query.page || 1)),
      );
      return true;
    }
    m = p.match(/^\/movie\/(\d+)\/recommendations$/);
    if (m) {
      json(res, results(Number(m[1]) % Math.max(1, films.length), 1));
      return true;
    }
    m = p.match(/^\/movie\/(\d+)$/);
    if (m) {
      json(res, detailsFor(m[1]));
      return true;
    }
    if (p === '/trending/movie/week') {
      json(res, results(0, Number(query.page || 1)));
      return true;
    }
    if (p === '/discover/movie') {
      if (query.with_genres) {
        json(res, unheld(query.with_genres, Number(query.page || 1)));
        return true;
      }
      json(res, results(Number(query.with_watch_providers || 0), Number(query.page || 1)));
      return true;
    }
    return false;
  }

  /* One flat gradient with a corner bar and its own caption, so a TMDB picture
     is obvious next to the Plex mock's in a screenshot — and so a poster and a
     backdrop of the same title can be told apart at a glance, by shape as well
     as by caption. */
  function image(res, p) {
    const m = p.match(/^\/(\w+)\/(backdrop|poster|profile)\/(\d+)\/(\d+)\.svg$/);
    if (!m) return false;
    const size = m[1],
      kind = m[2],
      id = m[3],
      k = Number(m[4]);
    const hue = (Number(id) * 13 + k * 60 + (kind === 'poster' ? 180 : 0)) % 360;
    const w = kind === 'poster' ? 200 : 320,
      h = kind === 'poster' ? 300 : 180;
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'max-age=60',
    });
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
        w +
        ' ' +
        h +
        '">' +
        '<rect width="' +
        w +
        '" height="' +
        h +
        '" fill="hsl(' +
        hue +
        ',44%,' +
        (18 + k * 8) +
        '%)"/>' +
        '<rect x="0" y="0" width="' +
        w +
        '" height="10" fill="hsl(' +
        hue +
        ',70%,60%)"/>' +
        '<text x="16" y="' +
        h * 0.57 +
        '" font-family="Helvetica,Arial" font-size="26" ' +
        'fill="rgba(255,255,255,0.85)">TMDB ' +
        id +
        ' #' +
        k +
        '</text>' +
        '<text x="16" y="' +
        h * 0.74 +
        '" font-family="Helvetica,Arial" font-size="18" ' +
        'fill="rgba(255,255,255,0.5)">' +
        kind +
        ' ' +
        size +
        '</text></svg>',
    );
    return true;
  }

  return {
    discovered: discovered,
    /* Returns true if it answered. /__tmdbimg first: it also starts with /__tmdb. */
    handle: function (req, res, pathname, query) {
      if (pathname.indexOf('/__tmdbimg') === 0) {
        return image(res, pathname.slice('/__tmdbimg'.length));
      }
      if (pathname.indexOf('/__tmdb') === 0) {
        return api(res, pathname.slice('/__tmdb'.length), query || {});
      }
      return false;
    },
  };
}

module.exports = {
  create: create,
  oneBackdrop: oneBackdrop,
  noCredits: noCredits,
};
