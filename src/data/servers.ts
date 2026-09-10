/* Which servers we can reach, which one an item came from, and which one is
   preferred. Nothing in the app may assume "the server": every request is made
   against a named one, and every item is stamped with where it came from. */

let list: PlexServer[] = [];

function local(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
  return null;
}

export function all(): PlexServer[] {
  return list;
}

export function count(): number {
  return list.length;
}

export function get(id: string | undefined): PlexServer | null {
  return list.find((server) => server.id === id) ?? null;
}

/* Items carry their origin as _server. Anything that lost the stamp is a bug
   upstream, but falling back to the first server beats throwing. */
export function of(item: { _server?: string } | null | undefined): PlexServer | null {
  return get(item?._server) ?? list[0] ?? null;
}

export function stamp<T extends { _server?: string }>(items: T[], server: PlexServer): T[] {
  items.forEach((item) => {
    if (item) item._server = server.id;
  });
  return items;
}

export function set(found: PlexServer[]): void {
  list = found;
  local(
    'servers',
    JSON.stringify(
      list.map((server) => ({
        id: server.id,
        name: server.name,
        base: server.base,
        token: server.token,
      })),
    ),
  );
}

export function forget(): void {
  list = [];
  local('servers', null);
}

/* A film held by both is shown as the preferred server's copy, and that is what
   playback defaults to. A film the preferred server does not have simply
   appears as whoever does — a preference, not a filter. */
let preferredId: string | null = null;

export function preferred(): string | null {
  if (preferredId && get(preferredId)) return preferredId;
  return list[0]?.id ?? null;
}

export function isPreferred(server: PlexServer | null | undefined): boolean {
  return !!server && server.id === preferred();
}

export function setPreferred(id: string | null): void {
  preferredId = id;
  local('preferredServer', id ?? null);
}

export function loadPreference(): void {
  preferredId = local('preferredServer');
}

/* With a d-pad and no colour buttons, cycling is the cheapest control there is:
   the chip says which is preferred and OK moves to the next. */
export function cyclePreferred(): string | null {
  if (list.length < 2) return preferred();
  const current = preferred();
  const at = list.findIndex((server) => server.id === current);
  const next = list[((at < 0 ? 0 : at) + 1) % list.length];
  if (next) setPreferred(next.id);
  return preferred();
}

export function load(): PlexServer[] {
  const raw = local('servers');
  loadPreference();
  if (!raw) return [];
  try {
    list = (JSON.parse(raw) as PlexServer[]) || [];
  } catch {
    list = [];
  }
  return list;
}

/** Shortest label that still tells two servers apart. */
export function label(server: PlexServer | null | undefined): string {
  return count() > 1 && server ? server.name : '';
}
