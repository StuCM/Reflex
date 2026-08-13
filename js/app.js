/* Boot, the playback guard, and where each key goes.

   Everything else lives next door: js/browse.js holds the rows and the focus,
   js/rail.js draws them, js/plex.js talks to the server, js/media.js knows the
   rules. This file is the wiring. */
(function () {
  'use strict';

  /* ---------- playback ----------

     The one rule this app exists to keep: nothing starts a session on someone
     else's server unless we already know it will direct play. That means two
     checks before any stream is opened — is there an audio track that can pass
     over ARC at all, and does the server agree it will direct play — and the
     second one uses hasMDE=1, which returns a verdict without opening a
     session. See CLAUDE.md. */

  function playSelected() {
    var item = Browse.focusedItem();
    if (!item) return;
    UI.toast('Checking…');

    Meta.load(item.ratingKey).then(function (md) {
      if (!md) { UI.toast('No metadata'); return; }
      var media = md.Media && md.Media[0];
      var part = media && media.Part && media.Part[0];
      if (!part) { UI.message('Nothing to play', 'This item has no playable part.'); return; }

      var audio = Media.pickAudio(part);
      if (!audio) {
        UI.message('No passable audio track', item.title +
          ' only offers TrueHD or DTS-HD MA. Neither can pass over plain HDMI ARC ' +
          'on this set, so playing it would force an audio transcode on a server ' +
          'we do not own. Refused.');
        return;
      }

      return Plex.decide(md, 0, 0, audio.id).then(function (verdict) {
        UI.debug('decision: ' + verdict.decision + ' ' + verdict.text);
        if (verdict.decision === 'directplay') {
          md.viewOffset = item.viewOffset || md.viewOffset || 0;
          UI.show('player');
          Player.play({
            item: md,
            part: part,
            onExit: function () { UI.show('browse'); Browse.render(); },
            onError: function (msg) { UI.message('Playback failed', msg); }
          });
          return;
        }
        refuse(item, media, verdict);
      });
    }).catch(function (e) {
      UI.message('Could not check playback', e.message);
    });
  }

  function refuse(item, media, verdict) {
    var why = verdict.text || ('the server returned "' + verdict.decision + '"');
    if (Media.isUHD(media)) {
      UI.message('4K transcode refused', item.title + ' will not direct play — ' + why +
        '. Starting it would register a 4K transcode on the server, which gets killed. ' +
        'Run probe.py against this file to find which declared capability flips it.');
    } else {
      UI.message('Would transcode', item.title + ' will not direct play — ' + why +
        '. Reflex plays direct only.');
    }
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
      case 'message': handled = messageKey(code); break;
      case 'browse':  handled = Browse.key(code); break;
      default:        handled = false;             // the link screen waits, that is all
    }
    if (handled) e.preventDefault();
  }

  function messageKey(code) {
    if (!UI.isBack(code) && code !== UI.KEY.OK) return false;
    if (!Plex.hasToken()) doLink();
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
      if (cached && cached.length && Plex.state.base) {
        Browse.loadSection(Browse.setSections(cached), false);
      }
      return Plex.discover();
    }).then(function () {
      UI.debug('server: ' + (Plex.state.serverName || Plex.state.base));
      return Plex.sections();
    }).then(function (secs) {
      if (!secs.length) {
        UI.message('No movie libraries', 'This server shares no movie sections.');
        return;
      }
      Store.put('sections', secs);
      Browse.loadSection(Browse.setSections(secs), true);
    }).catch(startFailed);
  }

  function startFailed(e) {
    UI.debug('start failed: ' + e.message);
    /* Match the status precisely — a bare '401' also appears inside URLs, and
       signing out on a false positive dumps the user back to a fresh code with
       no explanation, which looks exactly like a login loop. */
    if (/-> 40[13]$/.test(e.message)) {
      /* Only plex.tv can invalidate the login. A 401 from the media server
         means the per-server token is stale — rediscover, don't make the user
         link again. Conflating the two is what turned one bug into a repeating
         login loop. */
      if (e.message.indexOf(Config.plexTvBase) >= 0) {
        Plex.signOut();
        UI.message('Plex rejected the login', e.message +
          '  ·  The stored login is no longer valid. BACK to link again.');
      } else {
        Plex.forgetServer();
        UI.message('Server rejected the token', e.message +
          '  ·  Dropped the cached server. BACK to retry.');
      }
      return;
    }
    if (!Browse.hasRows()) UI.message('Could not reach the server', e.message + '  ·  BACK to retry');
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
  Browse.init({ onPlay: playSelected, onExit: exitApp });
  document.addEventListener('keydown', onKey, false);
  Plex.init();
  Devices.init();
  storageSelfTest();
  if (Plex.hasToken()) start(); else doLink();
})();
