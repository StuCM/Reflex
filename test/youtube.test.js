/* The two pure parts of the recaps client: turning YouTube's payload into a
   rail, and keeping only the videos that are actually about this show. The
   second is the one that matters — the channel covers everything, and a search
   for a one-word show title brings most of it back.

   Joined rather than deep-equal throughout: these arrays are built inside the
   sandbox and so have a different Array.prototype, which strict deep equality
   rejects.
   Run: node test/youtube.test.js */
var assert = require('assert');
var app = require('./load.js')(['config', 'http', 'youtube']);
var Youtube = app.Youtube;

function item(id, title, duration) {
  var it = {
    id: { videoId: id },
    snippet: { title: title, thumbnails: { medium: { url: 'http://img/' + id } } },
  };
  if (duration) it.contentDetails = { duration: duration };
  return it;
}

function field(list, name) {
  return list
    .map(function (r) {
      return r[name];
    })
    .join(' | ');
}

/* ---- the season out of the title ---- */

var seasons = Youtube.parse([
  item('a', 'Blue Harbour Season 3 Recap'),
  item('b', 'Blue Harbour S1 Recap'),
  item('c', 'Blue Harbour Series 2 Recap'),
  item('d', 'Blue Harbour: everything you missed'),
]);

assert.strictEqual(
  field(seasons, 'season'),
  '1 | 2 | 3 | ',
  'Season, S and Series all read, and no season sorts last',
);
assert.strictEqual(field(seasons, 'id'), 'b | c | a | d');
assert.strictEqual(seasons[0].thumb, 'http://img/b');

/* ---- ties keep the order the API gave ----

   Chromium 53's sort is not stable, so this is arithmetic the module has to do
   itself: two videos about the same season stay in the order they came back. */

var tied = Youtube.parse([
  item('first', 'Blue Harbour Season 1 Recap, part one'),
  item('second', 'Blue Harbour Season 1 Recap, part two'),
  item('third', 'Blue Harbour Season 1 Recap, part three'),
]);
assert.strictEqual(field(tied, 'id'), 'first | second | third');

/* ---- lengths, when the payload carries them ---- */

var timed = Youtube.parse([
  item('a', 'Blue Harbour Season 1 Recap', 'PT12M4S'),
  item('b', 'Blue Harbour Season 2 Recap', 'PT1H2M3S'),
  item('c', 'Blue Harbour Season 3 Recap', 'PT45S'),
  item('d', 'Blue Harbour Season 4 Recap'),
]);
assert.strictEqual(field(timed, 'length'), '12:04 | 1:02:03 | 0:45 | ');

/* ---- a payload that is not one ----

   The rail asks for an answer, not for an exception: a malformed item is simply
   not a recap. */

assert.strictEqual(Youtube.parse(null).length, 0);
assert.strictEqual(Youtube.parse([]).length, 0);
assert.strictEqual(Youtube.parse([{}, null, { id: {} }, { snippet: {} }]).length, 0);
assert.strictEqual(
  Youtube.parse([{ id: { videoId: 'x' }, snippet: {} }]).length,
  0,
  'no title is not a recap',
);
assert.strictEqual(
  Youtube.parse([{ snippet: { title: 'Season 1 Recap' } }]).length,
  0,
  'no videoId is nothing to play',
);
assert.strictEqual(Youtube.parse([item('a', 'A Season 1 Recap', 'nonsense')])[0].length, '');

/* ---- only this show ---- */

var mixed = Youtube.parse([
  item('a', 'Blue Harbour Season 1 Recap'),
  item('b', 'Blue Harbour: The Return — Season 2 Recap'),
  item('c', 'Grey Tunnel Season 1 Recap'),
  item('d', 'blue harbour season 3, everything explained'),
]);

assert.strictEqual(Youtube.pickForShow(mixed, 'Blue Harbour').length, 3);
assert.strictEqual(
  field(Youtube.pickForShow(mixed, 'Blue Harbour'), 'id'),
  'a | b | d',
  'another show on the same channel is rejected',
);

/* Punctuation is not part of the name, and neither is case. */
assert.strictEqual(Youtube.pickForShow(mixed, 'blue-harbour!').length, 3);

/* ---- a one-word show title ----

   The case the filter exists for: "Signal" sits inside other words, and a
   channel's back catalogue is full of them. */

var oneWord = Youtube.parse([
  item('a', 'Signal Season 1 Recap'),
  item('b', 'Signalling Season 1 Recap'),
  item('c', 'The Lost Signal Season 2 Recap'),
  item('d', 'Grey Tunnel Season 1 Recap'),
]);
assert.strictEqual(field(Youtube.pickForShow(oneWord, 'Signal'), 'id'), 'a | c');

assert.strictEqual(Youtube.pickForShow(mixed, '').length, 0, 'no show is no recaps');
assert.strictEqual(Youtube.pickForShow(null, 'Blue Harbour').length, 0);

/* ---- inert without a key ---- */

assert.strictEqual(Youtube.enabled(), false, 'the repo ships with no key');

console.log('youtube: parse and pickForShow ok');
