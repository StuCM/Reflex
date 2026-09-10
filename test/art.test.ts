/* The tile and the hero stop being the same picture only if the pick is right:
   the best backdrop for one and the best poster for the other, out of a single
   payload. Everything else in js/art.js talks to the network or the DOM; this
   is the part that must not be wrong.
   Run: node test/art.test.js */
import assert from 'node:assert';
import { test } from 'vitest';
import { Art } from './modules';

test('tmdb art picking', () => {
  function shot(path, avg, count) {
    return { file_path: path, vote_average: avg, vote_count: count };
  }

  /* The pick comes out of the sandbox js/art.js runs in, so its prototype is not
     this realm's — compare the two fields rather than the object. */
  function nothing(got, what) {
    assert.strictEqual(got.hero, null, what + ' should have no hero');
    assert.strictEqual(got.poster, null, what + ' should have no poster');
  }

  /* ---- one payload gives a backdrop and a poster ---- */

  var both = Art.pick({
    images: {
      backdrops: [shot('/wide-a.jpg', 7.2, 40), shot('/wide-b.jpg', 8.1, 10)],
      posters: [shot('/tall-a.jpg', 5.0, 900), shot('/tall-b.jpg', 6.4, 2)],
    },
  });
  assert.strictEqual(both.hero, '/wide-b.jpg');
  assert.strictEqual(both.poster, '/tall-b.jpg');

  /* ---- backdrops but no posters: the tile has to fall back to Plex ---- */

  var wideOnly = Art.pick({ images: { backdrops: [shot('/only.jpg', 6, 3)], posters: [] } });
  assert.strictEqual(wideOnly.hero, '/only.jpg');
  assert.strictEqual(wideOnly.poster, null, 'a backdrop must never stand in for a poster');

  /* A second backdrop is not a poster either — that was the old rule. */
  var twoWide = Art.pick({ images: { backdrops: [shot('/a.jpg', 9, 5), shot('/b.jpg', 8, 5)] } });
  assert.strictEqual(twoWide.poster, null);

  /* ---- and the other way round ---- */

  var tallOnly = Art.pick({ images: { posters: [shot('/tall.jpg', 7, 30)] } });
  assert.strictEqual(tallOnly.hero, null);
  assert.strictEqual(tallOnly.poster, '/tall.jpg');

  /* ---- neither gives two nulls ---- */

  nothing(Art.pick({ images: { backdrops: [], posters: [] } }), 'two empty lists');

  /* ---- a malformed payload is a miss, not a throw ---- */

  nothing(Art.pick(null), 'no payload at all');
  nothing(Art.pick({}), 'a payload with no images');
  nothing(Art.pick({ images: {} }), 'an images block with nothing in it');
  nothing(Art.pick({ images: { backdrops: 'nonsense', posters: 42 } }), 'lists that are not lists');
  nothing(
    Art.pick({
      images: { backdrops: [null, {}, { file_path: '' }], posters: [null, { file_path: '' }] },
    }),
    'entries with no path',
  );

  /* ---- the bare shape reads the same as the appended one ----

     The images used to be the whole payload and now arrive under `images`, so an
     entry cached before that change must still pick. */

  var bare = Art.pick({
    backdrops: [shot('/a.jpg', 7.2, 40), shot('/b.jpg', 8.1, 10)],
    posters: [shot('/p.jpg', 3, 3)],
  });
  assert.strictEqual(bare.hero, '/b.jpg');
  assert.strictEqual(bare.poster, '/p.jpg');

  /* ---- the order is the votes, not the payload ----

     TMDB returns its images in its own order and it is not the order we want, so
     the same three in any arrangement must pick the same one. */

  var best = shot('/best.jpg', 9, 5);
  var next = shot('/next.jpg', 8, 200);
  var worst = shot('/worst.jpg', 2, 9000);

  [
    [best, next, worst],
    [worst, next, best],
    [next, worst, best],
  ].forEach(function (order) {
    var got = Art.pick({ images: { backdrops: order, posters: order } });
    assert.strictEqual(got.hero, '/best.jpg');
    assert.strictEqual(got.poster, '/best.jpg');
  });

  /* Votes break a tie on the score, so two equally rated pictures still order. */
  var tied = Art.pick({
    images: {
      backdrops: [shot('/few.jpg', 7, 8), shot('/many.jpg', 7, 900)],
      posters: [shot('/p-few.jpg', 7, 8), shot('/p-many.jpg', 7, 900)],
    },
  });
  assert.strictEqual(tied.hero, '/many.jpg');
  assert.strictEqual(tied.poster, '/p-many.jpg');

  /* ---- the facts the header draws ---- */

  function noFacts(got, what) {
    assert.strictEqual(got.overview, '', what + ' should have no overview');
    assert.strictEqual(got.runtime, null, what + ' should have no runtime');
    assert.deepStrictEqual(Array.prototype.slice.call(got.cast), [], what + ' should have no cast');
  }

  /* Four names, in the order TMDB billed them — not sorted, not the last four. */
  var billed = Art.facts({
    overview: 'A film happens.',
    runtime: 118,
    credits: {
      cast: ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Fay'].map(function (n, i) {
        return { name: n, order: i };
      }),
    },
  });
  assert.strictEqual(billed.overview, 'A film happens.');
  assert.strictEqual(billed.runtime, 118);
  assert.deepStrictEqual(Array.prototype.slice.call(billed.cast), ['Ada', 'Bo', 'Cy', 'Di']);

  /* Fewer than four is however many there are, never padded. */
  assert.deepStrictEqual(
    Array.prototype.slice.call(Art.facts({ credits: { cast: [{ name: 'Ada' }] } }).cast),
    ['Ada'],
  );

  /* An entry with no name is not a name. */
  assert.deepStrictEqual(
    Array.prototype.slice.call(
      Art.facts({ credits: { cast: [null, {}, { name: '' }, { name: 'Ada' }] } }).cast,
    ),
    ['Ada'],
  );

  /* ---- nothing to say is empty, never a throw ---- */

  noFacts(Art.facts({}), 'a payload with nothing on it');
  noFacts(Art.facts(null), 'no payload at all');
  noFacts(Art.facts({ credits: {} }), 'credits with no cast');
  noFacts(Art.facts({ credits: { cast: [] } }), 'an empty cast');
  noFacts(
    Art.facts({ overview: 42, runtime: '118', credits: { cast: 'nonsense' } }),
    'a malformed payload',
  );

  /* The overview and the run time survive a missing credits block. */
  var noCast = Art.facts({ overview: 'Still a film.', runtime: 90 });
  assert.strictEqual(noCast.overview, 'Still a film.');
  assert.strictEqual(noCast.runtime, 90);
  assert.strictEqual(noCast.cast.length, 0);

  console.log('art: pick chooses a backdrop and a poster, and facts read the header');
});
