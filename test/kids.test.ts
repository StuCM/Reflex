import assert from 'node:assert';
import { beforeEach, expect, test, vi } from 'vitest';

const server = { id: 'a' } as PlexServer;
const flaky = { id: 'b' } as PlexServer;
const active = [server];
const calls: string[] = [];
const extras: Record<string, string | number>[] = [];
let flakyReads = 0;

function film(id: string, type = 'movie'): PlexItem {
  return { type, Guid: [{ id: `tmdb://${id}` }] } as PlexItem;
}

vi.mock('../src/api/plex/library', async () => {
  const real =
    await vi.importActual<typeof import('../src/api/plex/library')>('../src/api/plex/library');
  const lib = (key: string, title: string, type: string) => ({
    key,
    title,
    type,
  });
  return {
    ...real,
    sections: async () => [
      lib('1', 'Movies', 'movie'),
      lib('2', 'Movies - Kids', 'movie'),
      lib('3', 'TV Shows', 'show'),
    ],
    genres: async (_s: unknown, key: string) =>
      key === '1'
        ? [
            { key: 'f', title: 'Family' },
            { key: 'd', title: 'Drama' },
          ]
        : [],
    items: async (
      s: PlexServer,
      key: string,
      _start: number,
      _size: number,
      extra: { genre?: string; excludeElements?: string },
    ) => {
      extras.push(extra);
      if (s.id === 'b') {
        flakyReads++;
        if (key === '2') throw new Error('down');
        return { total: 1, items: [film('30')] };
      }
      calls.push(`${key}:${extra.genre ?? ''}`);
      if (key === '1')
        return {
          total: 1,
          items: extra.genre === 'f' ? [film('10')] : [film('99')],
        };
      if (key === '2')
        return {
          total: 1,
          items: [film('20'), film('21', 'show'), { type: 'movie' } as PlexItem],
        };
      return { total: 0, items: [] };
    },
  };
});

vi.mock('../src/data/servers', () => ({ all: () => active }));

import { held, isHeld, keyOf } from '../src/data/kids';
import * as discovery from '../src/data/discovery';

beforeEach(() => {
  calls.length = 0;
  extras.length = 0;
});

test('keyOf: shows are tv/<id>, films the id, no tmdb guid is skipped', () => {
  expect(keyOf(film('5', 'show'))).toBe('tv/5');
  expect(keyOf(film('5'))).toBe('5');
  expect(keyOf({ type: 'movie' } as PlexItem)).toBeNull();
});

test('held reads kids libraries whole and the Family genre elsewhere, once a week', async () => {
  const set = await held();
  expect(Array.from(set).sort()).toEqual(['10', '20', 'tv/21']);
  expect(extras.length).toBeGreaterThan(0);
  extras.forEach((extra) => {
    expect(extra.excludeElements).toBe('Media,Genre,Country,Director,Writer,Role');
    expect(extra.excludeFields).toBe('summary,tagline');
  });
  expect(calls.sort()).toEqual(['1:f', '2:']);
  const entry = (id: string) => ({ Guid: [{ id: `tmdb://${id}` }] }) as DiscoveryEntry;
  expect(isHeld(set, entry('10'))).toBe(true);
  expect(isHeld(set, entry('99'))).toBe(false);

  await held();
  expect(calls.length).toBe(2);
});

test('a failing library keeps what the rest held and is asked again, not cached as empty', async () => {
  active.push(flaky);
  const set = await held();
  expect(Array.from(set).sort()).toEqual(['10', '20', '30', 'tv/21']);
  const reads = flakyReads;
  expect(reads).toBeGreaterThan(0);
  await held();
  expect(flakyReads).toBeGreaterThan(reads);
  active.pop();
});

test('keep drops unheld entries from every row but upcoming', async () => {
  const rows: string[][] = [];
  const page = (id: string) => ({
    films: [
      { id, title: id, media: 'movie' },
      { id: 'x', title: 'x', media: 'movie' },
    ],
    pages: 1,
  });
  const categories = [
    { title: 'A', kind: 'trending', id: 'a' },
    { title: 'U', kind: 'upcoming', id: 'u' },
  ] as DiscoveryCategory[];
  const tmdb = await import('../src/api/tmdb');
  vi.spyOn(tmdb, 'catalogue').mockImplementation(async () => page('10') as never);
  await discovery.load({
    isCurrent: () => true,
    categories,
    keep: (e) => e.Guid?.[0]?.id === 'tmdb://10',
    add: (title, entries) => {
      rows.push([title, ...entries.map((e) => e.title ?? '')]);
    },
  });
  assert.deepStrictEqual(rows, [
    ['A', '10'],
    ['U', '10', 'x'],
  ]);
});
