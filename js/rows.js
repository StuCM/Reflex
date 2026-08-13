/* The row model, and nothing else — no DOM, no network.

   Two kinds of row:
     'list'   items are held outright (hubs, Continue watching, search results)
     'merge'  virtual over one or more server sections, merged and deduplicated
              as you scroll

   The merge row is what makes a 30,000 film library browsable across two
   servers: it knows roughly how long it is without crawling anything, holds
   only what you have walked past, and shows one entry per film with every
   copy of it attached. See js/merge.js for the walk itself. */
var Rows = (function () {
  'use strict';

  var PAGE = 100;                // items per request against a server section

  function list(title, items) {
    return { kind: 'list', title: title, items: items, total: items.length, focus: 0 };
  }

  /* parts: [{ server, key, updatedAt, filter, tag }], one per server section.
     fetch(part, offset) -> Promise({ items, total }). */
  function merged(title, parts, fetch) {
    return { kind: 'merge', title: title || 'All films', focus: 0, total: 0,
             parts: parts, state: Merge.stream(parts, fetch) };
  }

  /* Null means "position exists but has not been walked to yet" — the tile
     draws a placeholder rather than a gap. */
  function itemAt(row, i) {
    if (!row || i < 0 || i >= row.total) return null;
    if (row.kind === 'list') return row.items[i];
    return Merge.items(row.state)[i] || null;
  }

  /* How far ahead of the focus to materialise: a screenful, plus enough that
     holding a direction key does not outrun the walk. */
  var LOOKAHEAD = 24;

  function needsUpTo(row) { return row.focus + LOOKAHEAD; }

  function haveUpTo(row) {
    return row.kind === 'merge' ? Merge.items(row.state).length : row.total;
  }

  return { PAGE: PAGE, list: list, merged: merged, itemAt: itemAt,
           needsUpTo: needsUpTo, haveUpTo: haveUpTo, LOOKAHEAD: LOOKAHEAD };
})();

if (typeof module !== 'undefined') module.exports = Rows;   // for test/rows.test.js
