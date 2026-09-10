/* What src/ publishes on `window` for the files still in js/.
   Empty means the migration is over. Nothing in src/ may import from here. */
import * as audio from './rules/audio';
import * as identity from './rules/identity';
import * as labels from './rules/labels';
import { langName } from './rules/language';
import * as quality from './rules/quality';
import * as ratings from './rules/ratings';
import * as http from './api/http';
import settings from './core/config';
import * as panel from './core/panel';
import * as userInterface from './core/ui';
import * as art from './data/art';
import * as glyphs from './view/glyphs';
import * as masthead from './view/masthead';
import * as menu from './view/menu';
import * as browse from './screen/browse';
import * as showpage from './screen/showpage';
import * as detail from './screen/detail';
import * as player from './screen/player';
import * as rail from './view/rail';
import * as sidebar from './view/sidebar';
import * as cached from './data/cached';
import * as devices from './data/devices';
import * as discovery from './data/discovery';
import * as guard from './data/guard';
import * as meta from './data/meta';
import * as shows from './data/shows';
import * as merge from './data/merge';
import * as servers from './data/servers';
import * as store from './data/store';
import * as plexAuth from './api/plex/auth';
import { hasToken, init, state } from './api/plex/client';
import { discover } from './api/plex/discovery';
import * as plexImages from './api/plex/images';
import * as plexLibrary from './api/plex/library';
import * as plexPlayback from './api/plex/playback';
import * as tmdb from './api/tmdb';
import * as youtube from './api/youtube';
import * as cues from './rules/cues';
import * as rows from './rules/rows';
import * as subtitles from './rules/subtitles';
import * as timeline from './rules/timeline';

/* plex.js is five modules now; js/ still calls the whole thing Plex. */
const Plex = {
  init,
  hasToken,
  state,
  discover,
  ...plexAuth,
  ...plexLibrary,
  ...plexImages,
  ...plexPlayback,
};

/* The seven rules modules were one `Media` global, and js/ still calls it that. */
const Media = {
  ...audio,
  ...subtitles,
  ...timeline,
  ...quality,
  ...ratings,
  ...identity,
  ...labels,
  langName,
};

/** A module namespace is sealed; what js/ gets is a plain copy of it. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

declare global {
  interface Window {
    Media: typeof Media;
    Subs: Mutable<typeof cues>;
    Rows: Mutable<typeof rows>;
    Http: Mutable<typeof http>;
    Tmdb: Mutable<typeof tmdb>;
    Youtube: Mutable<typeof youtube>;
    Plex: Mutable<typeof Plex>;
    Store: Mutable<typeof store>;
    Cached: Mutable<typeof cached>;
    Servers: Mutable<typeof servers>;
    Merge: Mutable<typeof merge>;
    Meta: Mutable<typeof meta>;
    Guard: Mutable<typeof guard>;
    Art: Mutable<typeof art>;
    Shows: Mutable<typeof shows>;
    Discovery: Mutable<typeof discovery>;
    Devices: Mutable<typeof devices>;
    Config: typeof settings;
    /* js/ calls it Panel.features(); the module exports probeFeatures. */
    Panel: Mutable<typeof panel> & { features: typeof panel.probeFeatures };
    UI: Mutable<typeof userInterface>;
    Glyphs: Mutable<typeof glyphs>;
    Menu: Mutable<typeof menu>;
    Sidebar: Mutable<typeof sidebar>;
    Rail: Mutable<typeof rail>;
    ShowPage: Mutable<typeof showpage>;
    Browse: Mutable<typeof browse>;
    Detail: Mutable<typeof detail>;
    Player: Mutable<typeof player>;
    /* js/ calls it Masthead.art(); the module exports showArt. */
    Masthead: Mutable<typeof masthead> & { art: typeof masthead.showArt };
  }
}

window.Media = Media;
/* Spread, not the namespace object itself: `import * as x` gives a sealed
   object, and js/ — and the smoke suite — still expect to be able to swap a
   function out the way they could on the old IIFE. */
window.Subs = { ...cues };
window.Rows = { ...rows };
window.Http = { ...http };
window.Tmdb = { ...tmdb };
window.Youtube = { ...youtube };
window.Plex = { ...Plex };
window.Store = { ...store };
window.Cached = { ...cached };
window.Servers = { ...servers };
window.Merge = { ...merge };
window.Meta = { ...meta };
window.Guard = { ...guard };
window.Art = { ...art };
window.Shows = { ...shows };
window.Discovery = { ...discovery };
window.Devices = { ...devices };
window.Config = settings;
window.Panel = { ...panel, features: panel.probeFeatures };
window.UI = { ...userInterface };
window.Glyphs = { ...glyphs };
window.Menu = { ...menu };
window.Sidebar = { ...sidebar };
window.Rail = { ...rail };
window.ShowPage = { ...showpage };
window.Browse = { ...browse };
window.Detail = { ...detail };
window.Player = { ...player };
window.Masthead = { ...masthead, art: masthead.showArt };
