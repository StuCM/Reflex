/* One actor, drawn in the cast area: a large face, their work newest first and
   a line of bio. Owns no state; the series page says which row is focused. */
import { div, fill, put, span } from './dom';

/** Rows of the credits list on screen at once. */
export const ROWS = 6;
const LEAD = 2;

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

/** First row drawn: the focus sits LEAD rows down until the list runs out. */
export function windowStart(index: number, length: number): number {
  return Math.min(Math.max(index - LEAD, 0), Math.max(0, length - ROWS));
}

export interface PersonPanel {
  root: HTMLDivElement;
  list: HTMLDivElement;
}

export function build(person: TmdbPerson, face: string, name: string): PersonPanel {
  const picture = span('sh-person-face');
  if (face) picture.style.setProperty('--face', `url("${face}")`);
  const list = div('sh-person-list');
  const root = div('sh-person');
  put(root, picture, div('sh-person-name', name), list, div('sh-person-bio', bio(person)));
  return { root, list };
}

export function paintList(list: HTMLElement, credits: TmdbFilm[], index: number): void {
  if (!credits.length) {
    fill(list, div('sh-credit', 'No other credits listed.'));
    return;
  }
  const first = windowStart(index, credits.length);
  const rows = credits.slice(first, first + ROWS).map((credit, at) => {
    const row = div(`sh-credit${first + at === index ? ' on' : ''}`);
    put(
      row,
      span('sh-credit-title', credit.title),
      span('sh-credit-year', credit.year ? String(credit.year) : ''),
      span('sh-credit-kind', credit.media === 'tv' ? 'Show' : 'Film'),
    );
    return row;
  });
  fill(list, ...rows);
}
