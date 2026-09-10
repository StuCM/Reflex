/* What a rail tile and the hero over it are named, and the line underneath.

   An episode is the case that matters: its own title says nothing without the
   show, and every one of them looked like a different film. */
'use strict';

const assert = require('assert');
const { Media } = require('./load')(['config', 'panel', 'media']);

const ep = {
  type: 'episode',
  title: 'Spirit Receivers',
  grandparentTitle: 'Archive 81',
  parentIndex: 1,
  index: 4,
  duration: 2760000,
};

assert.strictEqual(Media.railTitle(ep), 'Archive 81', 'an episode is named by its show');
assert.strictEqual(
  Media.railSub(ep),
  'S1 E4  ·  Spirit Receivers',
  'and the line under it says where you are',
);

/* A special with no season, and a show that never numbered its episodes. */
assert.strictEqual(Media.railSub({ type: 'episode', title: 'Pilot', index: 1 }), 'E1  ·  Pilot');
assert.strictEqual(
  Media.railSub({ type: 'episode', title: 'Pilot' }),
  'Pilot',
  'no numbers at all falls back to the episode title',
);
assert.strictEqual(
  Media.railTitle({ type: 'episode', title: 'Pilot' }),
  'Pilot',
  'and to the episode title when there is no show name either',
);

const film = { type: 'movie', title: 'Sudden Quarry', year: 2017, duration: 8580000 };
assert.strictEqual(Media.railTitle(film), 'Sudden Quarry');
assert.strictEqual(Media.railSub(film), '143 min', 'a film says how long it is, and nothing else');
assert.strictEqual(
  Media.railSub({ type: 'movie', title: 'X' }),
  '',
  'a film with no duration says nothing rather than "NaN min"',
);

const show = { type: 'show', title: 'Archive 81', childCount: 2, year: 2022 };
assert.strictEqual(Media.railSub(show), '2 series');
assert.strictEqual(
  Media.railSub({ type: 'show', title: 'X', year: 1999 }),
  '1999',
  'a show with no series count falls back to its year',
);

assert.strictEqual(Media.railTitle(null), '');
assert.strictEqual(Media.railSub(null), '');

console.log('rail and hero labels: all assertions passed');
