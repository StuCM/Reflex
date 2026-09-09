/* The Discovery page: your own categories, drawn from TMDB.

   A tile only needs a title and a picture, and TMDB has both — so a row here
   costs one TMDB request and not a single one against a server we do not own.
   Everything Plex-shaped (a ratingKey, media, a guard verdict) is needed only
   when acting on a title, so it is fetched when you rest on one and not before.

   js/config.js holds the categories, js/tmdb.js fetches them, this turns them
   into rows and answers "do we actually have this?" one title at a time. */
var Discovery = (function () {
  'use strict';

  function enabled() { return Tmdb.enabled(); }

  /* A TMDB result as something the rail can draw with no Plex request at all:
     the synthetic Guid is what js/art.js keys the poster on, and _resolved is
     undefined until someone asks whether we hold it. */
  function entry(result) {
    return { type: 'movie', title: result.title, year: result.year,
             Guid: [{ id: `tmdb://${result.id}` }],
             _tmdb: result,
             _resolved: undefined };
  }

  /* Is this a title drawn from TMDB rather than out of a library? */
  function isEntry(item) { return !!(item && item._tmdb); }

  /* The line the masthead shows under the name — the honest answer before OK
     is pressed. */
  function settle(item, found) {
    const sub = found ? Media.railSub(found) : '';
    item._resolved = found || null;
    item._availability = !found ? 'Not in your library'
      : (sub ? `In your library  ·  ${sub}` : 'In your library');
  }

  function ask(id) {
    return Promise.all(Servers.all().map((sv) => {
      return Plex.findByGuid(sv, `tmdb://${id}`).catch(() => { return null; });
    })).then((perServer) => {
      const hits = [];
      for (let i = 0; i < perServer.length; i++) if (perServer[i]) hits.push(perServer[i]);
      return hits.length ? Merge.lists([hits])[0] : null;
    });
  }

  /* The copy we hold of a TMDB title, or null for one we do not. Call it for
     the focused tile and on OK — never for a tile that is merely drawn, which
     is the whole difference between this page and crawling the library. */
  function resolve(item) {
    if (item._resolved !== undefined) return Promise.resolve(item._resolved);
    if (item._asking) return item._asking;
    item._asking = Cache.lookup.get(item._tmdb.id).then((hit) => {
      if (hit !== undefined) return hit;
      return ask(item._tmdb.id).then((found) => {
        Cache.lookup.put(item._tmdb.id, found);
        return found;
      });
    }).then((found) => {
      settle(item, found);
      return item._resolved;
    }, (e) => {
      item._asking = null;                    // a failed lookup is worth retrying
      UI.debug(`resolve ${item.title}: ${e.message}`);
      return null;
    });
    return item._asking;
  }

  /* One row per category in js/config.js, each one TMDB request cached for the
     day and published the moment it lands. ctx.isCurrent() guards against a
     section switch mid-flight; ctx.seeds are the TMDB ids of what has been
     watched, which the caller already holds — asking a server for them would
     cost the page the very thing it exists to avoid. */
  function load(ctx) {
    const cats = Config.categories || [];
    let i = 0;
    function step() {
      if (!ctx.isCurrent() || i >= cats.length) return Promise.resolve();
      return one(ctx, cats[i++]).then(step);
    }
    return step();
  }

  function one(ctx, cat) {
    const seeds = ctx.seeds || [];
    const key = cat.kind + ':' + (cat.id || seeds.join('-'));
    return Cache.catalogue.get(key).then((hit) => {
      if (hit && hit.length) return hit;
      return Tmdb.catalogue(cat, seeds).then((found) => {
        Cache.catalogue.put(key, found);
        return found;
      });
    }).then((found) => {
      if (!ctx.isCurrent()) return;
      if (!found.length) { UI.debug(cat.title + ': TMDB returned nothing'); return; }
      ctx.add(cat.title, found.map(entry));
      UI.debug(cat.title + ': ' + found.length + ' from TMDB');
    }, (e) => {
      UI.debug(cat.title + ' failed: ' + e.message);
    });
  }

  return { enabled: enabled, load: load, entry: entry, isEntry: isEntry, resolve: resolve };
})();
