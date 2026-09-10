/* The backdrop, the title, and one line under it. */
import { tmdbId } from '../api/plex/library';
import * as art from '../data/art';
import { railSub, railTitle } from '../rules/labels';

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}

const rowElement = must('mh-row');
const titleElement = must('mh-title');
const metaElement = must('mh-meta');
const descriptionElement = must('mh-desc');
const castElement = must('mh-cast');

/* Two stacked layers; the one carrying .on is the one you see, and a new
   picture is written into the other and faded up over it. */
const layers = [must('hero-art-a'), must('hero-art-b')];
let shown = 0;

/* Long enough that sweeping a row never starts a full-screen image, short
   enough that a deliberate step still feels answered. */
const HOLD = 420;

let timer: ReturnType<typeof setTimeout> | null = null;
let wanted: PlexItem | null = null;
let lastUrl = '';

function paintArt(): void {
  art.warm(wanted);
  const url = art.hero(wanted);
  if (!url || url === lastUrl) return;
  lastUrl = url;

  /* Swap only once the picture is decoded, or the fade reveals an empty box. A
     broken URL swaps anyway, so it cannot leave the old one up for ever; a swap
     the next backdrop has already overtaken is dropped. */
  const next = layers[shown ? 0 : 1];
  const current = layers[shown];
  if (!next || !current) return;

  const preload = new Image();
  const swap = () => {
    if (lastUrl !== url) return;
    next.style.setProperty('--art', `url("${url}")`);
    current.classList.remove('on');
    next.classList.add('on');
    shown = shown ? 0 : 1;
  };
  preload.onload = swap;
  preload.onerror = swap;
  preload.src = url;
}

/* The backdrop, debounced: only the last item asked for is drawn, so sweeping a
   row costs one full-screen image rather than one per key. */
export function showArt(item: PlexItem | null): void {
  wanted = item;
  if (timer) clearTimeout(timer);
  timer = setTimeout(paintArt, HOLD);
}

/* The description and the top of the billing, out of the one TMDB request the
   backdrop already cost. Plex's own summary stands in until it lands, so the
   header never blanks, and an empty cast draws no line at all. */
function paintFacts(item: PlexItem): void {
  const facts = art.factsFor(item);
  descriptionElement.textContent = facts?.overview || item.summary || '';
  castElement.textContent = facts?.cast.length ? facts.cast.join('  ·  ') : '';
}

/* A backdrop that lands after the debounce fired belongs on screen only if the
   item it belongs to is still the one being rested on. */
art.onReady((id) => {
  if (!wanted || tmdbId(wanted) !== id) return;
  paintArt();
  paintFacts(wanted);
});

export function render(
  row: { title?: string } | null,
  item: PlexItem | null,
  hasRows: boolean,
): void {
  rowElement.textContent = row?.title ?? '';

  if (!item) {
    titleElement.textContent = hasRows ? '…' : 'Loading…';
    metaElement.textContent = '';
    descriptionElement.textContent = '';
    castElement.textContent = '';
    return;
  }

  /* The same two rules the tile under it uses, so the hero names the show and
     the line beneath says which episode — not the other way round. */
  titleElement.textContent = railTitle(item);
  /* A Discovery title says whether we hold it instead: it has no run time until
     it has been resolved, and whether we have it is the fact you need before
     pressing OK. */
  metaElement.textContent = (item as DiscoveryEntry)._availability ?? railSub(item);
  paintFacts(item);
}
