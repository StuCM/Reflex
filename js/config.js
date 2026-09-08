/* Settings that differ between the TV and a laptop, in one place. Loaded first.

   On the TV nothing overrides these, so the defaults are what ships. The dev
   server injects window.REFLEX_CONFIG before this file runs, which is the only
   seam the app needs to talk to a fake server instead of a real one. */
var Config = (function () {
  'use strict';

  var cfg = {
    /* plex.tv itself, unless something is standing in for it. */
    plexTvBase: 'https://plex.tv',

    /* Free TMDB v3 API key. Empty means the discovery rows don't appear and
       the artwork stays whatever Plex has; nothing else is affected. */
    tmdbKey: '',

    /* TMDB's API and its image CDN, unless something is standing in for them. */
    tmdbBase: 'https://api.themoviedb.org/3',
    tmdbImageBase: 'https://image.tmdb.org/t/p/',

    /* Free YouTube Data API v3 key, for the season recaps on a show page. Empty
       means the Find recaps action does not appear; nothing else is affected. */
    youtubeKey: '',

    /* YouTube's API and its embed player, unless something is standing in. */
    youtubeBase: 'https://www.googleapis.com/youtube/v3',
    youtubeEmbedBase: 'https://www.youtube.com/embed/',

    /* Bring-up only: WAM doesn't forward console.log anywhere readable on this
       set, so the app can POST its debug line to a listener on the dev machine.
       Empty switches it off. Set it to e.g. 'http://192.168.1.92:8099/' while
       working on the TV — see `npm run beacon`. */
    beacon: '',

    /* True only under the dev server. Nothing should behave differently because
       of it; it exists so the debug line can say where it is running. */
    dev: false
  };

  var over = (typeof window !== 'undefined' && window.REFLEX_CONFIG) || null;
  if (over) {
    var keys = Object.keys(over), i;
    for (i = 0; i < keys.length; i++) cfg[keys[i]] = over[keys[i]];
  }
  return cfg;
})();
