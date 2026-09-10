/* What plays after an episode ends. nextInList is the arithmetic of it, split
   out from the fetching so it can be checked without a server — get it wrong
   and the wrong episode starts itself, which is the one failure this feature
   can produce unattended.
   Run: node test/shows.test.js */
var assert = require('assert');
var app = require('./load.js')(['media', 'servers', 'merge', 'shows']);
var Shows = app.Shows;

function ep(key, n, sources) {
  var e = {
    ratingKey: key,
    _server: 'srv-main',
    type: 'episode',
    index: n,
    parentIndex: 1,
    title: 'Episode ' + n,
  };
  if (sources) e._sources = sources;
  return e;
}

var one = ep('11', 1),
  two = ep('12', 2),
  three = ep('13', 3);
var series = [one, two, three];

/* ---- the ordinary case ---- */

assert.strictEqual(Shows.nextInList(series, one), two);
assert.strictEqual(Shows.nextInList(series, two), three);

/* ---- the end of the series, and things that are not in it ---- */

assert.strictEqual(Shows.nextInList(series, three), null, 'the last episode has no next');
assert.strictEqual(
  Shows.nextInList(series, ep('99', 9)),
  null,
  'an episode that is not in this list offers nothing',
);
assert.strictEqual(Shows.nextInList([], one), null);
assert.strictEqual(Shows.nextInList(null, one), null);
assert.strictEqual(Shows.nextInList(series, null), null);

/* ---- the entry after this one, found by rating key rather than by number ----

   The list is whatever order the season came back in, and the episode playing
   is matched to a position in it — not to an index one higher than its own. */

var outOfOrder = [three, one, two];
assert.strictEqual(Shows.nextInList(outOfOrder, one), two);
assert.strictEqual(
  Shows.nextInList(outOfOrder, two),
  null,
  'last in the list is last, whatever its episode number',
);
assert.strictEqual(Shows.nextInList(outOfOrder, three), one);

/* ---- the same episode arriving from the other server ----

   A merged entry leads with one server's copy and carries the other as a
   source, with a different rating key. The copy that was playing may be
   either, so a match has to look at all of them. */

var backup = {
  ratingKey: '2012',
  _server: 'srv-backup',
  type: 'episode',
  index: 2,
  parentIndex: 1,
  title: 'Episode 2',
};
var merged = [one, ep('12', 2, [backup]), three];
assert.strictEqual(
  Shows.nextInList(merged, backup),
  three,
  'the copy that played is a copy of the merged entry',
);

/* And a rating key that only *looks* alike is still a different episode. */
assert.strictEqual(Shows.nextInList(merged, ep('201', 2)), null);

console.log('what comes next: all assertions passed');
