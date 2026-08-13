/* Direct play only. If the decision isn't directplay we don't get here —
   see App.playSelected. */
var Player = (function () {
  'use strict';

  var v = document.getElementById('video');
  var osd = document.getElementById('osd');
  var osdTitle = document.getElementById('osd-title');
  var osdTime = document.getElementById('osd-time');

  var item = null, onExit = null, ticker = null, osdTimer = null, resumeMs = 0;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
  }

  function showOsd() {
    osdTime.textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration) + (v.paused ? '   PAUSED' : '');
    osd.classList.remove('hidden');
    osd.style.opacity = '1';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osd.style.opacity = '0'; }, 4000);
  }

  function report(state) {
    if (!item) return;
    Plex.timeline(item, state, (v.currentTime || 0) * 1000, (v.duration || 0) * 1000);
  }

  function play(opts) {
    item = opts.item;
    onExit = opts.onExit;
    resumeMs = opts.item.viewOffset || 0;

    osdTitle.textContent = opts.item.title || '';
    v.src = Plex.streamUrl(opts.part);
    v.classList.remove('hidden');
    showOsd();

    v.onloadedmetadata = function () {
      if (resumeMs > 10000 && resumeMs < (v.duration * 1000) - 30000) {
        v.currentTime = resumeMs / 1000;
      }
      v.play();
      report('playing');
    };
    v.onplay = function () { showOsd(); };
    v.onended = function () { stop('stopped'); };
    v.onerror = function () {
      var code = v.error ? v.error.code : '?';
      stop('stopped');
      if (opts.onError) opts.onError('The panel refused the stream (media error ' + code + ').');
    };

    v.load();
    clearInterval(ticker);
    ticker = setInterval(function () { report(v.paused ? 'paused' : 'playing'); }, 10000);
  }

  function stop(state) {
    if (!item) return;
    report(state || 'stopped');
    clearInterval(ticker); ticker = null;
    clearTimeout(osdTimer);
    v.pause();
    v.onloadedmetadata = v.onplay = v.onended = v.onerror = null;
    v.removeAttribute('src');
    v.load();
    v.classList.add('hidden');
    osd.classList.add('hidden');
    var done = onExit;
    item = null; onExit = null;
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
