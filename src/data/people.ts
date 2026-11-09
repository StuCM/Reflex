/* An actor's work, for the series page. Asked only when OK is pressed on a
   face, then kept: a bio does not change. */
import { person as askPerson } from '../api/tmdb';
import * as cached from './cached';

/** Credits shown; a long career is a long list to walk with a remote. */
const CAP = 30;

function plain(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** The TMDB credit for a Plex actor, by exact name. */
export function match(name: string, cast: CastId[]): CastId | undefined {
  const wanted = plain(name);
  return cast.find((credit) => plain(credit.name) === wanted);
}

/* Sorts indices, not credits: sort is not stable on Chromium 53, and equal
   years must keep TMDB's order. Undated go last. */
export function newestFirst(credits: TmdbFilm[]): TmdbFilm[] {
  const year = (at: number) => credits[at]?.year ?? 0;
  const order: number[] = [];
  for (let at = 0; at < credits.length; at++) order.push(at);
  order.sort((one, two) => year(two) - year(one) || one - two);
  return order.slice(0, CAP).map((at) => credits[at] as TmdbFilm);
}

export async function person(id: string): Promise<TmdbPerson> {
  const hit = await cached.people.get(id);
  if (hit) return hit;
  const got = await askPerson(id);
  void cached.people.put(id, got);
  return got;
}
