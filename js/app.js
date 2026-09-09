/* Boot, and where each key goes.

   Everything else lives next door: js/browse.js holds the rows and the focus,
   js/rail.js draws them, js/detail.js is the page you land on when you pick
   something, js/guard.js decides whether a copy may be played, js/plex.js talks
   to the servers. This file is the wiring. */
(function () {
  'use strict';

  /* ---------- opening something ----------

     OK on the rail no longer plays. It opens the detail page, which lists every
     copy of the film — both servers, and every version each of them holds — and
     checks each one before you choose. Playing is a decision made there, with
     the verdict already on screen. */

  function toBrowse() { UI.show('browse'); Browse.render(); }
  function toShow() { UI.show('show'); }

  /* A film opens its detail page; a show and an episode both open the series
     page, and an episode chosen there opens the same detail page a film would. */
  function openItem(item) {
    if (!item) return;
    if (Discovery.isEntry(item)) { openDiscovered(item); return; }
    if (item.type === 'show') { openShow(item); return; }
    if (item.type === 'episode') { openEpisode(item); return; }
    openDetail(item, toBrowse);
  }

  /* A Discovery tile is a film TMDB knows about, which neither server need
     have. Resolving it is one request and resting on it has usually paid for it
     already; a title we do not hold reaches no guard and no player, so it says
     so rather than opening a page about nothing. */
  function openDiscovered(item) {
    Discovery.resolve(item).then(function (found) {
      if (found) { openItem(found); return; }
      UI.message('Not in your library',
        item.title + (item.year ? ' (' + item.year + ')' : '') +
        ' is on neither server.  ·  BACK to the rows');
    });
  }

  function openShow(entry, at) {
    ShowPage.open(entry, {
      at: at,
      onExit: toBrowse,
      onPlay: function (episode, verdict) {
        playChecked(episode, verdict, false, undefined, toShow);
      },
      /* Leaving the page by any route stops its theme. One call per route
         rather than a listener, because the failure mode is two sources on one
         ARC link — BACK goes through ShowPage's own close, and playback stops
         it in playChecked. */
      onChoose: function (episode) { ShowPage.silence(); openDetail(episode, toShow); },
      onRecap: function (video) { ShowPage.silence(); openRecap(video); }
    });
  }

  /* ---------- season recaps ----------

     A recap is a YouTube video, not library content: it never reaches Guard,
     Player or the timeline, and it opens nothing on anyone's Plex server. */

  var recapVideo = null;         // playing in the overlay, or null
  var recapOffer = null;         // the panel refused it; OK opens the app instead
  var recapTimer = null;

  /* Chromium 53 is nine years old and YouTube's embed drops old browsers over
     time, so an embed that never loads is a real outcome, not a bug: it falls
     back to the app that can play it rather than sitting on a black screen. */
  function openRecap(video) {
    var frame = document.getElementById('recap-frame');
    recapVideo = video;
    clearTimeout(recapTimer);
    recapTimer = setTimeout(function () { recapFailed('did not load'); }, 8000);
    frame.onload = function () { clearTimeout(recapTimer); };
    frame.onerror = function () { recapFailed('would not load'); };
    frame.src = Config.youtubeEmbedBase + video.id + '?autoplay=1';
    document.getElementById('recap').classList.remove('hidden');
  }

  function closeRecap() {
    var frame = document.getElementById('recap-frame');
    clearTimeout(recapTimer);
    frame.onload = null;
    frame.onerror = null;
    frame.src = 'about:blank';                 // stops it playing on the way out
    document.getElementById('recap').classList.add('hidden');
    recapVideo = null;
  }

  function recapFailed(why) {
    var video = recapVideo;
    if (!video) return;
    closeRecap();
    recapOffer = video;
    UI.message('This panel ' + why, video.title +
               '  ·  OK opens it in the YouTube app  ·  BACK to the recaps');
  }

  /* webOS only; on the laptop there is no app to hand it to. */
  function launchYouTube(id) {
    if (!window.webOS || !window.webOS.service) return;
    window.webOS.service.request('luna://com.webos.applicationManager', {
      method: 'launch',
      parameters: { id: 'youtube.leanback.v4', params: { contentTarget: 'v=' + id } }
    });
  }

  /* An episode is never a dead end: it opens its series at that episode, so the
     next one is one keypress away. Resolving the series takes a request or two,
     hence the toast — and if it cannot be resolved, its own page is better than
     nothing happening. */
  function openEpisode(item) {
    UI.toast('Opening ' + (item.grandparentTitle || 'series') + '…');
    Shows.entryFor(item).then(function (entry) {
      if (!entry) {
        UI.debug('no series for ' + (item.grandparentTitle || item.ratingKey));
        openDetail(item, toBrowse);
        return;
      }
      openShow(entry, { season: item.parentIndex, episode: item.index });
    }, function (e) {
      UI.debug('series: ' + e.message);
      openDetail(item, toBrowse);
    });
  }

  function openDetail(item, back) {
    if (!item) return;
    Detail.open(item, {
      /* isExtra comes from the page: a trailer is played, but it is not the
         film and must not inherit its resume position.

         Stopping returns to this page rather than past it — the page is where
         you pick another copy, or the next extra.

         The verdict is the one the page's buttons already put through the
         guard, and subLang is the subtitle language they chose, so playback
         starts on exactly what those buttons said it would.

         resumeAt is 0 when the page's second play was pressed and undefined
         when Play was, which is the difference between starting again and
         picking up. */
      onPlay: function (entry, verdict, isExtra, subLang, resumeAt) {
        playChecked(entry, verdict, isExtra, resumeAt,
                    function () { openDetail(item, back); }, subLang);
      },
      onExit: back || toBrowse
    });
  }

  /* The verdict has already been through Guard, so by here we know the server
     will serve it and that it is not a 4K transcode. Nothing else reaches
     Player.

     `back` is where stopping returns to — the show page for an episode, the
     film's own page otherwise — so the next episode is one press away rather
     than a search away.

     `subLang` is the subtitle language that was on before a restart. Both
     survive a switch of audio track, version or quality, because a switch is
     a restart and neither of them should be lost to it. */
  function playChecked(item, verdict, isExtra, resumeAt, back, subLang) {
    /* Before anything touches the video element: a series theme and playback
       must never share the ARC link. */
    ShowPage.silence();
    if (!verdict || !verdict.ok) return;
    var md = verdict.md;
    var server = Servers.of(md);
    /* Only an episode has a next. A film does not, and a trailer or an extra is
       not the thing you sat down to watch. */
    var hasNext = !isExtra && md.type === 'episode';
    var goBack = back || function () { openDetail(item, toBrowse); };
    /* A trailer is not the film: resuming it 40 minutes in would be absurd. */
    md.viewOffset = isExtra ? 0
      : (resumeAt !== undefined ? resumeAt * 1000 : (item.viewOffset || md.viewOffset || 0));
    UI.debug('starting at ' + Math.round(md.viewOffset / 1000) + 's');
    UI.show('player');
    Player.play({
      server: server,
      item: md,
      part: verdict.part,
      audio: verdict.audio,
      mediaIndex: verdict.mediaIndex || 0,
      maxBitrate: verdict.maxBitrate || null,
      /* Set when this stream is being muxed by the server purely so that a
         chosen audio track is actually the one playing — see js/player.js. */
      forceStream: !!verdict.forceStream,
      /* Which subtitle language was on before a restart. By language, not by
         stream id: another version of the film is a different file with
         different ids, and "French" is what the user chose. */
      subLang: subLang,
      /* Audio, another version, and a quality cap are all the same move:
         ask the server for a different stream and start again from here. The
         panel picks its own track out of a direct-played file, so there is
         nothing to switch client-side. Subtitles are not here — they are drawn
         over the video and never restart anything. */
      onSwitch: function (change) {
        Guard.check(verdict.md, change.mediaIndex, change.audioId,
                    { maxBitrate: change.maxBitrate, forceStream: change.forceStream })
          .then(function (v2) {
            if (!v2.ok) {
              /* Refusing a switch must not end the film. Say why in a line and
                 leave what is already playing alone — the full explanation is
                 on the detail page, and stopping playback to deliver it is a
                 worse answer than not switching. */
              UI.toast('Kept as it was — ' + Guard.label(v2));
              UI.debug('switch refused: ' + Guard.refusal(item, v2)[1]);
              return;
            }
            Player.stop('stopped', true);
            playChecked(item, v2, isExtra, change.at, back, change.subLang);
          });
      },
      /* Direct play reads the file itself. Otherwise the server has to serve a
         converted stream, which means HLS and an actual session on it. */
      url: verdict.transcode
        ? Plex.transcodeUrl(server, md, verdict.mediaIndex || 0, 0,
                            verdict.audio && verdict.audio.id,
                            { maxBitrate: verdict.maxBitrate,
                              forceStream: verdict.forceStream })
        : null,
      transcode: !!verdict.transcode,
      /* What the player offers when this one ends, and what it does when the
         offer is taken. Kept apart because finding the next episode costs a
         request or two and playing it has to go through the guard. */
      onNext: hasNext ? Shows.nextAfter : null,
      onPlayNext: hasNext ? function (episode) { playNext(episode, goBack); } : null,
      onExit: goBack,
      onError: function (msg) { UI.message('Playback failed', msg); }
    });
  }

  /* The next episode is not a special case: it may be a 4K remux the server
     would refuse, and finding that out by starting a session is exactly what
     the guard exists to prevent. A refusal says why and goes back to the
     series rather than leaving a black screen. */
  function playNext(episode, back) {
    Guard.check(episode).then(function (v) {
      if (!v.ok) {
        UI.toast('Not playing ' + (episode.title || 'the next one') + ' — ' + Guard.label(v));
        UI.debug('next refused: ' + Guard.refusal(episode, v)[1]);
        back();
        return;
      }
      playChecked(episode, v, false, 0, back);
    });
  }

  /* ---------- keys ---------- */

  function onKey(e) {
    var code = e.keyCode, handled;

    if (Player.playing()) {
      if (Player.key(code)) e.preventDefault();
      return;
    }

    /* The recap overlay sits over the show page, which is still the view: BACK
       closes it and leaves the rail exactly where it was. */
    if (recapVideo) {
      if (UI.isBack(code)) { closeRecap(); e.preventDefault(); }
      return;
    }

    switch (UI.view()) {
      case 'search':  handled = Browse.searchKey(code); break;
      case 'devices': handled = Devices.key(code); break;
      case 'detail':  handled = Detail.key(code); break;
      case 'show':    handled = ShowPage.key(code); break;
      case 'message': handled = messageKey(code); break;
      case 'browse':  handled = Browse.key(code); break;
      default:        handled = false;             // the link screen waits, that is all
    }
    if (handled) e.preventDefault();
  }

  /* Back from a message goes where you came from — the detail page if one is
     open, which is where a refusal is most likely to have come from. */
  function messageKey(code) {
    if (!UI.isBack(code) && code !== UI.KEY.OK) return false;
    /* The offer of the YouTube app: OK takes it, BACK declines, and either way
       the show page and its recaps are what is behind this message. */
    if (recapOffer) {
      var video = recapOffer;
      recapOffer = null;
      if (code === UI.KEY.OK) launchYouTube(video.id);
      UI.show('show');
      return true;
    }
    if (!Plex.hasToken()) doLink();
    else if (Detail.current()) UI.show('detail');
    else if (ShowPage.current()) UI.show('show');
    else toBrowse();
    return true;
  }

  function exitApp() {
    if (window.webOS && window.webOS.platformBack) window.webOS.platformBack();
    else window.close();
  }

  /* ---------- boot ---------- */

  function doLink() {
    UI.show('link');
    UI.debug('requesting a pin from plex.tv…');
    Plex.linkStart().then(function (pin) {
      document.getElementById('link-code').textContent = pin.code;
      UI.debug('pin ' + pin.id + ' · client ' + String(Plex.state.clientId).substring(0, 8) +
               ' · code ' + pin.code);
      return Plex.linkPoll(pin.id, Date.now() + 15 * 60 * 1000, UI.debug);
    }).then(function (token) {
      if (!token) {                          // pin expired, issue a fresh one
        UI.debug('pin expired after 15 min, requesting another');
        doLink();
        return;
      }
      UI.show('browse');
      start();
    }).catch(function (e) {
      UI.message('Could not reach plex.tv', e.message + '  ·  BACK to retry');
    });
  }

  function start() {
    UI.show('browse');
    /* Paint from cache before any network work — the whole point of the app. */
    Store.get('sections').then(function (cached) {
      if (cached && cached.length && Servers.count()) {
        Browse.loadSection(Browse.setSections(rehydrate(cached)), false);
      }
      return Plex.discover();
    }).then(function (servers) {
      UI.debug('servers: ' + servers.map(function (sv) { return sv.name; }).join(', '));
      /* Each server's own section list. They may not agree on what exists —
         Browse folds them by type into one Movies and one TV Shows. */
      return Promise.all(servers.map(function (sv) {
        return Plex.sections(sv).then(function (secs) {
          return { server: sv, sections: secs };
        });
      }));
    }).then(function (perServer) {
      var any = perServer.filter(function (r) { return r.sections.length; });
      if (!any.length) {
        UI.message('No libraries', 'Neither server shares a film or show section.');
        return;
      }
      Store.put('sections', perServer.map(function (r) {
        return { serverId: r.server.id, sections: r.sections };
      }));
      Browse.loadSection(Browse.setSections(perServer), true);
    }).catch(startFailed);
  }

  /* Cached sections name their server by id; turn them back into the server
     objects discovery handed us. A server that has since gone is dropped. */
  function rehydrate(cached) {
    var out = [], i, server;
    for (i = 0; i < cached.length; i++) {
      server = Servers.get(cached[i].serverId);
      if (server) out.push({ server: server, sections: cached[i].sections });
    }
    return out;
  }

  function startFailed(e) {
    UI.debug('start failed: ' + e.message);
    /* Match the status precisely — a bare '401' also appears inside URLs, and
       signing out on a false positive dumps the user back to a fresh code with
       no explanation, which looks exactly like a login loop. */
    if (/-> 40[13]$/.test(e.message)) {
      /* Only plex.tv can invalidate the login. A 401 from a media server means
         that server's token is stale — rediscover, don't make the user link
         again. Conflating the two is what turned one bug into a repeating
         login loop. */
      if (e.message.indexOf(Config.plexTvBase) >= 0) {
        Plex.signOut();
        UI.message('Plex rejected the login', e.message +
          '  ·  The stored login is no longer valid. BACK to link again.');
      } else {
        Plex.forgetServers();
        UI.message('A server rejected the token', e.message +
          '  ·  Dropped the cached servers. BACK to retry.');
      }
      return;
    }
    if (!Browse.hasRows()) UI.message('Could not reach the servers', e.message + '  ·  BACK to retry');
    else UI.toast('Offline — showing cache');
  }

  /* Does persistence actually work here? If not, every launch is a first
     launch, which looks like a login loop. */
  function storageSelfTest() {
    var ok;
    try {
      localStorage.setItem('selftest', 'y');
      ok = localStorage.getItem('selftest') === 'y';
      localStorage.removeItem('selftest');
    } catch (e) {
      UI.debug('localStorage THROWS: ' + e.message);
      return;
    }
    UI.debug('localStorage ' + (ok ? 'ok' : 'SILENTLY DROPS WRITES') +
             ' · token ' + (Plex.hasToken() ? 'present' : 'absent') +
             (Config.dev ? ' · dev server' : ''));
  }

  window.onerror = function (msg, url, line) {
    UI.debug('JS ERROR ' + msg + ' @' + String(url).split('/').pop() + ':' + line);
    return false;
  };

  Rail.build();
  Browse.init({ onOpen: openItem, onExit: exitApp });
  document.addEventListener('keydown', onKey, false);
  Plex.init();
  Devices.init();
  storageSelfTest();
  if (Plex.hasToken()) start(); else doLink();
})();
