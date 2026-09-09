/* Seasons and episodes, merged across servers.

   A show entry from the rail is already merged — it carries a copy of the show
   from each server that has it. Drilling in means asking each of those servers
   for its own children and merging those too, at both levels: a season is one
   season however many servers hold it, and so is an episode.

   Nothing here fetches a whole library. One show, one season at a time. */
var Shows = (function () {
  'use strict';

  const entries = {};              // '<server>:<showKey>' -> Promise<entry|null>

  /* Seasons of a merged show entry, in order.
     Each returned season carries its own per-server copies, which is what the
     episode fetch then walks. */
  function seasons(entry) {
    const copies = Merge.sources(entry);
    return Promise.all(copies.map((copy) => {
      return Plex.children(Servers.of(copy), copy.ratingKey);
    })).then((perServer) => {
      const merged = Merge.lists(perServer.map((list) => {
        return list.filter((m) => { return m.type === 'season'; });
      }));
      merged.sort((a, b) => { return (a.index || 0) - (b.index || 0); });
      return merged;
    });
  }

  /* Episodes of a merged season, in order. */
  function episodes(season) {
    const copies = Merge.sources(season);
    return Promise.all(copies.map((copy) => {
      return Plex.children(Servers.of(copy), copy.ratingKey);
    })).then((perServer) => {
      const merged = Merge.lists(perServer.map((list) => {
        return list.filter((m) => { return m.type === 'episode'; });
      }));
      merged.sort((a, b) => { return (a.index || 0) - (b.index || 0); });
      return merged;
    });
  }

  /* The series an episode belongs to, merged across every server that has it,
     or null if it cannot be resolved. Cached per show, because pressing OK on
     three episodes of one show must cost one resolution. */
  function entryFor(episode) {
    if (!episode || !episode.grandparentRatingKey) return Promise.resolve(null);
    const key = episode._server + ':' + episode.grandparentRatingKey;
    if (!entries[key]) entries[key] = resolve(episode);
    return entries[key];
  }

  function resolve(episode) {
    return Meta.load({ ratingKey: episode.grandparentRatingKey,
                       _server: episode._server }).then((md) => {
      if (!md) return null;
      /* Up to the show and out from there: episodes rarely carry ids of their
         own, but the show does, so its ids are what the other servers are asked
         for. Its own server's copy leads the fold, so a show only one server
         has is simply a one-source entry and the page is happy with that. */
      return Promise.all(Servers.all().map((sv) => {
        return Plex.allVersions(sv, md);
      })).then((perServer) => {
        return Merge.lists([[md]].concat(perServer))[0];
      });
    }).catch(() => { return null; });
  }

  /* Is this merged entry a copy of that episode? Matched by rating key across
     every copy, because the episode playing is one server's and the merged
     entry may lead with the other's. */
  function isCopyOf(entry, episode) {
    const copies = Merge.sources(entry);
    for (let i = 0; i < copies.length; i++) {
      if (String(copies[i].ratingKey) === String(episode.ratingKey)) return true;
    }
    return false;
  }

  /* The episode after `current` in a season's list, or null at the end of it or
     when `current` is not in the list at all. Pure, so it is unit tested. */
  function nextInList(episodes, current) {
    if (!episodes || !current) return null;
    for (let i = 0; i < episodes.length; i++) {
      if (isCopyOf(episodes[i], current)) return episodes[i + 1] || null;
    }
    return null;
  }

  /* What follows an episode: the next in its season, else the first of the next
     season, or null once the series is over. newSeason is what stops an
     unattended chain rolling across a season boundary. */
  function nextAfter(episode) {
    if (!episode) return Promise.resolve(null);
    return entryFor(episode).then((entry) => {
      if (!entry) return null;
      return seasons(entry).then((list) => {
        let at = -1;
        for (let i = 0; i < list.length; i++) {
          if (list[i].index === episode.parentIndex) { at = i; break; }
        }
        if (at < 0) return null;
        return episodes(list[at]).then((eps) => {
          const next = nextInList(eps, episode);
          if (next) return { episode: next, newSeason: false };
          /* seasons() is sorted by index, so the one after is simply the next. */
          if (at + 1 >= list.length) return null;
          return episodes(list[at + 1]).then((more) => {
            return more.length ? { episode: more[0], newSeason: true } : null;
          });
        });
      });
    }).catch(() => { return null; });
  }

  /* "4 series · 38 episodes", or as much of it as the server told us. */
  function summary(entry) {
    const bits = [];
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
    for (let i = 0; i < list.length; i++) {
      if ((list[i].leafCount || 0) > (list[i].viewedLeafCount || 0)) return i;
    }
    return 0;
  }

  return { seasons: seasons, episodes: episodes, entryFor: entryFor,
           nextInList: nextInList, nextAfter: nextAfter,
           summary: summary, openAt: openAt };
})();
