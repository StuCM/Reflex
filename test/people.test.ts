/* Which TMDB person is a Plex actor, and in what order their work reads.
   Run: npx vitest run test/people.test.ts */
import assert from 'node:assert';
import { test } from 'vitest';
import { match, newestFirst } from '../src/data/people';

function credit(title: string, year: number | null): TmdbFilm {
  return { id: title, title, year, poster_path: null, backdrop_path: null, vote_average: 7 };
}

test('newestFirst keeps the given order for equal years, past ten items', () => {
  const same = Array.from({ length: 14 }, (_, at) => credit(`same ${at}`, 2019));
  const list = [credit('old', 1990), credit('undated', null), ...same, credit('new', 2024)];
  const titles = newestFirst(list).map((entry) => entry.title);
  assert.deepStrictEqual(titles, ['new', ...same.map((entry) => entry.title), 'old', 'undated']);
});

test('newestFirst stops at thirty', () => {
  const long = Array.from({ length: 45 }, (_, at) => credit(`film ${at}`, 2000 + (at % 20)));
  assert.strictEqual(newestFirst(long).length, 30);
});

test('match ignores case and accents, and wants the whole name', () => {
  const cast: CastId[] = [
    { name: 'Penélope Cruz', id: '1', profile: null },
    { name: 'Tom Hanks', id: '2', profile: null },
  ];
  assert.strictEqual(match('penelope CRUZ', cast)?.id, '1');
  assert.strictEqual(match('Tom Hanks', cast)?.id, '2');
  assert.strictEqual(match('Tom', cast), undefined);
});
