/* Certificate parsing gives a title its age limit, so a wrong answer
   here puts an 18 in front of a child. Run: node test/rating.test.js */
import assert from 'node:assert';
import { test } from 'vitest';
import { Media } from './modules';

test('certificate parsing', () => {
  var age = Media.ageLimit;

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

  console.log('certificate parsing: all assertions passed');
});
