/* One entry per film, across servers.
   Identity is any shared external id; title and year are the fallback. A film
   held by both is shown as the preferred server's copy, with the others kept
   on `_sources`, because the copies differ — often a 4K TrueHD remux on one
   and a 1080p E-AC3 file on the other, and only one of those direct plays. */
import { identities } from '../rules/identity';
import * as servers from './servers';

/** An index from every known identity to the merged entry holding it. */
export function index(): MergeIndex {
  return { map: {}, out: [], dupes: 0 };
}

function sortKey(item: PlexItem | undefined): string {
  return String(item?.titleSort ?? item?.title ?? '').toLowerCase();
}

function before(one: PlexItem | undefined, two: PlexItem | undefined): boolean {
  const first = sortKey(one);
  const second = sortKey(two);
  if (first !== second) return first < second;
  return (one?.year ?? 0) < (two?.year ?? 0);
}

/* A copy is a library on a server, not a server: one section spans several
   libraries, and the same film in a 4K library and an LQ one is two copies that
   play differently. Items folded by lists() — onDeck and the hubs — carry no
   part, so they still fold per server. */
function copyKey(item: PlexItem): string {
  return `${item._server}/${item._part ?? ''}`;
}

/* Fold a second copy in, and decide which the entry is *shown* as: the
   preferred server's, when it has one.

   `_sources` holds the OTHER copies, not this one — a self-reference would make
   the row a cycle, and these get written to IndexedDB. Read it through
   sources(), which puts the shown copy back at the front. */
function combine(primary: PlexItem, item: PlexItem): PlexItem {
  const extras = primary._sources ?? [];
  const key = copyKey(item);
  /* One copy per library. A film listed twice by the same library is not what
     this is for — versions within one item are, and those live in Media[]. */
  if (copyKey(primary) === key) return primary;
  if (extras.some((extra) => copyKey(extra) === key)) return primary;

  /* Plex syncs the position between servers, but if they disagree the furthest
     through is the one worth resuming. */
  const offset = Math.max(primary.viewOffset ?? 0, item.viewOffset ?? 0);
  const seen = Math.max(primary.lastViewedAt ?? 0, item.lastViewedAt ?? 0);

  let shown: PlexItem;
  if (servers.preferred() === item._server && primary._server !== servers.preferred()) {
    delete primary._sources;
    item._sources = [primary, ...extras];
    shown = item;
  } else {
    primary._sources = [...extras, item];
    shown = primary;
  }
  if (offset) shown.viewOffset = offset;
  if (seen) shown.lastViewedAt = seen;
  return shown;
}

/* True if this started a new entry, false if it merged into one. `keys` may be
   passed when the item has been slimmed and no longer carries the ids they were
   derived from. */
export function push(into: MergeIndex, item: PlexItem | null, keys?: string[]): boolean {
  if (!item) return false;
  const wanted = keys ?? identities(item);
  const hit = wanted.find((key) => into.map[key] !== undefined);

  if (hit !== undefined) {
    const at = into.map[hit] as number;
    into.out[at] = combine(into.out[at] as PlexItem, item);
    /* Register this copy's other ids too, so a third copy matching on any of
       them lands in the same place. */
    wanted.forEach((key) => {
      if (into.map[key] === undefined) into.map[key] = at;
    });
    into.dupes++;
    return false;
  }

  into.out.push(item);
  const at = into.out.length - 1;
  wanted.forEach((key) => {
    into.map[key] = at;
  });
  return true;
}

/* Fold several lists into one. Order is first-seen: the first server's list in
   its own order, with anything only the others have appended where it first
   appears. */
export function lists(arrays: (PlexItem[] | null | undefined)[]): PlexItem[] {
  const into = index();
  arrays.forEach((array) => {
    (array ?? []).forEach((item) => push(into, item));
  });
  return into.out;
}

/** Every copy of this film, the one being displayed first. */
export function sources(item: PlexItem | null | undefined): PlexItem[] {
  if (!item) return [];
  return [item, ...(item._sources ?? [])];
}

export function isShared(item: PlexItem | null | undefined): boolean {
  return !!item?._sources?.length;
}

/* Only the fields the rail and masthead draw. A merged All row keeps everything
   walked past, so a 30,000 film walk holds 30,000 of these.

   Guid is the one costly field and it stays: without it a film walked into the
   All row has no TMDB id, so it gets neither a backdrop of its own nor a place
   in the merge by identity. */
export function slim(item: PlexItem): PlexItem {
  const media = item.Media?.[0];
  const out: PlexItem = {
    ratingKey: item.ratingKey,
    _server: item._server,
    _part: item._part,
    title: item.title,
    titleSort: item.titleSort,
    year: item.year,
    duration: item.duration,
    contentRating: item.contentRating,
    thumb: item.thumb,
    art: item.art,
    summary: item.summary,
    guid: item.guid,
    Guid: item.Guid,
    viewOffset: item.viewOffset,
    lastViewedAt: item.lastViewedAt,
  };
  if (media) {
    out.Media = [
      {
        id: media.id,
        videoResolution: media.videoResolution,
        videoCodec: media.videoCodec,
        container: media.container,
        width: media.width,
        height: media.height,
      },
    ];
  }
  return out;
}

/* parts: one per server section being merged. fetch(part, offset) must resolve
   { items, total }. */
export function stream(parts: MergePart[], fetch: MergeFetch): MergeState {
  return {
    fetch,
    streams: parts.map((part) => ({
      part,
      offset: 0,
      buffer: [],
      total: 0,
      done: false,
    })),
    idx: index(),
    exhausted: false,
    busy: null,
  };
}

/* An upper bound until the walk finishes: every copy on every server, less the
   duplicates found so far. It only ever gets more accurate. */
export function estimate(state: MergeState): number {
  const total = state.streams.reduce((sum, one) => sum + one.total, 0);
  return Math.max(state.idx.out.length, total - state.idx.dupes);
}

export function items(state: MergeState): PlexItem[] {
  return state.idx.out;
}

function fetchInto(state: MergeState, one: MergeStream): Promise<MergeStream> {
  return state.fetch(one.part, one.offset).then(
    (result) => {
      const got = result.items;
      if (result.total) one.total = result.total;
      one.offset += got.length;
      got.forEach((item) => {
        /* Which library it came from: one section spans several, and two of
           them can hold the same film in different shapes. */
        item._part = one.part.key;
        one.buffer.push(item);
      });
      if (!got.length || (one.total && one.offset >= one.total)) one.done = true;
      return one;
    },
    () => {
      /* A server that stops answering drops out of the merge rather than
         stalling the row. */
      one.done = true;
      return one;
    },
  );
}

function fill(state: MergeState, upTo: number): Promise<PlexItem[]> {
  /* A loop, not recursion: walking deep into a big library would otherwise
     build a stack frame per film. */
  while (state.idx.out.length <= upTo) {
    const needs = state.streams.filter((one) => !one.done && !one.buffer.length);
    if (needs.length) {
      return Promise.all(needs.map((one) => fetchInto(state, one))).then(() => fill(state, upTo));
    }

    const live = state.streams.filter((one) => one.buffer.length);
    if (!live.length) {
      state.exhausted = true;
      break;
    }

    let pick = live[0] as MergeStream;
    live.forEach((one) => {
      if (before(one.buffer[0], pick.buffer[0])) pick = one;
    });

    /* Identities come off the full item — slimming drops the Guid array they
       are mostly derived from. */
    const raw = pick.buffer.shift();
    if (raw) push(state.idx, slim(raw), identities(raw));
  }
  return Promise.resolve(state.idx.out);
}

/* Materialise the merged list until index `upTo` exists, or the servers run
   out. Concurrent calls share one walk. */
export function advance(state: MergeState, upTo: number): Promise<PlexItem[]> {
  if (state.idx.out.length > upTo || state.exhausted) return Promise.resolve(state.idx.out);
  if (state.busy) return state.busy;
  state.busy = fill(state, upTo).then(
    (out) => {
      state.busy = null;
      return out;
    },
    (error: unknown) => {
      state.busy = null;
      throw error;
    },
  );
  return state.busy;
}
