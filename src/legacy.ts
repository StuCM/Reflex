/* What src/ publishes on `window` for the files still in js/.
   Empty means the migration is over. Nothing in src/ may import from here. */
import * as audio from './rules/audio';
import * as identity from './rules/identity';
import * as labels from './rules/labels';
import { langName } from './rules/language';
import * as quality from './rules/quality';
import * as ratings from './rules/ratings';
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

declare global {
  interface Window {
    Media: typeof Media;
    Subs: typeof cues;
    Rows: typeof rows;
  }
}

window.Media = Media;
window.Subs = cues;
window.Rows = rows;
