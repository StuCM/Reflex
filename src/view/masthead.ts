/* The backdrop, the title, one line under it, and the facts. */
import { tmdbId } from '../api/plex/library';
import * as art from '../data/art';
import { railSub, railTitle } from '../rules/labels';
import { heroHold, heroOn } from './hud';

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

const layers = [must('hero-art-a'), must('hero-art-b')];
const background = must('bg');
let shown = 0;
let lastUrl = '';

let timer: ReturnType<typeof setTimeout> | null = null;
let wanted: PlexItem | null = null;

function clearArt(): void {
  lastUrl = '';
  layers.forEach((layer) => layer.classList.remove('on'));
  background.classList.remove('hero-on');
}

/* The new picture is written into the hidden layer and given two frames to paint
   and decode before the fade starts: Chrome 53's onload means fetched, not decoded. */
function paintArt(): void {
  art.warm(wanted);
  const url = heroOn() ? art.hero(wanted) : '';
  if (!url) {
    clearArt();
    return;
  }
  if (url === lastUrl) return;
  lastUrl = url;

  const next = layers[shown ? 0 : 1];
  const current = layers[shown];
  if (!next || !current) return;

  const fade = () => {
    if (lastUrl !== url) return;
    current.classList.remove('on');
    next.classList.add('on');
    shown = shown ? 0 : 1;
    background.classList.add('hero-on');
  };
  const swap = () => {
    if (lastUrl !== url) return;
    next.style.setProperty('--art', `url("${url}")`);
    requestAnimationFrame(() => requestAnimationFrame(fade));
  };
  const preload = new Image();
  preload.onload = swap;
  preload.onerror = swap;
  preload.src = url;
}

/* Asks for the facts of the item rested on, debounced so a sweep costs one lookup. */
export function showFacts(item: PlexItem | null): void {
  wanted = item;
  if (timer) clearTimeout(timer);
  timer = setTimeout(paintArt, heroHold());
}

/* The description and the top of the billing, out of the one TMDB request the
   backdrop already cost. Plex's own summary stands in until it lands, so the
   header never blanks, and an empty cast draws no line at all. */
function paintFacts(item: PlexItem): void {
  const facts = art.factsFor(item);
  descriptionElement.textContent = facts?.overview || item.summary || '';
  castElement.textContent = facts?.cast.length ? facts.cast.join('  ·  ') : '';
}

/* Facts that land after the debounce fired belong on screen only if the item
   they belong to is still the one being rested on. */
art.onReady((id) => {
  if (!wanted || tmdbId(wanted) !== id) return;
  paintArt();
  paintFacts(wanted);
});

const masthead = must('masthead');
let fadeB = false;
let shownText = '';

export function render(
  row: { title?: string } | null,
  item: PlexItem | null,
  hasRows: boolean,
): void {
  rowElement.textContent = row?.title ?? '';
  masthead.style.setProperty('--hold', `${heroHold()}ms`);
  const text = item
    ? `${railTitle(item)}|${(item as DiscoveryEntry)._availability ?? railSub(item)}`
    : `|${hasRows}`;
  if (text !== shownText) {
    shownText = text;
    fadeB = !fadeB;
    masthead.classList.remove(fadeB ? 'fb' : 'fa');
    masthead.classList.add(fadeB ? 'fa' : 'fb');
  }

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
