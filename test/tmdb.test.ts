/* The two pure halves of the Discovery page: which TMDB endpoint a configured
   category reaches, and whether the entry built from a result is something the
   rest of the app can read as a film.

   Everything else in js/discovery.js talks to a server. These are the parts
   that decide what the page costs and whether it draws at all.
   Run: node test/tmdb.test.js */
import assert from 'node:assert';
import { test } from 'vitest';
import { Discovery, Plex, Tmdb } from './modules';

test('catalogue dispatch and the vote floor', () => {
  /* What TMDB was asked for, and what it answered. The client is XHR, so a fake
     one is the whole seam — nothing here reaches a network. */
  const asked = [];
  let payload = { results: [] };

  class FakeXhr {
    url = '';
    status = 0;
    responseText = '';
    onload: () => void = () => {};
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      asked.push(this.url);
      this.status = 200;
      this.responseText = JSON.stringify(payload);
      this.onload();
    }
  }
  (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXhr;

  function result(id, over) {
    const m = {
      id: id,
      title: 'Film ' + id,
      release_date: '2011-06-01',
      poster_path: '/p' + id + '.jpg',
      backdrop_path: '/b' + id + '.jpg',
      vote_count: 900,
      vote_average: 7.5,
    };
    Object.keys(over || {}).forEach(function (k) {
      m[k] = over[k];
    });
    return m;
  }

  function fetched(category, seeds) {
    asked.length = 0;
    return Tmdb.catalogue(category, seeds).then(function (films) {
      return { films: films, asked: asked.slice() };
    });
  }

  /* ---- one function per kind, and the config says which ---- */

  payload = { results: [result(11), result(22)] };

  Promise.resolve()

    .then(function () {
      return fetched({ title: 'Trending this week', kind: 'trending' }).then(function (got) {
        assert.strictEqual(got.asked.length, 1);
        assert.ok(/\/trending\/movie\/week\?/.test(got.asked[0]), got.asked[0]);
        assert.strictEqual(
          got.films
            .map(function (f) {
              return f.id;
            })
            .join(','),
          '11,22',
        );
        /* The tile is drawn from these fields alone — an id on its own would put
           the page back to a lookup per title. */
        assert.strictEqual(got.films[0].title, 'Film 11');
        assert.strictEqual(got.films[0].year, 2011);
        assert.strictEqual(got.films[0].poster_path, '/p11.jpg');
      });
    })

    .then(function () {
      return fetched({ kind: 'provider', id: 8 }).then(function (got) {
        assert.ok(/\/discover\/movie\?/.test(got.asked[0]), got.asked[0]);
        assert.ok(/with_watch_providers=8/.test(got.asked[0]), got.asked[0]);
      });
    })

    .then(function () {
      return fetched({ kind: 'genre', id: 878 }).then(function (got) {
        assert.ok(/\/discover\/movie\?/.test(got.asked[0]), got.asked[0]);
        assert.ok(/with_genres=878/.test(got.asked[0]), got.asked[0]);
        assert.ok(!/with_watch_providers/.test(got.asked[0]), 'a genre row is not a provider row');
      });
    })

    .then(function () {
      return fetched({ kind: 'recommended' }, ['11', '22']).then(function (got) {
        assert.strictEqual(got.asked.length, 2, 'one request per seed, and no more');
        assert.ok(/\/movie\/11\/recommendations\?/.test(got.asked[0]), got.asked[0]);
        /* A seed is not a recommendation, and both seeds return both seeds. */
        assert.strictEqual(got.films.length, 0);
      });
    })

    /* ---- a kind nobody implemented is a typo in the config, not a crash ---- */

    .then(function () {
      return fetched({ title: 'Whatever', kind: 'documentaries' }).then(function (got) {
        assert.strictEqual(got.films.length, 0);
        assert.strictEqual(got.asked.length, 0, 'an unknown kind asks TMDB nothing');
      });
    })

    .then(function () {
      return fetched({}).then(function (got) {
        assert.strictEqual(got.films.length, 0);
        assert.strictEqual(got.asked.length, 0);
      });
    })

    /* ---- the rubbish filter survived carrying titles about ---- */

    .then(function () {
      payload = {
        results: [
          result(1, { vote_count: 4 }),
          result(2, { vote_count: 500 }),
          result(3, { vote_count: 0 }),
          { title: 'no id', vote_count: 9000 },
        ],
      };
      return fetched({ kind: 'trending' }).then(function (got) {
        assert.strictEqual(
          got.films
            .map(function (f) {
              return f.id;
            })
            .join(','),
          '2',
          'only titles over the vote floor, and only ones with an id',
        );
      });
    })

    /* ---- and the entry the rail is handed ---- */

    .then(function () {
      const one = Discovery.entry({
        id: '603',
        title: 'The Matrix',
        year: 1999,
        poster_path: '/m.jpg',
      });
      assert.strictEqual(
        Plex.tmdbId(one),
        '603',
        'js/art.js finds the poster through Plex.tmdbId, or the tile is blank',
      );
      assert.strictEqual(one.type, 'movie');
      assert.strictEqual(one.title, 'The Matrix');
      assert.strictEqual(one.year, 1999);
      assert.strictEqual(one.ratingKey, undefined, 'nothing may take it for a library item');
      assert.strictEqual(one._server, undefined);
      assert.strictEqual(one._resolved, undefined, 'unknown, which is not the same as "not held"');
      assert.strictEqual(Discovery.isEntry(one), true);
      assert.strictEqual(Discovery.isEntry({ type: 'movie', ratingKey: '7' }), false);
      assert.strictEqual(Discovery.isEntry(null), false);
    })

    .then(
      function () {
        console.log('tmdb.test.js: catalogue dispatch, the vote floor and the Discovery entry');
      },
      function (e) {
        console.error((e && e.stack) || e);
        process.exit(1);
      },
    );
});
