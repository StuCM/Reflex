/* Every server the account can reach, each on whichever address answers first.
   Relay is never used — direct only. All of them are kept: the same film is
   often on more than one, and the app deduplicates rather than picking. */
import { ask, plexTv, queryString, request, state } from './client';

function ping(uri: string, token: string): Promise<string> {
  return request('GET', `${uri}/identity`, { timeout: 4000, token }).then(() => uri);
}

/** Promise.any does not exist in Chromium 53. */
function raceOk<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let left = promises.length;
    let settled = false;
    if (!left) {
      reject(new Error('nothing to race'));
      return;
    }
    promises.forEach((promise) => {
      promise.then(
        (value) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        },
        () => {
          left--;
          if (left === 0 && !settled) reject(new Error('all connections failed'));
        },
      );
    });
  });
}

function reach(resource: PlexResource): Promise<PlexServer | null> {
  const token = resource.accessToken ?? state.token ?? '';
  const uris = (resource.connections ?? [])
    .filter((connection) => !connection.relay)
    .map((connection) => connection.uri);
  if (!uris.length) return Promise.resolve(null);

  return raceOk(uris.map((uri) => ping(uri, token))).then(
    (uri) => ({
      id: resource.clientIdentifier,
      name: resource.name ?? 'server',
      base: uri,
      token,
    }),
    () => null,
  );
}

export function discover(): Promise<PlexServer[]> {
  const cached = Servers.all();
  if (cached.length) {
    return Promise.all(
      cached.map((server) =>
        ping(server.base, server.token).then(
          () => server,
          () => null,
        ),
      ),
    ).then((live) => {
      const reachable = live.filter((server): server is PlexServer => !!server);
      if (reachable.length) {
        Servers.set(reachable);
        return reachable;
      }
      Servers.forget();
      return discover();
    });
  }

  return (
    plexTv(
      'GET',
      `/api/v2/resources?${queryString({ includeHttps: 1, includeRelay: 0 })}`,
    ) as Promise<PlexResource[]>
  )
    .then((resources) => {
      const jobs = resources
        .filter((resource) => (resource.provides ?? '').indexOf('server') >= 0)
        .map((resource) => reach(resource));
      if (!jobs.length) throw new Error('no servers on this account');
      return Promise.all(jobs);
    })
    .then((found) => {
      const reachable = found.filter((server): server is PlexServer => !!server);
      if (!reachable.length) throw new Error('no direct server connection');
      /* Stable order, so rows do not reshuffle between launches. */
      reachable.sort((one, two) => (one.name < two.name ? -1 : one.name > two.name ? 1 : 0));
      Servers.set(reachable);
      return reachable;
    });
}

export { ask };
