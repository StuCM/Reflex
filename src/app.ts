/* Boot, and where each key goes.

   Everything else lives next door: screen/browse holds the rows and the focus,
   view/rail draws them, screen/detail is the page you land on when you pick
   something, data/guard decides whether a copy may be played, api/plex talks
   to the servers. This file is the wiring. */
import { forgetServers, linkPoll, linkStart, signOut } from './api/plex/auth';
import { hasToken, init as plexInit, state as plexState } from './api/plex/client';
import { discover as plexDiscover } from './api/plex/discovery';
import { sections as plexSections } from './api/plex/library';
import { transcodeUrl as plexTranscodeUrl } from './api/plex/playback';
import settings from './core/config';
import { KEY, debug, isBack, message, show as showView, toast, view } from './core/ui';
import * as cached from './data/cached';
import * as devices from './data/devices';
import * as discovery from './data/discovery';
import * as guard from './data/guard';
import * as servers from './data/servers';
import * as shows from './data/shows';
import * as browse from './screen/browse';
import * as detail from './screen/detail';
import * as showpage from './screen/showpage';
import * as player from './screen/player';
import { must } from './view/dom';
import * as rail from './view/rail';

/* ---------- opening something ----------

   OK on the rail no longer plays. It opens the detail page, which lists every
   copy of the film — both servers, and every version each of them holds — and
   checks each one before you choose. Playing is a decision made there, with
   the verdict already on screen. */

function toBrowse() {
  showView('browse');
  browse.render();
}

function toShow() {
  showView('show');
}

/* A film opens its detail page; a show and an episode both open the series
   page, and an episode chosen there opens the same detail page a film would. */
function openItem(item: PlexItem | null | undefined) {
  if (!item) return;
  if (discovery.isEntry(item)) {
    openDiscovered(item as DiscoveryEntry);
    return;
  }
  if (item.type === 'show') {
    openShow(item);
    return;
  }
  if (item.type === 'episode') {
    openEpisode(item);
    return;
  }
  openDetail(item, toBrowse);
}

/* A Discovery tile is a film TMDB knows about, which neither server need
   have. Resolving it is one request and resting on it has usually paid for it
   already; a title we do not hold reaches no guard and no player, so it says
   so rather than opening a page about nothing. */
function openDiscovered(item: DiscoveryEntry) {
  discovery.resolve(item).then((found) => {
    if (found) {
      openItem(found);
      return;
    }
    const named = `${item.title}${item.year ? ` (${item.year})` : ''}`;
    message('Not in your library', `${named} is on neither server.  ·  BACK to the rows`);
  });
}

function openShow(entry: PlexItem, at?: { season?: number; episode?: number }) {
  showpage.open(entry, {
    at,
    onExit: toBrowse,
    onPlay: (episode, verdict) => {
      playChecked(episode, verdict, false, undefined, toShow);
    },
    /* Leaving the page by any route stops its theme. One call per route rather
       than a listener, because the failure mode is two sources on one ARC
       link — BACK goes through showpage's own close, and playback stops it in
       playChecked. */
    onChoose: (episode) => {
      showpage.silence();
      openDetail(episode, toShow);
    },
    onRecap: (video) => {
      showpage.silence();
      openRecap(video);
    },
  });
}

/* ---------- season recaps ----------

   A recap is a YouTube video, not library content: it never reaches the guard,
   the player or the timeline, and it opens nothing on anyone's Plex server. */

const recapView = must('recap');
const recapFrame = must('recap-frame') as HTMLIFrameElement;

/** Playing in the overlay, or null. */
let recapVideo: Recap | null = null;
/** The panel refused it; OK opens the app instead. */
let recapOffer: Recap | null = null;
let recapTimer = 0;

/* Chromium 53 is nine years old and YouTube's embed drops old browsers over
   time, so an embed that never loads is a real outcome, not a bug: it falls
   back to the app that can play it rather than sitting on a black screen. */
function openRecap(video: Recap) {
  recapVideo = video;
  clearTimeout(recapTimer);
  recapTimer = setTimeout(() => {
    recapFailed('did not load');
  }, 8000);
  recapFrame.onload = () => {
    clearTimeout(recapTimer);
  };
  recapFrame.onerror = () => {
    recapFailed('would not load');
  };
  recapFrame.src = `${settings.youtubeEmbedBase}${video.id}?autoplay=1`;
  recapView.classList.remove('hidden');
}

function closeRecap() {
  clearTimeout(recapTimer);
  recapFrame.onload = null;
  recapFrame.onerror = null;
  recapFrame.src = 'about:blank'; // stops it playing on the way out
  recapView.classList.add('hidden');
  recapVideo = null;
}

function recapFailed(why: string) {
  const video = recapVideo;
  if (!video) return;
  closeRecap();
  recapOffer = video;
  message(
    `This panel ${why}`,
    `${video.title}  ·  OK opens it in the YouTube app  ·  BACK to the recaps`,
  );
}

/* webOS only; on the laptop there is no app to hand it to. */
function launchYouTube(id: string) {
  const service = window.webOS?.service;
  if (!service) return;
  service.request('luna://com.webos.applicationManager', {
    method: 'launch',
    parameters: { id: 'youtube.leanback.v4', params: { contentTarget: `v=${id}` } },
  });
}

/* An episode is never a dead end: it opens its series at that episode, so the
   next one is one keypress away. Resolving the series takes a request or two,
   hence the toast — and if it cannot be resolved, its own page is better than
   nothing happening. */
function openEpisode(item: PlexItem) {
  toast(`Opening ${item.grandparentTitle || 'series'}…`);
  shows.entryFor(item).then(
    (entry) => {
      if (!entry) {
        debug(`no series for ${item.grandparentTitle || item.ratingKey}`);
        openDetail(item, toBrowse);
        return;
      }
      openShow(entry, { season: item.parentIndex, episode: item.index });
    },
    (error: Error) => {
      debug(`series: ${error.message}`);
      openDetail(item, toBrowse);
    },
  );
}

function openDetail(item: PlexItem | null | undefined, back?: () => void) {
  if (!item) return;
  detail.open(item, {
    /* `at` is 0 when the page's second play was pressed and undefined when
       Play was — the difference between starting again and picking up, so it
       must not be collapsed to `at || 0`. */
    onPlay: (entry, verdict, isExtra, language, at) => {
      playChecked(
        entry,
        verdict,
        isExtra,
        at,
        () => {
          openDetail(item, back);
        },
        language,
      );
    },
    onExit: back || toBrowse,
  });
}

/* The one way into the player: the verdict has already been through the
   guard, so the server will serve it and it is not a 4K transcode.

   `back` and `language` are carried through a switch of audio track, version
   or quality, because a switch is a restart and losing either to it is what
   the caller would never see. */
function playChecked(
  item: PlexItem,
  verdict: Verdict | null | undefined,
  isExtra?: boolean,
  resumeAt?: number,
  back?: () => void,
  language?: string | null,
) {
  /* Before anything touches the video element: a series theme and playback
     must never share the ARC link. */
  showpage.silence();
  if (!verdict || !verdict.ok) return;
  const metadata = verdict.metadata;
  const server = servers.of(metadata);
  if (!metadata || !server) return;
  /* Only an episode has a next. A film does not, and a trailer or an extra is
     not the thing you sat down to watch. */
  const hasNext = !isExtra && metadata.type === 'episode';
  const goBack =
    back ||
    (() => {
      openDetail(item, toBrowse);
    });
  /* A trailer is not the film: resuming it 40 minutes in would be absurd. */
  metadata.viewOffset = isExtra
    ? 0
    : resumeAt === undefined
      ? item.viewOffset || metadata.viewOffset || 0
      : resumeAt * 1000;
  debug(`starting at ${Math.round(metadata.viewOffset / 1000)}s`);
  showView('player');
  player.play({
    server,
    item: metadata,
    part: verdict.part,
    audio: verdict.audio,
    mediaIndex: verdict.mediaIndex || 0,
    maxBitrate: verdict.maxBitrate || null,
    /* Set when this stream is being muxed by the server purely so that a chosen
       audio track is actually the one playing — see screen/player. */
    forceStream: !!verdict.forceStream,
    /* By language, not by stream id: another version of the film is a
       different file with different ids, and "French" is what was chosen. */
    subLang: language,
    /* Audio, another version and a quality cap are one move — a different
       stream, started again from here — so all three go back through the
       guard rather than any of them getting a path of its own. */
    onSwitch: (change) => {
      guard
        .check(metadata, change.mediaIndex, change.audioId, {
          maxBitrate: change.maxBitrate,
          forceStream: change.forceStream,
        })
        .then((switched) => {
          if (!switched.ok) {
            /* A refusal returns without touching the player: stopping
               playback to deliver a message is worse than not switching. */
            toast(`Kept as it was — ${guard.label(switched)}`);
            debug(`switch refused: ${guard.refusal(item, switched)[1]}`);
            return;
          }
          player.stop('stopped', true);
          playChecked(item, switched, isExtra, change.at, back, change.subLang);
        });
    },
    /* Direct play reads the file itself. Otherwise the server has to serve a
       converted stream, which means HLS and an actual session on it. */
    url: verdict.transcode
      ? plexTranscodeUrl(
          server,
          metadata,
          verdict.mediaIndex || 0,
          0,
          (verdict.audio && verdict.audio.id) || null,
          { maxBitrate: verdict.maxBitrate, forceStream: verdict.forceStream },
        )
      : null,
    transcode: !!verdict.transcode,
    /* What the player offers when this one ends, and what it does when the
       offer is taken. Kept apart because finding the next episode costs a
       request or two and playing it has to go through the guard. */
    onNext: hasNext ? shows.nextAfter : null,
    onPlayNext: hasNext
      ? (episode: PlexItem) => {
          playNext(episode, goBack);
        }
      : null,
    onExit: goBack,
    onError: (text: string) => {
      message('Playback failed', text);
    },
  });
}

/* The next episode is not a special case: it may be a 4K remux the server would
   refuse, and finding that out by starting a session is exactly what the guard
   exists to prevent. A refusal says why and goes back to the series rather than
   leaving a black screen. */
function playNext(episode: PlexItem, back: () => void) {
  guard.check(episode).then((verdict) => {
    if (!verdict.ok) {
      toast(`Not playing ${episode.title || 'the next one'} — ${guard.label(verdict)}`);
      debug(`next refused: ${guard.refusal(episode, verdict)[1]}`);
      back();
      return;
    }
    playChecked(episode, verdict, false, 0, back);
  });
}

/* ---------- keys ---------- */

function onKey(event: KeyboardEvent) {
  const code = event.keyCode;
  let handled: boolean;

  if (player.playing()) {
    if (player.key(code)) event.preventDefault();
    return;
  }

  /* The recap overlay sits over the show page, which is still the view: BACK
     closes it and leaves the rail exactly where it was. */
  if (recapVideo) {
    if (isBack(code)) {
      closeRecap();
      event.preventDefault();
    }
    return;
  }

  switch (view()) {
    case 'search':
      handled = browse.searchKey(code);
      break;
    case 'devices':
      handled = devices.key(code);
      break;
    case 'detail':
      handled = detail.key(code);
      break;
    case 'show':
      handled = showpage.key(code);
      break;
    case 'message':
      handled = messageKey(code);
      break;
    case 'browse':
      handled = browse.key(code);
      break;
    default:
      handled = false; // the link screen waits, that is all
  }
  if (handled) event.preventDefault();
}

/* Back from a message goes where you came from — the detail page if one is
   open, which is where a refusal is most likely to have come from. */
function messageKey(code: number): boolean {
  if (!isBack(code) && code !== KEY.OK) return false;
  /* The offer of the YouTube app: OK takes it, BACK declines, and either way
     the show page and its recaps are what is behind this message. */
  if (recapOffer) {
    const video = recapOffer;
    recapOffer = null;
    if (code === KEY.OK) launchYouTube(video.id);
    showView('show');
    return true;
  }
  if (!hasToken()) doLink();
  else if (detail.current()) showView('detail');
  else if (showpage.current()) showView('show');
  else toBrowse();
  return true;
}

function exitApp() {
  if (window.webOS?.platformBack) window.webOS.platformBack();
  else window.close();
}

/* ---------- boot ---------- */

function doLink() {
  showView('link');
  debug('requesting a pin from plex.tv…');
  linkStart()
    .then((pin) => {
      must('link-code').textContent = pin.code;
      const client = String(plexState.clientId).substring(0, 8);
      debug(`pin ${pin.id} · client ${client} · code ${pin.code}`);
      return linkPoll(pin.id, Date.now() + 15 * 60 * 1000, debug);
    })
    .then((token) => {
      if (!token) {
        // pin expired, issue a fresh one
        debug('pin expired after 15 min, requesting another');
        doLink();
        return;
      }
      showView('browse');
      start();
    })
    .catch((error: Error) => {
      message('Could not reach plex.tv', `${error.message}  ·  BACK to retry`);
    });
}

function start() {
  showView('browse');
  /* Paint from cache before any network work — the whole point of the app. */
  cached.sections
    .get()
    .then((list) => {
      if (list && list.length && servers.count()) {
        browse.loadSection(browse.setSections(rehydrate(list)), false);
      }
      return plexDiscover();
    })
    .then((found) => {
      debug(`servers: ${found.map((server) => server.name).join(', ')}`);
      /* Each server's own section list. They may not agree on what exists —
         browse folds them by type into one Movies and one TV Shows. */
      return Promise.all(
        found.map((server) => plexSections(server).then((list) => ({ server, sections: list }))),
      );
    })
    .then((perServer) => {
      if (!perServer.some((row) => row.sections.length)) {
        message('No libraries', 'Neither server shares a film or show section.');
        return;
      }
      cached.sections.put(
        perServer.map((row) => ({ serverId: row.server.id, sections: row.sections })),
      );
      browse.loadSection(browse.setSections(perServer), true);
    })
    .catch(startFailed);
}

/* Cached sections name their server by id; turn them back into the server
   objects discovery handed us. A server that has since gone is dropped. */
function rehydrate(list: CachedSections[]): { server: PlexServer; sections: PlexSection[] }[] {
  const out: { server: PlexServer; sections: PlexSection[] }[] = [];
  list.forEach((row) => {
    const server = servers.get(row.serverId);
    if (server) out.push({ server, sections: row.sections });
  });
  return out;
}

function startFailed(error: Error) {
  debug(`start failed: ${error.message}`);
  /* Match the status precisely — a bare '401' also appears inside URLs, and
     signing out on a false positive dumps the user back to a fresh code with no
     explanation, which looks exactly like a login loop. */
  if (/-> 40[13]$/.test(error.message)) {
    /* Only plex.tv can invalidate the login. A 401 from a media server means
       that server's token is stale — rediscover, don't make the user link
       again. Conflating the two is what turned one bug into a repeating login
       loop. */
    if (error.message.indexOf(settings.plexTvBase) >= 0) {
      signOut();
      message(
        'Plex rejected the login',
        `${error.message}  ·  The stored login is no longer valid. BACK to link again.`,
      );
    } else {
      forgetServers();
      message(
        'A server rejected the token',
        `${error.message}  ·  Dropped the cached servers. BACK to retry.`,
      );
    }
    return;
  }
  if (browse.hasRows()) toast('Offline — showing cache');
  else message('Could not reach the servers', `${error.message}  ·  BACK to retry`);
}

/* Does persistence actually work here? If not, every launch is a first launch,
   which looks like a login loop. */
function storageSelfTest() {
  let stored;
  try {
    localStorage.setItem('selftest', 'y');
    stored = localStorage.getItem('selftest') === 'y';
    localStorage.removeItem('selftest');
  } catch (error) {
    debug(`localStorage THROWS: ${(error as Error).message}`);
    return;
  }
  const token = hasToken() ? 'present' : 'absent';
  debug(
    `localStorage ${stored ? 'ok' : 'SILENTLY DROPS WRITES'} · token ${token}` +
      (settings.dev ? ' · dev server' : ''),
  );
}

window.onerror = (text, url, line) => {
  debug(`JS ERROR ${String(text)} @${String(url).split('/').pop()}:${line}`);
  return false;
};

rail.build();
browse.init({ onOpen: openItem, onExit: exitApp });
document.addEventListener('keydown', onKey, false);
plexInit();
devices.init();
storageSelfTest();
if (hasToken()) start();
else doLink();
