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

  function openDetail(item) {
    if (!item) return;
    Detail.open(item, {
      onPlay: playChecked,
      onExit: function () { UI.show('browse'); Browse.render(); }
    });
  }

  /* The verdict has already been through Guard, so by here the copy is known to
     direct play. Nothing else may reach Player. */
  function playChecked(item, verdict, isExtra) {
    if (!verdict || !verdict.ok) return;
    var md = verdict.md;
    /* A trailer is not the film: resuming it 40 minutes in would be absurd. */
    md.viewOffset = isExtra ? 0 : (item.viewOffset || md.viewOffset || 0);
    UI.show('player');
    Player.play({
      server: Servers.of(md),
      item: md,
      part: verdict.part,
      onExit: function () { openDetail(item); },
      onError: function (msg) { UI.message('Playback failed', msg); }
    });
  }

  /* ---------- keys ---------- */

  function onKey(e) {
    var code = e.keyCode, handled;

    if (Player.playing()) {
      if (Player.key(code)) e.preventDefault();
      return;
    }

    switch (UI.view()) {
      case 'search':  handled = Browse.searchKey(code); break;
      case 'devices': handled = Devices.key(code); break;
      case 'detail':  handled = Detail.key(code); break;
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
    if (!Plex.hasToken()) doLink();
    else if (Detail.current()) UI.show('detail');
    else { UI.show('browse'); Browse.render(); }
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
         Browse merges them by title. */
      return Promise.all(servers.map(function (sv) {
        return Plex.sections(sv).then(function (secs) {
          return { server: sv, sections: secs };
        });
      }));
    }).then(function (perServer) {
      var any = perServer.filter(function (r) { return r.sections.length; });
      if (!any.length) {
        UI.message('No movie libraries', 'Neither server shares a movie section.');
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
  Browse.init({ onOpen: openDetail, onExit: exitApp });
  document.addEventListener('keydown', onKey, false);
  Plex.init();
  Devices.init();
  storageSelfTest();
  if (Plex.hasToken()) start(); else doLink();
})();
