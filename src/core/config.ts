/* Settings that differ between the TV and a laptop, in one place.
   On the TV nothing overrides these, so the defaults are what ships. The dev
   server injects window.REFLEX_CONFIG before the app runs, which is the only
   seam needed to talk to a fake server instead of a real one.
   The two keys come from the environment at build time, so the repo never
   holds one. */

interface Settings {
  plexTvBase: string;
  tmdbKey: string;
  categories: DiscoveryCategory[];
  kidsCategories: DiscoveryCategory[];
  tmdbBase: string;
  tmdbImageBase: string;
  youtubeKey: string;
  youtubeBase: string;
  youtubeEmbedBase: string;
  beacon: string;
  dev: boolean;
}

const PG_CEILING = { certification_country: 'GB', 'certification.lte': 'PG' };

function kids(): DiscoveryCategory[] {
  const film = (title: string, filters: Record<string, string | number>): DiscoveryCategory => ({
    title,
    kind: 'discover',
    media: 'movie',
    params: { ...filters, ...PG_CEILING },
    minVotes: 20,
  });
  const show = (title: string, filters: Record<string, string | number>): DiscoveryCategory => ({
    title,
    kind: 'discover',
    media: 'tv',
    params: filters,
    minVotes: 20,
  });
  const onService = (name: string, id: number): DiscoveryCategory[] => [
    film(`On ${name}`, { with_genres: '10751', with_watch_providers: id }),
    show(`Shows on ${name}`, {
      with_genres: '10762',
      with_watch_providers: id,
    }),
  ];
  return [
    {
      title: 'New and coming',
      kind: 'upcoming',
      params: { with_genres: '10751', region: 'GB', with_release_type: 3 },
      minVotes: 0,
    },
    film('Popular kids films', {
      with_genres: '10751',
      sort_by: 'popularity.desc',
    }),
    show('Popular kids shows', {
      with_genres: '10762',
      sort_by: 'popularity.desc',
    }),
    ...onService('Netflix', 8),
    ...onService('Prime Video', 9),
    ...onService('Disney+', 337),
    film('Animated', {
      with_companies: '2|6125|3|521',
      with_genres: '16',
      sort_by: 'popularity.desc',
    }),
    film('Real people', {
      with_genres: '10751',
      without_genres: '16',
      sort_by: 'popularity.desc',
    }),
    film('Classics from the 90s', {
      with_genres: '10751',
      'primary_release_date.gte': '1988-01-01',
      'primary_release_date.lte': '2000-12-31',
      sort_by: 'vote_count.desc',
    }),
  ];
}

const settings: Settings = {
  /* plex.tv itself, unless something is standing in for it. */
  plexTvBase: 'https://plex.tv',

  /* Free TMDB v3 API key. Empty means the discovery rows don't appear and
     the artwork stays whatever Plex has; nothing else is affected. */
  tmdbKey: import.meta.env.VITE_TMDB_KEY || '',

  /* The Discovery page, in the order they appear on screen. `kind` is what
     js/tmdb.js dispatches on; a genre id comes from TMDB's
     /genre/movie/list and a provider id from JustWatch as TMDB exposes it. */
  categories: [
    { title: 'Trending this week', kind: 'trending' },
    { title: 'Trending shows this week', kind: 'trending', media: 'tv' },
    { title: 'On Netflix', kind: 'provider', id: 8 },
    { title: 'Shows on Netflix', kind: 'provider', id: 8, media: 'tv' },
    { title: 'On Prime Video', kind: 'provider', id: 9 },
    { title: 'Shows on Prime Video', kind: 'provider', id: 9, media: 'tv' },
    { title: 'Science fiction', kind: 'genre', id: 878 },
    { title: 'Sci-fi & fantasy shows', kind: 'genre', id: 10765, media: 'tv' },
    { title: 'Because of what you have been watching', kind: 'recommended' },
  ],

  /* The Kids page: what TMDB calls family and kids, nothing else. Films carry
     a PG_CEILING ceiling except the unreleased row, which often has no certificate yet. */
  kidsCategories: kids(),

  /* TMDB's API and its image CDN, unless something is standing in for them. */
  tmdbBase: 'https://api.themoviedb.org/3',
  tmdbImageBase: 'https://image.tmdb.org/t/p/',

  /* Free YouTube Data API v3 key, for the season recaps on a show page. Empty
     means the Find recaps action does not appear; nothing else is affected. */
  youtubeKey: import.meta.env.VITE_YOUTUBE_KEY || '',

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
  dev: false,
};

const overrides = (typeof window === 'undefined' ? null : window.REFLEX_CONFIG) ?? null;
if (overrides) Object.assign(settings, overrides);

export default settings;
