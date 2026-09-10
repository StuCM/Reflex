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
  Media?: PlexMedia[];

  /* Reflex's own, stamped on the way through. Underscored so nothing
     confuses them with something the server sent. */
  _server?: PlexServer;
  _sources?: PlexItem[];
}

interface PlexServer {
  id: string;
  name: string;
  uri: string;
  token: string;
}
