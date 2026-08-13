/* Direct play only. If the decision isn't directplay we don't get here —
   see the playback guard in js/app.js. */
var Player = (function () {
  'use strict';

  var v = document.getElementById('video');
  var osd = document.getElementById('osd');
  var osdTitle = document.getElementById('osd-title');
  var osdTime = document.getElementById('osd-time');

  var item = null, server = null, onExit = null, onError = null;
  var ticker = null, osdTimer = null, resumeMs = 0;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
  }

  /* Two separate things: painting the time, and putting the OSD back on screen
     for another few seconds. Repainting must not reset the hide timer, or the
     OSD would never go away once playback started. */
  function paintOsd() {
    osdTime.textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration) +
                          (v.paused ? '   PAUSED' : '');
  }

  function showOsd() {
    paintOsd();
    osd.classList.remove('hidden');
    osd.style.opacity = '1';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osd.style.opacity = '0'; }, 4000);
  }

  function osdShowing() { return osd.style.opacity !== '0' && !osd.classList.contains('hidden'); }

  /* Progress goes to the server we are playing from. Plex syncs the position
     to the account, which is why the same film picked up on the other server
     resumes in the right place. */
  function report(state) {
    if (!item || !server) return;
    Plex.timeline(server, item, state, (v.currentTime || 0) * 1000, (v.duration || 0) * 1000);
  }

  /* A black screen tells you nothing, and "the panel refused it" is only one of
     the reasons this fails. Say which. */
  function mediaErrorText(err) {
    var code = err ? err.code : 0;
    var detail = err && err.message ? '  ·  ' + err.message : '';
    if (code === 1) return 'The stream was aborted.' + detail;
    if (code === 2) return 'The network dropped the stream — the server stopped ' +
                           'answering part way through.' + detail;
    if (code === 3) return 'The panel could not decode this stream (media error 3). ' +
                           'The server said it would direct play, so the declared ' +
                           'profile in js/plex.js claims something this panel cannot ' +
                           'actually decode.' + detail;
    if (code === 4) return 'The stream would not open (media error 4) — the server ' +
                           'refused the request, or the container is one the panel ' +
                           'will not accept at all.' + detail;
    return 'The stream failed (media error ' + code + ').' + detail;
  }

  function fail(msg) {
    var report_ = onError;
    UI.debug('playback failed: ' + msg);
    stop('stopped');
    if (report_) report_(msg);
  }

  function play(opts) {
    item = opts.item;
    server = opts.server;
    onExit = opts.onExit;
    onError = opts.onError;
    resumeMs = opts.item.viewOffset || 0;

    var url = Plex.streamUrl(server, opts.part);
    osdTitle.textContent = opts.item.title || '';
    v.classList.remove('hidden');

    v.onloadedmetadata = function () {
      /* Only now does currentTime mean anything. Don't resume within half a
         minute of the end — that is a film you finished. */
      if (resumeMs > 10000 && v.duration && resumeMs < (v.duration * 1000) - 30000) {
        v.currentTime = resumeMs / 1000;
      }
      showOsd();
      report('playing');
    };
    v.onplaying = function () { showOsd(); };
    v.ontimeupdate = function () { if (osdShowing()) paintOsd(); };
    v.onended = function () { stop('stopped'); };
    v.onerror = function () { fail(mediaErrorText(v.error)); };

    v.src = url;
    v.load();
    showOsd();
    UI.debug('playing ' + String(url).split('?')[0]);

    /* preload="none" means nothing loads until something asks it to, and
       loadedmetadata may never fire on its own. Ask directly, and report it if
       the request is refused rather than sitting on a black screen — a play()
       that rejects is otherwise completely silent. */
    var started = v.play();
    if (started && started.then) {
      started.then(null, function (e) {
        fail('The player refused to start: ' + ((e && (e.name + ' ' + e.message)) || 'unknown') +
             '. If this is the TV, it is usually the media pipeline rejecting the ' +
             'container rather than the codec.');
      });
    }

    clearInterval(ticker);
    ticker = setInterval(function () { report(v.paused ? 'paused' : 'playing'); }, 10000);
  }

  function stop(state) {
    if (!item) return;
    report(state || 'stopped');
    clearInterval(ticker); ticker = null;
    clearTimeout(osdTimer);
    v.pause();
    v.onloadedmetadata = v.onplaying = v.ontimeupdate = v.onended = v.onerror = null;
    v.removeAttribute('src');
    v.load();
    v.classList.add('hidden');
    osd.classList.add('hidden');
    var done = onExit;
    item = null; server = null; onExit = null; onError = null;
    if (done) done();
  }

  function playing() { return !!item; }

  function key(code) {
    switch (code) {
      case 13: case 415: case 19: case 179:      // OK / play / pause
        if (v.paused) v.play(); else v.pause();
        report(v.paused ? 'paused' : 'playing');
        showOsd();
        return true;
      case 37: case 412:                          // left / rewind
        v.currentTime = Math.max(0, v.currentTime - 30);
        showOsd();
        return true;
      case 39: case 417:                          // right / fast forward
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 30);
        showOsd();
        return true;
      case 38: case 40:
        showOsd();
        return true;
      case 461: case 27: case 8: case 413:        // back / stop
        stop('stopped');
        return true;
    }
    return false;
  }

  return { play: play, stop: stop, playing: playing, key: key };
})();
