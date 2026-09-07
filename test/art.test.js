/* The tile and the hero stop being the same picture only if the pick is right:
   two backdrops, best first, and never the same path twice. Everything else in
   js/art.js talks to the network or the DOM; this is the part that must not be
   wrong.
   Run: node test/art.test.js */
var assert = require('assert');
var app = require('./load.js')(['art']);
var Art = app.Art;

function shot(path, avg, count) {
  return { file_path: path, vote_average: avg, vote_count: count };
}

/* The pick comes out of the sandbox js/art.js runs in, so its prototype is not
   this realm's — compare the two fields rather than the object. */
function nothing(got, what) {
  assert.strictEqual(got.hero, null, what + ' should have no hero');
  assert.strictEqual(got.tile, null, what + ' should have no tile');
}

/* ---- two backdrops give two different pictures ---- */

var two = Art.pick({ backdrops: [shot('/a.jpg', 7.2, 40), shot('/b.jpg', 8.1, 10)] });
assert.strictEqual(two.hero, '/b.jpg');
assert.strictEqual(two.tile, '/a.jpg');
assert.notStrictEqual(two.hero, two.tile);

/* ---- one backdrop is a hero and nothing else ---- */

var one = Art.pick({ backdrops: [shot('/only.jpg', 6, 3)] });
assert.strictEqual(one.hero, '/only.jpg');
assert.strictEqual(one.tile, null);

/* ---- none gives two nulls ---- */

nothing(Art.pick({ backdrops: [] }), 'an empty list');

/* ---- a malformed payload is a miss, not a throw ---- */

nothing(Art.pick(null), 'no payload at all');
nothing(Art.pick({}), 'a payload with no backdrops');
nothing(Art.pick({ backdrops: 'nonsense' }), 'backdrops that are not a list');
nothing(Art.pick({ backdrops: [null, {}, { file_path: '' }] }), 'entries with no path');

/* ---- the appended shape reads the same as the bare one ----

   The backdrops used to be the whole payload and now arrive under `images`, so
   an entry cached before that change must still pick. */

var appended = Art.pick({ images: { backdrops: [shot('/a.jpg', 7.2, 40), shot('/b.jpg', 8.1, 10)] } });
assert.strictEqual(appended.hero, '/b.jpg');
assert.strictEqual(appended.tile, '/a.jpg');
nothing(Art.pick({ images: {} }), 'an appended payload with no backdrops');
nothing(Art.pick({ images: { backdrops: [] } }), 'an appended empty list');

/* ---- the order is the votes, not the payload ----

   TMDB returns backdrops in its own order and it is not the order we want, so
   the same three in any arrangement must pick the same two. */

var best = shot('/best.jpg', 9, 5);
var next = shot('/next.jpg', 8, 200);
var worst = shot('/worst.jpg', 2, 9000);

[[best, next, worst], [worst, next, best], [next, worst, best]].forEach(function (order) {
  var got = Art.pick({ backdrops: order });
  assert.strictEqual(got.hero, '/best.jpg');
  assert.strictEqual(got.tile, '/next.jpg');
});

/* Votes break a tie on the score, so two equally rated backdrops still order. */
var tied = Art.pick({ backdrops: [shot('/few.jpg', 7, 8), shot('/many.jpg', 7, 900)] });
assert.strictEqual(tied.hero, '/many.jpg');
assert.strictEqual(tied.tile, '/few.jpg');

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
  credits: { cast: ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Fay'].map(function (n, i) {
    return { name: n, order: i };
  }) }
});
assert.strictEqual(billed.overview, 'A film happens.');
assert.strictEqual(billed.runtime, 118);
assert.deepStrictEqual(Array.prototype.slice.call(billed.cast), ['Ada', 'Bo', 'Cy', 'Di']);

/* Fewer than four is however many there are, never padded. */
assert.deepStrictEqual(
  Array.prototype.slice.call(Art.facts({ credits: { cast: [{ name: 'Ada' }] } }).cast), ['Ada']);

/* An entry with no name is not a name. */
assert.deepStrictEqual(
  Array.prototype.slice.call(
    Art.facts({ credits: { cast: [null, {}, { name: '' }, { name: 'Ada' }] } }).cast), ['Ada']);

/* ---- nothing to say is empty, never a throw ---- */

noFacts(Art.facts({}), 'a payload with nothing on it');
noFacts(Art.facts(null), 'no payload at all');
noFacts(Art.facts({ credits: {} }), 'credits with no cast');
noFacts(Art.facts({ credits: { cast: [] } }), 'an empty cast');
noFacts(Art.facts({ overview: 42, runtime: '118', credits: { cast: 'nonsense' } }),
        'a malformed payload');

/* The overview and the run time survive a missing credits block. */
var noCast = Art.facts({ overview: 'Still a film.', runtime: 90 });
assert.strictEqual(noCast.overview, 'Still a film.');
assert.strictEqual(noCast.runtime, 90);
assert.strictEqual(noCast.cast.length, 0);

console.log('art: pick chooses a hero and a different tile, and facts read the header');
