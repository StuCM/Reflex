/* Screen chrome: which view is showing, the toast, the debug line, and the few
   helpers every other module needs. Nothing here knows about Plex. */
var UI = (function () {
  'use strict';

  /* Every full-screen view in index.html. show() hides all of them and reveals
     one; show('player') is a legitimate call that reveals none of them, since
     the video element sits above the lot. */
  var VIEWS = ['browse', 'detail', 'link', 'message', 'search', 'devices'];

  /* Remote keycodes. The TV sends 461 for Back; a desktop browser sends 8 or
     27, which is what lets the whole app be driven from a keyboard in dev. */
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    OK: 13, RED: 403,
    BACK: 461, ESC: 27, BACKSPACE: 8
  };

  var els = {};
  var i;
  for (i = 0; i < VIEWS.length; i++) els[VIEWS[i]] = document.getElementById(VIEWS[i]);

  var elToast = document.getElementById('toast');
  var elDebug = document.getElementById('debug');

  var current = 'browse';
  var toastTimer = null;
  var bootedAt = Date.now();

  function isBack(code) {
    return code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE;
  }

  function show(name) {
    current = name;
    var n;
    for (n = 0; n < VIEWS.length; n++) {
      els[VIEWS[n]].classList.toggle('hidden', VIEWS[n] !== name);
    }
  }

  function view() { return current; }

  /* The bottom line of the screen. WAM doesn't forward console.log anywhere
     readable on this set, so during bring-up the same text can be posted to a
     listener on the dev machine — see Config.beacon and dev/beacon.js. */
  /* Stamped with the time since launch, so the debug line reads as a timeline
     of the first load — which is the only way to tell a slow server from a slow
     panel without a profiler. */
  function debug(msg) {
    var stamped = (Date.now() - bootedAt) + 'ms  ' + msg;
    elDebug.textContent = stamped;
    if (window.console && console.log) console.log('REFLEX ' + stamped);
    if (!Config.beacon) return;
    try {
      var x = new XMLHttpRequest();
      x.open('GET', Config.beacon + '?m=' + encodeURIComponent(msg), true);
      x.send(null);
    } catch (e) { /* never let logging break the app */ }
  }

  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.classList.add('hidden'); }, 4000);
  }

  function message(title, body) {
    document.getElementById('message-title').textContent = title;
    document.getElementById('message-body').textContent = body;
    show('message');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  return {
    KEY: KEY, isBack: isBack,
    show: show, view: view, message: message, toast: toast, debug: debug,
    escapeHtml: escapeHtml, clamp: clamp
  };
})();
