/* Direct play only. If the decision isn't directplay we don't get here —
   see the playback guard in js/app.js. */
var Player = (function () {
  'use strict';

  var v = document.getElementById('video');
  var osd = document.getElementById('osd');
  var osdTitle = document.getElementById('osd-title');
  var osdTime = document.getElementById('osd-time');
  var osdFill = document.getElementById('osd-fill');
  var osdBuffered = document.getElementById('osd-buffered');
  var osdTracks = document.getElementById('osd-tracks');

  var BAR_W = 1792;                // #osd-bar, in CSS pixels
  var SEEK_SETTLE = 400;           // ms of stillness before a seek is applied

  var item = null, server = null, onExit = null, onError = null, onAudio = null;
  var currentPart = null, currentAudio = null;
  var ticker = null, osdTimer = null, resumeMs = 0;

  /* A stall is the thing you actually see as a blip, and it is over before the
     ten-second sample comes round. Count them instead. */
  var stalls = 0, lowest = 999, startedAt = 0;

  /* Where a run of seek presses is heading. Every currentTime assignment on a
     direct-played file is a real seek — a range request, a decoder flush — so
     holding the key would otherwise fire one per press and fight the network
     the whole way. Accumulate, show where you are going, apply once you stop. */
  var pending = null, seekTimer = null;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
  }

  /* Where the picture will be once any pending seek lands — that is what the
     user is aiming at, so that is what the bar and the clock have to show. */
  function target() {
    return pending === null ? (v.currentTime || 0) : pending;
  }

  /* Two separate things: painting the time, and putting the OSD back on screen
     for another few seconds. Repainting must not reset the hide timer, or the
     OSD would never go away once playback started. */
  function paintOsd() {
    var at = target(), dur = v.duration || 0;
    var left = dur ? Math.max(0, dur - at) : 0;

    osdTime.textContent = fmt(at) + ' / ' + fmt(dur) +
      (dur ? '   ·   ' + fmt(left) + ' left' : '') +
      (pending !== null ? '   SEEKING' : (v.paused ? '   PAUSED' : ''));

    osdFill.style.width = dur ? Math.round(BAR_W * at / dur) + 'px' : '0';

    var ahead = 0;
    try {
      if (v.buffered && v.buffered.length) ahead = v.buffered.end(v.buffered.length - 1);
    } catch (e) { ahead = 0; }
    osdBuffered.style.width = dur ? Math.round(BAR_W * Math.min(ahead, dur) / dur) + 'px' : '0';
  }

  function showOsd() {
    paintOsd();
    osd.classList.remove('hidden');
    osd.style.opacity = '1';
    clearTimeout(osdTimer);
    /* While a seek is still being aimed, the OSD is the only feedback there is,
       so it stays until the seek lands. */
    osdTimer = setTimeout(function () {
      if (pending !== null) { showOsd(); return; }
      osd.style.opacity = '0';
    }, 4000);
  }

  /* Nudge the target. Repeats accumulate rather than each one seeking. */
  function seekBy(seconds) {
    var dur = v.duration || 0;
    var at = target() + seconds;
    pending = Math.max(0, dur ? Math.min(at, dur - 2) : at);
    showOsd();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(applySeek, SEEK_SETTLE);
  }

  function applySeek() {
    if (pending === null) return;
    var to = pending;
    pending = null;
    try { v.currentTime = to; } catch (e) { /* not seekable yet */ }
    report(v.paused ? 'paused' : 'playing');
    showOsd();
  }

  function osdShowing() { return osd.style.opacity !== '0' && !osd.classList.contains('hidden'); }

  /* Progress goes to the server we are playing from. Plex syncs the position
     to the account, which is why the same film picked up on the other server
     resumes in the right place. */
  /* Which audio the panel is actually carrying, named on screen — the file
     usually has several and until now nothing said which one you had. */
  function paintTracks(part, chosen) {
    var streams = (part && part.Stream) || [], audio = [], i, st;
    for (i = 0; i < streams.length; i++) {
      st = streams[i];
      if (st.streamType !== 2) continue;
      audio.push(Media.audioLabel(st) + (Media.isCommentary(st) ? ' (commentary)' : ''));
    }
    osdTracks.textContent = chosen
      ? 'Audio: ' + Media.audioLabel(chosen) +
        (audio.length > 1 ? '   ·   ' + audio.length + ' tracks on this file' : '')
      : '';
  }

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

  /* A desktop browser is not this panel, and its codec support is much
     narrower — Firefox has no AC3/E-AC3 and no HEVC at all, Chrome has no
     Matroska. Silence or a decode error on the laptop usually says nothing
     about the TV, and mistaking one for the other costs an evening. */
  function laptopNote(media) {
    if (!Config.dev) return '';
    var codec = (media && media.videoCodec) || '?';
    var container = (media && media.container) || '?';
    return '  ·  You are on the dev server, so this is a desktop browser, not ' +
           'the B8. It is playing ' + String(codec).toUpperCase() + ' in ' +
           String(container).toUpperCase() + ', and browsers do not decode AC3, ' +
           'E-AC3, HEVC or Matroska the way the panel does. Judge playback on ' +
           'the TV.';
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

    stalls = 0; lowest = 999; startedAt = Date.now();
    var url = opts.url || Plex.streamUrl(server, opts.part);
    osdTitle.textContent = opts.item.title || '';
    pending = null;
    clearTimeout(seekTimer);
    currentPart = opts.part;
    currentAudio = opts.audio || null;
    onAudio = opts.onAudio || null;
    paintTracks(opts.part, opts.audio);
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
    /* 'waiting' is the panel telling us it has run dry. */
    v.onwaiting = function () { stalls++; };
    v.ontimeupdate = function () { if (osdShowing()) paintOsd(); };
    v.onended = function () { stop('stopped'); };
    v.onerror = function () {
      fail(mediaErrorText(v.error) + laptopNote(opts.item && opts.item.Media &&
                                                opts.item.Media[opts.mediaIndex || 0]));
    };

    /* preload only matters between the element existing and a src being set,
       and the src is only ever set here, at the moment we play. Leaving it at
       "none" made the browser conservative about reading ahead for no benefit. */
    v.preload = 'auto';
    v.src = url;
    v.load();
    showOsd();
    UI.debug((opts.transcode ? 'playing (server converting) ' : 'playing ') +
             String(url).split('?')[0]);

    /* Ask directly rather than waiting on loadedmetadata, which need not fire
       on its own, and report a rejected play() rather than sitting on a black
       screen — it is otherwise completely silent. */
    var started = v.play();
    if (started && started.then) {
      started.then(null, function (e) {
        fail('The player refused to start: ' + ((e && (e.name + ' ' + e.message)) || 'unknown') +
             '. If this is the TV, it is usually the media pipeline rejecting the ' +
             'container rather than the codec.');
      });
    }

    clearInterval(ticker);
    ticker = setInterval(function () {
      report(v.paused ? 'paused' : 'playing');
      UI.debug(health());
    }, 10000);
  }

  /* Stuttering is either the network not keeping up or the panel not decoding
     fast enough, and those want opposite fixes. The video element knows which:
     a buffer that keeps draining is bandwidth, dropped frames are decode.
     Reported every ten seconds alongside the timeline, so the debug line
     answers it without a profiler. */
  function health() {
    var ahead = 0;
    try {
      if (v.buffered && v.buffered.length) {
        ahead = Math.round(v.buffered.end(v.buffered.length - 1) - v.currentTime);
      }
    } catch (e) { ahead = -1; }

    var dropped = v.webkitDroppedFrameCount, decoded = v.webkitDecodedFrameCount;
    if (dropped === undefined && v.getVideoPlaybackQuality) {
      var q = v.getVideoPlaybackQuality();
      dropped = q.droppedVideoFrames;
      decoded = q.totalVideoFrames;
    }
    var frames = (decoded === undefined) ? 'frames n/a'
      : ('dropped ' + dropped + '/' + decoded);

    if (ahead >= 0 && ahead < lowest) lowest = ahead;

    return fmt(v.currentTime) + '  buffered +' + ahead + 's (low ' + lowest + 's)' +
           '  stalls ' + stalls + '  ' + frames + (v.paused ? '  PAUSED' : '');
  }

  /* Said once when playback ends, because that is when the whole picture
     exists: enough stalls on a 4K remux means the link cannot carry it, and
     the answer is the 1080p copy on the film page rather than anything here. */
  function summary() {
    var mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    return 'played ' + mins + ' min · ' + stalls + ' stall' + (stalls === 1 ? '' : 's') +
           ' · buffer low ' + (lowest === 999 ? '?' : lowest + 's');
  }

  /* quiet: tear down without telling the caller we are done — used when
     playback is about to be started again with a different track, where firing
     onExit would bounce back to the film page mid-restart. */
  function stop(state, quiet) {
    if (!item) return;
    UI.debug(summary());
    report(state || 'stopped');
    clearInterval(ticker); ticker = null;
    clearTimeout(osdTimer);
    clearTimeout(seekTimer);
    pending = null;
    v.pause();
    v.onloadedmetadata = v.onplaying = v.ontimeupdate = v.onended = v.onerror = null;
    v.onwaiting = null;
    v.removeAttribute('src');
    v.load();
    v.classList.add('hidden');
    osd.classList.add('hidden');
    var done = quiet ? null : onExit;
    item = null; server = null; onExit = null; onError = null; onAudio = null;
    currentPart = null; currentAudio = null;
    if (done) done();
  }

  /* Cycle to the next audio track on the file. The panel picks its own track
     out of a direct-played file, so honouring a choice means asking the server
     to deliver that one — which is a restart, from where we are now. A list
     screen would be nicer; a remote with no colour buttons but one red makes
     cycling the cheaper control that actually works. */
  function nextAudio() {
    if (!onAudio) return false;
    var tracks = Media.audioTracks(currentPart);
    if (tracks.length < 2) { showOsd(); return true; }
    var at = 0, i;
    for (i = 0; i < tracks.length; i++) {
      if (currentAudio && String(tracks[i].id) === String(currentAudio.id)) at = i;
    }
    var next = tracks[(at + 1) % tracks.length];
    osdTracks.textContent = 'Switching to ' + Media.audioLabel(next) +
      (Media.isCommentary(next) ? ' (commentary)' : '') + '…';
    showOsd();
    onAudio(next.id, v.currentTime || 0);
    return true;
  }

  function playing() { return !!item; }

  function key(code) {
    switch (code) {
      case 13: case 415: case 19: case 179:      // OK / play / pause
        if (v.paused) v.play(); else v.pause();
        report(v.paused ? 'paused' : 'playing');
        showOsd();
        return true;
      case 37:                                    // left
        seekBy(-30);
        return true;
      case 39:                                    // right
        seekBy(30);
        return true;
      case 412:                                   // rewind
        seekBy(-300);
        return true;
      case 417:                                   // fast forward
        seekBy(300);
        return true;
      case 38:                                    // up — five minutes on
        seekBy(300);
        return true;
      case 40:                                    // down — five minutes back
        seekBy(-300);
        return true;
      case 403:                                   // red — next audio track
        return nextAudio();
      case 461: case 27: case 8: case 413:        // back / stop
        stop('stopped');
        return true;
    }
    return false;
  }

  return { play: play, stop: stop, playing: playing, key: key };
})();
