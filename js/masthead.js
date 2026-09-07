/* The hero over the rail: the backdrop, the title, the line under it, and what
   the film is about with who is in it.

   No verdict here any more. Working out whether a copy will play means a
   metadata fetch per item you rest on, against a server we do not own, to
   answer a question you cannot act on until OK — and the detail page answers it
   properly, per copy, where the choice is actually made. */
var Masthead = (function () {
  'use strict';

  var elRow = document.getElementById('mh-row');
  var elTitle = document.getElementById('mh-title');
  var elMeta = document.getElementById('mh-meta');
  var elDesc = document.getElementById('mh-desc');
  var elCast = document.getElementById('mh-cast');
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
    if (!artWant || Plex.tmdbId(artWant) !== tmdbId) return;
    paintArt();
    paintFacts(artWant);
  });

  /* The description and the top of the billing, out of the one TMDB request the
     backdrop already cost. Plex's own summary stands in until it lands, so the
     header never blanks while waiting, and an empty cast draws no line at all
     rather than a label with nothing after it. */
  function paintFacts(item) {
    var got = Art.factsFor(item);
    elDesc.textContent = (got && got.overview) || item.summary || '';
    elCast.textContent = (got && got.cast.length) ? got.cast.join('  \u00b7  ') : '';
  }

  function render(row, item, hasRows) {
    elRow.textContent = (row && row.title) || '';

    if (!item) {
      elTitle.textContent = hasRows ? '\u2026' : 'Loading\u2026';
      elMeta.textContent = '';
      elDesc.textContent = '';
      elCast.textContent = '';
      return;
    }

    /* The same two rules the tile under it uses, so the hero names the show and
       the line beneath says which episode — not the other way round. */
    elTitle.textContent = Media.railTitle(item);
    elMeta.textContent = Media.railSub(item);
    paintFacts(item);
  }

  return { render: render, art: art };
})();
