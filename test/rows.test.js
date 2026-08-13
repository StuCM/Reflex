/* The virtual row is what makes a 30,000 film library browsable across two
   servers, and its arithmetic is entirely off-screen: get it wrong and tiles
   show the wrong film rather than throwing anything.
   Run: node test/rows.test.js */
var assert = require('assert');
var app = require('./load.js')(['media', 'servers', 'merge', 'rows']);
var Rows = app.Rows, Merge = app.Merge, Servers = app.Servers;

var MAIN = { id: 'srv-main', name: 'Main', base: 'http://main', token: 'a' };
Servers.set([MAIN]);

/* ---- list rows hold their items outright ---- */

var list = Rows.list('Continue watching', [{ title: 'A' }, { title: 'B' }]);
assert.strictEqual(list.total, 2);
assert.strictEqual(list.focus, 0);
assert.strictEqual(Rows.itemAt(list, 1).title, 'B');
assert.strictEqual(Rows.itemAt(list, 2), null);
assert.strictEqual(Rows.itemAt(list, -1), null);

/* ---- merge rows are virtual over the servers' own totals ---- */

var LIBRARY = 5000;
var fetched = [];

function item(i) {
  var t = 'Film ' + String(100000 + i).slice(1);      // sorts the same as i
  return { ratingKey: String(i), _server: MAIN.id, title: t, titleSort: t, year: 2000,
           Guid: [{ id: 'imdb://tt' + i }],
           Media: [{ videoResolution: '1080', videoCodec: 'h264', container: 'mkv' }] };
}

var row = Rows.merged('All films', [{ server: MAIN, key: '1' }], function (part, offset) {
  fetched.push(offset);
  var out = [], i;
  for (i = offset; i < Math.min(offset + Rows.PAGE, LIBRARY); i++) out.push(item(i));
  return Promise.resolve({ items: out, total: LIBRARY });
});

assert.strictEqual(row.total, 0, 'nothing is known before anything is asked');
assert.strictEqual(Rows.itemAt(row, 0), null, 'and nothing can be drawn yet');

/* The row is told its length separately and cheaply — one size=0 request per
   server — which is what browse.js does before any walking. */
row.state.streams[0].total = LIBRARY;
row.total = Merge.estimate(row.state);
assert.strictEqual(row.total, LIBRARY);

// A position that exists but has not been walked to is null, not an error: the
// tile draws a placeholder and the walk continues.
assert.strictEqual(Rows.itemAt(row, 0), null);

Merge.advance(row.state, Rows.needsUpTo(row)).then(function () {
  assert.strictEqual(Rows.itemAt(row, 0).title, 'Film 00000');
  assert.strictEqual(Rows.itemAt(row, 5).title, 'Film 00005');

  // Only as far as asked: a screenful plus the lookahead, not the library.
  assert.ok(Rows.haveUpTo(row) <= Rows.PAGE,
            'one page covers the first screen; ' + Rows.haveUpTo(row) + ' walked');
  assert.deepStrictEqual(fetched, [0], 'exactly one request so far');

  // Past the end there is nothing, walked or not.
  assert.strictEqual(Rows.itemAt(row, LIBRARY), null);
  assert.strictEqual(Rows.itemAt(row, 999999), null);

  // Scroll deeper and the walk follows, a page at a time.
  row.focus = 150;
  return Merge.advance(row.state, Rows.needsUpTo(row));
}).then(function () {
  assert.strictEqual(Rows.itemAt(row, 150).title, 'Film 00150');
  assert.deepStrictEqual(fetched, [0, 100], 'one more page, not a crawl to 150');

  // needsUpTo is the focus plus a lookahead, so holding a direction key does
  // not outrun the walk.
  row.focus = 10;
  assert.strictEqual(Rows.needsUpTo(row), 10 + Rows.LOOKAHEAD);

  console.log('row model: all assertions passed');
}).catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
