/* What the tests import while half the app is js/ and half is src/.
   Converted modules directly; the rest read off the global they set. */

/* First, and statically: src/api reads settings at module evaluation, and a
   static import is hoisted above every `await import` below. */
import settings from '../src/core/config';
import * as panel from '../src/core/panel';
import * as userInterface from '../src/core/ui';
import * as http from '../src/api/http';
import * as art from '../src/data/art';
import * as cached from '../src/data/cached';
import * as discovery from '../src/data/discovery';
import * as guard from '../src/data/guard';
import * as meta from '../src/data/meta';
import * as shows from '../src/data/shows';
import * as merge from '../src/data/merge';
import * as servers from '../src/data/servers';
import * as store from '../src/data/store';
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

export const Config = settings;
export const Panel = panel;
export const UI = userInterface;

export const Art = art;
export const Shows = shows;
export const Discovery = discovery;
export const Guard = guard;
export const Meta = meta;
export const Store = store;
export const Cached = cached;
export const Servers = servers;
export const Merge = merge;

export const Subs = cues;
export const Http = http;
export const Tmdb = tmdb;
export const Youtube = youtube;
export const Rows = rows;

/* Order matters below: js/core/panel.js is what Media.canDecode asks, and
   js/data/merge.js calls Media.identity — so the globals above must be set
   before those modules are asked anything. */
const globals = globalThis as Record<string, unknown>;
globals.Config = settings;
globals.Panel = { ...panel, features: panel.probeFeatures };
globals.UI = userInterface;
globals.Media = Media;
globals.Subs = Subs;
globals.Http = http;
globals.Plex = Plex;
globals.Store = store;
globals.Cached = cached;
globals.Servers = servers;
globals.Merge = merge;
globals.Art = art;
globals.Shows = shows;
globals.Discovery = discovery;
globals.Meta = meta;
globals.Guard = guard;
globals.Tmdb = tmdb;
globals.Youtube = youtube;
globals.Rows = Rows;
