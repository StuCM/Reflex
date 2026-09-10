/* The page between the rail and playback: what a film is, and the buttons
   that decide what Play actually plays.

   A copy is server × version — the same film sits on both servers, and one
   library item can hold several Media[]. Quality, audio and subtitles sit on
   top of whichever is chosen, and every combination goes back through
   data/guard before it sticks. */
import { allVersions as plexAllVersions } from '../api/plex/library';
import { artUrl as plexArtUrl, photoUrl as plexPhotoUrl } from '../api/plex/images';
import { probeFeatures } from '../core/panel';
import { KEY, clamp, debug, isBack, message, show as showView, toast } from '../core/ui';
import * as art from '../data/art';
import * as guard from '../data/guard';
import * as merge from '../data/merge';
import * as meta from '../data/meta';
import * as servers from '../data/servers';
import { audioLabel, audioMenuLabel, audioTracks } from '../rules/audio';
import { episodeLabel } from '../rules/labels';
import { bitrateLabel, isUHD, qualities, versionLabel } from '../rules/quality';
import { isTextSub, pickSubtitle, subLabel, subtitleTracks } from '../rules/subtitles';
import * as glyphs from '../view/glyphs';
import * as menu from '../view/menu';
import { div, span, fill, put, must, svg } from '../view/dom';
import type { MenuRow, MenuTab } from '../view/menu';
import * as browse from './browse';

const viewElement = must('detail');
const artElement = must('dt-art');
const kickerElement = must('dt-kicker');
const titleElement = must('dt-title');
const chipsElement = must('dt-chips');
const ratingsElement = must('dt-ratings');
const taglineElement = must('dt-tagline');
const summaryElement = must('dt-summary');
const namesElement = must('dt-names');
const crewElement = must('dt-crew');
const actionsElement = must('dt-actions');
const menuElement = must('dt-menu');
const extrasElement = must('dt-extras');
const extrasLabelElement = must('dt-extras-label');
const castElement = must('dt-cast');

/* Inlined, like the search icon in index.html: the app runs from file:// on
   the TV, so there is no icon font to fetch. */
const STAR_GLYPH =
  '<svg class="dt-glyph" width="22" height="22" viewBox="0 0 256 256" fill="none" ' +
  'stroke="currentColor" stroke-width="18" stroke-linejoin="round">' +
  '<polygon points="128,24 158,94 234,101 177,152 194,228 128,188 62,228 79,152 22,101 98,94"/>' +
  '</svg>';
const PLAY_GLYPH =
  '<svg class="dt-extra-play" width="52" height="52" viewBox="0 0 256 256" fill="none" ' +
  'stroke="currentColor" stroke-width="16" stroke-linejoin="round">' +
  '<circle cx="128" cy="128" r="100"/><polygon points="106,84 178,128 106,172"/></svg>';

interface Copy {
  item: PlexItem;
  server: PlexServer | null;
  versions: Source[] | null;
  metadata?: PlexItem;
}

interface Source {
  copy: Copy;
  media: PlexMedia;
  mediaIndex: number;
  server: PlexServer | null;
  verdict?: Verdict | null;
  provisional?: boolean;
  title?: string;
  kind?: string;
  isExtra?: boolean;
}

/** What a button on the action row would switch to. */
interface Choice {
  sel: number;
  audio?: PlexStream | null;
  maxBitrate?: number | null;
  forceStream?: boolean;
}

interface DetailOptions {
  onPlay?: (
    item: PlexItem,
    verdict: Verdict,
    isExtra?: boolean,
    language?: string | null,
    at?: number,
  ) => void;
  onExit?: () => void;
  onShow?: (item: PlexItem) => void;
}

/** One button on the action row. */
interface Action {
  act: string;
  label?: string;
  primary?: boolean;
  quiet?: boolean;
  glyph?: string;
  caption?: string;
  run: () => void;
}

/** The merged entry. */
let item: PlexItem | null = null;
/** One per server that has it. */
let copies: Copy[] = [];
/** Flattened: one per server × version. */
let sources: Source[] = [];
/** Trailers and the rest, playable in their own right. */
let extras: Source[] = [];
/** Which source Play would use. */
let sel = 0;
/** 0 = the action row, 1 = the extras. */
let strip = 0;
/** Within that row. */
let index = 0;
/** The first copy's metadata: what the header says. */
let headMetadata: PlexItem | null = null;
/** Is this in Continue watching, and so clearable. */
let onDeck = false;
let options: DetailOptions = {};
let generation = 0;

/* The combination Play would start: the guard's verdict for it, and the three
   things the buttons can change about it. */
let verdict: Verdict | null = null;
let chosenAudio: PlexStream | null = null;
let chosenSub: PlexStream | null = null;
let maxBitrate: number | null = null;
let forceStream = false;

export function open(entry: PlexItem | null, chosen?: DetailOptions) {
  if (!entry) return;
  item = entry;
  options = chosen ?? {};
  generation++;

  /* Merge already put the preferred server's copy first, so source 0 is the
     one the preference asks for. */
  copies = merge.sources(entry).map((copy) => {
    return { item: copy, server: servers.of(copy), versions: null };
  });
  extras = [];
  onDeck = browse.isOnDeck(entry);
  strip = 0;
  index = 0;
  verdict = null;
  chosenAudio = null;
  chosenSub = null;
  maxBitrate = null;
  forceStream = false;
  rebuild();

  showView('detail');
  paintSkeleton();
  render();
  loadDetails();
}

function close() {
  /* Metadata and verdicts for the page we are leaving are still in flight;
     moving the generation on is what stops them drawing into an empty page. */
  generation++;
  menu.close();
  item = null;
  copies = [];
  sources = [];
  extras = [];
  verdict = null;
  if (options.onExit) options.onExit();
}

/* ---------- the copies ---------- */

/* Until a copy's metadata lands we know it has *a* version, from the list
   response, but not how many. So each copy contributes one provisional line
   that becomes one line per version once we know. */
function rebuild() {
  const chosen = sources[sel] || null;
  sources = [];
  copies.forEach((copy) => {
    if (copy.versions) {
      copy.versions.forEach((version) => {
        sources.push(version);
      });
      return;
    }
    sources.push({
      copy: copy,
      server: copy.server,
      mediaIndex: 0,
      media: (copy.item.Media && copy.item.Media[0]) || {},
      verdict: null,
      provisional: true,
    });
  });
  /* Keep the user's choice pinned across a rebuild. */
  sel = 0;
  if (chosen) {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i] as Source;
      if (source.copy === chosen.copy && source.mediaIndex === chosen.mediaIndex) {
        sel = i;
        break;
      }
    }
  }
}

/* The copies we started with came from the row, which only ever knew about
   one section. These libraries keep the 4K version of a film in a section of
   its own, so the other versions are separate library items and only a guid
   lookup across the whole server finds them. */
function addOtherVersions(metadata: PlexItem) {
  const mine = generation;
  const known: Record<string, boolean> = {};
  copies.forEach((copy) => {
    known[copy.item._server + ':' + copy.item.ratingKey] = true;
  });

  servers.all().forEach((server) => {
    plexAllVersions(server, metadata).then((found) => {
      if (mine !== generation || !found.length) return;
      let added = 0;
      found.forEach((other) => {
        const sourceKey = other._server + ':' + other.ratingKey;
        if (known[sourceKey]) return;
        known[sourceKey] = true;
        added++;
        copies.push({ item: other, server: servers.of(other), versions: null });
        meta.load(other).then((omd) => {
          if (mine !== generation || !omd) return;
          const landed = copies.find((copy) => copy.item === other);
          if (landed) expand(landed, omd);
        });
      });
      if (added) {
        debug(
          `found ${added} more version${added === 1 ? '' : 's'}` +
            ' of ' +
            metadata.title +
            ' on ' +
            server.name,
        );
        rebuild();
        render();
      }
    });
  });
}

/* Trailers and behind-the-scenes clips come nested in the film's metadata,
   carrying their own media. They are ordinary parts on the same server, so
   they go through the same guard as the film — a clip that would transcode
   is still a transcode on someone else's hardware. */
function addExtras(metadata: PlexItem) {
  if (extras.length || !metadata.Extras || !metadata.Extras.Metadata) return;
  extras = metadata.Extras.Metadata.slice(0, 6).map((clip) => {
    return {
      copy: { item: clip, server: servers.of(clip), versions: null },
      server: servers.of(clip),
      mediaIndex: 0,
      media: (clip.Media && clip.Media[0]) || {},
      title: clip.title || 'Extra',
      kind: clip.subtype || clip.extraType || '',
      verdict: null,
      isExtra: true,
    };
  });
  render();
  extras.forEach(check);
}

function expand(copy: Copy, metadata: PlexItem) {
  const list = metadata.Media && metadata.Media.length ? metadata.Media : [null];
  copy.versions = list.map((media, at) => {
    return {
      copy: copy,
      server: copy.server,
      mediaIndex: at,
      media: media || {},
      verdict: null,
      provisional: false,
    };
  });
  rebuild();
  render();
  copy.versions.forEach(check);
}

/* Every version of every copy is checked as the page opens. hasMDE=1 opens no
   session, so asking about one you end up not playing costs a query and
   nothing else. */
function check(source: Source) {
  const mine = generation;
  guard.check(source.copy.item, source.mediaIndex).then((checked) => {
    if (mine !== generation) return;
    source.verdict = checked;
    render();
  });
}

/* Nobody has chosen anything yet, so the selected copy's own verdict is what
   Play would use — including a refusal, which Play then explains in full. */
function adoptDefault() {
  const src = sources[sel];
  if (verdict || !src || !src.verdict) return;
  verdict = src.verdict;
  chosenAudio = src.verdict.audio || null;
}

/* ---------- choosing ----------

   Every button on the row is the same move: ask the guard about the new
   combination, and keep it only if the answer is yes. Losing your place to
   deliver a message is a worse answer than not switching, so a refusal is a
   toast and the page does not move. */
function choose(next: Choice) {
  const mine = generation;
  const src = sources[next.sel];
  if (!src) return;
  guard
    .check(src.copy.item, src.mediaIndex, (next.audio && next.audio.id) || undefined, {
      maxBitrate: next.maxBitrate,
      forceStream: next.forceStream,
    })
    .then((checked) => {
      if (mine !== generation) return;
      if (!checked.ok) {
        toast(`Kept as it was — ${guard.label(checked)}`);
        debug(`choice refused: ${guard.refusal(item as PlexItem, checked)[1]}`);
        return;
      }
      /* By stream id on the copy we came from, so a subtitle language chosen
         here survives a move to a different file with different ids. */
      chosenSub = chosenSub ? pickSubtitle(checked.part, chosenSub.languageCode) : null;
      sel = next.sel;
      chosenAudio = next.audio || checked.audio || null;
      maxBitrate = next.maxBitrate || null;
      forceStream = !!next.forceStream;
      verdict = checked;
      render();
    });
}

/* ---------- the action row ---------- */

/* The track the guard picks for a copy on its own — anything else is the
   user's, and costs direct play unless the panel can select it. */
function defaultAudio() {
  const source = sources[sel];
  return (source && source.verdict && source.verdict.audio) || null;
}

/* Whether this pipeline exposes audioTracks, which is the whole difference
   between switching a track for nothing and asking the server to mux one. */
function panelOwnsAudio() {
  return probeFeatures().audioTracks !== 'no';
}

function part() {
  return verdict && verdict.part;
}

function sourceRows() {
  return sources.map((source, at) => {
    let name = (source.server && source.server.name) || 'server';
    if (servers.count() > 1 && servers.isPreferred(source.server)) name += ' · preferred';
    return {
      label: versionLabel(source.media) + ' · ' + name,
      note: guard.label(source.verdict),
      on: at === sel,
      value: at,
    };
  });
}

function qualityRows() {
  const source = sources[sel];
  return qualities(source && source.media).map((cap) => {
    return {
      label: cap.label,
      note:
        cap.bitrate && isUHD(source && source.media)
          ? 'a 4K transcode is what gets the stream killed — this will be refused'
          : '',
      on: (cap.bitrate || null) === maxBitrate,
      value: cap.bitrate || null,
    };
  });
}

/* Would choosing this track mean giving up direct play? Only when the panel
   cannot select tracks out of the file itself and this is not the track the
   guard picks anyway — the note and the guard call are both this, so what the
   row says before OK is what OK does. */
function needsMux(stream: PlexStream): boolean {
  if (panelOwnsAudio()) return false;
  const base = defaultAudio();
  return !(base && String(base.id) === String(stream.id));
}

function audioRows() {
  return audioTracks(part()).map((stream) => {
    const chosen = !!(chosenAudio && String(chosenAudio.id) === String(stream.id));
    return {
      label: audioMenuLabel(stream),
      note: chosen
        ? ''
        : needsMux(stream)
          ? 'costs direct play — the server would mux it'
          : 'keeps direct play',
      on: chosen,
      value: stream,
    };
  });
}

function subRows() {
  const out: MenuRow[] = [{ label: 'Off', on: !chosenSub, value: null }];
  subtitleTracks(part()).forEach((stream) => {
    out.push({
      label: subLabel(stream),
      note: isTextSub(stream) ? '' : 'image track — it would have to be burnt in',
      on: !!(chosenSub && String(chosenSub.id) === String(stream.id)),
      value: stream,
    });
  });
  return out;
}

/* "1:12", from seconds — where a part-watched film would pick up. */
function atLabel(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  return Math.floor(mins / 60) + ':' + (mins % 60 < 10 ? '0' : '') + (mins % 60);
}

/* Where Play would pick up, in seconds, and 0 when there is nothing worth
   resuming — the first ten seconds of a film are not a position. */
function resumeAt() {
  const at = (item && item.viewOffset) || 0;
  return at > 10000 ? Math.floor(at / 1000) : 0;
}

/* Play says what it will do and what it will cost, because both are decided
   by the buttons beside it. */
function playCaption() {
  const at = resumeAt();
  return (
    (at ? `resume at ${atLabel(at)}` : 'from start') +
    '  ·  ' +
    (verdict ? guard.label(verdict) : 'checking…')
  );
}

function sourceCaption() {
  const src = sources[sel];
  return (src && src.server && src.server.name) || 'checking…';
}

function qualityCaption() {
  if (maxBitrate) return bitrateLabel(maxBitrate) + ' converted';
  const source = sources[sel];
  return versionLabel(source && source.media);
}

/* Getting this out of Continue watching, which the row does for several at a
   time and this does for one. On success there is nothing left to say about
   it here, so the page closes onto the rail it has already been dropped
   from. */
function removeFromDeck() {
  browse.clearOne(item as PlexItem, () => {
    onDeck = false;
    close();
  });
}

/* Eight at most: Play, starting again where there is something to resume,
   then the extras, then the three things about the copy that can be chosen.
   Trailer is only here when there is one, and Remove only when the thing is
   actually on the deck. */
function actions(): Action[] {
  const out: Action[] = [
    {
      act: 'play',
      label: 'Play',
      primary: true,
      caption: playCaption(),
      run: () => {
        start(verdict, false);
      },
    },
  ];
  /* Part way through, resuming and starting again are two different things to
     want. Both are the verdict the buttons already settled — the second only
     says where to begin. */
  if (resumeAt()) {
    out.push({
      act: 'start',
      label: 'From start',
      primary: true,
      quiet: true,
      caption: verdict ? guard.label(verdict) : 'checking…',
      run: () => {
        start(verdict, false, 0);
      },
    });
  }
  const trailer = extras[0];
  if (trailer) {
    out.push({
      act: 'trailer',
      glyph: glyphs.trailer,
      caption: trailer.title,
      run: () => {
        start(trailer.verdict, true);
      },
    });
  }
  out.push({
    act: 'quality',
    glyph: glyphs.quality,
    caption: qualityCaption(),
    run: openQuality,
  });
  out.push({ act: 'source', glyph: glyphs.source, caption: sourceCaption(), run: openSource });
  out.push({
    act: 'audio',
    glyph: glyphs.audio,
    run: openAudio,
    caption: chosenAudio ? audioLabel(chosenAudio) : 'checking…',
  });
  out.push({
    act: 'subtitles',
    glyph: glyphs.subs,
    caption: subLabel(chosenSub),
    run: openSubs,
  });
  if (onDeck) {
    out.push({
      act: 'remove',
      glyph: glyphs.remove,
      run: removeFromDeck,
      caption: 'Remove from Continue watching',
    });
  }
  return out;
}

function renderActions() {
  fill(
    actionsElement,
    ...actions().map((action, at) => {
      const button = div(
        `dt-act${action.primary ? ' primary' : ''}${action.quiet ? ' quiet' : ''}` +
          (strip === 0 && at === index ? ' on' : ''),
      );
      button.dataset.act = action.act;
      const face = div('dt-act-btn');
      put(face, action.glyph ? svg(action.glyph) : action.label || '');
      put(button, face, div('dt-act-cap', action.caption || ''));
      return button;
    }),
  );
}

/* The chooser sits under the button that opened it, clamped so a button near
   the end of the row does not push it off the screen. */
function openChooser<T>(tab: MenuTab, onChoose: (value: T) => void) {
  const button = actionsElement.children[index] as HTMLElement | undefined;
  menuElement.style.setProperty(
    '--menu-left',
    clamp(96 + (button ? button.offsetLeft : 0), 96, 964) + 'px',
  );
  menu.open({
    host: menuElement,
    tabs: [tab],
    onChoose: (value) => onChoose(value as T),
    onClose: render,
  });
}

function openSource() {
  openChooser<number>(
    {
      label: 'Play from',
      rows: sourceRows,
      note: 'Every copy on every server, each already checked.',
    },
    (at) => {
      if (at === sel) return;
      choose({ sel: at, audio: null, maxBitrate: null, forceStream: false });
    },
  );
}

function openQuality() {
  openChooser<number | null>(
    {
      label: 'Quality',
      rows: qualityRows,
      note: 'Anything but Original asks the server to re-encode.',
    },
    (kbps) => {
      if ((kbps || null) === maxBitrate) return;
      choose({ sel: sel, audio: chosenAudio, maxBitrate: kbps, forceStream: forceStream });
    },
  );
}

function openAudio() {
  openChooser<PlexStream>({ label: 'Audio', rows: audioRows }, (stream) => {
    if (chosenAudio && String(chosenAudio.id) === String(stream.id)) return;
    /* A direct play hands the panel the whole file and the panel picks its own
       track, so a choice it cannot make itself means asking the server to mux
       — which on a 4K file the guard refuses, and rightly. */
    choose({ sel, audio: stream, maxBitrate, forceStream: needsMux(stream) });
  });
}

/* Subtitles never reach the guard: they are fetched as text and drawn over the
   video by js/subs.js, so they cost the server one GET and change nothing
   about the stream. An image track is the exception — the only way to show one
   is to have it burnt in, which is a transcode. */
function openSubs() {
  openChooser<PlexStream | null>(
    {
      label: 'Subtitles',
      rows: subRows,
      note: 'Drawn over the video as text, so they cost the server nothing.',
    },
    (stream) => {
      if (stream && !isTextSub(stream)) {
        toast('Kept as it was — an image track would have to be burnt in');
        return;
      }
      chosenSub = stream;
      render();
    },
  );
}

/* ---------- the extras strip ---------- */

/* A trailer is a card, not a line: a still with a play glyph and its length,
   the verdict under it because a clip is guarded like anything else. */
function extraCard(source: Source, focused: boolean): HTMLElement {
  const chosenVerdict = source.verdict;
  const state = chosenVerdict
    ? chosenVerdict.ok
      ? 'good'
      : chosenVerdict.state === 'noaudio'
        ? 'bad'
        : 'warn'
    : '';
  const clip = source.copy.item;
  const mins = clip.duration ? `${Math.max(1, Math.round(clip.duration / 60000))} min` : '';
  const shot = plexPhotoUrl(source.server, clip.thumb, 320, 180);

  const card = div(`dt-extra${focused ? ' on' : ''}`);
  const still = div('dt-extra-shot');
  if (shot) still.style.setProperty('--shot', `url("${shot}")`);
  put(still, svg(PLAY_GLYPH), mins ? div('dt-extra-len', mins) : null);
  put(
    card,
    still,
    div('dt-extra-title', source.title || ''),
    div(`dt-extra-verdict badge ${state}`, guard.label(chosenVerdict)),
  );
  return card;
}

function render() {
  adoptDefault();
  renderActions();
  fill(extrasElement, ...extras.map((extra, at) => extraCard(extra, strip === 1 && at === index)));
  extrasLabelElement.classList.toggle('hidden', extras.length === 0);
  /* Stepping into the extras lifts them clear of the bottom edge; the
     stylesheet owns what else moves out of their way. */
  viewElement.classList.toggle('down', strip === 1);
  /* The quality chip names the copy that would play, so it follows the
     Source button. */
  fill(chipsElement, ...chipNodes());
}

/* ---------- the rest of the page ---------- */

/* Everything the rail already knows, so the page is never blank while the
   metadata requests are in flight. */
function paintSkeleton() {
  if (!item) return;
  headMetadata = null;
  titleElement.textContent = item.title || '';
  taglineElement.textContent = '';
  summaryElement.textContent = description(null);
  namesElement.textContent = namesLine(null);
  fill(crewElement);
  fill(castElement);
  renderHead();

  const backdrop = plexArtUrl(item, 960, 540);
  artElement.style.setProperty('--art', backdrop ? `url("${backdrop}")` : 'none');
}

/* The kicker, the chips and the ratings, from whatever we have so far. Called
   again as metadata lands and as the selection moves. */
function renderHead() {
  kickerElement.textContent = kickerLine();
  fill(chipsElement, ...chipNodes());
  fill(ratingsElement, ...ratingNodes());
}

/* The header says what the rail's header said, which means TMDB's overview
   when the rail already fetched one and Plex's summary otherwise — the two
   screens must not describe the same film differently. */
function description(metadata: PlexItem | null): string {
  const got = art.factsFor(item);
  if (got && got.overview) return got.overview;
  return (metadata && metadata.summary) || (item && item.summary) || '';
}

/* Key actors, names only. Same source as the header above, so the strip of
   photographs further down never contradicts it. */
function namesLine(metadata: PlexItem | null): string {
  const got = art.factsFor(item);
  const names =
    got && got.cast.length
      ? got.cast
      : metadata && metadata.Role
        ? metadata.Role.slice(0, 4).map((role) => {
            return role.tag;
          })
        : [];
  return names.join('  ·  ');
}

/* "MOVIE · SCIENCE FICTION · DENIS VILLENEUVE" — what it is, in amber caps.
   An episode is named by its show; anything we do not have drops out with its
   separator rather than leaving a gap. */
function kickerLine() {
  if (!item) return '';
  const bits = [item.type === 'episode' ? item.grandparentTitle : item.type];
  const genre = headMetadata && headMetadata.Genre && headMetadata.Genre[0];
  const director = headMetadata && headMetadata.Director && headMetadata.Director[0];
  if (genre) bits.push(genre.tag);
  if (director) bits.push(director.tag);
  return bits.filter(Boolean).join(' · ');
}

/* episodeLabel leads with the show, which the kicker already says. */
function episodeChip() {
  const label = episodeLabel(item);
  const at = label.lastIndexOf('·');
  return at < 0 ? '' : label.slice(at + 1).trim();
}

/* TMDB's run time when we have it — it is the film's, where the item's
   duration is this copy's file. */
function runtimeChip() {
  const got = art.factsFor(item);
  const mins =
    (got && got.runtime) || (item && item.duration ? Math.round(item.duration / 60000) : 0);
  if (!mins) return '';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/* The quality of the copy that would play if Play were pressed now. HDR only
   when the server says so — a claim we cannot check is worse than silence. */
function qualityChip() {
  const source = sources[sel];
  const media = (source && source.media) || null;
  const resolution = String((media && media.videoResolution) || '').toLowerCase();
  if (!media || !resolution) return '';
  const name =
    resolution === '4k'
      ? '4K'
      : /^\d+$/.test(resolution)
        ? `${resolution}p`
        : resolution.toUpperCase();
  return /hdr|dovi|dolby/i.test(media.videoDynamicRange || '') ? `${name} HDR` : name;
}

/* Certificate, where it sits in a show, year, run time and quality. A chip we
   have nothing for is absent, never an empty outline. */
function chipNodes(): HTMLElement[] {
  const out: HTMLElement[] = [];
  function add(text: string | number | undefined, outlined: boolean) {
    if (!text) return;
    out.push(span(`dt-chip${outlined ? ' out' : ''}`, String(text)));
  }
  if (!item) return out;
  add(item.contentRating, true);
  add(episodeChip(), true);
  add(item.year, false);
  add(runtimeChip(), false);
  add(qualityChip(), true);
  return out;
}

/* Up to three scores, each labelled with the source it actually came from.
   There is no IMDb here: Plex gives critics and audience, TMDB gives its
   own, and a number under the wrong badge is a lie the user cannot check. */
function ratingNodes(): HTMLElement[] {
  const got = art.factsFor(item);
  const out: HTMLElement[] = [];
  function add(text: string) {
    const score = span('dt-rating');
    put(score, svg(STAR_GLYPH), span('dt-rating-text', text));
    out.push(score);
  }
  if (headMetadata && headMetadata.rating) add(`${Math.round(headMetadata.rating * 10)}% Critics`);
  if (headMetadata && headMetadata.audienceRating) {
    add(`${Math.round(headMetadata.audienceRating * 10)}% Audience`);
  }
  if (got && got.rating) add(`${got.rating} TMDB`);
  return out;
}

/* Metadata for every copy: each one tells us its versions, and the first to
   arrive also fills in the cast and crew, which are the same whichever server
   you end up playing from. */
function loadDetails() {
  const mine = generation;
  let filled = false;
  copies.forEach((copy) => {
    meta.load(copy.item).then((metadata) => {
      if (mine !== generation || !metadata) return;
      copy.metadata = metadata;
      expand(copy, metadata);
      if (filled) return;
      filled = true;
      headMetadata = metadata;
      renderHead();
      taglineElement.textContent = metadata.tagline || '';
      summaryElement.textContent = description(metadata);
      namesElement.textContent = namesLine(metadata);
      fill(crewElement, ...crewNodes(metadata));
      fill(castElement, ...castNodes(metadata));
      addExtras(metadata);
      addOtherVersions(metadata);
    });
  });
}

function crewNodes(metadata: PlexItem): Node[] {
  const out: Node[] = [];
  function names(list: PlexTag[]): string {
    return list
      .map((credit) => credit.tag || '')
      .filter(Boolean)
      .join(', ');
  }
  function add(label: string, text: string) {
    if (!text) return;
    if (out.length) out.push(span('dt-gap'));
    const name = document.createElement('b');
    name.textContent = label;
    out.push(name, document.createTextNode(` ${text}`));
  }
  add('Director', names(metadata.Director || []));
  add('Writer', names(metadata.Writer || []));
  add('Studio', metadata.studio || '');
  return out;
}

/* The first letters of the first two words: "Ada Lovelace" is AL. */
function initials(name: string): string {
  const words = String(name || '')
    .trim()
    .split(/\s+/);
  let out = '';
  for (let i = 0; i < words.length && out.length < 2; i++) {
    const word = words[i];
    if (word) out += word.charAt(0).toUpperCase();
  }
  return out;
}

function castNodes(metadata: PlexItem): HTMLElement[] {
  return (metadata.Role || []).slice(0, 8).map((role) => {
    const name = role.tag || '';
    const url = plexPhotoUrl(servers.of(metadata), role.thumb, 120, 120);
    const actor = div('dt-actor');
    let face;
    if (url) {
      face = document.createElement('img');
      face.src = url;
      face.alt = '';
    } else {
      face = div('dt-actor-blank', initials(name));
    }
    put(actor, face, div('dt-actor-name', name), div('dt-actor-role', role.role || ''));
    return actor;
  });
}

/* ---------- keys ---------- */

/* Hand a verdict to the caller, or say why there is nothing to hand over. A
   refusal is the long form on the message screen: this is the one moment the
   user has asked for the whole story. `at` is seconds to begin at, left out
   to pick up wherever the item says. */
function start(chosenVerdict: Verdict | null | undefined, isExtra?: boolean, at?: number) {
  if (!chosenVerdict) {
    toast('Still checking that copy…');
    return;
  }
  if (!chosenVerdict.ok) {
    const why = guard.refusal(item as PlexItem, chosenVerdict);
    message(why[0], why[1]);
    return;
  }
  if (options.onPlay && item) {
    options.onPlay(
      item,
      chosenVerdict,
      isExtra,
      isExtra ? null : chosenSub && chosenSub.languageCode,
      at,
    );
  }
}

export function key(code: number): boolean {
  const K = KEY;
  if (menu.isOpen()) return menu.key(code);
  const last = (strip === 0 ? actions().length : extras.length) - 1;

  if (code === K.LEFT && index > 0) {
    index--;
    render();
    return true;
  }
  if (code === K.RIGHT && index < last) {
    index++;
    render();
    return true;
  }
  if (code === K.DOWN && strip === 0 && extras.length) {
    strip = 1;
    index = 0;
    render();
    return true;
  }
  if (code === K.UP && strip === 1) {
    strip = 0;
    index = 0;
    render();
    return true;
  }
  if (code === K.OK) {
    const action = strip === 0 ? actions()[index] : null;
    if (action) action.run();
    else {
      const extra = extras[index];
      start(extra && extra.verdict, true);
    }
    return true;
  }
  if (isBack(code)) {
    close();
    return true;
  }
  return true; // this page swallows everything else
}

/* The film currently open, so the message screen knows to come back here
   rather than dropping to the rail. */
export function current(): PlexItem | null {
  return item;
}
