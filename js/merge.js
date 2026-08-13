/* One entry per film, across servers.

   Two jobs, both built on Media.identities:

   - `lists` folds a handful of already-fetched lists (Continue watching, the
     category rows, search results) into one.
   - `stream` does the same for the All films row, which cannot be fetched in
     one go. Both servers sort by title, so their pages arrive as two sorted
     streams and are merged as you scroll — nothing is crawled, and only what
     you have walked past is held.

   A merged entry is one of the copies, with `_sources` listing every copy of
   it. The copies matter: the same film is often a 4K TrueHD remux on one
   server and a 1080p E-AC3 file on the other, and only one of those will
   direct play. Choosing between them is what js/detail.js is for. */
var Merge = (function () {
  'use strict';

  /* An index from every known identity to the merged entry holding it. */
  function index() { return { map: {}, out: [], dupes: 0 }; }

  function sortKey(item) {
    return String((item && (item.titleSort || item.title)) || '').toLowerCase();
  }

  function before(a, b) {
    var ka = sortKey(a), kb = sortKey(b);
    if (ka !== kb) return ka < kb;
    return ((a && a.year) || 0) < ((b && b.year) || 0);
  }

  /* Fold a second copy of the same film into the entry, and decide which copy
     the entry should be *shown* as: the preferred server's, when it has one.
     That is what makes the preference visible — the badges in the masthead
     describe the copy you would get if you pressed OK and never looked at the
     detail page.

     `_sources` holds the OTHER copies, not this one: a self-reference would
     make the row a cycle, and these get written to IndexedDB. Read it through
     sources(), which puts the shown copy back at the front. */
  function combine(primary, item) {
    var extras = primary._sources || [], i;
    /* One copy per server. A film listed twice by the same server (two
       editions in one library) is not what this is for — versions within one
       item are, and those live in Media[], not here. */
    if (primary._server === item._server) return primary;
    for (i = 0; i < extras.length; i++) {
      if (extras[i]._server === item._server) return primary;
    }

    /* Plex syncs the position between servers, but if they disagree, the
       furthest through is the one worth resuming. */
    var offset = Math.max(primary.viewOffset || 0, item.viewOffset || 0);
    var seen = Math.max(primary.lastViewedAt || 0, item.lastViewedAt || 0);
    var shown;

    if (Servers.preferred() === item._server && primary._server !== Servers.preferred()) {
      delete primary._sources;
      item._sources = [primary].concat(extras);
      shown = item;
    } else {
      primary._sources = extras.concat([item]);
      shown = primary;
    }
    if (offset) shown.viewOffset = offset;
    if (seen) shown.lastViewedAt = seen;
    return shown;
  }

  /* Returns true if this started a new entry, false if it merged into one.
     `keys` may be passed in when the item has already been slimmed down and no
     longer carries the ids they were derived from. */
  function push(idx, item, keys) {
    if (!item) return false;
    var i, at = -1;
    keys = keys || Media.identities(item);
    for (i = 0; i < keys.length; i++) {
      if (idx.map[keys[i]] !== undefined) { at = idx.map[keys[i]]; break; }
    }
    if (at >= 0) {
      idx.out[at] = combine(idx.out[at], item);
      /* Register this copy's other ids too, so a third copy matching on any of
         them lands in the same place. */
      for (i = 0; i < keys.length; i++) {
        if (idx.map[keys[i]] === undefined) idx.map[keys[i]] = at;
      }
      idx.dupes++;
      return false;
    }
    idx.out.push(item);
    at = idx.out.length - 1;
    for (i = 0; i < keys.length; i++) idx.map[keys[i]] = at;
    return true;
  }

  /* Fold several lists into one. Order is first-seen: the first server's list
     in its own order, with anything only the others have appended where it
     first appears. */
  function lists(arrays) {
    var idx = index(), i, j, arr;
    for (i = 0; i < arrays.length; i++) {
      arr = arrays[i] || [];
      for (j = 0; j < arr.length; j++) push(idx, arr[j]);
    }
    return idx.out;
  }

  /* Every copy of this film, the one we are displaying first. */
  function sources(item) {
    if (!item) return [];
    return [item].concat(item._sources || []);
  }

  function isShared(item) { return !!(item && item._sources && item._sources.length); }

  /* ---------- the streaming merge ---------- */

  /* Only the fields the rail and the masthead actually draw. A merged All row
     keeps everything you have scrolled past, so a 30,000 film walk holds
     30,000 of these — whole Plex items would be several times the size. The
     detail page re-fetches anyway. */
  function slim(item) {
    var media = (item.Media && item.Media[0]) || null;
    var out = {
      ratingKey: item.ratingKey,
      _server: item._server,
      title: item.title,
      titleSort: item.titleSort,
      year: item.year,
      duration: item.duration,
      contentRating: item.contentRating,
      thumb: item.thumb,
      summary: item.summary,
      guid: item.guid,
      viewOffset: item.viewOffset,
      lastViewedAt: item.lastViewedAt
    };
    if (media) {
      out.Media = [{
        videoResolution: media.videoResolution,
        videoCodec: media.videoCodec,
        container: media.container,
        width: media.width,
        height: media.height
      }];
    }
    return out;
  }

  /* parts: [{ server, key, filter, tag }] — one per server section being
     merged. fetch(part, offset) must resolve { items, total }. */
  function stream(parts, fetch) {
    return {
      fetch: fetch,
      streams: parts.map(function (p) {
        return { part: p, offset: 0, buffer: [], total: 0, done: false, counted: false };
      }),
      idx: index(),
      exhausted: false,
      busy: null
    };
  }

  /* An upper bound until the walk finishes: every copy on every server, less
     the duplicates found so far. It only ever gets more accurate. */
  function estimate(st) {
    var total = 0, i;
    for (i = 0; i < st.streams.length; i++) total += st.streams[i].total;
    return Math.max(st.idx.out.length, total - st.idx.dupes);
  }

  function items(st) { return st.idx.out; }

  function fetchInto(st, s) {
    return st.fetch(s.part, s.offset).then(function (res) {
      var got = (res && res.items) || [], i;
      if (res && res.total) s.total = res.total;
      s.offset += got.length;
      for (i = 0; i < got.length; i++) s.buffer.push(got[i]);
      if (!got.length || (s.total && s.offset >= s.total)) s.done = true;
      return s;
    }, function () {
      /* A server that stops answering drops out of the merge rather than
         stalling the row. */
      s.done = true;
      return s;
    });
  }

  /* Materialise the merged list until index `upTo` exists, or the servers run
     out. Concurrent calls share one walk. */
  function advance(st, upTo) {
    if (st.idx.out.length > upTo || st.exhausted) return Promise.resolve(st.idx.out);
    if (st.busy) return st.busy;
    st.busy = fill(st, upTo).then(function (out) { st.busy = null; return out; },
                                  function (e) { st.busy = null; throw e; });
    return st.busy;
  }

  function fill(st, upTo) {
    var i, needs, live, pick;
    /* A loop, not recursion: walking deep into a big library would otherwise
       build a stack frame per film. */
    while (st.idx.out.length <= upTo) {
      needs = [];
      for (i = 0; i < st.streams.length; i++) {
        if (!st.streams[i].done && !st.streams[i].buffer.length) needs.push(st.streams[i]);
      }
      if (needs.length) {
        return Promise.all(needs.map(function (s) { return fetchInto(st, s); }))
          .then(function () { return fill(st, upTo); });
      }
      live = [];
      for (i = 0; i < st.streams.length; i++) {
        if (st.streams[i].buffer.length) live.push(st.streams[i]);
      }
      if (!live.length) { st.exhausted = true; break; }

      pick = live[0];
      for (i = 1; i < live.length; i++) {
        if (before(live[i].buffer[0], pick.buffer[0])) pick = live[i];
      }
      /* Identities come off the full item — slimming drops the Guid array they
         are mostly derived from. */
      var raw = pick.buffer.shift();
      push(st.idx, slim(raw), Media.identities(raw));
    }
    return Promise.resolve(st.idx.out);
  }

  return {
    lists: lists, sources: sources, isShared: isShared, slim: slim,
    stream: stream, advance: advance, estimate: estimate, items: items,
    /* exported for the tests */
    push: push, index: index
  };
})();

if (typeof module !== 'undefined') module.exports = Merge;
