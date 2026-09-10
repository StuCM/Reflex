/* What the tests import while half the app is js/ and half is src/.
   Converted modules directly; the rest read off the global they set. */

/* First, and statically: src/api reads Config at module evaluation, and a
   static import is hoisted above every `await import` below. */
import '../js/core/config.js';
import * as http from '../src/api/http';
import * as plexAuth from '../src/api/plex/auth';
import { hasToken, init, state } from '../src/api/plex/client';
import { discover } from '../src/api/plex/discovery';
import * as plexImages from '../src/api/plex/images';
import * as plexLibrary from '../src/api/plex/library';
import * as plexPlayback from '../src/api/plex/playback';
import * as tmdb from '../src/api/tmdb';
import * as youtube from '../src/api/youtube';
import * as audio from '../src/rules/audio';
import * as cues from '../src/rules/cues';
import * as identity from '../src/rules/identity';
import * as labels from '../src/rules/labels';
import { langName } from '../src/rules/language';
import * as quality from '../src/rules/quality';
import * as ratings from '../src/rules/ratings';
import * as rows from '../src/rules/rows';
import * as subtitles from '../src/rules/subtitles';
import * as timeline from '../src/rules/timeline';

/* The seven rules modules were one `Media`, and the assertions still say so. */
export const Media = {
  ...audio,
  ...subtitles,
  ...timeline,
  ...quality,
  ...ratings,
  ...identity,
  ...labels,
  langName,
};

export const Plex = {
  init,
  hasToken,
  state,
  discover,
  ...plexAuth,
  ...plexLibrary,
  ...plexImages,
  ...plexPlayback,
};

export const Subs = cues;
export const Http = http;
export const Tmdb = tmdb;
export const Youtube = youtube;
export const Rows = rows;

/* Order matters below: js/core/panel.js is what Media.canDecode asks, and
   js/data/merge.js calls Media.identity — so the globals above must be set
   before those modules are asked anything. */
const globals = globalThis as Record<string, unknown>;
globals.Media = Media;
globals.Subs = Subs;
globals.Http = http;
globals.Plex = Plex;
globals.Tmdb = tmdb;
globals.Youtube = youtube;
globals.Rows = Rows;

await import('../js/core/panel.js');
await import('../js/data/servers.js');
await import('../js/data/merge.js');
await import('../js/data/shows.js');
await import('../js/data/art.js');
await import('../js/data/discovery.js');

export const Config = globals.Config;
export const Panel = globals.Panel;
export const Servers = globals.Servers;
export const Merge = globals.Merge;
export const Shows = globals.Shows;
export const Art = globals.Art;
export const Discovery = globals.Discovery;
