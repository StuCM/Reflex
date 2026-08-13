/* The row model, and nothing else — no DOM, no network.

   Two kinds of row:
     'list'  items are held outright (hubs, Continue watching, search results)
     'all'   virtual over a total the server told us, pages fetched on demand

   The 'all' row is what makes a 30,000 film section browsable: the app knows
   how long it is and holds only the pages you have actually looked at. */
var Rows = (function () {
  'use strict';

  var PAGE = 100;                // items per request on an 'all' row
  var EDGE = 20;                 // how close to a page edge before prefetching

  function list(title, items) {
    return { kind: 'list', title: title, items: items, total: items.length, focus: 0 };
  }

  function all(sec, title, filter, tag) {
    return { kind: 'all', title: title || 'All films', focus: 0, total: 0,
             key: sec.key, version: sec.updatedAt || 0,
             filter: filter || null, tag: tag || '',
             pages: {}, inflight: {} };
  }

  /* Null means "position exists but its page has not arrived" — the caller
     draws a placeholder rather than a gap. */
  function itemAt(row, i) {
    if (!row || i < 0 || i >= row.total) return null;
    if (row.kind === 'list') return row.items[i];
    var p = row.pages[Math.floor(i / PAGE)];
    return p ? p[i % PAGE] : null;
  }

  function pageOf(i) { return Math.floor(i / PAGE); }

  /* Which pages are worth having, given where the focus is: the one you are
     on, and the neighbour you are close enough to reach. */
  function pagesNeeded(focus) {
    var n = pageOf(focus), within = focus % PAGE, out = [n];
    if (within > PAGE - EDGE) out.push(n + 1);
    if (within < EDGE && n > 0) out.push(n - 1);
    return out;
  }

  return { PAGE: PAGE, EDGE: EDGE, list: list, all: all,
           itemAt: itemAt, pageOf: pageOf, pagesNeeded: pagesNeeded };
})();

if (typeof module !== 'undefined') module.exports = Rows;   // for test/rows.test.js
