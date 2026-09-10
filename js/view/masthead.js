/* The hero over the rail: the backdrop, the title, the line under it, and what
   the film is about with who is in it.

   No verdict here any more. Working out whether a copy will play means a
   metadata fetch per item you rest on, against a server we do not own, to
   answer a question you cannot act on until OK — and the detail page answers it
   properly, per copy, where the choice is actually made. */
var Masthead = (function () {
  'use strict';

  const elRow = document.getElementById('mh-row');
  const elTitle = document.getElementById('mh-title');
  const elMeta = document.getElementById('mh-meta');
  const elDesc = document.getElementById('mh-desc');
  const elCast = document.getElementById('mh-cast');
  /* The backdrop is two stacked layers; the one carrying .on is the one you see,
     and a new picture is written into the other and faded up over it. */
  const artLayers = [document.getElementById('hero-art-a'), document.getElementById('hero-art-b')];
  let shown = 0;
  /* Long enough that sweeping a row never starts a full-screen image, short
     enough that a deliberate step still feels answered. */
  const HOLD = 420; // ms of stillness before asking for a backdrop
  let artTimer = null;
  let artWant = null;
  let lastArt = '';

  /* The backdrop, debounced: only the last item asked for is drawn, so sweeping
     a row costs one full-screen image rather than one per key. */
  function art(item) {
    artWant = item;
    clearTimeout(artTimer);
    artTimer = setTimeout(paintArt, HOLD);
  }

  function paintArt() {
    Art.warm(artWant);
    const url = Art.hero(artWant);
    if (!url || url === lastArt) return;
    lastArt = url;

    /* Swap only once the picture is decoded, or the fade reveals an empty box.
       A broken URL swaps anyway, so it cannot leave the old one up for ever;
       a swap the next backdrop has already overtaken is dropped. */
    const next = artLayers[shown ? 0 : 1];
    const pre = new Image();
    pre.onload = pre.onerror = () => {
      if (lastArt !== url) return;
      next.style.backgroundImage = `url("${url}")`;
      artLayers[shown].classList.remove('on');
      next.classList.add('on');
      shown = shown ? 0 : 1;
    };
    pre.src = url;
  }

  /* A backdrop that lands after the debounce fired belongs on screen only if
     the item it belongs to is still the one being rested on. */
  Art.onReady((tmdbId) => {
    if (!artWant || Plex.tmdbId(artWant) !== tmdbId) return;
    paintArt();
    paintFacts(artWant);
  });

  /* The description and the top of the billing, out of the one TMDB request the
     backdrop already cost. Plex's own summary stands in until it lands, so the
     header never blanks while waiting, and an empty cast draws no line at all
     rather than a label with nothing after it. */
  function paintFacts(item) {
    const got = Art.factsFor(item);
    elDesc.textContent = (got && got.overview) || item.summary || '';
    elCast.textContent = got && got.cast.length ? got.cast.join('  \u00b7  ') : '';
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
    /* A Discovery title says whether we hold it instead: it has no run time to
       show until it has been resolved, and whether we have it is the fact you
       need before pressing OK. */
    elMeta.textContent = item._availability || Media.railSub(item);
    paintFacts(item);
  }

  return { render: render, art: art };
})();
