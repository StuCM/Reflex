/* Playback, and everything you can do while it runs.

   Nothing reaches this file without a verdict from data/guard, which is why
   nothing here re-checks one. */
import { photoUrl, posterUrl } from '../api/plex/images';
import { streamUrl, subtitles as fetchSubtitles, timeline } from '../api/plex/playback';
import settings from '../core/config';
import { clamp, debug, isBack, toast } from '../core/ui';
import { audioLabel, audioMenuLabel, audioTracks } from '../rules/audio';
import * as cues from '../rules/cues';
import { bitrateLabel, isUHD, qualities, versionLabel } from '../rules/quality';
import { isTextSub, pickSubtitle, subLabel, subtitleTracks } from '../rules/subtitles';
import { chapters, markerAt, markerLabel } from '../rules/timeline';
import { div, fill, must, put, span, svg } from '../view/dom';
import * as glyphs from '../view/glyphs';
import * as menu from '../view/menu';
import type { MenuRow, MenuTab } from '../view/menu';

/* Past the standard element, and in lib.dom's DOM lib neither: a track list
   some pipelines let us select on, and webkit's frame counters. */
interface PanelTrack {
  enabled: boolean;
}

interface PanelTrackList {
  length: number;
  [index: number]: PanelTrack | undefined;
}

interface PanelVideoElement extends HTMLVideoElement {
  audioTracks?: PanelTrackList;
  webkitDroppedFrameCount?: number;
  webkitDecodedFrameCount?: number;
}

/** What a restart asks the server for. `at` is where to pick up. */
export interface PlaybackSwitch {
  at: number;
  subLang: string | null;
  audioId?: number | string | null;
  mediaIndex?: number;
  maxBitrate?: number | null;
  forceStream?: boolean;
}

export interface PlayOptions {
  item: PlexItem;
  server: PlexServer;
  part: PlexPart | undefined;
  url?: string | null;
  audio?: PlexStream | null;
  mediaIndex?: number;
  maxBitrate?: number | null;
  transcode?: boolean;
  forceStream?: boolean;
  subLang?: string | null;
  onExit?: (() => void) | null;
  onError?: ((message: string) => void) | null;
  onSwitch?: ((change: PlaybackSwitch) => void) | null;
  onNext?: ((item: PlexItem) => Promise<NextEpisode | null>) | null;
  onPlayNext?: ((episode: PlexItem) => void) | null;
}

interface NextEpisode {
  episode: PlexItem;
  newSeason: boolean;
}

/** One button on the control row. The transport three have no id and no panel;
    the four choices have both. */
interface Control {
  id?: string;
  glyph: string;
  caption?: string;
  run?: () => void;
}

const videoElement = must('video') as PanelVideoElement;
const osd = must('osd');
const osdTitle = must('osd-name');
const osdTime = must('osd-time');
const osdTotal = must('osd-total');
const osdFill = must('osd-fill');
const osdBuffered = must('osd-buffered');
const osdTicks = must('osd-ticks');
const osdBar = must('osd-bar');
const osdKnob = must('osd-knob');
const osdLeft = must('osd-left');
const osdRight = must('osd-right');
const osdHint = must('osd-hint');
const chaptersElement = must('osd-chapters');
const chaptersInner = must('osd-chapters-inner');
const skipElement = must('osd-skip');
const nextElement = must('upnext');
const nextStillElement = must('un-still');
const nextShowElement = must('un-show');
const nextTitleElement = must('un-title');
const nextHintElement = must('un-hint');
const subtitleElement = must('subtitle');
const menuElement = must('menu');

/** #osd-bar, in CSS pixels. */
const BAR_W = 1300;
/** .osd-chap plus its margin. */
const CARD_W = 260;
const CARDS_SHOWN = 6;
/** Milliseconds of stillness before a seek is applied. */
const SEEK_SETTLE = 400;
/** Left / right, in seconds. */
const NUDGE = 30;
/** Rewind / fast forward, in seconds. */
const JUMP = 300;

let item: PlexItem | null = null;
let server: PlexServer | null = null;
let onExit: (() => void) | null = null;
let onError: ((message: string) => void) | null = null;
let onSwitch: ((change: PlaybackSwitch) => void) | null = null;
let onNext: ((item: PlexItem) => Promise<NextEpisode | null>) | null = null;
let onPlayNext: ((episode: PlexItem) => void) | null = null;
let currentPart: PlexPart | null = null;
let currentAudio: PlexStream | null = null;
let currentMedia: PlexMedia | null = null;
let mediaIndex = 0;
let maxBitrate: number | null = null;
let transcoding = false;
let forceStream = false;
let ticker: ReturnType<typeof setInterval> | null = null;
let osdTimer: ReturnType<typeof setTimeout> | null = null;
let resumeMs = 0;

/* A stall is the thing you actually see as a blip, and it is over before the
   ten-second sample comes round. Count them instead. */
let stalls = 0;
let lowest = 999;
let startedAt = 0;

/* Where a run of seek presses is heading. Every currentTime assignment on a
   direct-played file is a real seek — a range request, a decoder flush — so
   holding the key would otherwise fire one per press and fight the network
   the whole way. Accumulate, show where you are going, apply once you stop. */
let pending: number | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;

/* Subtitles: the parsed cues, which track they came from, and the language
   the user asked for. The language is what survives a restart — after a
   switch to another version the stream ids are different, but "French" still
   means the same thing. */
let subtitleCues: Cue[] = [];
let currentSub: PlexStream | null = null;
let wantedLang: string | null = null;
let subToken = 0;
let subNote = '';

/* The skip prompt. The menu is view/menu and keeps its own state. */
let marker: PlexMarker | null = null;

/* Focus is a mode, and that is the only reason every key CLAUDE.md documents
   goes on meaning what it says: in 'none' the arrows seek, in 'bar' they
   scrub the trackbar, in 'row' they walk the buttons — and controlIndex says
   which button. Which panel is open under the row, and where the chapter rail
   is, are separate. */
let focus: 'none' | 'bar' | 'row' = 'none';
let controlIndex = -1;
let openPanel: string | null = null;
let chapterIndex = 0;

function pad(value: number): string {
  return (value < 10 ? '0' : '') + value;
}

function timecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const rest = whole % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/* A live or badly-muxed stream reports Infinity, and every sum here divides
   by this — so fall back to what the server said the film runs to. */
function duration(): number {
  const reported = videoElement.duration;
  if (reported && isFinite(reported)) return reported;
  return ((item && item.duration) || 0) / 1000;
}

/* Where the picture will be once any pending seek lands — that is what the
   user is aiming at, so that is what the bar and the clock have to show. */
function target(): number {
  return pending === null ? videoElement.currentTime || 0 : pending;
}

/* ---------- the OSD ----------

   Two separate things: painting the time, and putting the OSD back on screen
   for another few seconds. Repainting must not reset the hide timer, or the
   OSD would never go away once playback started. */

/** How far the buffer runs, in seconds. Null is a pipeline that would not say
    — distinct from 0, which is one that has buffered nothing yet, and the
    health line reports the two differently. */
function bufferedEnd(): number | null {
  try {
    const ranges = videoElement.buffered;
    if (ranges && ranges.length) return ranges.end(ranges.length - 1);
  } catch {
    return null;
  }
  return 0;
}

function paintOsd(): void {
  const at = target();
  const total = duration();
  const left = total ? Math.max(0, total - at) : 0;
  const paused = videoElement.paused ? '   PAUSED' : '';

  osdTime.textContent = timecode(at) + (pending === null ? paused : '   SEEKING');
  osdTotal.textContent = timecode(total) + (total ? `   ·   ${timecode(left)} left` : '');

  const across = total ? Math.round((BAR_W * Math.min(at, total)) / total) : 0;
  osdFill.style.setProperty('--fill', `${across}px`);
  /* transform, not left: the knob moves on every timeupdate and this is the
     one property the panel can move without a layout pass. */
  osdKnob.style.setProperty('--at', `${Math.min(across, BAR_W - 6)}px`);

  const ahead = bufferedEnd() ?? 0;
  osdBuffered.style.setProperty(
    '--buffered',
    total ? `${Math.round((BAR_W * Math.min(ahead, total)) / total)}px` : '0',
  );
}

/* Chapters as ticks, markers as bands. Drawn once, when the duration is
   known — they do not move, and rebuilding them on every frame is exactly
   the kind of work this panel cannot afford. */
function paintTicks(): void {
  const total = duration();
  if (!total) {
    fill(osdTicks);
    return;
  }
  const marks: HTMLElement[] = [];
  ((item && item.Marker) || []).forEach((band) => {
    const from = (band.startTimeOffset || 0) / 1000;
    const to = (band.endTimeOffset || 0) / 1000;
    const element = span('osd-band');
    element.style.setProperty('--at', `${Math.round((BAR_W * from) / total)}px`);
    const wide = Math.max(2, Math.round((BAR_W * (to - from)) / total));
    element.style.setProperty('--wide', `${wide}px`);
    marks.push(element);
  });
  chapters(item).forEach((chapter) => {
    if (chapter.start <= 0) return;
    const element = span('osd-tick');
    element.style.setProperty('--at', `${Math.round((BAR_W * chapter.start) / total)}px`);
    marks.push(element);
  });
  fill(osdTicks, ...marks);
}

function showOsd(): void {
  paintOsd();
  osd.classList.remove('hidden');
  osd.classList.remove('faded');
  subtitleElement.classList.add('lifted');
  if (osdTimer) clearTimeout(osdTimer);
  /* While a seek is still being aimed, the OSD is the only feedback there is,
     so it stays until the seek lands. The menu keeps it up too — it sits
     above the bar and reads as one panel. */
  osdTimer = setTimeout(() => {
    if (pending !== null || menu.isOpen() || openPanel || focus !== 'none') {
      showOsd();
      return;
    }
    osd.classList.add('faded');
    subtitleElement.classList.remove('lifted');
  }, 4000);
}

function osdShowing(): boolean {
  return !osd.classList.contains('faded') && !osd.classList.contains('hidden');
}

function hint(): void {
  if (openPanel === 'chapters') {
    osdHint.textContent = '◀ ▶ chapter · OK jump there · BACK close';
  } else if (menu.isOpen()) {
    osdHint.textContent = '▲ ▼ choose · OK select · BACK close';
  } else if (focus === 'row') {
    osdHint.textContent = '◀ ▶ control · OK open it · ▲ trackbar · ▼ back to playback';
  } else if (focus === 'bar') {
    osdHint.textContent = '◀ ▶ scrub · OK seek there · ▼ controls · BACK back to playback';
  } else {
    osdHint.textContent =
      `◀ ▶ ${NUDGE}s · ▲ trackbar · ▼ controls · 0–9 jump · ` + 'CH± chapter · OK pause';
  }
}

/* Move between the three modes. Leaving for playback forgets which button the
   row was on; the trackbar says so with the knob's ring. */
function setFocus(to: 'none' | 'bar' | 'row'): void {
  focus = to;
  if (to === 'none') controlIndex = -1;
  else if (to === 'row' && controlIndex < 0) controlIndex = indexOfControl('audio');
  osdBar.classList.toggle('foc', to === 'bar');
}

/* Every key that moves the focus repaints the row and puts the OSD back up.
   play() and stop() call setFocus alone, because neither wants either. */
function moveFocus(to: 'none' | 'bar' | 'row'): void {
  setFocus(to);
  paintControls();
  showOsd();
}

/* ---------- choosing the audio track ----------

   A direct play hands the panel the whole file and `audioStreamID` changes
   none of it, so only two things actually switch a track: selecting on the
   panel's own list, or giving up direct play and having the server mux it —
   which on a 4K file the guard refuses. Everything below is that choice. */

/* The panel's own track list, or null when it does not have one. Only useful
   once metadata has loaded, so never cached. */
function panelTracks(): PanelTrackList | null {
  const list = videoElement.audioTracks;
  if (!list || typeof list.length !== 'number' || list.length < 2) return null;
  return list;
}

/* Which entry of the panel's list is this Plex stream? The file's audio
   streams and the pipeline's track list are the same tracks in the same
   order — but only if they are the same length. If they are not, we do not
   know what we are looking at, and guessing would select the wrong track
   silently, which is the bug this whole section exists to fix. */
function panelIndexOf(stream: PlexStream): number {
  const tracks = audioTracks(currentPart);
  const list = panelTracks();
  if (!list || list.length !== tracks.length) return -1;
  return tracks.findIndex((track) => String(track.id) === String(stream.id));
}

function selectPanelTrack(at: number): boolean {
  const list = panelTracks();
  if (!list || at < 0 || at >= list.length) return false;
  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (track) track.enabled = i === at;
  }
  /* Trust nothing: read it back. A pipeline that exposes the list read-only
     would otherwise look like a successful switch and sound like the old
     track — the exact failure being fixed. */
  const chosen = list[at];
  return !!(chosen && chosen.enabled);
}

/* Is the track named on screen the track you are hearing? Only if we chose
   it: the server muxed the stream, or the panel let us select it. */
function audioIsOurs(): boolean {
  return transcoding || audioTracks(currentPart).length < 2 || !!panelTracks();
}

/* The track the guard picked is a promise the masthead already made before
   OK was pressed. If the panel lets us keep that promise, keep it at once
   rather than waiting to be asked — otherwise the first thing you hear is
   whatever the file happens to list first, which on a remux is routinely
   the one track that cannot cross ARC. */
function applyChosenTrack(): void {
  if (!currentAudio || transcoding) return;
  const at = panelIndexOf(currentAudio);
  if (at < 0) {
    paintControls();
    return;
  }
  const list = panelTracks();
  const already = list && list[at];
  if (already && already.enabled) return; // already right, say nothing
  if (selectPanelTrack(at)) {
    debug(`audio set on the panel (track ${at}): ${audioLabel(currentAudio)}`);
  }
  paintControls();
}

function chooseAudio(stream: PlexStream): void {
  if (currentAudio && String(currentAudio.id) === String(stream.id)) return;
  const at = panelIndexOf(stream);
  if (at >= 0 && selectPanelTrack(at)) {
    /* The good case: the panel switched it, nothing restarted, the server
       was not asked for anything. */
    currentAudio = stream;
    debug(`audio switched on the panel (track ${at}): ${audioLabel(stream)}`);
    paintControls();
    showOsd();
    return;
  }
  switchTo({ audioId: stream.id, forceStream: true }, audioMenuLabel(stream));
}

/* ---------- the control row ----------

   Transport on the left, the four things that can be changed on the right.
   Each right-hand button is captioned with what is chosen NOW rather than
   what is highlighted, because the caption is what you read before deciding
   to open anything; the violet ring says which panel is open. */

function audioCaption(): string {
  return audioMenuLabel(currentAudio) + (audioIsOurs() ? '' : ' — panel’s choice');
}

function subCaption(): string {
  return (currentSub ? subLabel(currentSub) : 'off') + (subNote ? ` — ${subNote}` : '');
}

function qualityCaption(): string {
  return maxBitrate ? `${bitrateLabel(maxBitrate)} converted` : versionLabel(currentMedia);
}

function chapterCaption(): string {
  const here = chapterAt(chapters(item), target());
  return here ? here.title : 'none';
}

/* The three transport buttons, then the four choices. The order is the order
   on screen, and the index into it is what the arrows move. */
function controls(): Control[] {
  return [
    {
      glyph: glyphs.rewind,
      run: () => {
        seekBy(-JUMP);
      },
    },
    { glyph: videoElement.paused ? glyphs.play : glyphs.pause, run: togglePlay },
    {
      glyph: glyphs.forward,
      run: () => {
        seekBy(JUMP);
      },
    },
    { id: 'audio', glyph: glyphs.audio, caption: audioCaption() },
    { id: 'subs', glyph: glyphs.subs, caption: subCaption() },
    { id: 'quality', glyph: glyphs.quality, caption: qualityCaption() },
    { id: 'chapters', glyph: glyphs.chapters, caption: chapterCaption() },
  ];
}

function paintControls(): void {
  const left: HTMLElement[] = [];
  const right: HTMLElement[] = [];
  controls().forEach((control, at) => {
    const element = div(
      `osd-ctl${focus === 'row' && at === controlIndex ? ' foc' : ''}` +
        (control.id && control.id === openPanel ? ' on' : ''),
    );
    if (control.id) element.id = `osd-ctl-${control.id}`;
    const face = div('osd-btn');
    put(face, svg(control.glyph));
    put(element, face, div('osd-cap', control.caption || ''));
    (control.id ? right : left).push(element);
  });
  fill(osdLeft, ...left);
  fill(osdRight, ...right);
  hint();
}

function togglePlay(): void {
  if (videoElement.paused) videoElement.play();
  else videoElement.pause();
  report(videoElement.paused ? 'paused' : 'playing');
  paintControls();
  showOsd();
}

/* ---------- seeking ---------- */

/* Nudge the target. Repeats accumulate rather than each one seeking. */
function seekBy(seconds: number): void {
  seekTo(target() + seconds);
}

function seekTo(seconds: number): void {
  const total = duration();
  pending = Math.max(0, total ? Math.min(seconds, total - 2) : seconds);
  dismissSkip();
  showOsd();
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = setTimeout(applySeek, SEEK_SETTLE);
}

/* An element that is not seekable yet throws rather than refusing quietly. */
function seekNow(to: number): void {
  try {
    videoElement.currentTime = to;
  } catch {
    /* not seekable yet */
  }
}

function applySeek(): void {
  if (pending === null) return;
  const to = pending;
  pending = null;
  seekNow(to);
  report(videoElement.paused ? 'paused' : 'playing');
  paintSub();
  showOsd();
}

/* A digit is the cheapest jump there is: 3 means three tenths in. The stock
   app has nothing like it and it is the fastest way past a first act. */
function jumpToTenth(tenth: number): void {
  const total = duration();
  if (!total) return;
  seekTo((total * tenth) / 10);
}

/* Chapter skip, falling back to a fixed jump on a file with no chapters —
   the button should always do something. */
function chapterStep(direction: number): void {
  const list = chapters(item);
  const at = target();
  if (!list.length) {
    seekBy(direction * JUMP);
    return;
  }
  if (direction > 0) {
    const ahead = list.find((chapter) => chapter.start > at + 1);
    seekTo(ahead ? ahead.start : Math.max(0, duration() - 5));
    return;
  }
  /* Back once goes to the start of this chapter, again to the one before —
     which is how every disc player has behaved for twenty years. */
  let to = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const chapter = list[i];
    if (chapter && chapter.start < at - 3) {
      to = chapter.start;
      break;
    }
  }
  seekTo(to);
}

/* ---------- skip intro ----------

   The server has already analysed the film and says where the intro and the
   credits are, so there is nothing to detect here — only something to offer
   while you are inside one. OK takes it; anything else carries on. */

let skipDismissed: PlexMarker | null = null;

function checkMarker(): void {
  let found = markerAt(item, videoElement.currentTime || 0);
  /* A dismissal lasts as long as you are inside the thing you dismissed, and
     no longer. Rewinding back over an intro and being refused the offer —
     because you happened to seek while it was on screen an hour ago — is not
     a decision anyone made. */
  if (skipDismissed && found !== skipDismissed) skipDismissed = null;
  if (found && skipDismissed === found) found = null;
  if (found === marker) return;
  marker = found;
  if (!marker) {
    skipElement.classList.add('hidden');
    return;
  }
  skipElement.textContent = `${markerLabel(marker)}   ›   OK`;
  skipElement.classList.remove('hidden');
}

function dismissSkip(): void {
  if (!marker) return;
  skipDismissed = marker;
  marker = null;
  skipElement.classList.add('hidden');
}

function takeSkip(): void {
  if (!marker) return;
  const to = (marker.endTimeOffset || 0) / 1000;
  skipDismissed = marker;
  marker = null;
  skipElement.classList.add('hidden');
  /* Applied at once rather than through the settle timer: the whole point is
     that one press gets you past it. */
  pending = null;
  if (seekTimer) clearTimeout(seekTimer);
  seekNow(to);
  debug(`skipped to ${timecode(to)}`);
  showOsd();
}

/* ---------- what comes next ----------

   An episode that ends offers the one after it, and waits for a keypress
   unless the setting says otherwise: a chain that rolls all night is load on
   hardware we do not own. A season boundary never counts down at all. */

/** Seconds; 0 is "wait for OK". */
const AUTOPLAY = [0, 5, 10, 15, 30];
/** Read from storage once, then cached. */
let autoplay: number | null = null;
let next: NextEpisode | null = null;
let nextTimer: ReturnType<typeof setInterval> | null = null;
let nextLeft = 0;

/** How long an ended episode waits before playing the next, in seconds, or 0
    for not at all. Storage that refuses us falls back to 0, the safe way. */
export function autoplaySeconds(): number {
  if (autoplay !== null) return autoplay;
  let stored = 0;
  try {
    stored = Number(localStorage.getItem('reflex.autoplay'));
  } catch {
    stored = 0;
  }
  autoplay = AUTOPLAY.indexOf(stored) > 0 ? stored : 0;
  return autoplay;
}

/** off → 5 → 10 → 15 → 30 → off, persisted. Cycling is the cheapest control a
    d-pad has, which is why the preference is a sidebar entry and not a screen. */
export function cycleAutoplay(): number {
  const chosen = AUTOPLAY[(AUTOPLAY.indexOf(autoplaySeconds()) + 1) % AUTOPLAY.length] ?? 0;
  autoplay = chosen;
  try {
    localStorage.setItem('reflex.autoplay', String(chosen));
  } catch {
    /* private mode */
  }
  return chosen;
}

/** 'off' or '10s' — what the sidebar entry and its toast say. */
export function autoplayLabel(): string {
  const seconds = autoplaySeconds();
  return seconds ? `${seconds}s` : 'off';
}

/* Playback ended on its own. Ask what follows before tearing anything down,
   because with nothing to offer this is an ordinary stop. */
function offerNext(): void {
  if (!onNext || !item) {
    stop('stopped');
    return;
  }
  const asked = item;
  onNext(item).then(
    (found) => {
      if (item !== asked) return; // stopped while we were asking
      if (!found || !found.episode) {
        stop('stopped');
        return;
      }
      showNext(found);
    },
    () => {
      stop('stopped');
    },
  );
}

/* "S1 E5 · Sundown" — where it sits in the series, then what it is called. */
function nextLabel(episode: PlexItem): string {
  return (
    `S${episode.parentIndex === undefined ? '?' : episode.parentIndex}` +
    ' E' +
    (episode.index === undefined ? '?' : episode.index) +
    '   ·   ' +
    (episode.title || '')
  );
}

function showNext(found: NextEpisode): void {
  next = found;
  dismissSkip();
  menu.close();
  const episode = found.episode;
  const still = posterUrl(episode, 320, 180);
  nextStillElement.style.setProperty('--shot', still ? `url("${still}")` : 'none');
  nextShowElement.textContent = `Up next   ·   ${episode.grandparentTitle || ''}`;
  nextTitleElement.textContent = nextLabel(episode);
  /* Crossing into a new season always waits, whatever the setting says: it is
     exactly where an unattended chain should stop. */
  nextLeft = found.newSeason ? 0 : autoplaySeconds();
  paintNext();
  nextElement.classList.remove('hidden');
  if (nextLeft > 0) nextTimer = setInterval(tickNext, 1000);
  debug(
    `up next: ${nextLabel(episode)}` + (nextLeft > 0 ? ` in ${nextLeft}s` : ' — waiting for OK'),
  );
}

function paintNext(): void {
  nextHintElement.textContent =
    nextLeft > 0
      ? `Playing in ${nextLeft}s   ·   OK now   ·   BACK to stop`
      : 'OK to play   ·   BACK to stop';
}

function tickNext(): void {
  nextLeft--;
  paintNext();
  if (nextLeft <= 0) takeNext();
}

/* Take the panel down and kill the countdown with it. A timer that plays an
   episode onto a screen nobody is looking at is worse than no feature, so
   every way out of playback comes through here. */
function clearNext(): void {
  if (nextTimer) clearInterval(nextTimer);
  nextTimer = null;
  nextLeft = 0;
  next = null;
  nextElement.classList.add('hidden');
}

function takeNext(): void {
  const episode = next && next.episode;
  const start = onPlayNext;
  clearNext();
  if (!episode || !start) {
    stop('stopped');
    return;
  }
  /* The finished episode is reported stopped before the next one starts — a
     session left open on a server we do not own is the rudest thing this app
     can do. Quietly, or onExit would bounce us out mid-handover. */
  stop('stopped', true);
  start(episode);
}

function nextKey(code: number): boolean {
  if (code === 13 || code === 415 || code === 19 || code === 179) {
    takeNext();
    return true;
  }
  if (isBack(code) || code === 413) {
    clearNext();
    stop('stopped');
    return true;
  }
  return true; // the offer swallows everything else
}

/* ---------- subtitles ----------

   Fetched as text and drawn over the video. The server does one small GET
   and nothing else — no session, no re-encode, nothing on the dashboard of a
   server we do not own. */

function setSub(stream: PlexStream | null): void {
  const token = ++subToken;
  subtitleCues = [];
  subNote = '';
  subtitleElement.textContent = '';
  /* Clear what is drawn AND the note of what was drawn: paintSub skips a cue
     identical to the last one, so leaving the note behind means turning a
     track off and back on inside one cue draws nothing. */
  subtitleElement.setAttribute('data-cue', '');
  subtitleElement.classList.add('hidden');
  currentSub = stream || null;
  wantedLang = stream ? String(stream.languageCode || '') : null;
  if (!stream) {
    paintControls();
    return;
  }

  if (!isTextSub(stream)) {
    /* A picture of words can only reach the screen by being painted into the
       video, which is a transcode — and on a 4K file that is the one thing
       that gets the session killed. So it is refused, by name. */
    currentSub = null;
    subNote =
      String(stream.codec || '').toUpperCase() +
      ' is an image track — it would need the server to burn it in';
    paintControls();
    return;
  }

  subNote = 'loading…';
  paintControls();
  if (!server) return;
  fetchSubtitles(server, stream).then(
    (text) => {
      if (token !== subToken) return;
      subtitleCues = cues.parse(text);
      subNote = subtitleCues.length ? '' : 'the track came back empty';
      debug(`subtitles: ${subLabel(stream)} · ${subtitleCues.length} cues`);
      paintControls();
      paintSub();
    },
    (error: Error) => {
      if (token !== subToken) return;
      currentSub = null;
      subNote = `could not be fetched (${error.message.split(' -> ').pop()})`;
      paintControls();
    },
  );
}

function paintSub(): void {
  if (!subtitleCues.length) return;
  const text = cues.textAt(subtitleCues, (videoElement.currentTime || 0) + 0.05);
  if (text === subtitleElement.getAttribute('data-cue')) return;
  subtitleElement.setAttribute('data-cue', text);
  subtitleElement.textContent = text;
  subtitleElement.classList.toggle('hidden', text === '');
}

/* ---------- the panels ----------

   Everything the stock app makes you leave playback for. One section per
   button rather than one block of tabs, so what is on screen is what the
   button you pressed is about. */

function audioRows(): MenuRow[] {
  return audioTracks(currentPart).map(audioRow);
}

function audioRow(stream: PlexStream): MenuRow {
  const chosen = !!(currentAudio && String(currentAudio.id) === String(stream.id));
  return {
    label: audioMenuLabel(stream),
    /* Say which switches are free. When the panel owns the track list this
       is instant; otherwise it restarts against a stream the server has to
       mux, and knowing that before you press OK is the difference between a
       choice and a surprise. */
    note: chosen || panelIndexOf(stream) >= 0 ? '' : 'restarts — the server has to mux this one',
    on: chosen,
    value: () => {
      chooseAudio(stream);
    },
  };
}

function subRows(): MenuRow[] {
  const out: MenuRow[] = [
    {
      label: 'Off',
      on: !currentSub,
      value: () => {
        setSub(null);
      },
    },
  ];
  subtitleTracks(currentPart).forEach((stream) => {
    out.push(subRow(stream));
  });
  return out;
}

function subRow(stream: PlexStream): MenuRow {
  return {
    label: subLabel(stream),
    note: isTextSub(stream) ? '' : 'image track — cannot be shown without a transcode',
    on: !!(currentSub && String(currentSub.id) === String(stream.id)),
    value: () => {
      setSub(stream);
    },
  };
}

/* Quality is two different things wearing one name: another *version* of the
   film — a separate file, often the 1080p next to the 4K — and a bitrate cap,
   which is the server re-encoding this one. Both belong here because both are
   what the user means by "make this play properly", and both go through the
   guard, so the 4K rule refuses the cap and offers the other version. */
function qualityRows(): MenuRow[] {
  const versions = (item && item.Media) || [];
  const out: MenuRow[] = [];
  if (versions.length > 1) {
    versions.forEach((media, at) => {
      out.push(versionRow(media, at));
    });
  }
  qualities(currentMedia).forEach((cap) => {
    out.push(qualityRow(cap));
  });
  return out;
}

function versionRow(media: PlexMedia, at: number): MenuRow {
  return {
    label: `Version — ${versionLabel(media)}`,
    on: at === mediaIndex && !maxBitrate,
    value: () => {
      if (at === mediaIndex && !maxBitrate) return;
      switchTo({ mediaIndex: at, maxBitrate: null }, versionLabel(media));
    },
  };
}

/* What a row costs, said before OK rather than found out after it. There is
   no "Auto" here on purpose: nothing in this app follows the connection —
   Original is the file as it stands and every cap is a fixed ceiling the
   server re-encodes to. */
function qualityNote(cap: Quality): string {
  if (!cap.bitrate) return forceStream ? 'the server muxes this one' : 'direct play';
  if (isUHD(currentMedia)) {
    return 'a 4K transcode is what gets the stream killed — this will be refused';
  }
  return `transcode · ${bitrateLabel(cap.bitrate)}`;
}

function qualityRow(cap: Quality): MenuRow {
  return {
    label: cap.label,
    note: qualityNote(cap),
    on: (cap.bitrate || null) === maxBitrate,
    value: () => {
      if ((cap.bitrate || null) === maxBitrate) return;
      switchTo({ maxBitrate: cap.bitrate || null }, cap.label);
    },
  };
}

/* The chapter the playhead is in, or null. The rail rings it and the caption
   names it, so both have to agree. */
function chapterAt(list: Chapter[], at: number): Chapter | null {
  /* Backwards: a chapter Plex gave no end offset for would otherwise swallow
     the whole film from its start onwards. */
  for (let i = list.length - 1; i >= 0; i--) {
    const chapter = list[i];
    if (chapter && at >= chapter.start && (!chapter.end || at < chapter.end)) return chapter;
  }
  return null;
}

/* Three of the four buttons open a list. A row's value is what choosing it
   does — view/menu draws and walks, and knows nothing about any of it. The
   builders are handed over rather than called, so the list is made when the
   panel opens and reflects where playback has got to. */
const PANELS: Record<string, MenuTab> = {
  audio: { label: 'Audio', rows: audioRows },
  subs: {
    label: 'Subtitles',
    rows: subRows,
    note: 'Subtitles are fetched as text and drawn here, so they cost the server nothing.',
  },
  quality: {
    label: 'Quality',
    rows: qualityRows,
    note: 'Anything but Original asks the server to re-encode.',
  },
};

/* Open the panel belonging to one of the four right-hand buttons, anchored
   over it and clamped so the last button does not push it off the screen. */
function openPanelFor(id: string): void {
  if (id === 'chapters') {
    openChapters();
    return;
  }
  const tab = PANELS[id];
  if (!tab) return;
  openPanel = id;
  paintControls();
  const button = document.getElementById(`osd-ctl-${id}`);
  const anchor = clamp(64 + osdRight.offsetLeft + (button ? button.offsetLeft : 0), 64, 960);
  menuElement.style.setProperty('--menu-left', `${anchor}px`);
  menu.open({
    host: menuElement,
    tabs: [tab],
    onChoose: (act) => {
      (act as () => void)();
    },
    onClose: () => {
      openPanel = null;
      paintControls();
      showOsd();
    },
  });
  showOsd();
}

/* ---------- the chapter rail ----------

   Cards rather than a list: a still and a timecode say more than "Chapter 7".
   Plex indexes a thumbnail for some chapters and not others, so the picture is
   the only thing a card can lose — never its size. */

function openChapters(): void {
  const list = chapters(item);
  if (!list.length) {
    toast('This file has no chapters');
    return;
  }
  openPanel = 'chapters';
  const here = chapterAt(list, target());
  chapterIndex = here ? Math.max(0, list.indexOf(here)) : 0;
  paintChapters();
  chaptersElement.classList.remove('hidden');
  paintControls();
  showOsd();
}

function closeChapters(): void {
  openPanel = null;
  chaptersElement.classList.add('hidden');
  paintControls();
  showOsd();
}

function paintChapters(): void {
  const list = chapters(item);
  fill(
    chaptersInner,
    ...list.map((chapter, at) => {
      const card = div(`osd-chap${at === chapterIndex ? ' on' : ''}`);
      const still = div('osd-chap-shot');
      const shot = chapter.thumb ? photoUrl(server, chapter.thumb, 240, 135) : '';
      if (shot) still.style.setProperty('--shot', `url("${shot}")`);
      put(still, div('osd-chap-time', timecode(chapter.start)));
      put(card, still, div('osd-chap-title', chapter.title));
      return card;
    }),
  );
  const first = clamp(chapterIndex - 2, 0, Math.max(0, list.length - CARDS_SHOWN));
  chaptersInner.style.setProperty('--wind', `${-first * CARD_W}px`);
}

function chapterKey(code: number): boolean {
  const list = chapters(item);
  if (code === 37) {
    chapterIndex = (chapterIndex + list.length - 1) % list.length;
    paintChapters();
    return true;
  }
  if (code === 39) {
    chapterIndex = (chapterIndex + 1) % list.length;
    paintChapters();
    return true;
  }
  if (code === 13 || code === 415 || code === 19) {
    const chapter = list[chapterIndex];
    if (chapter) seekTo(chapter.start);
    closeChapters();
    return true;
  }
  if (code === 40 || isBack(code) || code === 413) {
    closeChapters();
    return true;
  }
  return true; // the rail swallows everything else
}

/* Another version, a quality cap, and an audio track the panel will not
   select for us all mean the same thing: ask the server for a different
   stream and start again from here. The guard decides whether that is
   allowed, which is what keeps a quality cap on a 4K file refused. */
function switchTo(change: Partial<PlaybackSwitch>, what: string): void {
  if (!onSwitch) return;
  const asked: PlaybackSwitch = {
    at: target(),
    subLang: wantedLang,
    /* Everything not being changed is carried, so a later switch does not
       silently drop back to a direct play and lose the chosen track. */
    audioId: change.audioId === undefined ? currentAudio && currentAudio.id : change.audioId,
    mediaIndex: change.mediaIndex === undefined ? mediaIndex : change.mediaIndex,
    maxBitrate: change.maxBitrate === undefined ? maxBitrate : change.maxBitrate,
    forceStream: change.forceStream === undefined ? forceStream : change.forceStream,
  };
  /* On the hint line rather than in a caption: a caption names what IS
     chosen, and this has not happened yet. play() writes the hint back. */
  osdHint.textContent = `Switching to ${what}…`;
  showOsd();
  onSwitch(asked);
}

/* ---------- progress ---------- */

function report(state: string): void {
  if (!item || !server) return;
  timeline(
    server,
    item,
    state,
    (videoElement.currentTime || 0) * 1000,
    (videoElement.duration || 0) * 1000,
  );
}

/* A black screen tells you nothing, and "the panel refused it" is only one of
   the reasons this fails. Say which. */
const MEDIA_ERRORS: Record<number, string> = {
  1: 'The stream was aborted.',
  2: 'The network dropped the stream — the server stopped answering part way through.',
  3:
    'The panel could not decode this stream (media error 3). The server said it ' +
    'would direct play, so the declared profile in api/plex claims something ' +
    'this panel cannot actually decode.',
  4:
    'The stream would not open (media error 4) — the server refused the request, ' +
    'or the container is one the panel will not accept at all.',
};

function mediaErrorText(error: MediaError | null): string {
  const code = error ? error.code : 0;
  const detail = error && error.message ? `  ·  ${error.message}` : '';
  return (MEDIA_ERRORS[code] ?? `The stream failed (media error ${code}).`) + detail;
}

/* A desktop browser is not this panel, and its codec support is much
   narrower — Firefox has no AC3/E-AC3 and no HEVC at all, Chrome has no
   Matroska. Silence or a decode error on the laptop usually says nothing
   about the TV, and mistaking one for the other costs an evening. */
function laptopNote(media: PlexMedia | null): string {
  if (!settings.dev) return '';
  const codec = (media && media.videoCodec) || '?';
  const container = (media && media.container) || '?';
  const stream = `${String(codec).toUpperCase()} in ${String(container).toUpperCase()}`;
  return (
    `  ·  You are on the dev server, so this is a desktop browser, not the B8. ` +
    `It is playing ${stream}, and browsers do not decode AC3, E-AC3, HEVC or ` +
    'Matroska the way the panel does. Judge playback on the TV.'
  );
}

function fail(text: string): void {
  const say = onError;
  debug(`playback failed: ${text}`);
  stop('stopped');
  if (say) say(text);
}

/* Everything the element reports while it runs. Set per play() rather than
   once, because stop() clears them: a handler left on an element with no src
   goes on reporting a film nobody is watching. */
function listen(): void {
  videoElement.onloadedmetadata = () => {
    /* Only now does currentTime mean anything. Don't resume within half a
       minute of the end — that is a film you finished. */
    const total = videoElement.duration * 1000;
    if (resumeMs > 10000 && total && resumeMs < total - 30000) {
      videoElement.currentTime = resumeMs / 1000;
    }
    paintTicks();
    applyChosenTrack();
    showOsd();
    report('playing');
    /* The subtitle track the user had before a restart, matched by language
       because a different version of the film has different stream ids. */
    if (wantedLang !== null) {
      const again = pickSubtitle(currentPart, wantedLang);
      if (again) setSub(again);
    }
  };
  /* The track list is not always populated by loadedmetadata, so try again
     once the picture is actually running. */
  videoElement.onplaying = () => {
    applyChosenTrack();
    showOsd();
  };
  /* 'waiting' is the panel telling us it has run dry. */
  videoElement.onwaiting = () => {
    stalls++;
  };
  videoElement.ontimeupdate = () => {
    if (osdShowing()) paintOsd();
    paintSub();
    checkMarker();
  };
  videoElement.onended = () => {
    offerNext();
  };
  videoElement.onerror = () => {
    fail(mediaErrorText(videoElement.error) + laptopNote(currentMedia));
  };
}

export function play(options: PlayOptions): void {
  item = options.item;
  server = options.server;
  onExit = options.onExit || null;
  onError = options.onError || null;
  onSwitch = options.onSwitch || null;
  onNext = options.onNext || null;
  onPlayNext = options.onPlayNext || null;
  resumeMs = options.item.viewOffset || 0;
  clearNext();

  stalls = 0;
  lowest = 999;
  startedAt = Date.now();
  /* Without this a missing part is a TypeError inside streamUrl. */
  const url = options.url || (options.part && streamUrl(options.server, options.part));
  if (!url) {
    fail('This copy has no playable part.');
    return;
  }
  osdTitle.textContent = options.item.title || '';
  pending = null;
  if (seekTimer) clearTimeout(seekTimer);
  currentPart = options.part || null;
  currentAudio = options.audio || null;
  mediaIndex = options.mediaIndex || 0;
  maxBitrate = options.maxBitrate || null;
  transcoding = !!options.transcode;
  forceStream = !!options.forceStream;
  currentMedia = (item.Media && item.Media[mediaIndex]) || null;
  marker = null;
  skipDismissed = null;
  skipElement.classList.add('hidden');
  menu.close();
  setFocus('none');
  openPanel = null;
  chaptersElement.classList.add('hidden');
  subtitleCues = [];
  currentSub = null;
  subNote = '';
  subtitleElement.classList.add('hidden');
  subtitleElement.textContent = '';
  subtitleElement.setAttribute('data-cue', '');
  wantedLang = options.subLang === undefined ? null : options.subLang;
  paintControls();
  hint();
  videoElement.classList.remove('hidden');
  listen();

  /* preload only matters between the element existing and a src being set,
     and the src is only ever set here, at the moment we play. Leaving it at
     "none" made the browser conservative about reading ahead for no benefit. */
  videoElement.preload = 'auto';
  videoElement.src = url;
  videoElement.load();
  showOsd();
  debug(
    (transcoding
      ? `playing (server converting${maxBitrate ? ` at ${bitrateLabel(maxBitrate)}` : ''}) `
      : 'playing ') + String(url).split('?')[0],
  );

  /* Ask directly rather than waiting on loadedmetadata, which need not fire
     on its own, and report a rejected play() rather than sitting on a black
     screen — it is otherwise completely silent. */
  const started = videoElement.play();
  if (started && started.then) {
    started.then(null, (error: Error) => {
      fail(
        `The player refused to start: ${(error && `${error.name} ${error.message}`) || 'unknown'}` +
          '. If this is the TV, it is usually the media pipeline rejecting the ' +
          'container rather than the codec.',
      );
    });
  }

  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    report(videoElement.paused ? 'paused' : 'playing');
    debug(health());
  }, 10000);
}

/* Stuttering is either the network not keeping up or the panel not decoding
   fast enough, and those want opposite fixes. The video element knows which:
   a buffer that keeps draining is bandwidth, dropped frames are decode.
   Reported every ten seconds alongside the timeline, so the debug line
   answers it without a profiler. */
function health(): string {
  const end = bufferedEnd();
  let ahead = 0;
  if (end === null) ahead = -1;
  else if (end) ahead = Math.round(end - videoElement.currentTime);

  let dropped = videoElement.webkitDroppedFrameCount;
  let decoded = videoElement.webkitDecodedFrameCount;
  if (dropped === undefined && videoElement.getVideoPlaybackQuality) {
    const measured = videoElement.getVideoPlaybackQuality();
    dropped = measured.droppedVideoFrames;
    decoded = measured.totalVideoFrames;
  }
  const frames = decoded === undefined ? 'frames n/a' : `dropped ${dropped}/${decoded}`;

  if (ahead >= 0 && ahead < lowest) lowest = ahead;

  return (
    `${timecode(videoElement.currentTime)}  buffered +${ahead}s (low ${lowest}s)` +
    `  stalls ${stalls}  ${frames}` +
    (videoElement.paused ? '  PAUSED' : '')
  );
}

/* Said once when playback ends, because that is when the whole picture
   exists: enough stalls on a 4K remux means the link cannot carry it, and
   the answer is the 1080p copy on the film page rather than anything here. */
function summary(): string {
  const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  return (
    `played ${minutes} min · ${stalls} stall${stalls === 1 ? '' : 's'}` +
    ' · buffer low ' +
    (lowest === 999 ? '?' : `${lowest}s`)
  );
}

/** quiet: tear down without telling the caller we are done — used when
    playback is about to be started again with a different track, where firing
    onExit would bounce back to the film page mid-restart. */
export function stop(state?: string, quiet?: boolean): void {
  if (!item) return;
  menu.close();
  setFocus('none');
  openPanel = null;
  chaptersElement.classList.add('hidden');
  debug(summary());
  report(state || 'stopped');
  if (ticker) clearInterval(ticker);
  ticker = null;
  if (osdTimer) clearTimeout(osdTimer);
  if (seekTimer) clearTimeout(seekTimer);
  clearNext();
  pending = null;
  subToken++;
  videoElement.pause();
  videoElement.onloadedmetadata = null;
  videoElement.onplaying = null;
  videoElement.ontimeupdate = null;
  videoElement.onended = null;
  videoElement.onerror = null;
  videoElement.onwaiting = null;
  videoElement.removeAttribute('src');
  videoElement.load();
  videoElement.classList.add('hidden');
  osd.classList.add('hidden');
  skipElement.classList.add('hidden');
  subtitleElement.classList.add('hidden');
  marker = null;
  subtitleCues = [];
  const done = quiet ? null : onExit;
  item = null;
  server = null;
  onExit = null;
  onError = null;
  onSwitch = null;
  onNext = null;
  onPlayNext = null;
  currentPart = null;
  currentAudio = null;
  currentMedia = null;
  currentSub = null;
  if (done) done();
}

export function playing(): boolean {
  return !!item;
}

function indexOfControl(id: string): number {
  const at = controls().findIndex((control) => control.id === id);
  return at < 0 ? 0 : at;
}

/* Move the focus onto a button and open it — what a colour key does, so the
   shortcut and the row never disagree about what is on screen. */
function focusPanel(id: string): void {
  setFocus('row');
  controlIndex = indexOfControl(id);
  openPanelFor(id);
}

/* The trackbar has the four arrows once it has the focus. Scrubbing is the
   same aim-then-seek as a nudge, so holding ◀ still costs one range request;
   OK is what says "stop aiming and go there". */
function barKey(code: number): boolean {
  if (code === 37) {
    seekBy(-NUDGE);
    return true;
  }
  if (code === 39) {
    seekBy(NUDGE);
    return true;
  }
  if (code === 13 || code === 415 || code === 19) {
    if (marker) takeSkip();
    else applySeek();
    return true;
  }
  if (code === 40) {
    moveFocus('row');
    return true;
  }
  if (isBack(code) || code === 413) {
    if (marker) {
      dismissSkip();
      return true;
    }
    moveFocus('none');
    return true;
  }
  return false; // anything else is still playback's
}

/* The control row has the four arrows once it has the focus; everything else
   on the remote goes on meaning what it means during playback. OK belongs to
   the button here — the skip offer is taken with OK from playback, and BACK
   still dismisses it from the row. */
function controlKey(code: number): boolean {
  const count = controls().length;
  if (code === 37) {
    controlIndex = (controlIndex + count - 1) % count;
    paintControls();
    showOsd();
    return true;
  }
  if (code === 39) {
    controlIndex = (controlIndex + 1) % count;
    paintControls();
    showOsd();
    return true;
  }
  if (code === 13) {
    const control = controls()[controlIndex];
    if (!control) return true;
    if (control.id) openPanelFor(control.id);
    else if (control.run) control.run();
    return true;
  }
  if (code === 38) {
    moveFocus('bar');
    return true;
  }
  if (code === 40) {
    moveFocus('none');
    return true;
  }
  if (isBack(code) || code === 413) {
    if (marker) {
      dismissSkip();
      return true;
    }
    moveFocus('none');
    return true;
  }
  return false; // anything else is still playback's
}

export function key(code: number): boolean {
  /* The offer owns the remote while it is up: the film has ended, so seeking
     and pausing have nothing left to act on. */
  if (next) return nextKey(code);
  if (openPanel === 'chapters') return chapterKey(code);
  if (menu.isOpen()) return menu.key(code);

  /* Digits jump by tenths — the cheapest way past a first act there is. */
  if (code >= 48 && code <= 57) {
    jumpToTenth(code - 48);
    return true;
  }

  if (focus === 'bar' && barKey(code)) return true;
  if (focus === 'row' && controlKey(code)) return true;

  switch (code) {
    case 13:
    case 415:
    case 19:
    case 179: // OK / play / pause
      /* While the skip prompt is up, OK takes it. That is the one moment the
         button means something other than pause, and it is the moment you
         are reaching for it. */
      if (marker) takeSkip();
      else togglePlay();
      return true;
    case 37: // left
      seekBy(-NUDGE);
      return true;
    case 39: // right
      seekBy(NUDGE);
      return true;
    case 412: // rewind
      seekBy(-JUMP);
      return true;
    case 417: // fast forward
      seekBy(JUMP);
      return true;
    case 38: // up — the trackbar
      moveFocus('bar');
      return true;
    case 40: // down — the control row
      moveFocus('row');
      return true;
    case 33: // channel up — next chapter
      chapterStep(1);
      return true;
    case 34: // channel down — previous chapter
      chapterStep(-1);
      return true;
    case 403:
      focusPanel('audio');
      return true; // red
    case 404:
      focusPanel('subs');
      return true; // green
    case 405:
      focusPanel('quality');
      return true; // yellow
    case 406:
      focusPanel('chapters');
      return true; // blue
    case 461:
    case 27:
    case 8:
    case 413: // back / stop
      if (marker) dismissSkip();
      else stop('stopped');
      return true;
  }
  return false;
}
