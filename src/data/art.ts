/* A title's picture and its facts, from TMDB — queued, cached, and published
   when they land. Painting never waits on it: tile() and hero() answer
   synchronously and warm() repaints one tile when the lookup returns. */
import { photoUrl, posterUrl, artUrl } from '../api/plex/images';
import { tmdbId } from '../api/plex/library';
import { details, enabled } from '../api/tmdb';
import * as cached from './cached';
import * as servers from './servers';
import settings from '../core/config';

/* The tile is 209 wide, so w342 is the next size up — w500 was for a tile
   nearly twice as wide and is a third of a megabyte per poster wasted. */
const POSTER_SIZE = 'w342';
const HERO_SIZE = 'w1280';
const MAX_IN_FLIGHT = 4;

/** Names in the header's key-actors line. */
const CAST = 4;

const held: Record<string, ArtEntry> = {};
const pending: Record<string, true> = {};
const queue: string[] = [];
let active = 0;
const listeners: ((id: string) => void)[] = [];

/** The best-voted path out of one of TMDB's image lists, or null. */
function bestOf(list: TmdbImage[] | undefined): string | null {
  if (!Array.isArray(list)) return null;
  const usable = list.filter((image) => image?.file_path);
  usable.sort(
    (one, two) =>
      (two.vote_average ?? 0) - (one.vote_average ?? 0) ||
      (two.vote_count ?? 0) - (one.vote_count ?? 0),
  );
  return usable[0]?.file_path ?? null;
}

/* The backdrop behind the header and the poster on the tile, from one payload.
   Never throws: nothing usable gives two nulls. */
export function pick(payload: TmdbDetails | null | undefined): ArtEntry {
  /* The images used to be the whole payload and are now appended to it, so both
     shapes are read — old cache entries are still the old one. */
  const images = payload?.images ?? payload ?? {};
  return { hero: bestOf(images.backdrops), poster: bestOf(images.posters) };
}

/* What the header says about a title, out of the same payload. Never throws:
   anything missing gives empty. */
export function facts(payload: TmdbDetails | null | undefined): ArtFacts {
  const billing = Array.isArray(payload?.credits?.cast) ? payload.credits.cast : [];
  const cast: string[] = [];
  billing.forEach((person) => {
    if (person?.name && cast.length < CAST) cast.push(person.name);
  });
  const score = typeof payload?.vote_average === 'number' ? payload.vote_average : 0;
  return {
    overview: typeof payload?.overview === 'string' ? payload.overview : '',
    runtime: typeof payload?.runtime === 'number' ? payload.runtime : null,
    /* Out of ten, one decimal. Zero is TMDB's "nobody has voted", not a score. */
    rating: score ? Math.round(score * 10) / 10 : null,
    cast,
  };
}

export function url(path: string, size: string): string {
  return settings.tmdbImageBase + size + path;
}

/* An episode has no film id of its own, and its show's poster already came from
   Plex for nothing, so it is never looked up. */
function idOf(item: PlexItem | null | undefined): string | null {
  if (!item || item.type === 'episode') return null;
  return tmdbId(item);
}

function picked(item: PlexItem | null | undefined): ArtEntry | null {
  const id = idOf(item);
  return id ? (held[id] ?? null) : null;
}

/* The tile picture, always a poster: TMDB's, else for an episode its show's —
   Plex hands that over as grandparentThumb, so it costs no lookup — else the
   item's own thumb. Never a backdrop: 16:9 in a 2:3 box is a smear. */
export function tile(item: PlexItem | null | undefined, width: number, height: number): string {
  if (!item) return '';
  const got = picked(item);
  if (got?.poster) return url(got.poster, POSTER_SIZE);
  if (item.type === 'episode') {
    const show = (item as { grandparentThumb?: string }).grandparentThumb;
    return photoUrl(servers.of(item), show, width, height) || posterUrl(item, width, height);
  }
  return posterUrl(item, width, height);
}

/** The backdrop: TMDB's best, else the same Plex fallback. */
export function hero(item: PlexItem | null | undefined): string {
  const got = picked(item);
  if (got?.hero) return url(got.hero, HERO_SIZE);
  return artUrl(item, 1920, 1080) || posterUrl(item, 1920, 1080);
}

/* The description, run time and key actors, or null if TMDB has not answered
   yet. Synchronous, like tile() and hero(). */
export function factsFor(item: PlexItem | null | undefined): ArtFacts | null {
  return picked(item)?.facts ?? null;
}

/* Look a title's artwork up once, then tell the listeners so they can repaint.
   Cheap to call on every draw: a hit, a miss and a request already in flight
   all return without doing anything. */
export function warm(item: PlexItem | null | undefined): void {
  const id = idOf(item);
  if (!id || !enabled() || held[id] || pending[id]) return;
  pending[id] = true;
  queue.push(id);
  pump();
}

/** Whoever wants to know a title's art has landed. Called with the TMDB id. */
export function onReady(listener: (id: string) => void): void {
  listeners.push(listener);
}

function pump(): void {
  while (active < MAX_IN_FLIGHT && queue.length) {
    const id = queue.shift();
    if (!id) return;
    active++;
    fetchOne(id);
  }
}

function fetchOne(id: string): void {
  void cached.art
    .get(id)
    .then((hit) => {
      /* An entry cached before the facts or the poster existed is a miss for
         them, or an old cache would leave a title short of one for ever. */
      const entry = hit as ArtEntry | undefined;
      if (entry?.facts && entry.poster !== undefined) return entry;
      return details(id).then((payload) => {
        const got = pick(payload as TmdbDetails);
        got.facts = facts(payload as TmdbDetails);
        void cached.art.put(id, got);
        return got;
      });
    })
    .then(
      (got) => {
        landed(id, got);
      },
      () => {
        landed(id, { hero: null, poster: null });
      },
    );
}

/* A title with no usable backdrops is cached too, or an obscure one costs a
   request every time the row is walked past. */
function landed(id: string, got: ArtEntry): void {
  active--;
  delete pending[id];
  held[id] = got;
  pump();
  listeners.forEach((listener) => listener(id));
}
