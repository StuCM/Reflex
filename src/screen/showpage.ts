/* A show: its series across the top, its episodes down the side.
   Each episode row carries the same verdict the film page would give it,
   checked for the focused one as you move. OK plays when the preferred copy
   will direct play and opens the copy chooser when it will not — the only time
   you need to care which server an episode came from. */
import { artUrl, posterUrl, themeUrl } from '../api/plex/images';
import * as youtube from '../api/youtube';
import { KEY, clamp, debug, isBack, show as showView, toast } from '../core/ui';
import * as cached from '../data/cached';
import * as guard from '../data/guard';
import * as merge from '../data/merge';
import * as servers from '../data/servers';
import * as shows from '../data/shows';
import { identity } from '../rules/identity';
import { div, span, fill, put, must } from '../view/dom';

const titleElement = must('sh-title');
const metaElement = must('sh-meta');
const summaryElement = must('sh-summary');
const seasonsElement = must('sh-seasons');
const episodesElement = must('sh-episodes');
const artElement = must('sh-art');
const hintElement = must('sh-hint');
const recapsElement = must('sh-recaps');
const headElement = must('sh-head');
const themeElement = must('theme') as HTMLAudioElement;

/** Episode rows on screen at once, at 111px each. */
const EPISODE_POOL = 6;
const EPISODE_LEAD = 3;
/** Recap cards on screen at once, at 222px each. */
const RECAP_POOL = 7;
const RECAP_LEAD = 2;

interface ShowOptions {
  at?: { season?: number; episode?: number };
  onExit?: () => void;
  onPlay?: (episode: PlexItem, verdict: Verdict) => void;
  onChoose?: (episode: PlexItem) => void;
  onRecap?: (video: Recap) => void;
}

let show: PlexItem | null = null;
let seasons: PlexItem[] = [];
let seasonIndex = 0;
let episodes: PlexItem[] = [];
let episodeIndex = 0;
let zone: 'seasons' | 'episodes' | 'recaps' = 'episodes';
let recaps: Recap[] | null = null;
let recapIndex = 0;
let searching = false;
/** options.at.episode, honoured on the first load only. */
let wantEpisode: number | null = null;
let options: ShowOptions = {};
let generation = 0;
let verdicts: Record<string, Verdict> = {};
let checkTimer: ReturnType<typeof setTimeout> | null = null;

function verdictKey(episode: PlexItem): string {
  return `${episode._server}:${episode.ratingKey}`;
}

function paintHeader(): void {
  if (!show) return;
  titleElement.textContent = show.title ?? '';
  summaryElement.textContent = show.summary ?? '';
  const bits: (string | number)[] = [];
  if (show.year) bits.push(show.year);
  const counts = shows.summary(show);
  if (counts) bits.push(counts);
  if (show.contentRating) bits.push(show.contentRating);
  if (merge.isShared(show)) bits.push(`on ${merge.sources(show).length} servers`);
  metaElement.textContent = bits.join('   ·   ');
  const url = artUrl(show, 960, 540);
  artElement.style.setProperty('--art', url ? `url("${url}")` : 'none');
}

function renderSeasons(): void {
  fill(
    seasonsElement,
    ...seasons.map((season, at) =>
      span(
        `chip${at === seasonIndex ? ' cur' : ''}` +
          (zone === 'seasons' && at === seasonIndex ? ' on' : ''),
        season.title ?? `Series ${at + 1}`,
      ),
    ),
  );
}

function verdictBadge(episode: PlexItem): HTMLSpanElement | null {
  const verdict = verdicts[verdictKey(episode)];
  if (!verdict) return null;
  const state = verdict.ok ? 'good' : verdict.state === 'noaudio' ? 'bad' : 'warn';
  return span(`badge ${state} sh-verdict`, guard.label(verdict));
}

function hint(): string {
  if (zone === 'seasons') return '← → choose a series · ↓ to the episodes · BACK to the rail';
  if (zone === 'recaps') {
    return recaps?.length
      ? '← → choose a recap · OK to play it · ↑ back to the episodes'
      : 'OK to look for season recaps · ↑ back to the episodes';
  }
  return '↑ ↓ choose an episode · OK to play · → other copies · BACK to the rail';
}

function renderEpisodes(): void {
  if (!episodes.length) {
    fill(episodesElement, div('sh-episode', 'No episodes in this series.'));
    return;
  }
  /* A window, not the lot: a 24-episode series is common and drawing all of
     them costs more than it is worth. */
  const first = clamp(episodeIndex - EPISODE_LEAD, 0, Math.max(0, episodes.length - EPISODE_POOL));
  const drawn: HTMLDivElement[] = [];

  for (let at = first; at < Math.min(first + EPISODE_POOL, episodes.length); at++) {
    const episode = episodes[at];
    if (!episode) continue;
    const focused = at === episodeIndex && zone === 'episodes';
    const watched =
      episode.viewOffset && episode.duration
        ? `${Math.round((100 * episode.viewOffset) / episode.duration)}%`
        : (episode as { viewCount?: number }).viewCount
          ? 'watched'
          : '';

    const row = div(`sh-episode${focused ? ' on' : ''}`);
    /* An episode's thumb *is* its still, so the picture is already paid for. */
    const still = span('sh-ep-still');
    const url = posterUrl(episode, 160, 90);
    if (url) still.style.setProperty('--still', `url("${url}")`);

    put(
      row,
      still,
      span('sh-ep-num', episode.index === undefined ? '·' : String(episode.index)),
      span('sh-ep-title', episode.title ?? ''),
      span('sh-ep-mins', episode.duration ? `${Math.round(episode.duration / 60000)} min` : ''),
      span('sh-ep-seen', watched),
    );
    const badge = verdictBadge(episode);
    if (badge) put(row, badge);
    drawn.push(row);
  }

  fill(episodesElement, ...drawn);
  hintElement.textContent = hint();
}

/* The recaps strip, which costs nothing to draw: one action until it is
   pressed, then the rail it turned into. Entering the zone lifts the episode
   list to make room — a transform, not a height. */
function renderRecaps(): void {
  if (!youtube.enabled()) {
    fill(recapsElement);
    return;
  }
  const showing = zone === 'recaps';
  hintElement.textContent = hint();
  recapsElement.classList.toggle('open', showing);
  /* The whole column moves, or the episode rows would slide over the title. */
  headElement.classList.toggle('lifted', showing);
  seasonsElement.classList.toggle('lifted', showing);
  episodesElement.classList.toggle('lifted', showing);

  if (!recaps?.length) {
    fill(
      recapsElement,
      div(
        `sh-recap sh-recap-action${showing ? ' on' : ''}`,
        searching ? 'Searching…' : recaps ? 'No recaps found' : 'Find recaps',
      ),
    );
    return;
  }

  const first = clamp(recapIndex - RECAP_LEAD, 0, Math.max(0, recaps.length - RECAP_POOL));
  const drawn: HTMLDivElement[] = [];
  for (let at = first; at < Math.min(first + RECAP_POOL, recaps.length); at++) {
    const recap = recaps[at];
    if (!recap) continue;
    const card = div(`sh-recap${showing && at === recapIndex ? ' on' : ''}`);
    const thumb = span('sh-recap-thumb');
    if (recap.thumb) thumb.style.setProperty('--thumb', `url("${recap.thumb}")`);
    put(card, thumb, span('sh-recap-title', recap.title), span('sh-recap-len', recap.length));
    drawn.push(card);
  }
  fill(recapsElement, ...drawn);
}

/* A search is 100 units of the day's 10,000, so it happens on a press and never
   on a page opening — and a show already searched is read back from the cache,
   empty answer included. */
function findRecaps(): void {
  if (searching || recaps || !show) return;
  searching = true;
  renderRecaps();
  const mine = generation;
  const title = show.title ?? '';
  const id = identity(show);

  void cached.recaps
    .get(id)
    .then((hit) => {
      if (hit) return hit;
      return youtube.recaps(title).then((items) => {
        const list = youtube.pickForShow(youtube.parse(items), title);
        void cached.recaps.put(id, list);
        return list;
      });
    })
    .then(
      (list) => {
        if (mine !== generation) return;
        searching = false;
        recaps = list;
        recapIndex = 0;
        renderRecaps();
      },
      (error: Error) => {
        if (mine !== generation) return;
        debug(`recaps: ${error.message}`);
        /* Nothing was learnt, so the action goes back to being untried rather
           than claiming this show has no recaps. */
        searching = false;
        renderRecaps();
        toast('Could not search for recaps');
      },
    );
}

/* ---------- the theme tune ----------
   Shows have one, films do not. It is a static file on the server, so playing
   it costs a GET and nothing else: no decision, no session. */

/** Quiet: it announces the show, it is not the show. */
const THEME_VOL = 0.35;
/** Milliseconds between volume steps while fading in. */
const FADE_STEP = 40;

let fadeTimer: ReturnType<typeof setInterval> | null = null;
let themeOn: boolean | null = null;

/* Storage that refuses us reads as on, because on is what was asked for. */
function themePlays(): boolean {
  if (themeOn !== null) return themeOn;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('reflex.theme');
  } catch {
    stored = null;
  }
  themeOn = stored !== 'off';
  return themeOn;
}

/* Stops the theme dead — paused, rewound, and the source dropped, because a
   paused element still holding a source is still holding the audio pipeline.
   Anything that wants the audio calls this first. */
export function silence(): void {
  if (fadeTimer) clearInterval(fadeTimer);
  fadeTimer = null;
  if (!themeElement.getAttribute('src')) return;
  themeElement.pause();
  themeElement.currentTime = 0;
  themeElement.removeAttribute('src');
  themeElement.load();
}

/** on → off → on, persisted; the sidebar cycles it the way it cycles autoplay. */
export function cycleTheme(): boolean {
  themeOn = !themePlays();
  try {
    localStorage.setItem('reflex.theme', themeOn ? 'on' : 'off');
  } catch {
    /* private mode */
  }
  if (!themeOn) silence();
  return themeOn;
}

/** 'on' or 'off' — what the sidebar entry and its toast say. */
export function themeLabel(): string {
  return themePlays() ? 'on' : 'off';
}

function fadeIn(): void {
  const over =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-move')) || 340;
  const step = THEME_VOL / Math.max(1, Math.round(over / FADE_STEP));
  if (fadeTimer) clearInterval(fadeTimer);
  fadeTimer = setInterval(() => {
    const next = themeElement.volume + step;
    if (next < THEME_VOL) {
      themeElement.volume = next;
      return;
    }
    themeElement.volume = THEME_VOL;
    if (fadeTimer) clearInterval(fadeTimer);
    fadeTimer = null;
  }, FADE_STEP);
}

/* A show with no theme is the ordinary case, so this says nothing about it. */
function playTheme(): void {
  const url = themePlays() && show ? themeUrl(servers.of(show), show) : '';
  if (!url) return;
  themeElement.loop = true;
  themeElement.volume = 0;
  themeElement.src = url;
  /* The platform may refuse to start audio nobody asked for. That is an answer,
     not a fault: say so once and stay silent. */
  themeElement.play()?.catch((error: Error) => {
    debug(`theme: ${error.message}`);
  });
  fadeIn();
}

/* ---------- loading ---------- */

function loadEpisodes(): void {
  const mine = generation;
  const season = seasons[seasonIndex];
  if (!season) return;
  /* The episode we were opened at is for this load only: switching series
     afterwards goes back to landing on the first unfinished one. */
  const want = wantEpisode;
  wantEpisode = null;
  episodes = [];
  episodeIndex = 0;
  fill(episodesElement, div('sh-episode', 'Loading…'));

  void shows
    .episodes(season)
    .then((list) => {
      if (mine !== generation) return;
      episodes = list;
      /* Land on the episode we were opened at, or failing that the first
         unfinished one: what you want is almost always the next one. */
      const at = list.findIndex((episode) =>
        want === null
          ? episode.viewOffset || !(episode as { viewCount?: number }).viewCount
          : episode.index === want,
      );
      if (at >= 0) episodeIndex = at;
      renderEpisodes();
      scheduleCheck();
    })
    .catch((error: Error) => {
      if (mine !== generation) return;
      debug(`episodes: ${error.message}`);
      fill(episodesElement, div('sh-episode', 'Could not read the episode list.'));
    });
}

/* The focused episode gets checked once you have stopped moving. Everything the
   guard does is either cached or a hasMDE=1 query, so this costs a query per
   episode you rest on and opens no sessions. */
function scheduleCheck(): void {
  if (checkTimer) clearTimeout(checkTimer);
  const episode = episodes[episodeIndex];
  if (!episode || verdicts[verdictKey(episode)]) return;
  const mine = generation;
  checkTimer = setTimeout(() => {
    void guard.check(episode, 0).then((verdict) => {
      if (mine !== generation) return;
      verdicts[verdictKey(episode)] = verdict;
      renderEpisodes();
    });
  }, 300);
}

function openSeason(list: PlexItem[]): number {
  const want = options.at?.season;
  if (want !== undefined && want !== null) {
    const at = list.findIndex((season) => season.index === want);
    if (at >= 0) return at;
  }
  return shows.openAt(list);
}

/* options.at = { season, episode } opens on a named episode — Plex's own index
   values, not array positions. */
export function open(entry: PlexItem | null, chosen?: ShowOptions): void {
  if (!entry) return;
  show = entry;
  options = chosen ?? {};
  wantEpisode = options.at?.episode ?? null;
  generation++;
  seasons = [];
  episodes = [];
  seasonIndex = 0;
  episodeIndex = 0;
  zone = 'episodes';
  verdicts = {};
  recaps = null;
  recapIndex = 0;
  searching = false;

  showView('show');
  paintHeader();
  silence(); // whatever the last series was, it is over
  playTheme();
  renderRecaps();
  fill(seasonsElement);
  fill(episodesElement, div('sh-episode', 'Loading…'));

  const mine = generation;
  void shows
    .seasons(entry)
    .then((list) => {
      if (mine !== generation) return;
      seasons = list;
      seasonIndex = openSeason(list);
      renderSeasons();
      if (!list.length) {
        fill(episodesElement, div('sh-episode', 'This server lists no series for this show.'));
        return;
      }
      loadEpisodes();
    })
    .catch((error: Error) => {
      if (mine !== generation) return;
      debug(`seasons: ${error.message}`);
      fill(episodesElement, div('sh-episode', 'Could not read the series list.'));
    });
}

function close(): void {
  if (checkTimer) clearTimeout(checkTimer);
  silence();
  show = null;
  options.onExit?.();
}

function playFocused(): void {
  const episode = episodes[episodeIndex];
  if (!episode) return;
  const verdict = verdicts[verdictKey(episode)];
  /* Not checked yet, or the preferred copy will not play: the film page is
     where every copy is listed, so send them there rather than guessing. */
  if (!verdict?.ok) {
    openCopies();
    return;
  }
  options.onPlay?.(episode, verdict);
}

function openCopies(): void {
  const episode = episodes[episodeIndex];
  if (episode) options.onChoose?.(episode);
}

/** OK in the recaps zone is either the search or one of its results. */
function chooseRecap(): void {
  if (!recaps) {
    findRecaps();
    return;
  }
  const video = recaps[recapIndex];
  if (video) options.onRecap?.(video);
}

export function key(code: number): boolean {
  if (zone === 'seasons') {
    if (code === KEY.LEFT && seasonIndex > 0) {
      seasonIndex--;
      renderSeasons();
      loadEpisodes();
    } else if (code === KEY.RIGHT && seasonIndex < seasons.length - 1) {
      seasonIndex++;
      renderSeasons();
      loadEpisodes();
    } else if (code === KEY.DOWN || code === KEY.OK) {
      zone = 'episodes';
      renderSeasons();
      renderEpisodes();
    } else if (isBack(code)) {
      close();
    }
    return true;
  }

  if (zone === 'recaps') {
    if (code === KEY.UP) {
      zone = 'episodes';
      renderEpisodes();
      renderRecaps();
    } else if (code === KEY.LEFT && recapIndex > 0) {
      recapIndex--;
      renderRecaps();
    } else if (code === KEY.RIGHT && recaps && recapIndex < recaps.length - 1) {
      recapIndex++;
      renderRecaps();
    } else if (code === KEY.OK) {
      chooseRecap();
    } else if (isBack(code)) {
      close();
    }
    return true;
  }

  if (code === KEY.UP) {
    if (episodeIndex > 0) {
      episodeIndex--;
      renderEpisodes();
      scheduleCheck();
    } else {
      zone = 'seasons';
      renderSeasons();
      renderEpisodes();
    }
    return true;
  }
  if (code === KEY.DOWN) {
    if (episodeIndex < episodes.length - 1) {
      episodeIndex++;
      renderEpisodes();
      scheduleCheck();
      return true;
    }
    /* Past the last episode is the recaps strip, when there is a key for it. */
    if (youtube.enabled()) {
      zone = 'recaps';
      renderEpisodes();
      renderRecaps();
    }
    return true;
  }
  if (code === KEY.RIGHT) openCopies();
  else if (code === KEY.OK) playFocused();
  else if (isBack(code)) close();
  return true; // this page swallows everything else
}

export function current(): PlexItem | null {
  return show;
}
