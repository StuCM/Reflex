import assert from 'node:assert';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as devices from '../src/data/devices';
import * as profiles from '../src/data/profiles';
import * as store from '../src/data/store';

beforeEach(() => {
  vi.useFakeTimers();
  profiles.set('together');
});
afterEach(() => {
  vi.useRealTimers();
});

const film = (ratingKey: string) =>
  ({ title: 'T' + ratingKey, ratingKey, _server: 'srv' }) as PlexItem;

test("the choice is saved with a version and the accent is the profile's", async () => {
  profiles.set('stu');
  assert.strictEqual(profiles.current().id, 'stu');
  assert.strictEqual(profiles.current().accent, '#AEBBF0');
  assert.deepStrictEqual(await store.get('profile'), { v: 1, id: 'stu' });
  profiles.set('nobody');
  assert.strictEqual(profiles.current().id, 'stu');
});

test('four idle hours return to Together, and a touch restarts the wait', () => {
  profiles.set('naoise');
  vi.advanceTimersByTime(3 * 60 * 60 * 1000);
  profiles.touch();
  vi.advanceTimersByTime(3 * 60 * 60 * 1000);
  assert.strictEqual(profiles.current().id, 'naoise');
  vi.advanceTimersByTime(60 * 60 * 1000 + 1);
  assert.strictEqual(profiles.current().id, 'together');
});

test('a play is keyed by profile, item and server, once per 30 seconds', async () => {
  profiles.set('stu');
  profiles.recordPlay(film('7'), 1000, 9000);
  profiles.recordPlay(film('7'), 2000, 9000);
  expect(await store.keysIn('plays')).toContainEqual(['stu', '7', 'srv']);
  assert.strictEqual((await store.keysIn('plays')).filter((key) => key[1] === '7').length, 1);
  vi.advanceTimersByTime(31 * 1000);
  profiles.recordPlay(film('7'), 3000, 9000);
});

test('Continue watching keeps what the profile has played; Together keeps all', () => {
  profiles.set('naoise');
  profiles.recordPlay(film('21'), 0, 100);
  const deck = [film('21'), film('22')];
  assert.deepStrictEqual(
    devices.mine(deck).map((item) => item.ratingKey),
    ['21'],
  );
  profiles.set('stu');
  assert.strictEqual(devices.mine(deck).length, 0);
  profiles.set('together');
  assert.strictEqual(devices.mine(deck).length, 2);
});
