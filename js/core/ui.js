/* Screen chrome: which view is showing, the toast, the debug line, and the few
   helpers every other module needs. Nothing here knows about Plex. */
var UI = (function () {
  'use strict';

  /* Every full-screen view in index.html. show() hides all of them and reveals
     one; show('player') is a legitimate call that reveals none of them, since
     the video element sits above the lot. */
  const VIEWS = ['browse', 'show', 'detail', 'link', 'message', 'search', 'devices'];

  /* Remote keycodes. The TV sends 461 for Back; a desktop browser sends 8 or
     27, which is what lets the whole app be driven from a keyboard in dev. */
  const KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    OK: 13, RED: 403,
    BACK: 461, ESC: 27, BACKSPACE: 8
  };

  const els = {};
  for (let i = 0; i < VIEWS.length; i++) els[VIEWS[i]] = document.getElementById(VIEWS[i]);

  const elToast = document.getElementById('toast');
  const elDebug = document.getElementById('debug');

  let current = 'browse';
  let toastTimer = null;
  const bootedAt = Date.now();

  function isBack(code) {
    return code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE;
  }

  function show(name) {
    current = name;
    for (let n = 0; n < VIEWS.length; n++) {
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
    const stamped = (Date.now() - bootedAt) + 'ms  ' + msg;
    elDebug.textContent = stamped;
    if (window.console && console.log) console.log('REFLEX ' + stamped);
    if (!Config.beacon) return;
    /* Never let logging break the app: the answer is thrown away, and so is
       any failure to deliver it. */
    Http.request(Config.beacon + '?m=' + encodeURIComponent(msg), { label: 'beacon' })
      .then(null, function () {});
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
