/* A show: its series across the top, its episodes across the middle and its
   cast below them, which is screen 6d.
   Each episode card carries the same verdict the film page would give it,
   checked for the focused one as you move, and the header strip's chips say
   what that copy would really play. Held, OK opens a menu against the card,
   which is why OK here acts on release. */
import { artUrl, photoUrl, posterUrl, themeUrl } from '../api/plex/images';
import { scrobble as plexScrobble } from '../api/plex/library';
import { createHold } from '../view/hold';
import * as youtube from '../api/youtube';
import { KEY, clamp, debug, isBack, show as showView, toast } from '../core/ui';
import * as art from '../data/art';
import * as cached from '../data/cached';
import * as guard from '../data/guard';
import * as merge from '../data/merge';
import * as meta from '../data/meta';
import * as people from '../data/people';
import * as servers from '../data/servers';
import * as shows from '../data/shows';
import { audioLabel } from '../rules/audio';
import { identity } from '../rules/identity';
import { div, span, fill, put, must } from '../view/dom';
import * as glyphs from '../view/glyphs';
import * as menu from '../view/menu';
import * as personView from '../view/person';

const titleElement = must('sh-title');
const metaElement = must('sh-meta');
const chipsElement = must('sh-chips');
const summaryElement = must('sh-summary');
const seasonsElement = must('sh-seasons-row');
const seasonsWindow = must('sh-seasons');
const stripElement = must('sh-strip');
const episodesElement = must('sh-episodes');
const castLabelElement = must('sh-cast-label');
const castElement = must('sh-cast');
const artElement = must('sh-art');
const hintElement = must('sh-hint');
const recapsElement = must('sh-recaps');
const headElement = must('sh-head');
const themeElement = must('theme') as HTMLAudioElement;
const viewElement = must('show');
const menuElement = div('hold-menu hidden');
menuElement.id = 'sh-menu';
put(viewElement, menuElement);

/** 6d's card is 472 wide with 36 after it, so the strip steps by this. */
const CARD_STRIDE = 508;
/** Cards kept to the left of the focused one. */
const CARD_LEAD = 1;
/** Whole cards on screen at 1920 less the page margins. */
const CARDS_VISIBLE = 3;
/** Faces in the cast row — six fit across without the row having to wind. */
const CAST_MAX = 6;
/** Asked of Plex for a face drawn at 160px, twice over for the panel's own scaling. */
const FACE_ASKED = 240;
/** Recap cards on screen at once, at 222px each. */
const RECAP_POOL = 7;
const RECAP_LEAD = 2;

/** Enough to reopen the series page on the same actor and credit. */
export interface ActorState {
  name: string;
  credit: number;
  at?: { season?: number; episode?: number };
}

interface ShowOptions {
  at?: { season?: number; episode?: number };
  actor?: ActorState;
  onOpenTitle?: (credit: TmdbFilm, actor: ActorState) => void;
  onExit?: () => void;
  onPlay?: (episode: PlexItem, verdict: Verdict, at?: number) => void;
  onChoose?: (episode: PlexItem) => void;
  onRecap?: (video: Recap) => void;
}

let show: PlexItem | null = null;
let seasons: PlexItem[] = [];
let seasonIndex = 0;
let episodes: PlexItem[] = [];
let episodeIndex = 0;
/** Cards scrolled off the left of the strip. */
let stripShift = 0;
let cast: PlexTag[] = [];
let castIndex = 0;
let zone: 'seasons' | 'episodes' | 'cast' | 'person' | 'recaps' = 'episodes';
let castIds: CastId[] = [];
/** The actor open in place, or null. */
let opened: {
  panel: personView.PersonPanel;
  name: string;
  credits: TmdbFilm[];
  index: number;
  card: HTMLElement;
} | null = null;
let recaps: Recap[] | null = null;
let recapIndex = 0;
let searching = false;
/** options.at.episode, honoured on the first load only. */
let wantEpisode: number | null = null;
let options: ShowOptions = {};
let generation = 0;
let verdicts: Record<string, Verdict> = {};
let checkTimer: ReturnType<typeof setTimeout> | null = null;
/** The hold menu is up against the focused card. */
let holding = false;

function verdictKey(episode: PlexItem): string {
  return `${episode._server}:${episode.ratingKey}`;
}

function paintHeader(): void {
  if (!show) return;
  titleElement.textContent = show.title ?? '';
  summaryElement.textContent = show.summary ?? '';
  const bits: (string | number)[] = [];
  const year = episodes[0]?.originallyAvailableAt?.slice(0, 4) || show.year;
  if (year) bits.push(year);
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
  slideSeasons();
}

let seasonsShift = 0;

function slideSeasons(): void {
  const chip = seasonsElement.children[seasonIndex] as HTMLElement | undefined;
  if (!chip) return;
  const room = seasonsWindow.clientWidth;
  if (chip.offsetLeft + chip.offsetWidth - seasonsShift > room) {
    seasonsShift = chip.offsetLeft + chip.offsetWidth - room;
  } else if (chip.offsetLeft < seasonsShift) {
    seasonsShift = chip.offsetLeft;
  }
  seasonsElement.style.setProperty('--seasons-x', `${-seasonsShift}px`);
}

function verdictBadge(episode: PlexItem): HTMLSpanElement | null {
  const verdict = verdicts[verdictKey(episode)];
  if (!verdict) return null;
  const state = verdict.ok ? 'good' : verdict.state === 'noaudio' ? 'bad' : 'warn';
  return span(`badge ${state} sh-verdict`, guard.label(verdict));
}

function minutes(episode: PlexItem): string {
  return episode.duration ? `${Math.round(episode.duration / 60000)} min` : '';
}

function seenLabel(episode: PlexItem): string {
  if (episode.viewOffset && episode.duration) {
    return `${Math.round((100 * episode.viewOffset) / episode.duration)}%`;
  }
  return (episode as { viewCount?: number }).viewCount ? 'watched' : '';
}

function hint(): string {
  if (holding) return '↑ ↓ choose · OK confirms · ← → or BACK closes';
  if (zone === 'seasons') return '← → choose a series · ↓ to the episodes · BACK to the rail';
  if (zone === 'cast') return '← → along the cast · ↑ back to the episodes · BACK to the rail';
  if (zone === 'person') return '← → along their work · OK to open it · ↑ or BACK to the cast';
  if (zone === 'recaps') {
    return recaps?.length
      ? '← → choose a recap · OK to play it · ↑ back up the page'
      : 'OK to look for season recaps · ↑ back up the page';
  }
  return '← → choose an episode · OK to play · hold OK for more · BACK to the rail';
}

/* The whole series, not a window: the strip slides on one transform, and a
   window that moved with the focus would jump each time instead. */
function renderEpisodes(): void {
  if (!episodes.length) {
    fill(episodesElement, div('sh-episode', 'No episodes in this series.'));
    return;
  }
  fill(episodesElement, ...episodes.map(episodeCard));
  focusEpisodes();
}

function episodeCard(episode: PlexItem): HTMLDivElement {
  const card = div('sh-episode');
  /* An episode's thumb *is* its still, so the picture is already paid for. */
  const still = span('sh-ep-still');
  const url = posterUrl(episode, 480, 270);
  if (url) still.style.setProperty('--still', `url("${url}")`);
  put(
    still,
    span('sh-ep-num', episode.index === undefined ? '·' : String(episode.index)),
    span('sh-ep-mins', minutes(episode)),
    span('sh-ep-seen', seenLabel(episode)),
  );
  put(
    card,
    still,
    span('sh-ep-title', episode.title ?? ''),
    span('sh-ep-blurb', episode.summary ?? ''),
  );
  const badge = verdictBadge(episode);
  if (badge) put(card, badge);
  return card;
}

/* Moving along the strip is a ring, an offset and three chips — never a redraw
   of the cards, which would refetch a still for every press. */
function focusEpisodes(): void {
  const cards = episodesElement.children;
  for (let at = 0; at < cards.length; at++) {
    const card = cards[at] as HTMLElement;
    card.classList.toggle('on', at === episodeIndex && zone === 'episodes');
  }
  stripShift = clamp(episodeIndex - CARD_LEAD, 0, Math.max(0, episodes.length - CARDS_VISIBLE));
  episodesElement.style.setProperty('--strip-x', `${-stripShift * CARD_STRIDE}px`);
  /* The scrim, the dim on every other card and the ring on the held one are all
     this class: the menu is over the page, so nothing else redraws. */
  viewElement.classList.toggle('holding', holding);
  renderChips();
  hintElement.textContent = hint();
}

/* 6d's "4K HDR". HDR only when the server says so — a claim we cannot check is
   worse than silence. */
function qualityLabel(media: PlexMedia | null | undefined): string {
  const resolution = String(media?.videoResolution ?? '').toLowerCase();
  if (!resolution) return '';
  const name =
    resolution === '4k'
      ? '4K'
      : /^\d+$/.test(resolution)
        ? `${resolution}p`
        : resolution.toUpperCase();
  return /hdr|dovi|dolby/i.test(media?.videoDynamicRange ?? '') ? `${name} HDR` : name;
}

/* What the focused episode would really play. The audio chip is the verdict's
   own track — what pickAudio settled on — because naming the file's best track
   beside a stream that will play something else is a lie nobody can act on. */
function renderChips(): void {
  const episode = episodes[episodeIndex];
  const verdict = episode ? verdicts[verdictKey(episode)] : null;
  if (!verdict) {
    fill(chipsElement);
    return;
  }
  const quality = qualityLabel(verdict.media);
  fill(
    chipsElement,
    quality ? span('sh-chip', quality) : null,
    span('sh-chip', audioLabel(verdict.audio)),
    span('sh-chip', 'Subtitles off'),
  );
}

/* Plex's Role first rather than TMDB's names: the row wants the character and
   the photograph, and only Plex carries those. TMDB is the fallback the header
   line already uses. */
function castFrom(metadata: PlexItem | null): PlexTag[] {
  const roles = metadata?.Role ?? [];
  if (roles.length) return roles.slice(0, CAST_MAX);
  const facts = art.factsFor(show);
  return castNamed(facts?.castIds ?? []);
}

function castNamed(list: CastId[]): PlexTag[] {
  return list.slice(0, CAST_MAX).map((credit) => ({ tag: credit.name }));
}

function renderCast(): void {
  viewElement.classList.toggle('no-cast', !cast.length);
  fill(castElement, ...cast.map(actorCard));
  focusCast();
}

function actorCard(role: PlexTag): HTMLDivElement {
  const name = role.tag ?? '';
  const face = span('sh-actor-face');
  const url = photoUrl(servers.of(show), role.thumb, FACE_ASKED, FACE_ASKED);
  /* Initials rather than an empty disc: plenty of a library has no photographs. */
  if (url) face.style.setProperty('--face', `url("${url}")`);
  else face.textContent = initials(name);
  const actor = div('sh-actor');
  put(actor, face, div('sh-actor-name', name), div('sh-actor-role', role.role ?? ''));
  return actor;
}

function initials(name: string): string {
  return name
    .split(/\s+/, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function focusCast(): void {
  const faces = castElement.children;
  for (let at = 0; at < faces.length; at++) {
    (faces[at] as HTMLElement).classList.toggle('on', at === castIndex && zone === 'cast');
  }
}

/* One zone at a time carries the focus, so every change redraws all of them
   rather than leaving a ring behind in the one being left. */
function goZone(to: typeof zone): void {
  zone = to;
  if (to === 'cast') castIndex = clamp(castIndex, 0, Math.max(0, cast.length - 1));
  renderSeasons();
  focusEpisodes();
  focusCast();
  renderRecaps();
}

/* Down the page: the cast, then the recaps strip when there is a key for it.
   A show with neither stays where it is. */
function stepDown(): void {
  if (zone === 'episodes' && cast.length) goZone('cast');
  else if (youtube.enabled()) goZone('recaps');
}

/* The recaps strip, which costs nothing to draw: one action until it is
   pressed, then the rail it turned into. Entering the zone lifts the page to
   make room — a transform, not a height. */
function renderRecaps(): void {
  if (!youtube.enabled()) {
    fill(recapsElement);
    return;
  }
  const showing = zone === 'recaps';
  hintElement.textContent = hint();
  recapsElement.classList.toggle('open', showing);
  /* The whole page moves, or the cast would sit under the recap cards. */
  headElement.classList.toggle('lifted', showing);
  seasonsWindow.classList.toggle('lifted', showing);
  stripElement.classList.toggle('lifted', showing);
  castLabelElement.classList.toggle('lifted', showing);
  castElement.classList.toggle('lifted', showing);

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
  paintHeader();
  fill(episodesElement, div('sh-episode', 'Loading…'));
  focusEpisodes();

  void shows
    .episodes(season)
    .then((list) => {
      if (mine !== generation) return;
      episodes = list;
      paintHeader();
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
  cast = [];
  castIds = [];
  opened = null;
  viewElement.classList.remove('person');
  seasonIndex = 0;
  seasonsShift = 0;
  episodeIndex = 0;
  castIndex = 0;
  zone = 'episodes';
  verdicts = {};
  recaps = null;
  recapIndex = 0;
  searching = false;
  okHold.cancel();
  holding = false;

  showView('show');
  paintHeader();
  silence(); // whatever the last series was, it is over
  playTheme();
  renderRecaps();
  renderCast();
  fill(chipsElement);
  fill(seasonsElement);
  fill(episodesElement, div('sh-episode', 'Loading…'));
  focusEpisodes();

  const mine = generation;
  /* One metadata call for the show, which is where its cast lives — the season
     and episode lists carry none. */
  void meta.load(entry).then((metadata) => {
    if (mine !== generation) return;
    cast = castFrom(metadata);
    renderCast();
    resumeActor();
  });
  void art.castIds(entry).then((list) => {
    if (mine !== generation) return;
    castIds = list;
    if (!cast.length) {
      cast = castNamed(list);
      renderCast();
    }
    resumeActor();
  });

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
  okHold.cancel();
  silence();
  show = null;
  options.onExit?.();
}

/** `at` of 0 starts the episode again; undefined picks it up where it was. */
function playFocused(at?: number): void {
  const episode = episodes[episodeIndex];
  if (!episode) return;
  const verdict = verdicts[verdictKey(episode)];
  /* Not checked yet, or the preferred copy will not play: the film page is
     where every copy is listed, so send them there rather than guessing. */
  if (!verdict?.ok) {
    openCopies();
    return;
  }
  options.onPlay?.(episode, verdict, at);
}

function openCopies(): void {
  okHold.cancel(); // or the menu opens behind the film page
  const episode = episodes[episodeIndex];
  if (episode) options.onChoose?.(episode);
}

/* ---------- holding OK on an episode ----------

   OK here acts on *release*. It has to: a hold must be able to open this menu
   instead of playing, and playFocused() reaches the decision endpoint on a
   server we do not own — a side effect that cannot be fired and then taken
   back. Nothing else in the app listens for keyup. */

/** The box in css/show.css, and the gap it keeps from the screen edges. */

const okHold = createHold(playFocused, openHoldMenu);

function seasonNumber(episode: PlexItem): number {
  return episode.parentIndex ?? seasons[seasonIndex]?.index ?? 0;
}

/** 'S2 E3', from the episode's own numbers rather than its place in the list. */
function tag(episode: PlexItem): string {
  return `S${seasonNumber(episode)} E${episode.index ?? 0}`;
}

/** The stretch "mark all up to here" would cover: the series' first episode to
    this one, or just this one when it is the first. */
function spanUpTo(episode: PlexItem): string {
  const first = episodes[0];
  if (!first || first.index === episode.index) return tag(episode);
  return `S${seasonNumber(episode)} E${first.index ?? 0}–E${episode.index ?? 0}`;
}

function holdRows(episode: PlexItem): menu.MenuRow[] {
  return [
    { icon: glyphs.watched, label: 'Mark as watched', value: 'watched' },
    {
      icon: glyphs.watchedAll,
      label: 'Mark all up to here',
      note: spanUpTo(episode),
      value: 'upto',
    },
    { icon: glyphs.restart, label: 'Play from start', note: minutes(episode), value: 'restart' },
    { icon: glyphs.info, label: 'Episode details', value: 'details' },
  ];
}

/* Against the card: its offset is taken back through the shift the strip is
   sitting at, and menu.holdMenuAt keeps the result on the screen. The number
   comes from here, the position stays in CSS. */
function anchorMenu(card: HTMLElement): void {
  const at = menu.holdMenuAt(
    stripElement.offsetLeft + card.offsetLeft - stripShift * CARD_STRIDE,
    stripElement.offsetTop + card.offsetTop,
    menuElement.offsetHeight,
  );
  menuElement.style.setProperty('--menu-left', `${at.left}px`);
  menuElement.style.setProperty('--menu-top', `${at.top}px`);
}

function openHoldMenu(): void {
  const episode = episodes[episodeIndex];
  if (!episode || holding) return;

  holding = true;
  focusEpisodes();
  const card = episodesElement.querySelector('.sh-episode.on') as HTMLElement | null;
  if (!card) {
    holding = false;
    return;
  }

  menu.open({
    host: menuElement,
    head: { kicker: tag(episode), title: episode.title ?? '' },
    tabs: [{ label: '', rows: () => holdRows(episode) }],
    onChoose: (value) => {
      chose(String(value), episode);
    },
    onClose: () => {
      holding = false;
      focusEpisodes();
    },
  });
  anchorMenu(card);
}

function chose(value: string, episode: PlexItem): void {
  if (value === 'watched') markWatched([episode]);
  else if (value === 'upto') markWatched(episodes.slice(0, episodeIndex + 1));
  else if (value === 'restart') playFocused(0);
  else openCopies();
}

/* Every copy, because each server keeps its own watch state — the same reason
   the deck scrobbles each copy it clears rather than only the shown one. */
function markWatched(list: PlexItem[]): void {
  const writes: Promise<unknown>[] = [];
  list.forEach((episode) => {
    merge.sources(episode).forEach((copy) => {
      const server = servers.of(copy);
      if (server) writes.push(plexScrobble(server, copy.ratingKey));
    });
  });
  if (!writes.length) {
    toast('No server to mark it on');
    return;
  }

  void Promise.all(writes).then(
    () => {
      list.forEach((episode) => {
        const seen = episode as { viewCount?: number; viewOffset?: number };
        seen.viewCount = 1;
        seen.viewOffset = 0;
      });
      renderEpisodes();
      toast(list.length === 1 ? 'Marked watched' : `Marked ${list.length} episodes watched`);
    },
    (error: Error) => {
      debug(`scrobble: ${error.message}`);
      toast('Could not mark it watched');
    },
  );
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

function seasonsKey(code: number): void {
  if (code === KEY.LEFT && seasonIndex > 0) {
    seasonIndex--;
    renderSeasons();
    loadEpisodes();
  } else if (code === KEY.RIGHT && seasonIndex < seasons.length - 1) {
    seasonIndex++;
    renderSeasons();
    loadEpisodes();
  } else if (code === KEY.DOWN || code === KEY.OK) {
    goZone('episodes');
  } else if (isBack(code)) {
    close();
  }
}

/* Reopened from a title the actor's page led to: needs both the roles and the
   TMDB ids, which arrive separately. */
function resumeActor(): void {
  const want = options.actor;
  if (!want || !cast.length || !castIds.length) return;
  options.actor = undefined;
  const at = cast.findIndex((role) => role.tag === want.name);
  if (at < 0) return;
  castIndex = at;
  zone = 'cast';
  focusEpisodes();
  focusCast();
  void openPerson(want.credit);
}

function refuse(why: string): void {
  debug(`person: ${why}`);
  toast(why);
}

async function openPerson(credit = 0): Promise<void> {
  const role = cast[castIndex];
  const card = castElement.children[castIndex] as HTMLElement | undefined;
  if (!role?.tag || !card) return refuse('No name for this actor');
  if (!castIds.length) return refuse('Still reading the cast, try again in a moment');
  const known = people.match(role.tag, castIds);
  if (!known) return refuse(`No credits found for ${role.tag}`);
  const mine = generation;
  const wanted = castIndex;
  let got: TmdbPerson;
  try {
    got = await people.person(known.id);
  } catch (error) {
    debug(`person: ${(error as Error).message}`);
    toast('Could not read their credits');
    return;
  }
  if (mine !== generation || zone !== 'cast' || castIndex !== wanted) {
    debug(`person: ${role.tag} arrived after the page had moved on`);
    return;
  }
  const credits = people.newestFirst(got.credits);
  const panel = personView.build(got, role.tag, credits);
  opened = {
    panel,
    name: role.tag,
    credits,
    index: personView.step(credit, 0, credits.length),
    card,
  };
  personView.focus(panel, opened.index);
  card.style.setProperty('--face-x', `${-card.offsetLeft}px`);
  card.classList.add('open');
  put(castElement, panel.root);
  viewElement.classList.add('person');
  zone = 'person';
  hintElement.textContent = hint();
}

function closePerson(): void {
  if (!opened) return;
  castElement.removeChild(opened.panel.root);
  opened.card.classList.remove('open');
  opened = null;
  viewElement.classList.remove('person');
  zone = 'cast';
  focusCast();
  hintElement.textContent = hint();
}

function personKey(code: number): void {
  if (!opened) return;
  if (code === KEY.UP || isBack(code)) {
    closePerson();
  } else if (code === KEY.LEFT || code === KEY.RIGHT) {
    const delta = code === KEY.LEFT ? -1 : 1;
    opened.index = personView.step(opened.index, delta, opened.credits.length);
    personView.focus(opened.panel, opened.index);
  } else if (code === KEY.OK) {
    const credit = opened.credits[opened.index];
    const episode = episodes[episodeIndex];
    if (credit) {
      options.onOpenTitle?.(credit, {
        name: opened.name,
        credit: opened.index,
        at: { season: episode?.parentIndex, episode: episode?.index },
      });
    }
  }
}

function castKey(code: number): void {
  if (code === KEY.OK) void openPerson();
  else if (code === KEY.UP) goZone('episodes');
  else if (code === KEY.DOWN) stepDown();
  else if (code === KEY.LEFT && castIndex > 0) {
    castIndex--;
    focusCast();
  } else if (code === KEY.RIGHT && castIndex < cast.length - 1) {
    castIndex++;
    focusCast();
  } else if (isBack(code)) {
    close();
  }
}

function recapsKey(code: number): void {
  if (code === KEY.UP) {
    goZone(cast.length ? 'cast' : 'episodes');
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
}

export function key(code: number): boolean {
  if (okHold.swallow(code)) return true;
  if (code !== KEY.OK) okHold.cancel();
  if (menu.isOpen()) return menu.key(code);

  if (zone === 'seasons') {
    seasonsKey(code);
    return true;
  }
  if (zone === 'cast') {
    castKey(code);
    return true;
  }
  if (zone === 'person') {
    personKey(code);
    return true;
  }
  if (zone === 'recaps') {
    recapsKey(code);
    return true;
  }

  if (code === KEY.UP) goZone('seasons');
  else if (code === KEY.DOWN) stepDown();
  else if (code === KEY.LEFT && episodeIndex > 0) {
    episodeIndex--;
    focusEpisodes();
    scheduleCheck();
  } else if (code === KEY.RIGHT && episodeIndex < episodes.length - 1) {
    episodeIndex++;
    focusEpisodes();
    scheduleCheck();
  } else if (code === KEY.OK) okHold.down();
  else if (isBack(code)) close();
  return true; // this page swallows everything else
}

/** OK on an episode plays on release; a hold has already opened the menu. */
export function keyUp(code: number): void {
  if (code === KEY.OK) okHold.up();
}

export function current(): PlexItem | null {
  return show;
}
