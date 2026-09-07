/* The hero over the rail: the backdrop, the title, and one line under it.

   No verdict here any more. Working out whether a copy will play means a
   metadata fetch per item you rest on, against a server we do not own, to
   answer a question you cannot act on until OK — and the detail page answers it
   properly, per copy, where the choice is actually made. */
var Masthead = (function () {
  'use strict';

  var elRow = document.getElementById('mh-row');
  var elTitle = document.getElementById('mh-title');
  var elMeta = document.getElementById('mh-meta');
  var elArt = document.getElementById('hero-art');
  var HOLD = 280;                // ms of stillness before asking for a backdrop
  var artTimer = null, artWant = null, lastArt = '';

  /* The backdrop, debounced: only the last item asked for is drawn, so sweeping
     a row costs one full-screen image rather than one per key. */
  function art(item) {
    artWant = item;
    clearTimeout(artTimer);
    artTimer = setTimeout(paintArt, HOLD);
  }

  function paintArt() {
    Art.warm(artWant);
    var url = Art.hero(artWant);
    if (!url || url === lastArt) return;
    lastArt = url;
    elArt.style.backgroundImage = 'url("' + url + '")';
  }

  /* A backdrop that lands after the debounce fired belongs on screen only if
     the item it belongs to is still the one being rested on. */
  Art.onReady(function (tmdbId) {
    if (artWant && Plex.tmdbId(artWant) === tmdbId) paintArt();
  });

  function render(row, item, hasRows) {
    elRow.textContent = (row && row.title) || '';

    if (!item) {
      elTitle.textContent = hasRows ? '\u2026' : 'Loading\u2026';
      elMeta.textContent = '';
      return;
    }

    elTitle.textContent = item.title || '';

    /* One line, and only the line you need to decide: where you are in a show,
       how long a film runs. Everything else this used to carry — the year, the
       certificate, how far through you are, which of thirty thousand this is —
       is on the detail page OK opens. */
    if (item.type === 'episode') elMeta.textContent = Media.episodeLabel(item);
    else if (item.type === 'show') elMeta.textContent = Shows.summary(item) || '';
    else elMeta.textContent = item.duration ? Math.round(item.duration / 60000) + ' min' : '';
  }

  return { render: render, art: art };
})();
