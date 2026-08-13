/* Certificate parsing decides what lands in the kids section, so a wrong answer
   here puts an 18 in front of a child. Run: node test/rating.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'plex.js'), 'utf8');
var Plex = new Function(src + '; return Plex;')();
var age = Plex.ageLimit;

// BBFC
assert.strictEqual(age('U'), 0);
assert.strictEqual(age('PG'), 8);
assert.strictEqual(age('12'), 12);
assert.strictEqual(age('12A'), 12);
assert.strictEqual(age('15'), 15);
assert.strictEqual(age('18'), 18);

// MPAA
assert.strictEqual(age('G'), 0);
assert.strictEqual(age('PG-13'), 13);
assert.strictEqual(age('R'), 17);
assert.strictEqual(age('NC-17'), 18);

// US TV
assert.strictEqual(age('TV-Y'), 0);
assert.strictEqual(age('TV-Y7'), 7);
assert.strictEqual(age('TV-PG'), 8);
assert.strictEqual(age('TV-14'), 14);
assert.strictEqual(age('TV-MA'), 17);

// Region-prefixed forms, as Plex sometimes stores them
assert.strictEqual(age('gb/12A'), 12);
assert.strictEqual(age('us/PG-13'), 13);
assert.strictEqual(age('gb/18'), 18);

// Case and whitespace
assert.strictEqual(age('pg-13'), 13);
assert.strictEqual(age(' 15 '), 15);

// Unrated is NOT the same as suitable for children — must be null, not 0,
// so the kids filter excludes it rather than letting it through.
assert.strictEqual(age(''), null);
assert.strictEqual(age(null), null);
assert.strictEqual(age(undefined), null);
assert.strictEqual(age('NR'), null);
assert.strictEqual(age('Unrated'), null);
assert.strictEqual(age('nonsense'), null);

// The cutoff the kids section uses.
var KIDS_MAX_AGE = 12;
function allowed(r) { var a = age(r); return a !== null && a <= KIDS_MAX_AGE; }

['U', 'G', 'PG', '12', '12A', 'TV-Y7', 'TV-PG'].forEach(function (r) {
  assert.strictEqual(allowed(r), true, r + ' should be allowed');
});
['15', '18', 'R', 'NC-17', 'TV-MA', 'PG-13', 'TV-14', 'NR', ''].forEach(function (r) {
  assert.strictEqual(allowed(r), false, r + ' should NOT be allowed');
});

console.log('certificate parsing: all assertions passed');
