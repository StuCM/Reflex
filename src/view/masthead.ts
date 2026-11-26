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
const availElement = must('mh-avail');
const serviceElement = must('mh-service');
const logoElement = must('mh-logo-img') as HTMLImageElement;
const serviceName = must('mh-svc-name');
const rowsElement = must('rows');
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

function onBoard(): boolean {
  return rowsElement.classList.contains('board');
}

function runtimeText(minutes: number): string {
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)}h ${rest < 10 ? '0' : ''}${rest}m`;
}

/* Board hero: year, certificate, run time or seasons, rating — whatever is known. */
function boardMeta(item: PlexItem, facts: ArtFacts | null): string {
  const copy = (item as DiscoveryEntry)._resolved ?? item;
  const parts: (string | number | undefined)[] = [
    item.type === 'episode' ? railSub(item) : item.year,
    copy.contentRating,
  ];
  if (item.type === 'show' || item.type === 'episode') {
    const seasons = copy.childCount || facts?.seasons;
    if (seasons) parts.push(`${seasons} ${seasons === 1 ? 'season' : 'seasons'}`);
  } else if (facts?.runtime) {
    parts.push(runtimeText(facts.runtime));
  }
  if (facts?.rating) parts.push(`★ ${facts.rating}`);
  return parts.filter((part) => part).join('  ·  ');
}

/* What the line under the synopsis says about whether we hold a Discovery title. */
function availability(item: PlexItem, board: boolean): string {
  const entry = item as DiscoveryEntry;
  if (entry._availability === 'absent') return board ? 'Not on server' : 'Not in your library';
  if (entry._availability !== 'held' || board) return '';
  const sub = railSub(entry._resolved);
  return sub ? `In your library  ·  ${sub}` : 'In your library';
}

/* The description, the top of the billing and the hero's own line, out of the one
   TMDB request the backdrop already cost. Plex's own summary stands in until it
   lands, so the header never blanks, and an empty cast draws no line at all. */
function paintFacts(item: PlexItem): void {
  const facts = art.factsFor(item);
  const board = onBoard();
  descriptionElement.textContent = facts?.overview || item.summary || '';
  castElement.textContent = facts?.cast.length ? facts.cast.join('  ·  ') : '';
  metaElement.textContent = board ? boardMeta(item, facts) : railSub(item);
  availElement.textContent = availability(item, board);
  const service = board ? facts?.service : null;
  serviceElement.classList.toggle('hidden', !service);
  serviceName.textContent = service?.name ?? '';
  logoElement.classList.toggle('hidden', !service?.logo);
  if (service?.logo) logoElement.src = art.url(service.logo, 'w92');
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
  row: { title?: string; ranked?: true; focus?: number } | null,
  item: PlexItem | null,
  hasRows: boolean,
): void {
  rowElement.textContent =
    row?.ranked && item ? `#${(row.focus ?? 0) + 1} in the top 10 today` : (row?.title ?? '');
  masthead.classList.toggle('board', onBoard());
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
    titleElement.textContent = hasRows ? '…' : (row?.title ?? '');
    metaElement.textContent = '';
    descriptionElement.textContent = '';
    castElement.textContent = '';
    availElement.textContent = '';
    serviceElement.classList.add('hidden');
    return;
  }

  titleElement.textContent = railTitle(item);
  paintFacts(item);
}
