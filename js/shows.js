/* Seasons and episodes, merged across servers.

   A show entry from the rail is already merged — it carries a copy of the show
   from each server that has it. Drilling in means asking each of those servers
   for its own children and merging those too, at both levels: a season is one
   season however many servers hold it, and so is an episode.

   Nothing here fetches a whole library. One show, one season at a time. */
var Shows = (function () {
  'use strict';

  /* Seasons of a merged show entry, in order.
     Each returned season carries its own per-server copies, which is what the
     episode fetch then walks. */
  function seasons(entry) {
    var copies = Merge.sources(entry);
    return Promise.all(copies.map(function (copy) {
      return Plex.children(Servers.of(copy), copy.ratingKey);
    })).then(function (perServer) {
      var merged = Merge.lists(perServer.map(function (list) {
        return list.filter(function (m) { return m.type === 'season'; });
      }));
      merged.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
      return merged;
    });
  }

  /* Episodes of a merged season, in order. */
  function episodes(season) {
    var copies = Merge.sources(season);
    return Promise.all(copies.map(function (copy) {
      return Plex.children(Servers.of(copy), copy.ratingKey);
    })).then(function (perServer) {
      var merged = Merge.lists(perServer.map(function (list) {
        return list.filter(function (m) { return m.type === 'episode'; });
      }));
      merged.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
      return merged;
    });
  }

  /* "4 series · 38 episodes", or as much of it as the server told us. */
  function summary(entry) {
    var bits = [];
    if (entry.childCount) {
      bits.push(entry.childCount + ' series');
    }
    if (entry.leafCount) {
      bits.push(entry.leafCount + ' episode' + (entry.leafCount === 1 ? '' : 's'));
    }
    if (entry.leafCount && entry.viewedLeafCount) {
      bits.push(entry.viewedLeafCount + ' watched');
    }
    return bits.join('   ·   ');
  }

  /* The season a merged season list should open on: the first with anything
     unwatched, else the first. Somebody part way through series three does not
     want to land on series one every time. */
  function openAt(list) {
    var i;
    for (i = 0; i < list.length; i++) {
      if ((list[i].leafCount || 0) > (list[i].viewedLeafCount || 0)) return i;
    }
    return 0;
  }

  return { seasons: seasons, episodes: episodes, summary: summary, openAt: openAt };
})();
