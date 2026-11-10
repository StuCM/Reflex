/* One actor, drawn in the cast row: their work as poster tiles, newest first,
   and a line about them. Owns no state; the page says which tile is focused. */
import * as art from '../data/art';
import { div, put } from './dom';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** '1962-05-12' as '12 May 1962'; a date TMDB only half knows as what it has. */
export function date(iso: string): string {
  const [year, month, day] = iso.split('-');
  const name = MONTHS[Number(month) - 1];
  if (!year || !name) return year ?? '';
  return day ? `${Number(day)} ${name} ${year}` : `${name} ${year}`;
}

export function bio(person: TmdbPerson): string {
  const born = person.birthday ? date(person.birthday) : '';
  let line = '';
  if (born) line = `Born ${born}${person.placeOfBirth ? `, ${person.placeOfBirth}` : ''}`;
  else if (person.placeOfBirth) line = `Born in ${person.placeOfBirth}`;
  if (person.deathday) line += `${line ? '   ·   ' : ''}Died ${date(person.deathday)}`;
  return line;
}

/** The focused row moved by `by`, held inside the list. */
export function step(index: number, delta: number, length: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(0, length - 1));
}

/** Tiles across the strip before it has to wind. */
const VISIBLE = 6;
/** Tile width and the gap after it, which is how far one step winds the strip. */
export const STRIDE = 233;
const LEAD = 2;

/** The offset of the strip's first tile: the focus sits LEAD tiles in until the credits run out. */
export function shift(index: number, length: number): number {
  return Math.min(Math.max(index - LEAD, 0), Math.max(0, length - VISIBLE));
}

export interface PersonPanel {
  root: HTMLDivElement;
  track: HTMLDivElement;
  tiles: HTMLElement[];
}

function tile(credit: TmdbFilm): HTMLElement {
  const inner = div('tile-inner');
  if (credit.poster_path) {
    const poster = document.createElement('img');
    poster.src = art.url(credit.poster_path, 'w342');
    poster.alt = '';
    put(inner, poster);
  }
  const kind = credit.media === 'tv' ? 'Show' : 'Film';
  const sub = credit.year ? `${credit.year} · ${kind}` : kind;
  const root = div('tile');
  put(root, inner, div('tile-title', credit.title), div('tile-sub', sub));
  return root;
}

/** Their work as poster tiles, and under it who they are. */
export function build(person: TmdbPerson, name: string, credits: TmdbFilm[]): PersonPanel {
  const tiles = credits.map(tile);
  const track = div('pp-track');
  put(track, ...tiles);
  const strip = div('pp-strip');
  put(strip, track);
  const about = div('pp-about');
  const count = credits.length ? `${credits.length} films and shows` : 'No other credits listed.';
  put(about, div('pp-name', name), div('pp-bio', bio(person)), div('pp-count', count));
  const root = div('pp');
  put(root, strip, about);
  return { root, track, tiles };
}

/** Rings the tile at `index` and winds the strip to keep it in view. */
export function focus(panel: PersonPanel, index: number): void {
  panel.tiles.forEach((one, at) => one.classList.toggle('on', at === index));
  panel.track.style.setProperty('--strip-x', `${-shift(index, panel.tiles.length) * STRIDE}px`);
}
