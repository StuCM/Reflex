/* The virtual row is what makes a 30,000 film section browsable, and its
   arithmetic is entirely off-screen: get it wrong and tiles show the wrong
   film rather than throwing anything. Run: node test/rows.test.js */
var assert = require('assert');
var Rows = require('../js/rows.js');

var PAGE = Rows.PAGE;

/* ---- list rows hold their items outright ---- */

var list = Rows.list('Continue watching', [{ title: 'A' }, { title: 'B' }]);
assert.strictEqual(list.total, 2);
assert.strictEqual(list.focus, 0);
assert.strictEqual(Rows.itemAt(list, 1).title, 'B');
assert.strictEqual(Rows.itemAt(list, 2), null);
assert.strictEqual(Rows.itemAt(list, -1), null);

/* ---- 'all' rows are virtual over a total the server gave us ---- */

var all = Rows.all({ key: '1', updatedAt: 99 });
assert.strictEqual(all.total, 0);
assert.strictEqual(all.version, 99);
assert.strictEqual(Rows.itemAt(all, 0), null, 'nothing before a total is known');

all.total = 30000;

// A position inside a page we do not hold is null, not an error — the tile
// draws a placeholder and the page is fetched.
assert.strictEqual(Rows.itemAt(all, 12345), null);

// Once the page lands, the position maps into it.
all.pages[Rows.pageOf(12345)] = [];
for (var i = 0; i < PAGE; i++) all.pages[123][i] = { title: 'film ' + (12300 + i) };
assert.strictEqual(Rows.itemAt(all, 12345).title, 'film 12345');
assert.strictEqual(Rows.itemAt(all, 12300).title, 'film 12300');
assert.strictEqual(Rows.itemAt(all, 12399).title, 'film 12399');

// Neighbouring positions belong to pages we still do not hold.
assert.strictEqual(Rows.itemAt(all, 12299), null);
assert.strictEqual(Rows.itemAt(all, 12400), null);

// Past the end of the library there is nothing, page held or not.
assert.strictEqual(Rows.itemAt(all, 30000), null);
assert.strictEqual(Rows.itemAt(all, 999999), null);

assert.strictEqual(Rows.pageOf(0), 0);
assert.strictEqual(Rows.pageOf(PAGE - 1), 0);
assert.strictEqual(Rows.pageOf(PAGE), 1);

/* ---- which pages are worth fetching ---- */

// Mid-page: just the one you are on. Fetching neighbours from here would treble
// the requests to a server we do not own for no benefit.
assert.deepStrictEqual(Rows.pagesNeeded(PAGE * 4 + Math.floor(PAGE / 2)), [4]);

// Near the top edge of a page, the next one is worth having early.
assert.deepStrictEqual(Rows.pagesNeeded(PAGE * 4 + PAGE - 1), [4, 5]);

// Near the bottom edge, the previous one — you may be scrolling left.
assert.deepStrictEqual(Rows.pagesNeeded(PAGE * 4 + 1), [4, 3]);

// At the very start there is no previous page to ask for. Asking for page -1
// would be a request the server answers with the wrong end of the library.
assert.deepStrictEqual(Rows.pagesNeeded(0), [0]);
assert.deepStrictEqual(Rows.pagesNeeded(1), [0]);

console.log('row model: all assertions passed');
