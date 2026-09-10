/* The Plex payloads, as this app actually reads them.

   Hand-written from what the servers send and what dev/library.js generates.
   Everything is optional that a real server has ever omitted — the list
   endpoints carry Media but not Stream, episodes carry no Guid of their own,
   and a film with no certificate simply has no contentRating. Being honest
   about that is the whole point: the guard's job is deciding with a partial
   payload. */

/** A single audio, video or subtitle track inside a Part. */
interface PlexStream {
  id: number | string;
  /** 1 video · 2 audio · 3 subtitle. */
  streamType: 1 | 2 | 3;
  codec?: string;
  profile?: string;
  channels?: number;
  languageCode?: string;
  language?: string;
  title?: string;
  displayTitle?: string;
  extendedDisplayTitle?: string;
  selected?: boolean;
  default?: boolean;
  forced?: boolean;
  hearingImpaired?: boolean;
  key?: string;
  width?: number;
  height?: number;
}

/** One file on disk. Stream is absent on list endpoints. */
interface PlexPart {
  id: number | string;
  key: string;
  container?: string;
  duration?: number;
  size?: number;
  Stream?: PlexStream[];
}

/** One version of an item. An item may hold several. */
interface PlexMedia {
  id: number | string;
  container?: string;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  bitrate?: number;
  width?: number;
  height?: number;
  duration?: number;
  Part?: PlexPart[];
}

interface PlexGuid {
  id: string;
}

/** An intro or credits sequence Plex found, in milliseconds. */
interface PlexMarker {
  type?: string;
  startTimeOffset?: number;
  endTimeOffset?: number;
}

/** Same offsets as a marker. `thumb` is absent far more often than not. */
interface PlexChapter {
  tag?: string;
  title?: string;
  index?: number;
  startTimeOffset?: number;
  endTimeOffset?: number;
  thumb?: string;
}

/** A chapter as the trackbar wants it: seconds, in order. */
interface Chapter {
  title: string;
  start: number;
  end: number;
  thumb: string | null;
}

/** A row of the quality menu. A null bitrate is the file as it stands. */
interface Quality {
  label: string;
  bitrate: number | null;
}

/** A film, show, season or episode. */
interface PlexItem {
  ratingKey: string;
  key?: string;
  type?: 'movie' | 'show' | 'season' | 'episode' | 'clip';
  title?: string;
  year?: number;
  duration?: number;
  contentRating?: string;
  thumb?: string;
  art?: string;
  summary?: string;
  viewOffset?: number;
  lastViewedAt?: number;
  index?: number;
  parentIndex?: number;
  grandparentRatingKey?: string;
  grandparentTitle?: string;
  /** The legacy single guid, a `plex://movie/…` string. Distinct from Guid[],
      which carries the external imdb/tmdb/tvdb ids. Both are used. */
  guid?: string;
  Guid?: PlexGuid[];
  Marker?: PlexMarker[];
  Chapter?: PlexChapter[];
  titleSort?: string;
  grandparentGuid?: string;
  childCount?: number;
  Media?: PlexMedia[];

  /* Reflex's own, stamped on the way through. Underscored so nothing
     confuses them with something the server sent. */
  /** The id of the server it came from — Servers.stamp sets this. */
  _server?: string;
  _sources?: PlexItem[];
  _part?: string;
}

interface PlexServer {
  id: string;
  name: string;
  /** Whichever of its addresses answered first. */
  base: string;
  token: string;
}

/** A subtitle cue, in seconds. */
interface Cue {
  start: number;
  end: number;
  text: string;
}

/** One server section a merge row walks. */
interface MergePart {
  server: PlexServer;
  key: string;
  updatedAt?: number;
  filter?: string;
  tag?: string;
}

type MergeFetch = (
  part: MergePart,
  offset: number,
) => Promise<{ items: PlexItem[]; total: number }>;

interface MergeIndex {
  map: Record<string, number>;
  out: PlexItem[];
  dupes: number;
}

interface MergeStream {
  part: MergePart;
  offset: number;
  buffer: PlexItem[];
  total: number;
  done: boolean;
}

interface MergeState {
  fetch: MergeFetch;
  streams: MergeStream[];
  idx: MergeIndex;
  exhausted: boolean;
  busy: Promise<PlexItem[]> | null;
}

interface ListRow {
  kind: 'list';
  title: string;
  items: PlexItem[];
  total: number;
  focus: number;
}

interface MergeRow {
  kind: 'merge';
  title: string;
  focus: number;
  total: number;
  parts: MergePart[];
  state: MergeState;
}

type Row = ListRow | MergeRow;

/* ---------- TMDB ---------- */

interface TmdbResult {
  id?: number | string;
  title?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
}

/** Enough to draw a tile with, and nothing else. */
interface TmdbFilm {
  id: string;
  title: string;
  year: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
}

interface TmdbResponse {
  results?: TmdbResult[];
  [key: string]: unknown;
}

/** One row of the Discovery page, from js/core/config.js. */
interface DiscoveryCategory {
  title: string;
  kind: 'trending' | 'provider' | 'genre' | 'recommended';
  id?: number;
}

/* ---------- YouTube ---------- */

interface YoutubeThumb {
  url?: string;
}

interface YoutubeSnippet {
  title?: string;
  thumbnails?: { medium?: YoutubeThumb; high?: YoutubeThumb; default?: YoutubeThumb };
}

interface YoutubeContentDetails {
  duration?: string;
}

interface YoutubeItem {
  id?: string | { videoId?: string };
  snippet?: YoutubeSnippet;
  contentDetails?: YoutubeContentDetails;
}

interface YoutubeResponse {
  items?: YoutubeItem[];
}

/** One recap, as the show page's rail draws it. */
interface Recap {
  id: string;
  title: string;
  thumb: string;
  season: number | null;
  length: string;
}

/* ---------- what the Plex client hands back ---------- */

/** A library section, as the app groups them. */
interface PlexSection {
  key: string;
  title: string;
  type: 'movie' | 'show';
  updatedAt: number;
  server: string;
}

/** One of a section's own category rows. */
interface PlexHub {
  title: string;
  items: PlexItem[];
}

interface PlexDevice {
  id: string;
  name: string;
  platform: string;
}

/** The verdict from /video/:/transcode/universal/decision, with hasMDE=1. */
interface PlexDecision {
  decision: string;
  video: string;
  audio: string;
  text: string;
  raw: Record<string, unknown>;
}

interface PlaybackOptions {
  maxBitrate?: number | null;
  forceStream?: boolean;
}

/** What /api/v2/resources says about one server on the account. */
interface PlexResource {
  clientIdentifier: string;
  name?: string;
  provides?: string;
  accessToken?: string;
  connections?: { uri: string; relay?: boolean }[];
}

/** What Guard.check resolves with. Never rejects. */
interface Verdict {
  ok: boolean;
  state: string;
  text?: string;
  transcode?: boolean;
  video?: string;
  audioDecision?: string;
  audio?: PlexStream | null;
  passes?: boolean;
  maxBitrate?: number | null;
  forceStream?: boolean;
  metadata?: PlexItem;
  media?: PlexMedia;
  part?: PlexPart;
  mediaIndex?: number;
}
