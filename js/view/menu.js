/* The list of things to choose from, and the four arrows that walk it.

   Two screens need exactly this: the player, where it is audio, subtitles,
   quality and chapters, and the film page, where it is the copy, the version,
   the track and the subtitles. What each row means, and what choosing it
   costs, belongs to those screens. What is here is the shell — tabs across the
   top, a list that winds to keep the selection in view, and an overlay that
   takes every key while it is up, because a selection nobody can see must not
   be moving behind one. */
var Menu = (function () {
  'use strict';

  const ROW_H = 56; // .menu-row, in CSS pixels
  const ROWS_SHOWN = 7;

  let host = null;
  let tabs = [];
  let tab = 0;
  let sel = 0;
  let built = [];
  let onChoose = null;
  let onClose = null;
  let elTabs = null;
  let elInner = null;
  let elNote = null;

  /* A tab's rows are asked for when the tab is shown, not when the menu opens:
     what is on offer depends on where playback has got to, and a list built
     four tabs ago is stale by the time you reach it. */
  function build() {
    const list = tabs[tab] ? tabs[tab].rows() : [];
    built = list.length ? list : [{ label: 'Nothing to choose here', off: true }];
  }

  function rows() {
    return built;
  }

  /* Land on what is already in use, so OK on the first press is a no-op rather
     than a surprise. */
  function land() {
    const list = rows();
    sel = 0;
    for (let i = 0; i < list.length; i++)
      if (list[i].on) {
        sel = i;
        return;
      }
  }

  function paint() {
    const list = rows();
    let html = '';
    let i;
    for (i = 0; i < tabs.length; i++) {
      html +=
        `<span class="menu-tab${i === tab ? ' on' : ''}">` +
        UI.escapeHtml(tabs[i].label) +
        '</span>';
    }
    elTabs.innerHTML = html;

    html = '';
    for (i = 0; i < list.length; i++) {
      const r = list[i];
      html +=
        `<div class="menu-row${i === sel ? ' sel' : ''}` +
        (r.on ? ' on' : '') +
        (r.off ? ' off' : '') +
        '">' +
        '<span class="menu-mark">' +
        (r.on ? '●' : '') +
        '</span>' +
        '<span class="menu-label">' +
        UI.escapeHtml(r.label) +
        '</span>' +
        (r.note ? `<span class="menu-note-inline">${UI.escapeHtml(r.note)}</span>` : '') +
        '</div>';
    }
    elInner.innerHTML = html;

    /* Keep the selection in view without a scrollbar the remote cannot use. */
    const top = UI.clamp(sel - 3, 0, Math.max(0, list.length - ROWS_SHOWN));
    elInner.style.webkitTransform = elInner.style.transform = `translateY(${-top * ROW_H}px)`;
    elNote.textContent = (tabs[tab] && tabs[tab].note) || '';
  }

  /* Draw tabs of [{ label, note, rows }] into host and take the d-pad until a
     row is chosen or BACK closes it. Each tab's rows() returns
     [{ label, note, on, value }]; value is whatever onChoose is to act on. */
  function open(o) {
    host = o.host;
    tabs = o.tabs || [];
    tab = o.tab || 0;
    onChoose = o.onChoose || null;
    onClose = o.onClose || null;
    /* Built once per host and then kept: the winding transition lives on
       .menu-inner, and an element replaced on every paint never runs one. */
    if (!host.firstChild) {
      host.innerHTML =
        '<div class="menu-tabs"></div>' +
        '<div class="menu-list"><div class="menu-inner"></div></div>' +
        '<div class="menu-note"></div>';
    }
    elTabs = host.querySelector('.menu-tabs');
    elInner = host.querySelector('.menu-inner');
    elNote = host.querySelector('.menu-note');
    build();
    land();
    host.classList.remove('hidden');
    paint();
  }

  function close() {
    if (!host) return;
    const done = onClose;
    host.classList.add('hidden');
    host = null;
    tabs = [];
    onChoose = null;
    onClose = null;
    if (done) done();
  }

  function isOpen() {
    return !!host;
  }

  /* Closed before the choice is acted on, so a screen that reopens the menu or
     tears itself down in response is not fighting an overlay that is still up. */
  function choose() {
    const r = rows()[sel];
    const go = onChoose;
    close();
    if (r && !r.off && go) go(r.value, r);
  }

  function key(code) {
    const list = rows();
    if (code === 38) {
      sel = (sel + list.length - 1) % list.length;
      paint();
      return true;
    }
    if (code === 40) {
      sel = (sel + 1) % list.length;
      paint();
      return true;
    }
    if ((code === 37 || code === 39) && tabs.length > 1) {
      tab = (tab + (code === 39 ? 1 : tabs.length - 1)) % tabs.length;
      build();
      land();
      paint();
      return true;
    }
    if (code === 13 || code === 415 || code === 19) {
      choose();
      return true;
    }
    if (UI.isBack(code) || code === 413) {
      close();
      return true;
    }
    return true; // the menu swallows everything else
  }

  return { open: open, close: close, isOpen: isOpen, key: key };
})();
