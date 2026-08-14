/* A show: its series across the top, its episodes down the side.

   The episode list is where playback actually starts, so each row carries the
   same verdict the detail page would give it — checked for the focused episode
   as you move, against the preferred server's copy. OK plays when that copy
   will direct play, and opens the copy chooser when it will not, which is the
   only time you need to care which server an episode came from. */
var ShowPage = (function () {
  'use strict';

  var elTitle = document.getElementById('sh-title');
  var elMeta = document.getElementById('sh-meta');
  var elSummary = document.getElementById('sh-summary');
  var elSeasons = document.getElementById('sh-seasons');
  var elEpisodes = document.getElementById('sh-episodes');
  var elArt = document.getElementById('sh-art');
  var elHint = document.getElementById('sh-hint');

  var EPISODE_POOL = 9;          // episode rows on screen at once

  var show = null;
  var seasons = [], seasonIdx = 0;
  var episodes = [], epIdx = 0;
  var zone = 'episodes';         // 'seasons' | 'episodes'
  var opts = {};
  var generation = 0;
  var verdicts = {};             // ratingKey -> verdict, for the rows
  var checkTimer = null;

  function open(entry, options) {
    if (!entry) return;
    show = entry;
    opts = options || {};
    generation++;
    seasons = []; episodes = []; seasonIdx = 0; epIdx = 0; zone = 'episodes';
    verdicts = {};

    UI.show('show');
    paintHeader();
    elSeasons.innerHTML = '';
    elEpisodes.innerHTML = '<div class="sh-episode">Loading…</div>';

    var gen = generation;
    Shows.seasons(entry).then(function (list) {
      if (gen !== generation) return;
      seasons = list;
      seasonIdx = Shows.openAt(list);
      renderSeasons();
      if (!list.length) {
        elEpisodes.innerHTML = '<div class="sh-episode">This server lists no series for ' +
                               'this show.</div>';
        return;
      }
      loadEpisodes();
    }).catch(function (e) {
      if (gen !== generation) return;
      UI.debug('seasons: ' + e.message);
      elEpisodes.innerHTML = '<div class="sh-episode">Could not read the series list.</div>';
    });
  }

  function close() {
    clearTimeout(checkTimer);
    show = null;
    if (opts.onExit) opts.onExit();
  }

  /* ---------- painting ---------- */

  function paintHeader() {
    elTitle.textContent = show.title || '';
    elSummary.textContent = show.summary || '';
    var bits = [];
    if (show.year) bits.push(show.year);
    var counts = Shows.summary(show);
    if (counts) bits.push(counts);
    if (show.contentRating) bits.push(show.contentRating);
    if (Merge.isShared(show)) bits.push('on ' + Merge.sources(show).length + ' servers');
    elMeta.textContent = bits.join('   ·   ');
    var art = Plex.artUrl(show, 960, 540);
    elArt.style.backgroundImage = art ? 'url("' + art + '")' : 'none';
  }

  function renderSeasons() {
    var html = '', i, cls;
    for (i = 0; i < seasons.length; i++) {
      cls = 'chip' + (i === seasonIdx ? ' cur' : '') +
            (zone === 'seasons' && i === seasonIdx ? ' on' : '');
      html += '<span class="' + cls + '">' + UI.escapeHtml(seasons[i].title || ('Series ' + (i + 1))) +
              '</span>';
    }
    elSeasons.innerHTML = html;
  }

  function verdictHtml(ep) {
    var v = verdicts[verdictKey(ep)];
    if (!v) return '';
    var state = v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn');
    return '<span class="badge ' + state + ' sh-verdict">' +
           UI.escapeHtml(Guard.label(v)) + '</span>';
  }

  function verdictKey(ep) { return ep._server + ':' + ep.ratingKey; }

  function renderEpisodes() {
    if (!episodes.length) {
      elEpisodes.innerHTML = '<div class="sh-episode">No episodes in this series.</div>';
      return;
    }
    /* A window, not the lot: a 24-episode series is common and drawing all of
       them costs more than it is worth. */
    var first = UI.clamp(epIdx - 4, 0, Math.max(0, episodes.length - EPISODE_POOL));
    var html = '', i, ep, on, watched;
    for (i = first; i < Math.min(first + EPISODE_POOL, episodes.length); i++) {
      ep = episodes[i];
      on = (i === epIdx && zone === 'episodes');
      watched = ep.viewOffset && ep.duration
        ? Math.round(100 * ep.viewOffset / ep.duration) + '%'
        : (ep.viewCount ? 'watched' : '');
      html += '<div class="sh-episode' + (on ? ' on' : '') + '">' +
              '<span class="sh-ep-num">' + (ep.index === undefined ? '·' : ep.index) + '</span>' +
              '<span class="sh-ep-title">' + UI.escapeHtml(ep.title || '') + '</span>' +
              '<span class="sh-ep-mins">' +
              (ep.duration ? Math.round(ep.duration / 60000) + ' min' : '') + '</span>' +
              '<span class="sh-ep-seen">' + UI.escapeHtml(watched) + '</span>' +
              verdictHtml(ep) +
              '</div>';
    }
    elEpisodes.innerHTML = html;
    elHint.textContent = zone === 'seasons'
      ? '← → choose a series · ↓ to the episodes · BACK to the rail'
      : '↑ ↓ choose an episode · OK to play · → other copies · BACK to the rail';
  }

  /* ---------- loading ---------- */

  function loadEpisodes() {
    var gen = generation;
    var season = seasons[seasonIdx];
    episodes = [];
    epIdx = 0;
    elEpisodes.innerHTML = '<div class="sh-episode">Loading…</div>';
    Shows.episodes(season).then(function (list) {
      if (gen !== generation) return;
      episodes = list;
      /* Land on the first unfinished episode: what you want is almost always
         the next one, not the first. */
      var i;
      for (i = 0; i < list.length; i++) {
        if (list[i].viewOffset || !list[i].viewCount) { epIdx = i; break; }
      }
      renderEpisodes();
      scheduleCheck();
    }).catch(function (e) {
      if (gen !== generation) return;
      UI.debug('episodes: ' + e.message);
      elEpisodes.innerHTML = '<div class="sh-episode">Could not read the episode list.</div>';
    });
  }

  /* The focused episode gets checked, once you have stopped moving. Everything
     the guard does is either cached or a hasMDE=1 query, so this costs the
     server a query per episode you rest on and opens no sessions. */
  function scheduleCheck() {
    clearTimeout(checkTimer);
    var ep = episodes[epIdx];
    if (!ep || verdicts[verdictKey(ep)]) return;
    var gen = generation;
    checkTimer = setTimeout(function () {
      Guard.check(ep, 0).then(function (v) {
        if (gen !== generation) return;
        verdicts[verdictKey(ep)] = v;
        renderEpisodes();
      });
    }, 300);
  }

  /* ---------- keys ---------- */

  function playFocused() {
    var ep = episodes[epIdx];
    if (!ep) return;
    var v = verdicts[verdictKey(ep)];
    /* Not checked yet, or the preferred copy will not play: the detail page is
       where every copy is listed, so send them there rather than guessing. */
    if (!v || !v.ok) { openCopies(); return; }
    if (opts.onPlay) opts.onPlay(ep, v);
  }

  function openCopies() {
    var ep = episodes[epIdx];
    if (ep && opts.onChoose) opts.onChoose(ep);
  }

  function key(code) {
    var K = UI.KEY;

    if (zone === 'seasons') {
      if (code === K.LEFT && seasonIdx > 0) { seasonIdx--; renderSeasons(); loadEpisodes(); return true; }
      if (code === K.RIGHT && seasonIdx < seasons.length - 1) {
        seasonIdx++; renderSeasons(); loadEpisodes(); return true;
      }
      if (code === K.DOWN || code === K.OK) {
        zone = 'episodes'; renderSeasons(); renderEpisodes(); return true;
      }
      if (UI.isBack(code)) { close(); return true; }
      return true;
    }

    if (code === K.UP) {
      if (epIdx > 0) { epIdx--; renderEpisodes(); scheduleCheck(); }
      else { zone = 'seasons'; renderSeasons(); renderEpisodes(); }
      return true;
    }
    if (code === K.DOWN && epIdx < episodes.length - 1) {
      epIdx++; renderEpisodes(); scheduleCheck();
      return true;
    }
    if (code === K.RIGHT) { openCopies(); return true; }
    if (code === K.OK) { playFocused(); return true; }
    if (UI.isBack(code)) { close(); return true; }
    return true;                     // this page swallows everything else
  }

  function current() { return show; }

  return { open: open, key: key, current: current };
})();
