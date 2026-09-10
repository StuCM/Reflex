/* TMDB, for the curated rows and the artwork.
   External-first on purpose: fetch ~20 titles, then ask Plex which it has.
   The other direction would mean crawling a server we do not own. */
import { queryString, request } from './http';

const KEY = Config.tmdbKey;
const API = Config.tmdbBase;
const REGION = 'GB';

/** The rubbish filter. Junk has almost no votes, so a floor removes most of it. */
const MIN_VOTES = 500;

export function enabled(): boolean {
  return !!KEY;
}

function get(
  path: string,
  parameters: Record<string, string | number> = {},
): Promise<TmdbResponse> {
  return request(`${API}${path}?${queryString({ ...parameters, api_key: KEY })}`, {
    label: `TMDB ${path}`,
  }) as Promise<TmdbResponse>;
}

function goodEnough(result: TmdbResult): boolean {
  return !!result.id && (result.vote_count ?? 0) >= MIN_VOTES;
}

/* Enough to draw a tile with and nothing more: the rest of a TMDB result is
   never shown, and a discovery row holds a dozen of these per category. */
function film(result: TmdbResult): TmdbFilm {
  return {
    id: String(result.id),
    title: result.title ?? '',
    year: Number(String(result.release_date ?? '').slice(0, 4)) || null,
    poster_path: result.poster_path ?? null,
    backdrop_path: result.backdrop_path ?? null,
    vote_average: result.vote_average ?? 0,
  };
}

function films(results: TmdbResult[] | undefined): TmdbFilm[] {
  return (results ?? []).filter(goodEnough).map(film);
}

export function trending(): Promise<TmdbFilm[]> {
  return get('/trending/movie/week').then((body) => films(body.results));
}

/** What is on a streaming service right now, in this region. */
export function onProvider(providerId: number): Promise<TmdbFilm[]> {
  return get('/discover/movie', {
    with_watch_providers: providerId,
    watch_region: REGION,
    sort_by: 'popularity.desc',
    'vote_count.gte': MIN_VOTES,
  }).then((body) => films(body.results));
}

/** One genre, most popular first. Ids come from /genre/movie/list. */
export function byGenre(genreId: number): Promise<TmdbFilm[]> {
  return get('/discover/movie', {
    with_genres: genreId,
    sort_by: 'popularity.desc',
    'vote_count.gte': MIN_VOTES,
  }).then((body) => films(body.results));
}

/** One at a time, on purpose — this is a courtesy API and the rows are small. */
function serial<T>(list: T[], each: (entry: T) => Promise<unknown>): Promise<void> {
  let index = 0;
  function step(): Promise<void> {
    if (index >= list.length) return Promise.resolve();
    const entry = list[index++] as T;
    return each(entry).then(step);
  }
  return step();
}

/* Content-based recommendations: ask TMDB what resembles each thing recently
   watched, then count how often each suggestion comes up. No model, no
   training — frequency across several seeds is enough to be useful. */
export function recommendedFrom(seedTmdbIds: string[] | undefined): Promise<TmdbFilm[]> {
  const seeds = (seedTmdbIds ?? []).slice(0, 8);
  if (!seeds.length) return Promise.resolve([]);

  const score: Record<string, number> = {};
  const seen: Record<string, TmdbFilm> = {};

  return serial(seeds, (seed) =>
    get(`/movie/${seed}/recommendations`).then(
      (body) => {
        films(body.results).forEach((suggestion) => {
          if (seeds.indexOf(suggestion.id) >= 0) return; // do not suggest the seed
          seen[suggestion.id] = suggestion;
          score[suggestion.id] = (score[suggestion.id] ?? 0) + 1;
        });
      },
      () => {
        /* one bad seed should not sink the row */
      },
    ),
  ).then(() =>
    Object.keys(score)
      .sort((one, two) => (score[two] ?? 0) - (score[one] ?? 0))
      .map((id) => seen[id])
      .filter((entry): entry is TmdbFilm => entry !== undefined),
  );
}

/* One category from Config.categories to its films. An unknown kind is a typo
   in the config rather than a crash: it gives an empty row. `seeds` are TMDB
   ids of what has been watched, and only the recommended kind uses them. */
export function catalogue(
  category: DiscoveryCategory | null | undefined,
  seeds?: string[],
): Promise<TmdbFilm[]> {
  if (category?.kind === 'trending') return trending();
  if (category?.kind === 'provider') return onProvider(category.id as number);
  if (category?.kind === 'genre') return byGenre(category.id as number);
  if (category?.kind === 'recommended') return recommendedFrom(seeds);
  return Promise.resolve([]);
}

/* Everything js/data/art.js keeps about a film in one request: the backdrops,
   the overview, the run time and the billing order. `include_image_language`
   matters — without it the appended images are filtered to the request language
   and most backdrops disappear. */
export function details(tmdbId: string): Promise<TmdbResponse> {
  return get(`/movie/${tmdbId}`, {
    append_to_response: 'images,credits',
    include_image_language: 'en,null',
  });
}
