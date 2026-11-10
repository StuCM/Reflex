/* TMDB, for the curated rows and the artwork.
   External-first on purpose: fetch ~20 titles, then ask Plex which it has.
   The other direction would mean crawling a server we do not own. */
import { queryString, request } from './http';
import settings from '../core/config';

const KEY = settings.tmdbKey;
const API = settings.tmdbBase;
const REGION = 'GB';

/** The rubbish filter. Junk has almost no votes, so a floor removes most of it. */
const MIN_VOTES = 500;

type Media = 'movie' | 'tv';

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

function goodEnough(result: TmdbResult, minVotes = MIN_VOTES): boolean {
  return !!result.id && (result.vote_count ?? 0) >= minVotes;
}

/* Enough to draw a tile with and nothing more: the rest of a TMDB result is
   never shown, and a discovery row holds a dozen of these per category. */
export function film(result: TmdbResult, media: Media): TmdbFilm {
  return {
    id: String(result.id),
    media,
    title: result.title ?? result.name ?? '',
    year: Number(String(result.release_date ?? result.first_air_date ?? '').slice(0, 4)) || null,
    poster_path: result.poster_path ?? null,
    backdrop_path: result.backdrop_path ?? null,
    vote_average: result.vote_average ?? 0,
  };
}

function films(
  results: TmdbResult[] | undefined,
  media: Media = 'movie',
  minVotes = MIN_VOTES,
): TmdbFilm[] {
  return (results ?? [])
    .filter((result) => goodEnough(result, minVotes))
    .map((result) => film(result, media));
}

/* TMDB refuses a page above 500, whatever total_pages claims. */
const MAX_PAGES = 500;

export interface TmdbPage {
  films: TmdbFilm[];
  pages: number;
}

function paged(body: TmdbResponse, media: Media, minVotes = MIN_VOTES): TmdbPage {
  return {
    films: films(body.results, media, minVotes),
    pages: Math.min(Math.max(body.total_pages ?? 1, 1), MAX_PAGES),
  };
}

export async function trending(page = 1, media: Media = 'movie'): Promise<TmdbPage> {
  return paged(await get(`/trending/${media}/week`, { page }), media);
}

/** What is on a streaming service right now, in this region. */
export async function onProvider(
  providerId: number,
  page = 1,
  media: Media = 'movie',
): Promise<TmdbPage> {
  return paged(
    await get(`/discover/${media}`, {
      with_watch_providers: providerId,
      watch_region: REGION,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES,
      page,
    }),
    media,
  );
}

/** One genre, most popular first. Ids come from /genre/movie/list. */
export async function byGenre(
  genreId: number,
  page = 1,
  media: Media = 'movie',
): Promise<TmdbPage> {
  return paged(
    await get(`/discover/${media}`, {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES,
      page,
    }),
    media,
  );
}

/** A free-form /discover query; the kids rows are built from these. */
export async function discover(
  media: Media,
  parameters: Record<string, string | number>,
  page = 1,
  minVotes = MIN_VOTES,
): Promise<TmdbPage> {
  const query: Record<string, string | number> = { ...parameters, page };
  if ('with_watch_providers' in parameters) query.watch_region = REGION;
  return paged(await get(`/discover/${media}`, query), media, minVotes);
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

/* One category from settings.categories to its films. An unknown kind is a typo
   in the config rather than a crash: it gives an empty row. `seeds` are TMDB
   ids of what has been watched, and only the recommended kind uses them. */
export async function catalogue(
  category: DiscoveryCategory | null | undefined,
  seeds?: string[],
  page = 1,
): Promise<TmdbPage> {
  const media = category?.media ?? 'movie';
  if (category?.kind === 'trending') return trending(page, media);
  if (category?.kind === 'provider') return onProvider(category.id as number, page, media);
  if (category?.kind === 'genre') return byGenre(category.id as number, page, media);
  const parameters = category?.params ?? {};
  if (category?.kind === 'discover') {
    return discover(media, parameters, page, category.minVotes);
  }
  /* No votes yet is the point of an unreleased film, so this row has no floor. */
  if (category?.kind === 'upcoming') {
    const now = new Date();
    const later = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
    const upcoming = {
      ...parameters,
      'primary_release_date.gte': now.toISOString().slice(0, 10),
      'primary_release_date.lte': later.toISOString().slice(0, 10),
      sort_by: 'popularity.desc',
    };
    return discover('movie', upcoming, page, 0);
  }
  if (category?.kind === 'recommended') return { films: await recommendedFrom(seeds), pages: 1 };
  return { films: [], pages: 1 };
}

/* Everything js/data/art.js keeps about a film in one request: the backdrops,
   the overview, the run time and the billing order. `include_image_language`
   matters — without it the appended images are filtered to the request language
   and most backdrops disappear. */
export function details(tmdbId: string): Promise<TmdbResponse> {
  /* A show's id is `tv/<id>` everywhere it is keyed, so it is its own path. */
  const path = tmdbId.startsWith('tv/') ? `/${tmdbId}` : `/movie/${tmdbId}`;
  return get(path, {
    append_to_response: 'images,credits,videos',
    include_image_language: 'en,null',
  });
}

interface PersonBody {
  name?: string;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  profile_path?: string | null;
  combined_credits?: { cast?: TmdbResult[] };
}

/** An actor's dates, place and acting credits, in TMDB's order. */
export async function person(id: string): Promise<TmdbPerson> {
  const body = (await get(`/person/${id}`, {
    append_to_response: 'combined_credits',
  })) as PersonBody;
  const cast = body.combined_credits?.cast ?? [];
  return {
    name: body.name ?? '',
    birthday: body.birthday || null,
    deathday: body.deathday || null,
    placeOfBirth: body.place_of_birth || null,
    profile: body.profile_path ?? null,
    credits: cast
      .filter((credit) => goodEnough(credit))
      .map((credit) => film(credit, credit.media_type === 'tv' ? 'tv' : 'movie')),
  };
}
