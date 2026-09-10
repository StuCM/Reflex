/* Season recaps, from one YouTube channel.
 *
 * 100 quota units a search against a daily 10,000, so this is only ever called
 * from a keypress — never from a page opening. A quota refusal answers with
 * nothing rather than an error, because "none today" is the truth the screen
 * has to show.
 *
 * Inert without a key: the Find recaps action simply does not appear.
 */
import { queryString, request } from './http';

const KEY = Config.youtubeKey;
const API = Config.youtubeBase;

/* The channel by handle, not by id: a guessed id in source would be wrong and
   unverifiable, and a handle is something a human can check. */
const HANDLE = '@ManOfRecaps';

const SEASON = /\b(?:season|series|s)\s*0*(\d{1,2})\b/i;

/** Is there a key at all? Without one the recaps action never appears. */
export function enabled(): boolean {
  return !!KEY;
}

function ask(path: string, parameters: Record<string, string | number>): Promise<YoutubeResponse> {
  return request(`${API}${path}?${queryString({ ...parameters, key: KEY })}`, {
    label: `YouTube ${path}`,
  }) as Promise<YoutubeResponse>;
}

/* One request in flight at a time. Two searches racing is 200 units spent to
   answer one question. */
let queue: Promise<unknown> = Promise.resolve();
function get(path: string, parameters: Record<string, string | number>): Promise<YoutubeResponse> {
  const run = () => ask(path, parameters);
  queue = queue.then(run, run);
  return queue as Promise<YoutubeResponse>;
}

/** The channel id behind the handle, resolved once and kept for good. */
export function channelId(): Promise<string> {
  return Cached.ytChannel.get(HANDLE).then((cached: string | undefined) => {
    if (cached) return cached;
    return get('/channels', { part: 'id', forHandle: HANDLE }).then((body) => {
      const found = body.items?.[0]?.id;
      const id = typeof found === 'string' ? found : undefined;
      if (!id) throw new Error(`no channel for ${HANDLE}`);
      Cached.ytChannel.put(HANDLE, id);
      return id;
    });
  });
}

/* search carries no duration and videos.list does — one more unit against the
   hundred the search already cost. A missing length is a missing caption, not a
   missing rail, so a failure here keeps the items. */
function withLengths(items: YoutubeItem[]): Promise<YoutubeItem[]> {
  const ids = items.map((item) => videoIdOf(item)).filter((id): id is string => !!id);
  if (!ids.length) return Promise.resolve(items);

  return get('/videos', { part: 'contentDetails', id: ids.join(',') }).then(
    (body) => {
      const byId: Record<string, YoutubeContentDetails> = {};
      (body.items ?? []).forEach((entry) => {
        if (typeof entry.id === 'string' && entry.contentDetails) {
          byId[entry.id] = entry.contentDetails;
        }
      });
      items.forEach((item) => {
        const id = videoIdOf(item);
        const details = id ? byId[id] : undefined;
        if (details) item.contentDetails = details;
      });
      return items;
    },
    () => items,
  );
}

/** This show's recaps from that channel, raw. */
export function recaps(showTitle: string): Promise<YoutubeItem[]> {
  return channelId()
    .then((id) =>
      get('/search', {
        part: 'snippet',
        channelId: id,
        q: `${showTitle} recap`,
        maxResults: 25,
        type: 'video',
      }),
    )
    .then((body) => withLengths(body.items ?? []))
    .catch((error: Error) => {
      if (!error.message.endsWith('-> 403')) throw error;
      UI.debug(`youtube: ${error.message} (quota)`);
      return [];
    });
}

/* `typeof null === 'object'`, so this cannot be inlined as a typeof check —
   a malformed item is simply not a recap, and must not throw. */
function videoIdOf(item: YoutubeItem | null | undefined): string | undefined {
  const id = item?.id;
  if (!id || typeof id === 'string') return undefined;
  return id.videoId;
}

function seasonOf(title: string): number | null {
  const found = SEASON.exec(title);
  return found?.[1] ? Number(found[1]) : null;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** PT1H2M3S -> 1:02:03. Anything else has no length to show. */
function lengthOf(iso: string | undefined): string {
  const found = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/.exec(iso ?? '');
  if (!found) return '';
  const hours = Number(found[1] ?? 0);
  const minutes = Number(found[2] ?? 0);
  const secs = Number(found[3] ?? 0);
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function thumbOf(snippet: YoutubeSnippet | undefined): string {
  const thumbnails = snippet?.thumbnails ?? {};
  const chosen = thumbnails.medium ?? thumbnails.high ?? thumbnails.default;
  return chosen?.url ?? '';
}

/* Sorting the positions rather than the list: Chromium 53's sort is not stable,
   and within a season the order the API chose is the one to keep. */
function bySeason(list: Recap[]): Recap[] {
  const order = list.map((_entry, position) => position);
  order.sort((one, two) => {
    const first = list[one]?.season ?? null;
    const second = list[two]?.season ?? null;
    if (first === second) return one - two;
    if (first === null) return 1;
    if (second === null) return -1;
    return first - second;
  });
  return order.map((position) => list[position]).filter((entry): entry is Recap => !!entry);
}

/* The API payload as the rail wants it, in season order with the unnumbered
   ones last. Never throws: a malformed item is simply not a recap. */
export function parse(items: (YoutubeItem | null)[] | null | undefined): Recap[] {
  const out: Recap[] = [];
  (items ?? []).forEach((item) => {
    const id = videoIdOf(item);
    const title = item?.snippet?.title ?? '';
    if (!id || !title) return;
    out.push({
      id,
      title,
      thumb: thumbOf(item?.snippet),
      season: seasonOf(title),
      length: lengthOf(item?.contentDetails?.duration),
    });
  });
  return bySeason(out);
}

function normalise(text: string | null | undefined): string {
  return ` ${String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^ +| +$/g, '')} `;
}

/* Only the videos that name this show. The channel covers everything, and a
   search for a one-word title brings back most of it. */
export function pickForShow(parsed: Recap[] | null | undefined, showTitle: string): Recap[] {
  const wanted = normalise(showTitle);
  if (wanted.length < 3) return []; // no title left to match on
  return (parsed ?? []).filter((recap) => normalise(recap.title).indexOf(wanted) >= 0);
}
