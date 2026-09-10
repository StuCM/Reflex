/* What src/ publishes on `window` for the files still in js/.
   Empty means the migration is over. Nothing in src/ may import from here. */
import * as audio from './rules/audio';
import * as identity from './rules/identity';
import * as labels from './rules/labels';
import { langName } from './rules/language';
import * as quality from './rules/quality';
import * as ratings from './rules/ratings';
import * as http from './api/http';
import * as tmdb from './api/tmdb';
import * as youtube from './api/youtube';
import * as cues from './rules/cues';
import * as rows from './rules/rows';
import * as subtitles from './rules/subtitles';
import * as timeline from './rules/timeline';

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
