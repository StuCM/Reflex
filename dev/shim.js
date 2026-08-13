/* Laptop-only shim, injected by dev/server.js. Never packaged.
   Runs in desktop Chrome, so modern syntax is fine here.

   Two jobs: fit a 1920x1080 app into a laptop window, and give the keys the
   Magic Remote has that a keyboard does not. */
(function () {
  'use strict';

  /* ---- fit to window ---- */

  function fit() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.zoom = scale;
  }
  fit();
  window.addEventListener('resize', fit);

  /* ---- remote keys ---- */

  /* webOS keycodes the app listens for that a keyboard cannot produce.
     Arrows, Enter, Escape and Backspace already arrive with the right codes. */
  const MAP = {
    F1: 403,     // red button — search
    F2: 461,     // webOS Back, the code the TV actually sends
    KeyP: 415,   // play
    KeyO: 19,    // pause
    KeyS: 413,   // stop
    Comma: 412,  // rewind
    Period: 417  // fast forward
  };

  window.addEventListener('keydown', function (e) {
    if (e._reflexSynthetic) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

    if (e.code === 'Slash' && e.shiftKey) { toggleHelp(); e.preventDefault(); return; }

    const code = MAP[e.code];
    if (!code) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const fake = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(fake, 'keyCode', { get: function () { return code; } });
    Object.defineProperty(fake, 'which', { get: function () { return code; } });
    fake._reflexSynthetic = true;
    document.dispatchEvent(fake);
  }, true);

  /* ---- help ---- */

  const KEYS = [
    ['Arrows', 'move · seek while playing'],
    ['Enter', 'OK — play, or activate a chip'],
    ['Backspace / Esc', 'Back'],
    ['F1', 'red button (search)'],
    ['F2', 'Back, using the TV\'s own keycode 461'],
    ['P / O / S', 'play · pause · stop'],
    [', / .', 'rewind · fast forward'],
    ['?', 'this list']
  ];

  let help = null;
  function toggleHelp() {
    if (help) { help.parentNode.removeChild(help); help = null; return; }
    help = document.createElement('div');
    help.setAttribute('style', [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:9999', 'background:#16161c', 'color:#e8e8ea', 'padding:36px 48px',
      'border:2px solid #3a3a44', 'border-radius:10px', 'font:24px/1.7 Helvetica,Arial',
      'box-shadow:0 20px 60px rgba(0,0,0,0.6)'
    ].join(';'));
    help.innerHTML =
      '<div style="font-size:30px;margin-bottom:20px">Reflex dev keys</div>' +
      KEYS.map(function (k) {
        return '<div><b style="display:inline-block;width:320px;color:#e5a00d">' +
               k[0] + '</b>' + k[1] + '</div>';
      }).join('') +
      '<div style="margin-top:24px;color:#8b8b93;font-size:20px">' +
      'This overlay and the key mapping are dev-only — dev/shim.js is not packaged.</div>';
    document.body.appendChild(help);
  }

  /* ---- a corner marker, so a screenshot is never mistaken for the TV ---- */

  const mark = document.createElement('div');
  mark.textContent = 'DEV · ? for keys';
  mark.setAttribute('style', 'position:fixed;right:8px;bottom:6px;z-index:9998;' +
    'font:16px Helvetica,Arial;color:#4a4a52');
  window.addEventListener('load', function () { document.body.appendChild(mark); });
})();
