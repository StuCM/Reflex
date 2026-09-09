/* Curated rows: take a small external list and ask the server which of it we
   already have.

   The direction matters. Indexing 30,000 library items against TMDB would mean
   a full crawl of a server we do not own, plus somewhere to keep the index.
   Starting from twenty curated titles and asking "do you have this one?" is
   forty small requests and no crawl at all.

   js/tmdb.js fetches the lists; this turns them into rows. */
var Discovery = (function () {
  'use strict';

  const MAX_LOOKUPS = 40;          // titles per row we will ask the server about
  const CONCURRENCY = 4;
  const MAX_SEEDS = 8;

  function enabled() { return Tmdb.enabled(); }

  /* Bounded concurrency: guid lookups are one small request each, but firing
     forty at a remote server at once is rude and slower in practice. */
  function mapLimit(list, max, fn) {
    return new Promise(resolve => {
      const results = new Array(list.length);
      let i = 0, done = 0, active = 0;
      if (!list.length) { resolve([]); return; }
      function launch() {
        while (active < max && i < list.length) {
          active++;
          /* k is per-turn, which is the whole reason this is const in the loop
             body rather than the index itself. */
          const k = i++;
          fn(list[k]).then(v => { results[k] = v; }, () => { results[k] = null; })
            .then(() => {
              active--; done++;
              if (done === list.length) resolve(results); else launch();
            });
        }
      }
      launch();
    });
  }

  /* TMDB ids -> the items we actually hold, on any server, order preserved and
     one entry per film however many servers have it. */
  function matchToLibrary(tmdbIds) {
    return mapLimit(tmdbIds.slice(0, MAX_LOOKUPS), CONCURRENCY, id => {
      return Promise.all(Servers.all().map(sv => {
        return Plex.findByGuid(sv, 'tmdb://' + id);
      })).then(perServer => {
        const hits = perServer.filter(m => !!m);
        return hits.length ? Merge.lists([hits])[0] : null;
      });
    }).then(found => {
      return found.filter(m => !!m);
    });
  }

  function seedsFromViewing() {
    return Promise.all(Servers.all().map(sv => {
      return Plex.onDeck(sv);
    })).then(perServer => {
      const seeds = [];
      const list = Devices.mine(Merge.lists(perServer));
      for (let i = 0; i < list.length && seeds.length < MAX_SEEDS; i++) {
        const id = Plex.tmdbId(list[i]);
        if (id) seeds.push(id);
      }
      return seeds;
    }).catch(() => []);
  }

  /* ctx.isCurrent() guards against a section switch mid-flight; ctx.add(title,
     items) puts a row on screen the moment it resolves, rather than making the
     user wait for the slowest one. */
  function load(ctx) {
    const tasks = [{ title: 'Trending this week', get: Tmdb.trending }];
    Tmdb.providers.forEach(p => {
      tasks.push({ title: 'On ' + p.name,
                   get: () => Tmdb.onProvider(p.id) });
    });

    function runTask(t) {
      return t.get().then(matchToLibrary).then(items => {
        if (!ctx.isCurrent()) return;
        if (!items.length) { UI.debug(t.title + ': nothing on this server'); return; }
        ctx.add(t.title, items);
        UI.debug(t.title + ': ' + items.length + ' on this server');
      }, e => {
        UI.debug(t.title + ' failed: ' + e.message);
      });
    }

    let i = 0;
    function step() {
      if (!ctx.isCurrent() || i >= tasks.length) return Promise.resolve();
      return runTask(tasks[i++]).then(step);
    }

    return step().then(() => {
      if (!ctx.isCurrent()) return;
      return seedsFromViewing().then(seeds => {
        if (!ctx.isCurrent() || !seeds.length) return;
        return Tmdb.recommendedFrom(seeds).then(matchToLibrary).then(items => {
          if (!ctx.isCurrent() || !items.length) return;
          ctx.add('Because of what you have been watching', items);
        });
      });
    });
  }

  return { enabled: enabled, load: load };
})();
